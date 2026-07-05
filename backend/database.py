import sqlite3
import pandas as pd
from backend.config import settings

DB_FILE = "./incident_assignment.db"
def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Create Associates Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS associates (
        name TEXT PRIMARY KEY,
        domain TEXT,
        skill_level TEXT,
        active_tickets INTEGER DEFAULT 0
    )
    """)
    
    # 2. Create Incidents Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS incidents (
        number TEXT PRIMARY KEY,
        short_description TEXT,
        description TEXT,
        category TEXT,
        priority TEXT,
        urgency TEXT,
        sla_limit TEXT,
        status TEXT,
        assigned_to TEXT,
        assigned_at TEXT,
        created_at TEXT,
        rejection_count INTEGER DEFAULT 0,
        rejected_associates TEXT DEFAULT '[]'
    )
    """)
    
    # 3. Resolved Incidents are now stored in ChromaDB (see backend/rag_engine.py)

    # 4. Create Assignment Logs Table (Audit)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS assignment_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_number TEXT,
        recommended_associate TEXT,
        confidence_score REAL,
        justification TEXT,
        evaluated_associates TEXT,
        decision_status TEXT,
        assigned_by TEXT,
        timestamp TEXT
    )
    """)
    
    conn.commit()
    conn.close()
    
    # Sync associates from Excel sheet
    sync_associates_from_roster()

    # Historical resolved incidents are now seeded into ChromaDB by rag_engine
    # at startup (see backend/main.py startup_event).

def sync_associates_from_roster():
    print("Syncing associates from shift roster Excel...")
    try:
        # Load Associate_Skills sheet from shift_roster.xlsx
        xls_path = settings.ROSTER_FILE_PATH
        df = pd.read_excel(xls_path, sheet_name="Associate_Skills")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        for _, row in df.iterrows():
            name = row["Associate Name"]
            domain = row["Technology Domain"]
            skill_level = row["Skill Level"]
            
            # Insert or update
            cursor.execute("""
            INSERT INTO associates (name, domain, skill_level, active_tickets)
            VALUES (?, ?, ?, 0)
            ON CONFLICT(name) DO UPDATE SET
                domain=excluded.domain,
                skill_level=excluded.skill_level
            """, (name, domain, skill_level))
            
        conn.commit()
        conn.close()
        print("Associates synced successfully.")
    except Exception as e:
        print(f"Error syncing associates from roster: {e}")

def get_seed_resolved_incidents() -> list:
    """
    Returns the historical resolved incidents used to bootstrap the RAG knowledge base.
    The list is consumed by rag_engine.seed_historical_incidents() at startup
    and written into ChromaDB.
    """
    return [
        {
            "number": "INC0001001",
            "short_description": "Azure VM disk space critically low",
            "resolution": "Extended the OS drive capacity in the Azure portal and expanded the volume using Disk Management utility.",
            "resolved_by": "Ivy Martin"  # Azure L3
        },
        {
            "number": "INC0001002",
            "short_description": "Azure Web App returning 503 service unavailable",
            "resolution": "Restarted the app service slot and increased instance count from 1 to 2 in Azure Scale Out settings.",
            "resolved_by": "Henry Anderson"  # Azure L2
        },
        {
            "number": "INC0001003",
            "short_description": "MFT transfer failed for file upload to client SFTP",
            "resolution": "SFTP password had expired. Updated the credentials in MFT partner profile and triggered reprocessing.",
            "resolved_by": "Charlie Brown"  # MFT L3
        },
        {
            "number": "INC0001004",
            "short_description": "ESB Message Broker queue blocked on processing payload",
            "resolution": "Cleared the poisoned message queue, routed message to dead letter queue, and restarted the listener service.",
            "resolved_by": "Frank Thomas"  # ESB L3
        },
        {
            "number": "INC0001005",
            "short_description": "Oracle Database connection timeout from application server",
            "resolution": "Db listeners were saturated. Increased PROCESSES and SESSIONS configuration parameters in init.ora and flushed connection pool.",
            "resolved_by": "Liam Clark"  # Database L3
        },
        {
            "number": "INC0001006",
            "short_description": "SQL Server deadlock encountered in inventory transaction",
            "resolution": "Identified blocking transaction. Refactored query to use WITH (NOLOCK) hint and optimized table indexes.",
            "resolved_by": "Kelly Harris"  # Database L2
        },
        {
            "number": "INC0001007",
            "short_description": "ETL job failing due to string truncation error in stage table",
            "resolution": "Source system altered schema length. Increased column size of dest_customer_address in target table to VARCHAR(250).",
            "resolved_by": "Olivia Hall"  # ETL L3
        },
        {
            "number": "INC0001008",
            "short_description": "Azure Key Vault secret retrieval access denied",
            "resolution": "Added app registrations service principal to Access Policies in Key Vault with Secret Get permission.",
            "resolved_by": "Grace Taylor"  # Azure L1
        },
        {
            "number": "INC0001009",
            "short_description": "ESB flow failed due to parsing exception on invalid XML structure",
            "resolution": "Validated payload schema. Communicated with source system to escape special character ampersand '&' and re-received payload.",
            "resolved_by": "Emma Wilson"  # ESB L2
        },
        {
            "number": "INC0001010",
            "short_description": "ETL workflow running extremely slow on daily delta load",
            "resolution": "Rebuilt indexes on delta log table and updated statistics. Performance restored back to normal (12 min from 3 hrs).",
            "resolved_by": "Noah Walker"  # ETL L2
        }
    ]
