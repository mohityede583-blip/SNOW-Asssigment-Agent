import sys
import os
from datetime import datetime

# Add project root to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.database import init_db, get_db_connection
from backend.roster_manager import RosterManager
from backend.rag_engine import rag_engine
from backend.assignment_engine import assignment_engine

def run_tests():
    print("==================================================")
    print("   STARTING SERVICE-NOW AI DISPATCHER TEST SUITE   ")
    print("==================================================")
    
    # 1. Database Initialization and Seeding
    print("\n--- Phase 1: Database Setup ---")
    try:
        init_db()
        print("PASS: SQLite database initialized and seeded successfully.")
    except Exception as e:
        print(f"FAIL: Database init error: {e}")
        return

    # 2. Test Roster Manager Shift Checks
    print("\n--- Phase 2: Shift Roster Parser Test ---")
    try:
        roster_mgr = RosterManager()
        # July 5, 2026, 10:48 AM is a Sunday
        test_dt = datetime(2026, 7, 5, 10, 48, 0)
        
        # Test John Doe or Alice Smith
        # Alice Smith belongs to MFT domain
        shift = roster_mgr.get_shift_for_date("Alice Smith", "MFT", test_dt)
        is_active = roster_mgr.is_on_shift("Alice Smith", "MFT", test_dt)
        print(f"Roster Lookup: Alice Smith (MFT) on July 5, 2026 @ 10:48 AM:")
        print(f"  - Shift Acronym: {shift}")
        print(f"  - Actively On Shift: {is_active}")
        
        # Verify L1 support agent
        l1_shift = roster_mgr.get_shift_for_date("Sophia Allen", "L1 Support", test_dt)
        l1_active = roster_mgr.is_on_shift("Sophia Allen", "L1 Support", test_dt)
        print(f"Roster Lookup: Sophia Allen (L1 Support) on July 5, 2026 @ 10:48 AM:")
        print(f"  - Shift Acronym: {l1_shift}")
        print(f"  - Actively On Shift: {l1_active}")
        
        print("PASS: Roster manager successfully processed sheets and dates.")
    except Exception as e:
        print(f"FAIL: Roster manager error: {e}")
        return

    # 3. Test RAG Engine Vector Search
    print("\n--- Phase 3: RAG Embedding Vector Search Test ---")
    try:
        query = "Oracle db server connection pools saturated and blocking queries"
        print(f"Search Query: '{query}'")
        matches = rag_engine.search_similar_incidents(query, top_k=2)
        
        print("Vector Database Matches found:")
        for idx, match in enumerate(matches):
            print(f"  [{idx+1}] {match['number']} - Sim Score: {match['similarity_score']}%")
            print(f"      Short Desc: {match['short_description']}")
            print(f"      Resolved By: {match['resolved_by']}")
            
        if len(matches) > 0:
            print("PASS: RAG search completed and returned similarity matches.")
        else:
            print("FAIL: No RAG matches returned.")
            return
    except Exception as e:
        print(f"FAIL: RAG search error: {e}")
        return

    # 4. Test Assignment Engine Flow
    print("\n--- Phase 4: AI Intelligent Assignment Flow Test ---")
    try:
        # Create a test incident in SQLite
        conn = get_db_connection()
        cursor = conn.cursor()
        
        test_inc_num = "INC000TEST1"
        cursor.execute("DELETE FROM incidents WHERE number = ?", (test_inc_num,))
        cursor.execute("""
        INSERT INTO incidents (number, short_description, description, category, priority, urgency, sla_limit, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            test_inc_num,
            "Azure virtual machine running at 99% CPU load",
            "Production VM web-app-prod-01 is alerting high CPU utilization for 15 minutes. Web traffic is sluggish.",
            "Azure", "2", "2", "2026-07-06T18:48:00Z", "Unassigned", datetime.now().isoformat()
        ))
        conn.commit()
        conn.close()
        
        # Run assignment
        print(f"Executing assignment workflow for test incident: {test_inc_num}")
        result = assignment_engine.execute_assignment(test_inc_num)
        
        if result.get('status') == 'success':
            print("\nAssignment Workflow Output:")
            print(f"  - Status: {result['status']}")
            print(f"  - Route Decision: {result['route_status']}")
            print(f"  - Assigned To: {result['recommended_associate']}")
            print(f"  - Confidence: {result['confidence_score']}%")
            print(f"  - Audit Reason: {result['justification']}")
            print("PASS: Assignment workflow completed and recommended associate.")
        else:
            print(f"FAIL: Assignment workflow failed: {result.get('message')}")
            return
    except Exception as e:
        print(f"FAIL: Assignment engine error: {e}")
        return

    print("\n==================================================")
    print("      ALL VERIFICATION PHASES COMPLETED: PASS      ")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
