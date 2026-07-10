import asyncio
import json
from datetime import datetime
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# pydantic-settings in backend.config reads .env automatically,
# so we import settings first and then load_dotenv() as a backup
# for any plain os.getenv() callers elsewhere in the app.
from dotenv import load_dotenv
load_dotenv()

from backend.config import settings
from backend.database import get_db_connection, init_db, get_seed_resolved_incidents
from backend.servicenow_client import servicenow_client
from backend.assignment_engine import assignment_engine
from backend.rag_engine import rag_engine
from langsmith.middleware import TracingMiddleware

# Initialize FastAPI App
app = FastAPI(title=settings.APP_NAME, version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# adding Langsmith middleware
app.add_middleware(TracingMiddleware)

# Startup event
@app.on_event("startup")
async def startup_event():
    # Initialize the database (associates + incidents + audit logs)
    init_db()
    # Bootstrap the RAG knowledge base in ChromaDB with the historical seed list
    rag_engine.seed_historical_incidents(get_seed_resolved_incidents())
    # Start the periodic background fetch task
    # asyncio.create_task(periodic_snow_pull())

# Background task to periodically pull incidents (simulate ServiceNow webhook/polling)
async def periodic_snow_pull():
    while True:
        try:
            print("Running periodic ServiceNow incident sync...")
            new_incidents = servicenow_client.pull_new_incidents()
            if new_incidents:
                print(f"Ingested {len(new_incidents)} new unassigned incident(s).")
        except Exception as e:
            print(f"Error in periodic ServiceNow sync: {e}")
        # Wait 45 seconds between sync checks
        await asyncio.sleep(45)

# Pydantic Schemas
class AssignRequest(BaseModel):
    incident_numbers: List[str]

class ApproveRequest(BaseModel):
    incident_number: str
    associate_name: str

class RejectRequest(BaseModel):
    incident_number: str
    associate_name: str

class OverrideRequest(BaseModel):
    incident_number: str
    associate_name: str

class ResolveRequest(BaseModel):
    incident_number: str
    resolution: str
    resolved_by: str

class WorkloadRequest(BaseModel):
    name: str
    amount: int


# API Endpoints
@app.get("/api/incidents")
def get_incidents(status: Optional[str] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if status:
        cursor.execute("SELECT * FROM incidents WHERE status = ? ORDER BY created_at DESC", (status,))
    else:
        cursor.execute("SELECT * FROM incidents ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/incidents/simulate")
def simulate_incident():
    """
    Manually triggers the ingestion of a single simulated incident.
    """
    try:
        new_tickets = [servicenow_client.simulate_single_incident()]
        conn = get_db_connection()
        cursor = conn.cursor()
        for ticket in new_tickets:
            cursor.execute("""
            INSERT INTO incidents (number, short_description, description, category, priority, urgency, sla_limit, status, assigned_to, assigned_at, created_at, rejection_count, rejected_associates)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]')
            """, (
                ticket["number"], ticket["short_description"], ticket["description"],
                ticket["category"], ticket["priority"], ticket["urgency"],
                ticket["sla_limit"], ticket["status"], ticket["assigned_to"],
                ticket["assigned_at"], ticket["created_at"]
            ))
        conn.commit()
        conn.close()
        return {"status": "success", "incident": new_tickets[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/incidents/assign")
def assign_incidents(request: AssignRequest):
    results = []
    for inc_num in request.incident_numbers:
        try:
            res = assignment_engine.execute_assignment(inc_num)
            results.append(res)
        except Exception as e:
            results.append({"incident_number": inc_num, "status": "error", "message": str(e)})
    return results

@app.post("/api/incidents/approve")
def approve_assignment(request: ApproveRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Check incident
        cursor.execute("SELECT * FROM incidents WHERE number = ?", (request.incident_number,))
        inc = cursor.fetchone()
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found")
            
        # Update incident status
        cursor.execute("""
        UPDATE incidents 
        SET status = 'Assigned', assigned_to = ?, assigned_at = ?
        WHERE number = ?
        """, (request.associate_name, datetime.utcnow().isoformat(), request.incident_number))
        
        # Increment active tickets
        cursor.execute("""
        UPDATE associates 
        SET active_tickets = active_tickets + 1 
        WHERE name = ?
        """, (request.associate_name,))
        
        # Update audit log
        cursor.execute("""
        UPDATE assignment_logs 
        SET decision_status = 'Approved', assigned_by = 'Human'
        WHERE incident_number = ? AND recommended_associate = ?
        """, (request.incident_number, request.associate_name))
        
        conn.commit()
        return {"status": "success", "message": f"Incident {request.incident_number} assigned to {request.associate_name}"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/incidents/reject")
def reject_assignment(request: RejectRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Fetch incident
        cursor.execute("SELECT rejected_associates, rejection_count FROM incidents WHERE number = ?", (request.incident_number,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Incident not found")
            
        rejected = json.loads(row["rejected_associates"] or "[]")
        if request.associate_name not in rejected:
            rejected.append(request.associate_name)
            
        count = row["rejection_count"] + 1
        
        # Update rejection metadata
        cursor.execute("""
        UPDATE incidents 
        SET rejected_associates = ?, rejection_count = ?, status = 'Unassigned', assigned_to = NULL, assigned_at = NULL
        WHERE number = ?
        """, (json.dumps(rejected), count, request.incident_number))
        
        # Update audit log
        cursor.execute("""
        UPDATE assignment_logs 
        SET decision_status = 'Rejected'
        WHERE incident_number = ? AND recommended_associate = ?
        """, (request.incident_number, request.associate_name))
        
        conn.commit()
        conn.close()
        
        # Automatically re-run the assignment engine!
        reassign_result = assignment_engine.execute_assignment(request.incident_number)
        return {"status": "success", "rejection_count": count, "reassignment": reassign_result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/incidents/override")
def override_assignment(request: OverrideRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Check incident
        cursor.execute("SELECT assigned_to, status FROM incidents WHERE number = ?", (request.incident_number,))
        inc = cursor.fetchone()
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found")
            
        old_assignee = inc["assigned_to"]
        
        # Decrement old assignee workload
        if old_assignee:
            cursor.execute("""
            UPDATE associates 
            SET active_tickets = MAX(0, active_tickets - 1) 
            WHERE name = ?
            """, (old_assignee,))
            
        # Update assignment
        cursor.execute("""
        UPDATE incidents 
        SET status = 'Assigned', assigned_to = ?, assigned_at = ?
        WHERE number = ?
        """, (request.associate_name, datetime.utcnow().isoformat(), request.incident_number))
        
        # Increment new assignee workload
        cursor.execute("""
        UPDATE associates 
        SET active_tickets = active_tickets + 1 
        WHERE name = ?
        """, (request.associate_name,))
        
        # Log override
        cursor.execute("""
        INSERT INTO assignment_logs (
            incident_number, recommended_associate, confidence_score, 
            justification, evaluated_associates, decision_status, assigned_by, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, 'Human', ?)
        """, (
            request.incident_number, request.associate_name, 100.0,
            f"Manual override. Assigned to {request.associate_name} directly by coordinator.",
            "[]", "Approved", datetime.utcnow().isoformat()
        ))
        
        conn.commit()
        return {"status": "success", "message": f"Overridden to {request.associate_name}"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/incidents/resolve")
def resolve_incident(request: ResolveRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Check incident details
        cursor.execute("SELECT short_description FROM incidents WHERE number = ?", (request.incident_number,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Incident not found")
            
        short_desc = row["short_description"]
        
        # Update incident status
        cursor.execute("""
        UPDATE incidents 
        SET status = 'Resolved' 
        WHERE number = ?
        """, (request.incident_number,))
        
        # Decrement associate workload
        cursor.execute("""
        UPDATE associates 
        SET active_tickets = MAX(0, active_tickets - 1) 
        WHERE name = ?
        """, (request.resolved_by,))
        
        conn.commit()
        conn.close()
        
        # Push to RAG historical DB!
        rag_engine.add_resolved_incident(
            request.incident_number,
            short_desc,
            request.resolution,
            request.resolved_by
        )
        
        return {"status": "success", "message": f"Incident {request.incident_number} resolved by {request.resolved_by} and indexed into RAG KB."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/associates/workload")
def adjust_workload(request: WorkloadRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT active_tickets FROM associates WHERE name = ?", (request.name,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Associate not found")
        
        new_tickets = max(0, row["active_tickets"] + request.amount)
        cursor.execute("UPDATE associates SET active_tickets = ? WHERE name = ?", (new_tickets, request.name))
        conn.commit()
        return {"status": "success", "name": request.name, "active_tickets": new_tickets}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/associates")
def get_associates():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM associates")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    # Enrich with shift status right now
    now = datetime.now()
    roster_mgr = assignment_engine.roster_mgr
    
    enriched = []
    for assoc in rows:
        on_shift = roster_mgr.is_on_shift(assoc["name"], assoc["domain"], now)
        # Find current day shift acronym
        shift_acronym = roster_mgr.get_shift_for_date(assoc["name"], assoc["domain"], now)
        
        enriched_assoc = assoc.copy()
        enriched_assoc["is_on_shift"] = on_shift
        enriched_assoc["current_shift_acronym"] = shift_acronym
        enriched_assoc["shift_time_block"] = roster_mgr.shift_definitions.get(shift_acronym, "Day Off")
        enriched.append(enriched_assoc)
        
    return enriched

@app.get("/api/roster")
def get_roster_data():
    """
    Returns the shiftDefinitions and calendar details for all associates.
    """
    roster_mgr = assignment_engine.roster_mgr
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name, domain FROM associates")
    associates_list = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    # Build schedule structure
    now = datetime.now()
    schedule_data = []
    for assoc in associates_list:
        name = assoc["name"]
        domain = assoc["domain"]
        
        days_shifts = {}
        for day in range(1, 32):
            test_dt = datetime(2026, 7, day, 12, 0)  # July 2026
            acronym = roster_mgr.get_shift_for_date(name, domain, test_dt)
            days_shifts[str(day)] = acronym
            
        schedule_data.append({
            "name": name,
            "domain": domain,
            "schedule": days_shifts
        })
        
    return {
        "shift_definitions": roster_mgr.shift_definitions,
        "current_date": now.date().isoformat(),
        "roster": schedule_data
    }

@app.get("/api/logs")
def get_assignment_logs(incident_number: Optional[str] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if incident_number:
        cursor.execute("SELECT * FROM assignment_logs WHERE incident_number = ? ORDER BY timestamp DESC", (incident_number,))
    else:
        cursor.execute("SELECT * FROM assignment_logs ORDER BY timestamp DESC")
    rows = cursor.fetchall()
    conn.close()
    
    logs = []
    for r in rows:
        log_dict = dict(r)
        # Parse evaluated associates JSON
        try:
            log_dict["evaluated_associates"] = json.loads(log_dict["evaluated_associates"] or "[]")
        except:
            log_dict["evaluated_associates"] = []
        logs.append(log_dict)
    return logs

@app.get("/api/history")
def get_history():
    try:
        return rag_engine.get_all_resolved_incidents()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/search")
def search_history(query: str):
    try:
        results = rag_engine.search_similar_incidents(query, top_k=3)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/metrics")
def get_metrics():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Total incidents processed
    cursor.execute("SELECT COUNT(*) FROM incidents")
    total_incidents = cursor.fetchone()[0]
    
    # 2. Rejection Count & Accuracy
    cursor.execute("SELECT SUM(rejection_count) FROM incidents")
    rejection_count = cursor.fetchone()[0] or 0
    
    cursor.execute("SELECT COUNT(*) FROM incidents WHERE status = 'Resolved'")
    resolved_count = cursor.fetchone()[0] or 0
    
    cursor.execute("SELECT COUNT(*) FROM incidents WHERE status = 'Assigned'")
    assigned_count = cursor.fetchone()[0] or 0
    
    accuracy = 100.0
    if (resolved_count + assigned_count) > 0:
        total_assignments = resolved_count + assigned_count + rejection_count
        accuracy = max(0.0, round(((total_assignments - rejection_count) / total_assignments) * 100, 1))
        
    # 3. Time to Assignment (simulated/actual diff in seconds)
    cursor.execute("SELECT created_at, assigned_at FROM incidents WHERE assigned_at IS NOT NULL")
    times = cursor.fetchall()
    
    avg_time_seconds = 45.0  # default fallback
    if times:
        diffs = []
        for c_at, a_at in times:
            try:
                c_dt = datetime.fromisoformat(c_at)
                a_dt = datetime.fromisoformat(a_at)
                diffs.append((a_dt - c_dt).total_seconds())
            except:
                pass
        if diffs:
            avg_time_seconds = round(sum(diffs) / len(diffs), 1)
            
    # 4. Workload list
    cursor.execute("SELECT name, domain, active_tickets FROM associates")
    workloads = [dict(r) for r in cursor.fetchall()]
    
    # 5. Ratios
    cursor.execute("SELECT COUNT(*) FROM incidents WHERE status = 'Assigned'")
    auto_assigned = cursor.fetchone()[0] or 0
    
    cursor.execute("SELECT COUNT(*) FROM incidents WHERE status = 'Flagged'")
    flagged_review = cursor.fetchone()[0] or 0
    
    conn.close()
    
    return {
        "total_incidents": total_incidents,
        "resolved_incidents": resolved_count,
        "active_incidents": assigned_count,
        "rejection_count": rejection_count,
        "assignment_accuracy": accuracy,
        "avg_time_to_assignment_seconds": avg_time_seconds,
        "auto_assigned_count": auto_assigned,
        "flagged_review_count": flagged_review,
        "workload_distribution": workloads
    }
