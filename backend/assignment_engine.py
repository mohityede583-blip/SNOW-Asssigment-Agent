import json
from datetime import datetime, timezone
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable
from backend.config import settings
from backend.database import get_db_connection
from backend.roster_manager import RosterManager
from backend.rag_engine import rag_engine
from langchain_google_genai import ChatGoogleGenerativeAI
from backend.servicenow_client import servicenow_client

class AssignmentEngine:
    # Points awarded per listed skill that appears in the incident text.
    # Tunable. High weightage to prioritize specialized skills.
    SKILL_MATCH_BONUS = 30.0

    def __init__(self):
        self.roster_mgr = RosterManager()
        # ChatOllama goes through LangChain, so every .invoke() is auto-traced
        # by LangSmith when LANGSMITH_TRACING=true is in the environment.
        self.llm = ChatOllama(
            base_url=settings.OLLAMA_BASE_URL,
            model=settings.OLLAMA_TEXT_MODEL,
            temperature=0.1,
        )

        self.google = ChatGoogleGenerativeAI(
            model=settings.GOOGLE_LLM,
            api_key=settings.GOOGLE_API_KEY,
            temperature=0.1
        )

    @staticmethod
    def _count_skill_matches(skills_csv: str | None, incident_text: str) -> int:
        """
        Count how many of the candidate's listed skills appear (as a
        case-insensitive substring) in the incident text. Returns 0 when
        the candidate has no skills recorded (e.g. SNOW-synced rows).
        """
        if not skills_csv or not incident_text:
            return 0
        haystack = incident_text.lower()
        hits = 0
        for raw in skills_csv.split(","):
            skill = raw.strip().lower()
            # Skip tokens that are too short to be meaningful substrings.
            if len(skill) < 3:
                continue
            if skill in haystack:
                hits += 1
        return hits

    @traceable(name="get_candidate_associates",run_type="tool")
    def get_candidate_associates(self, dt: datetime, rejected_list: list) -> tuple[list, str]:
        """
        Retrieves associates who are currently on shift.
        If no associates are available on shift, falls back to all associates.
        """
        conn = get_db_connection()
        cursor = conn.cursor()

        # Fetch all associates regardless of domain to ensure a broader candidate pool.
        # Specialization is handled by the scoring heuristic, not by initial filtering.
        cursor.execute("SELECT name, domain, skill_level, active_tickets, skills FROM associates")
        candidates = [dict(r) for r in cursor.fetchall()]

        # Filter by shift availability
        on_shift = self.roster_mgr.get_active_associates(candidates, dt)

        # Exclude already rejected associates
        available = [c for c in on_shift if c["name"] not in rejected_list]

        route_status = "Considering all on-shift associates"

        # Super hard fallback: if NO ONE is on shift, return all associates as fallback
        if not available:
            print("No associates on shift at all. Returning off-shift candidates as fallback...")
            available = [c for c in candidates if c["name"] not in rejected_list]
            route_status = "Assigned to off-shift associate (No active roster coverage)"

        conn.close()
        return available, route_status

    @traceable(name="get_candidate_details",run_type="tool")
    def calculate_heuristic_scores(self, candidates: list, rag_matches: list) -> list:
        """
        Retrieves essential details for each candidate to be used by the LLM for decision making.
        Returns a list of candidates with their profile and RAG match count.
        """
        candidate_details = []

        for cand in candidates:
            # Count RAG matches for this candidate
            rag_count = sum(1 for match in rag_matches if match["resolved_by"] == cand["name"])

            candidate_details.append({
                "name": cand["name"],
                "domain": cand["domain"],
                "skills": cand.get("skills") or "No specific skills listed",
                "active_tickets": cand["active_tickets"],
                "rag_count": rag_count
            })

        # Sort by RAG count (desc) then active tickets (asc) to provide a sensible default order
        candidate_details.sort(key=lambda x: (-x["rag_count"], x["active_tickets"]))
        return candidate_details

    @traceable(name="execute_assignment", run_type="chain")
    def execute_assignment(self, incident_number: str) -> dict:
        """
        Retrieves incident details, gathers candidate profiles, invokes the Ollama LLM
        for reasoning, and records the audit log in SQLite.
        """
        conn = get_db_connection()
        cursor = conn.cursor()
        # 1. Fetch incident
        print('STAGE 1: FETCHING INC DETAILS')
        cursor.execute("SELECT * FROM incidents WHERE number = ?", (incident_number,))
        inc_row = cursor.fetchone()

        if not inc_row:
            conn.close()
            return {"status": "error", "message": "Incident not found"}

        incident = dict(inc_row)

        # Parse rejected list
        rejected_list = json.loads(incident["rejected_associates"] or "[]")

        # 2. Search RAG for similar resolved tickets
        print('STAGE 2: SEARCHING FOR SIMILAR INC')
        traced_similar_inc = traceable(
            rag_engine.search_similar_incidents,
            name="search_similar_incidents",
            run_type='retriever'
        )

        rag_matches = traced_similar_inc(
            f"{incident['short_description']} {incident['description']}",
            top_k=3
        )

        # 3. Find candidates on shift
        print('STAGE 3: FINDING ON SHIFT ASSOCIATES')
        now = datetime.now()
        candidates, route_status = self.get_candidate_associates(now, rejected_list)
        if not candidates:
            conn.close()
            return {"status": "error", "message": "No candidates available for assignment."}

        # 4. Gather candidate details
        print('STAGE 4: GATHERING CANDIDATE PROFILES')
        scored_candidates = self.calculate_heuristic_scores(candidates, rag_matches)
        # 5. Build prompt for Ollama
        print("STAGE 5: BUILDING PROMPT")
        prompt = self.build_ollama_prompt(incident, scored_candidates, rag_matches, route_status)
        # 6. Call Ollama
        print('STAGE 6: CALLING LLM')
        recommendation = self.call_ollama_llm(prompt, scored_candidates[0]["name"])
        # 7. Update Database
        print('STAGE 7: SNOW ASSIGNMENT')
        conf_score = recommendation["confidence_score"]
        rec_associate = recommendation["recommended_associate"]
        justification = recommendation["justification"]

        # If score is below 70%, flag for human review
        new_status = "Assigned"
        print(f'conf_score:{conf_score} {type(conf_score)} threshold:{settings.CONFIDENCE_THRESHOLD}')
        if conf_score < settings.CONFIDENCE_THRESHOLD:
            new_status = "Flagged"
            servicenow_client.update_work_notes(incident["sys_id"],"ASSIGNMENT: Assign it to available engineer.")
            return {"status": "Flagged"}

        # Save audit log
        cursor.execute("""
        INSERT INTO assignment_logs (
            incident_number, recommended_associate, confidence_score,
            justification, evaluated_associates, decision_status, assigned_by, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, 'AI', ?)
        """, (
            incident_number,
            rec_associate,
            conf_score,
            "ASSIGNMENT:"+justification,
            json.dumps(scored_candidates),
            "Pending_Approval" if new_status == "Flagged" else "Approved",
            datetime.now(timezone.utc).isoformat()
        ))

        # Update incident record
        # If approved automatically, set assigned_to. Else keep empty for human review.
        assigned_to = rec_associate if new_status == "Assigned" else None
        assigned_at = datetime.now(timezone.utc).isoformat() if new_status == "Assigned" else None


        cursor.execute("""
        UPDATE incidents
        SET status = ?, assigned_to = ?, assigned_at = ?
        WHERE number = ?
        """, (new_status, assigned_to, assigned_at, incident_number))

        # Increment active tickets for the associate if auto-assigned
        if new_status == "Assigned":
            cursor.execute("""
            UPDATE associates
            SET active_tickets = active_tickets + 1
            WHERE name = ?
            """, (rec_associate,))

        conn.commit()
        conn.close()

        return {
            "status": "success",
            "incident_number": incident_number,
            "recommended_associate": rec_associate,
            "confidence_score": conf_score,
            "justification": justification,
            "assignment_status": new_status,
            "route_status": route_status,
            "candidates": scored_candidates
        }

    @traceable(name="build_ollama_prompt", run_type="prompt")
    def build_ollama_prompt(self, incident: dict, candidates: list, rag_matches: list, route_status: str) -> str:
        candidates_str = ""
        for c in candidates:
            candidates_str += f"- Name: {c['name']}, Domain: {c['domain']}, Skills: {c['skills']}, Active Tickets: {c['active_tickets']}, RAG History: Solved {c['rag_count']} similar incident(s)\n"
        rag_str = ""
        if rag_matches:
            for i, m in enumerate(rag_matches):
                rag_str += f"\nMatch {i+1} (Similarity {m['similarity_score']}%):\n"
                rag_str += f"  - Short Description: {m['short_description']}\n"
                rag_str += f"  - Resolution: {m['resolution']}\n"
                rag_str += f"  - Resolved By: {m['resolved_by']}\n"
        else:
            rag_str = "No historical matching incidents found.\n"

        prompt = f"""[System Instruction]
You are an AI Dispatcher for ServiceNow incidents. Analyze the incident details, historical solutions, and candidate associates, and choose the single best associate to handle this incident.

INCIDENT TO ASSIGN:
- Ticket: {incident['number']}
- Short Description: {incident['short_description']}
- Description: {incident['description']}
- Priority: {incident['priority']} (1=Critical, 2=High, 3=Moderate, 4=Low)
- Route Status: {route_status}

HISTORICAL SOLUTIONS (RAG):
{rag_str}

CANDIDATES CURRENTLY ON SHIFT:
{candidates_str}

DECISION RULES:
1. Prioritize associates who resolved highly similar tickets in the past (RAG History).
2. Balance workloads: avoid assigning to associates with high number of active tickets if someone else is available.
3. Skills Matching: make sure associate should have skillset which needs to resolve given incident.
4. Output a Confidence Score (0-100%). If the candidates are a poor match, or workload is high, reduce the score. If a candidate is a perfect match (on shift and has resolved this exact issue in past), confidence should be increase.

RESPONSE FORMAT:
You MUST respond with a single JSON object. Do not include markdown wraps (like ```json), headers, or explanations. Use this schema:
{{
  "recommended_associate": "Full Name of Selected Associate",
  "confidence_score": "A dynamic Confidence Score range from 0 to 100 based on how much you sure about recommended associate capability to resolve given incident",
  "justification": "Detailed explanation why should we assign incident to recommended associate mentioning their shift availability, RAG history, and matching skillsets in bullet points"
}}
"""
        return prompt

    @traceable(name="call_ollama_llm", run_type="llm")
    def call_ollama_llm(self, prompt: str, default_candidate: str) -> dict:
        """
        Calls Ollama through ChatOllama so the request/response is captured
        as a single LLM run in LangSmith. Falls back to the top candidate
        if Ollama is unreachable or returns unparseable JSON.
        """
        try:
            response = self.llm.invoke(
                [
                    SystemMessage(
                        content=(
                            "You are an AI Dispatcher for ServiceNow incidents. "
                            "Always respond with valid JSON matching the requested "
                            "schema. No markdown fences."
                        )
                    ),
                    HumanMessage(content=prompt),
                ]
            )
            text_out = (response.content or "").strip()

            # Strip markdown fences if the model still added them
            if text_out.startswith("```"):
                lines = text_out.split("\n")
                if lines and lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                text_out = "\n".join(lines).strip()

            res_json = json.loads(text_out)
            if "recommended_associate" in res_json and "confidence_score" in res_json:
                return {
                    "recommended_associate": res_json["recommended_associate"],
                    "confidence_score": float(res_json["confidence_score"]),
                    "justification": res_json.get(
                        "justification",
                        "Assigned based on skill profile and shift schedule.",
                    ),
                }
        except Exception as e:
            print(f"Error calling Ollama LLM or parsing response: {e}")

        # Fallback to the top candidate from the provided list if LLM fails
        return {
            "recommended_associate": default_candidate,
            "confidence_score": 65.0,  # Below 70% threshold so it goes to human review
            "justification": f"Fallback: Ollama generation failed. Selected top candidate based on RAG and workload: {default_candidate}. Requires manual auditing.",
        }

assignment_engine = AssignmentEngine()
