import json
from datetime import datetime
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable
from backend.config import settings
from backend.database import get_db_connection
from backend.roster_manager import RosterManager
from backend.rag_engine import rag_engine

class AssignmentEngine:
    def __init__(self):
        self.roster_mgr = RosterManager()
        # ChatOllama goes through LangChain, so every .invoke() is auto-traced
        # by LangSmith when LANGSMITH_TRACING=true is in the environment.
        self.llm = ChatOllama(
            base_url=settings.OLLAMA_BASE_URL,
            model=settings.OLLAMA_TEXT_MODEL,
            temperature=0.1,
        )

    def get_candidate_associates(self, category: str, dt: datetime, rejected_list: list) -> tuple[list, str]:
        """
        Retrieves associates matching the tech team, who are currently on shift.
        If no associates are available, falls back to the L1 Support team.
        """
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Mapping categories to tech domains in the Excel sheets
        # MFT, ESB, Azure, Database, ETL
        domain = category
        if category not in ["MFT", "ESB", "Azure", "Database", "ETL"]:
            domain = "L1 Support"
            
        cursor.execute("SELECT name, domain, skill_level, active_tickets FROM associates WHERE domain = ?", (domain,))
        candidates = [dict(r) for r in cursor.fetchall()]
        
        # Filter by shift availability
        on_shift = self.roster_mgr.get_active_associates(candidates, dt)
        
        # Exclude already rejected associates
        available = [c for c in on_shift if c["name"] not in rejected_list]
        
        route_status = f"Matched to tech domain: {domain}"
        
        # Fallback to L1 Support if no team members are active in the target domain
        if not available and domain != "L1 Support":
            print(f"No active associates in domain {domain}. Escalating to L1 Support Team...")
            cursor.execute("SELECT name, domain, skill_level, active_tickets FROM associates WHERE domain = 'L1 Support'")
            l1_candidates = [dict(r) for r in cursor.fetchall()]
            on_shift_l1 = self.roster_mgr.get_active_associates(l1_candidates, dt)
            available = [c for c in on_shift_l1 if c["name"] not in rejected_list]
            route_status = "Escalated to L1 Support (Domain members unavailable)"
            
        # Hard fallback: if still no one is on shift anywhere, find any on-shift associate as a safety valve
        if not available:
            cursor.execute("SELECT name, domain, skill_level, active_tickets FROM associates")
            all_candidates = [dict(r) for r in cursor.fetchall()]
            on_shift_any = self.roster_mgr.get_active_associates(all_candidates, dt)
            available = [c for c in on_shift_any if c["name"] not in rejected_list]
            route_status = "Escalated to Any On-Shift Associate (No team/L1 members active)"
            
        # Super hard fallback: if NO ONE is on shift, return all associates in the matching domain (on or off shift)
        if not available:
            print("No associates on shift at all. Returning off-shift candidates as fallback...")
            cursor.execute("SELECT name, domain, skill_level, active_tickets FROM associates WHERE domain = ?", (domain,))
            available = [dict(r) for r in cursor.fetchall() if r["name"] not in rejected_list]
            route_status = f"Assigned to off-shift associate in {domain} (No active roster coverage)"
            
        conn.close()
        return available, route_status

    def calculate_heuristic_scores(self, incident: dict, candidates: list, rag_matches: list) -> list:
        """
        Calculates a compatibility score for each candidate associate.
        """
        scored_candidates = []
        prio = str(incident["priority"])
        
        for cand in candidates:
            # Start with base score of 50
            score = 50.0
            reasons = []
            
            # 1. Workload balancing (Penalize queue size: -15 points per active ticket)
            active_tkts = cand["active_tickets"]
            workload_penalty = active_tkts * 15
            score -= workload_penalty
            reasons.append(f"Workload: {active_tkts} active tickets (-{workload_penalty} pts)")
            
            # 2. Skill Proficiency vs Incident Priority
            # Priority 1 (Critical) & 2 (High) are senior tickets
            skill = cand["skill_level"]
            if prio in ["1", "2"]:
                if skill == "L3":
                    score += 35
                    reasons.append("SLA Urgency: Senior associate L3 matched to high priority (+35 pts)")
                elif skill == "L2":
                    score += 15
                    reasons.append("SLA Urgency: Mid-level associate L2 matched to high priority (+15 pts)")
                elif skill == "L1":
                    score -= 20
                    reasons.append("SLA Urgency: L1 junior associate penalized for high priority (-20 pts)")
            else:
                # Priority 3 (Moderate) & 4 (Low) are standard tickets
                if skill == "L1":
                    score += 25
                    reasons.append("Workload/SLA: L1 junior associate matched to standard priority (+25 pts)")
                elif skill in ["L2", "L3"]:
                    score += 10
                    reasons.append(f"Workload/SLA: Senior associate {skill} matched to standard ticket (+10 pts)")
                    
            # 3. Domain Experience (RAG lookup matches)
            rag_bonus = 0.0
            rag_count = 0
            for match in rag_matches:
                if match["resolved_by"] == cand["name"]:
                    # Add points based on similarity of their past resolution
                    bonus = match["similarity_score"] * 0.4
                    rag_bonus += bonus
                    rag_count += 1
                    
            if rag_count > 0:
                score += rag_bonus
                reasons.append(f"RAG History: Solved {rag_count} similar incident(s) in past (+{round(rag_bonus, 1)} pts)")
                
            cand_scored = cand.copy()
            cand_scored["heuristic_score"] = round(score, 1)
            cand_scored["score_breakdown"] = reasons
            scored_candidates.append(cand_scored)
            
        # Sort candidates by heuristic score descending
        scored_candidates.sort(key=lambda x: x["heuristic_score"], reverse=True)
        return scored_candidates

    @traceable(name="execute_assignment", run_type="chain")
    def execute_assignment(self, incident_number: str) -> dict:
        """
        Retrieves incident details, runs the scoring heuristic, invokes the Ollama LLM
        for reasoning, and records the audit log in SQLite.
        """
        conn = get_db_connection()
        cursor = conn.cursor()
        print('api key',settings.LANGSMITH_ENDPOINT)
        # 1. Fetch incident
        cursor.execute("SELECT * FROM incidents WHERE number = ?", (incident_number,))
        inc_row = cursor.fetchone()
        
        if not inc_row:
            conn.close()
            return {"status": "error", "message": "Incident not found"}
            
        incident = dict(inc_row)
        
        # Parse rejected list
        rejected_list = json.loads(incident["rejected_associates"] or "[]")
        
        # 2. Search RAG for similar resolved tickets
        rag_matches = rag_engine.search_similar_incidents(
            f"{incident['short_description']} {incident['description']}", 
            top_k=2
        )
        
        # 3. Find candidates on shift
        now = datetime.now()
        candidates, route_status = self.get_candidate_associates(incident["category"], now, rejected_list)
        
        if not candidates:
            conn.close()
            return {"status": "error", "message": "No candidates available for assignment."}
            
        # 4. Score candidates
        scored_candidates = self.calculate_heuristic_scores(incident, candidates, rag_matches)
        
        # 5. Build prompt for Ollama
        prompt = self.build_ollama_prompt(incident, scored_candidates, rag_matches, route_status)
        
        # 6. Call Ollama
        recommendation = self.call_ollama_llm(prompt, scored_candidates[0]["name"])
        
        # 7. Update Database
        conf_score = recommendation["confidence_score"]
        rec_associate = recommendation["recommended_associate"]
        justification = recommendation["justification"]
        
        # If score is below 70%, flag for human review
        new_status = "Assigned"
        if conf_score < settings.CONFIDENCE_THRESHOLD:
            new_status = "Flagged"
            
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
            justification,
            json.dumps(scored_candidates),
            "Pending_Approval" if new_status == "Flagged" else "Approved",
            datetime.utcnow().isoformat()
        ))
        
        # Update incident record
        # If approved automatically, set assigned_to. Else keep empty for human review.
        assigned_to = rec_associate if new_status == "Assigned" else None
        assigned_at = datetime.utcnow().isoformat() if new_status == "Assigned" else None
        
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

    @traceable(name="build_ollama_prompt", run_type="chain")
    def build_ollama_prompt(self, incident: dict, candidates: list, rag_matches: list, route_status: str) -> str:
        candidates_str = ""
        for c in candidates:
            candidates_str += f"- Name: {c['name']}, Domain: {c['domain']}, Skill Level: {c['skill_level']}, Active Tickets: {c['active_tickets']}, Heuristic Score: {c['heuristic_score']}\n"
            candidates_str += f"  Factors: {', '.join(c['score_breakdown'])}\n"
        print("BUILD OLLAMA CALLED")
        rag_str = ""
        if rag_matches:
            for i, m in enumerate(rag_matches):
                rag_str += f"Match {i+1} (Similarity {m['similarity_score']}%):\n"
                rag_str += f"  - Short Description: {m['short_description']}\n"
                rag_str += f"  - Resolution: {m['resolution']}\n"
                rag_str += f"  - Resolved By: {m['resolved_by']}\n"
        else:
            rag_str = "No historical matching incidents found.\n"
            
        prompt = f"""[System Instruction]
You are an AI Dispatcher for ServiceNow incidents. Analyze the incident details, historical solutions, and candidate associates, and choose the single best associate to handle this incident.

INCIDENT TO ASSIGN:
- Ticket: {incident['number']}
- Category: {incident['category']}
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
3. Skill level match: High priority (1 or 2) tickets require L3 or L2 associates. Junior (L1) associates should receive L4 or L3 priority tickets.
4. Output a Confidence Score (0-100%). If the candidates are a poor match, or workload is high, reduce the score. If a candidate is a perfect match (L3, on shift, has resolved this exact issue in past, has low workload), confidence should be 85%+.

RESPONSE FORMAT:
You MUST respond with a single JSON object. Do not include markdown wraps (like ```json), headers, or explanations. Use this schema:
{{
  "recommended_associate": "Full Name of Selected Associate",
  "confidence_score": 85,
  "justification": "Detailed explanation mentioning their skill level, shift availability, RAG history, and workload."
}}
"""
        return prompt

    @traceable(name="call_ollama_llm", run_type="llm")
    def call_ollama_llm(self, prompt: str, default_candidate: str) -> dict:
        """
        Calls Ollama through ChatOllama so the request/response is captured
        as a single LLM run in LangSmith. Falls back to the top heuristic
        candidate if Ollama is unreachable or returns unparseable JSON.
        """
        print("CALL OLLAMA CALLED")
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

        # Fallback to the top candidate from heuristic scoring if LLM fails
        return {
            "recommended_associate": default_candidate,
            "confidence_score": 65.0,  # Below 70% threshold so it goes to human review
            "justification": f"Fallback: Ollama generation failed. Selected highest ranking heuristic candidate {default_candidate}. Requires manual auditing.",
        }

assignment_engine = AssignmentEngine()
