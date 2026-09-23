import sqlite3
import hashlib
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
    #
    # Schema mirrors ServiceNow `sys_user` (User [sys_user]) plus three local-only
    # fields (domain, skill_level, active_tickets) used by the assignment engine.
    # The SNOW-specific columns (email, phone, manager, department, etc.) stay NULL
    # while associates are seeded from `shift_roster.xlsx`; a future SNOW sync will
    # populate them.
    #
    # Migration strategy: drop & recreate on startup. We detect the legacy 4-column
    # layout (no `sys_id`) via PRAGMA and DROP only when needed, so a fresh DB does
    # not see a redundant DROP. Existing local data loss is intentional and accepted.
    cursor.execute("PRAGMA table_info(associates)")
    _existing_cols = [row[1] for row in cursor.fetchall()]
    if _existing_cols and "sys_id" not in _existing_cols:
        print("Legacy associates layout detected — dropping and recreating to mirror sys_user.")
        cursor.execute("DROP TABLE associates")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS associates (
        -- SNOW identity columns
        sys_id            TEXT PRIMARY KEY,
        user_name         TEXT,
        first_name        TEXT,
        middle_name       TEXT,
        last_name         TEXT,
        name              TEXT NOT NULL UNIQUE,  -- display name; UI key

        -- SNOW contact
        email             TEXT,
        phone             TEXT,
        mobile_phone      TEXT,
        title             TEXT,

        -- SNOW org / HR
        employee_number   TEXT,
        department        TEXT,  -- cmn_department sys_id
        company           TEXT,  -- core_company sys_id
        manager           TEXT,  -- self-ref to sys_user.sys_id
        location          TEXT,
        building          TEXT,
        cost_center       TEXT,
        time_zone         TEXT,

        -- SNOW flags (SQLite booleans = INTEGER 0/1)
        active            INTEGER NOT NULL DEFAULT 0,
        locked_out        INTEGER NOT NULL DEFAULT 0,
        vip               INTEGER NOT NULL DEFAULT 0,

        -- SNOW misc
        roles             TEXT,           -- comma-separated role names
        source            TEXT,           -- ldap / okta / roster / snow_sync
        last_login_time   TEXT,           -- ISO datetime
        failed_attempts   INTEGER NOT NULL DEFAULT 0,
        photo             TEXT,

        -- Local-only fields used by the assignment engine
        domain            TEXT,
        skill_level       TEXT,
        active_tickets    INTEGER NOT NULL DEFAULT 0,
        skills            TEXT                 -- comma-separated; from the Excel sheet
    )
    """)

    # `name` UNIQUE creates its own index; add a domain index because the engine
    # filters `WHERE domain = ?` on every assignment call.
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_associates_domain ON associates(domain)"
    )

    # Idempotent column-add for tables that already have the SNOW-aligned
    # layout. Mirrors the _migrate_incidents_columns pattern.
    _migrate_associates_columns(cursor)
    
    # 2. Create Incidents Table
    # The original 13 columns are preserved so the assignment engine, the
    # verify script, and the React dashboard keep working unchanged.
    # The new columns capture the full ServiceNow API payload:
    #   - typed columns for fields the AI engine or future UI may query
    #   - *_ref columns for reference objects (opened_by, caller_id,
    #     assignment_group, assigned_to), stored as JSON strings of
    #     {value, display_value, link}
    #   - raw_payload holds the full original SNOW JSON as a safety net
    #     for any field we didn't promote to a typed column.
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
        rejected_associates TEXT DEFAULT '[]',

        -- ServiceNow audit + identity
        sys_id            TEXT,
        sys_class_name    TEXT,
        sys_mod_count     INTEGER DEFAULT 0,
        sys_updated_on    TEXT,
        sys_updated_by    TEXT,

        -- ServiceNow state + impact
        incident_state    TEXT,
        impact            TEXT,
        severity          TEXT,
        subcategory       TEXT,

        -- ServiceNow resolution
        close_code        TEXT,
        close_notes       TEXT,
        made_sla          TEXT,
        hold_reason       TEXT,
        reassignment_count INTEGER DEFAULT 0,
        reopen_count       INTEGER DEFAULT 0,

        -- ServiceNow timestamps (sys_created_on vs opened_at are distinct)
        opened_at         TEXT,
        resolved_at       TEXT,
        closed_at         TEXT,
        sla_due           TEXT,
        activity_due      TEXT,

        -- Reference objects (JSON: {value, display_value, link})
        opened_by_ref        TEXT,
        caller_id_ref        TEXT,
        assignment_group_ref TEXT,
        assigned_to_ref      TEXT,

        -- Full original SNOW payload (json.dumps of the API result row)
        raw_payload        TEXT
    )
    """)

    # Idempotent migration: add any new column that's missing on an older DB.
    # Safe to run on every startup because we introspect via PRAGMA first.
    _migrate_incidents_columns(cursor)

    # Backfill: copy legacy data into the new shape so the app sees a
    # uniform row layout regardless of when an incident was first ingested.
    _backfill_incidents_columns(cursor)
    
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

# -------------------------------------------------------------------
# Schema migration helpers (called from init_db)
# -------------------------------------------------------------------
# Note: the `associates` table intentionally uses DROP + CREATE in
# init_db() rather than the ALTER-based pattern below. See the comment
# at the top of the associates CREATE TABLE for the rationale.
#
# The list of columns the v2 schema adds on top of the original 13.
# Each entry is (name, sqlite_type). New columns must be added here so
# existing databases pick them up on the next startup. The CREATE TABLE
# in init_db() also lists them, so a fresh DB gets them in one shot.
_INCIDENT_NEW_COLUMNS = [
    ("sys_id",              "TEXT"),
    ("sys_class_name",      "TEXT"),
    ("sys_mod_count",       "INTEGER DEFAULT 0"),
    ("sys_updated_on",      "TEXT"),
    ("sys_updated_by",      "TEXT"),
    ("incident_state",      "TEXT"),
    ("impact",              "TEXT"),
    ("severity",            "TEXT"),
    ("subcategory",         "TEXT"),
    ("close_code",          "TEXT"),
    ("close_notes",         "TEXT"),
    ("made_sla",            "TEXT"),
    ("hold_reason",         "TEXT"),
    ("reassignment_count",  "INTEGER DEFAULT 0"),
    ("reopen_count",        "INTEGER DEFAULT 0"),
    ("opened_at",           "TEXT"),
    ("resolved_at",         "TEXT"),
    ("closed_at",           "TEXT"),
    ("sla_due",             "TEXT"),
    ("activity_due",        "TEXT"),
    ("opened_by_ref",       "TEXT"),
    ("caller_id_ref",       "TEXT"),
    ("assignment_group_ref","TEXT"),
    ("assigned_to_ref",     "TEXT"),
    ("raw_payload",         "TEXT"),
]


def _column_exists(cursor, table, column):
    """Return True if `column` is already present on `table`."""
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def _migrate_incidents_columns(cursor):
    """
    Add any column from _INCIDENT_NEW_COLUMNS that isn't already on the
    `incidents` table. Idempotent: re-running it is a no-op once every
    column is present.
    """
    for col_name, col_type in _INCIDENT_NEW_COLUMNS:
        if not _column_exists(cursor, "incidents", col_name):
            cursor.execute(
                f"ALTER TABLE incidents ADD COLUMN {col_name} {col_type}"
            )


# Idempotent column-add for the `associates` table. The CREATE TABLE in
# init_db() lists the final column set, so a fresh DB gets every column in
# one shot. For an existing DB that already has the SNOW-aligned layout
# (from the previous schema migration), these ADD COLUMNs bring it up to
# date without the drop-and-recreate that would lose data.
_ASSOCIATE_NEW_COLUMNS = [
    ("skills", "TEXT"),
]


def _migrate_associates_columns(cursor):
    """Add any column from _ASSOCIATE_NEW_COLUMNS that isn't already on `associates`."""
    for col_name, col_type in _ASSOCIATE_NEW_COLUMNS:
        if not _column_exists(cursor, "associates", col_name):
            cursor.execute(
                f"ALTER TABLE associates ADD COLUMN {col_name} {col_type}"
            )


def _backfill_incidents_columns(cursor):
    """
    Populate the new columns from the legacy ones where possible so the
    app sees a uniform row layout. This is best-effort: it only writes
    a cell if the new column is currently NULL and the source is not.
    """
    # sla_limit -> sla_due. The legacy schema had only sla_limit; the new
    # schema has both, and sla_due is the SNOW-canonical name.
    cursor.execute(
        """
        UPDATE incidents
        SET sla_due = sla_limit
        WHERE sla_due IS NULL AND sla_limit IS NOT NULL
        """
    )

    # Wrap legacy `assigned_to` plain strings into the new
    # {value, display_value, link} JSON shape. The display name is the
    # only signal the legacy column carries, so value/link are NULL.
    # Uses SQLite's built-in json_object() to avoid Python-side string
    # interpolation of untrusted display names.
    cursor.execute(
        """
        UPDATE incidents
        SET assigned_to_ref = json_object(
            'value',         NULL,
            'display_value', assigned_to,
            'link',          NULL
        )
        WHERE assigned_to_ref IS NULL AND assigned_to IS NOT NULL
        """
    )

    # assignment_group_ref has no legacy counterpart, so old rows keep
    # NULL there until a future ServiceNow refresh populates it.

def _seed_sys_id(name: str) -> str:
    """
    Deterministic 32-char hex sys_id derived from the Excel display name.
    Re-running the seed yields the same id, so the ON CONFLICT upsert is
    idempotent. The 'roster:' prefix prevents accidental collisions with
    real ServiceNow sys_ids (which are unprefixed 32-hex).
    """
    return hashlib.sha1(f"roster:{name}".encode("utf-8")).hexdigest()[:32]


def _parse_name(full_name: str) -> tuple[str | None, str | None]:
    """
    Best-effort split of a single full name into (first_name, last_name).
    Returns (None, None) if the name is empty or unparseable.
    """
    if not isinstance(full_name, str) or not full_name.strip():
        return None, None
    parts = full_name.strip().split()
    if len(parts) == 1:
        return parts[0], None
    return parts[0], parts[-1]


def sync_associates_from_roster():
    print("Syncing associates from shift roster Excel...")
    try:
        # Load Associate_Skills sheet from shift_roster.xlsx
        xls_path = settings.ROSTER_FILE_PATH
        df = pd.read_excel(xls_path, sheet_name="Associate_Skills")

        conn = get_db_connection()
        cursor = conn.cursor()

        for _, row in df.iterrows():
            name = str(row["Associate Name"]).strip()
            domain = row["Technology Domain"]
            skill_level = row["Skill Level"]
            skills = row.get("Skills") if "Skills" in df.columns else None

            sys_id = _seed_sys_id(name)
            first_name, last_name = _parse_name(name)

            # Insert or update. We do NOT touch `active_tickets` here so an
            # in-flight workload counter survives a reseed. Each per-row write
            # is isolated so a duplicate display name (UNIQUE collision on
            # `name`) logs a warning instead of aborting the whole seed.
            try:
                cursor.execute("""
                INSERT INTO associates (
                    sys_id, user_name, first_name, last_name, name,
                    domain, skill_level, active_tickets,
                    active, locked_out, vip, failed_attempts, source,
                    skills
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'roster', ?)
                ON CONFLICT(sys_id) DO UPDATE SET
                    name           = excluded.name,
                    user_name      = excluded.user_name,
                    first_name     = excluded.first_name,
                    last_name      = excluded.last_name,
                    domain         = excluded.domain,
                    skill_level    = excluded.skill_level,
                    source         = excluded.source,
                    skills         = excluded.skills
                """, (
                    sys_id, name, first_name, last_name, name,
                    domain, skill_level, skills,
                ))
            except sqlite3.IntegrityError as e:
                # Most likely cause: duplicate `name` in the Excel sheet.
                print(f"Skipping duplicate associate row for name={name!r}: {e}")

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
                "number": "INC0012948",
                "resolved_by": "Naomi Greenly",
                "short_description": "Critical BusinessWorks JVM Heap Exhaustion and Engine Stoppage During Peak XML Payload Processing",
                "resolution": "Restarted the BW engine instance and increased JVM max heap allocation (-Xmx) from 2GB to 4GB in TRA config. Verified stable processing via monitoring tools."
            },
            {
                "number": "INC0012949",
                "resolved_by": "Melinda Carleton",
                "short_description": "Scheduled SFTP File Transfer Job Interruption Due to Network and Authentication Protocol Timeouts",
                "resolution": "Re-established SSH keys, verified firewall port 22 connectivity, and manually re-triggered the file transfer task to completion."
            },
            {
                "number": "INC0012950",
                "resolved_by": "Melinda Carleton",
                "short_description": "Database Staging Pipeline Failure Caused by Exclusive Row-Level Locks and Concurrent Batch Deadlocks",
                "resolution": "Cleared active database sessions holding exclusive locks, adjusted commit intervals within the mapping, and successfully restarted the workflow."
            },
            {
                "number": "INC0012951",
                "resolved_by": "Melinda Carleton",
                "short_description": "Cloud Workflow Service Integration Failure Due to Expired OAuth 2.0 Security Credentials and Invalid Token",
                "resolution": "Rotated and updated the Client Secret in the vault, re-authorized the service connection resource, and reprocessed dead-lettered messages."
            },
            {
                "number": "INC0012952",
                "resolved_by": "Melinda Carleton",
                "short_description": "Enterprise Gateway HTTP 504 Gateway Timeout Due to Downstream Microservice Connection Pool Exhaustion",
                "resolution": "Scaled Kubernetes pod replicas from 3 to 6 for the downstream microservice and added an index on the SQL query to eliminate high latency."
            },
            {
                "number": "INC0012953",
                "resolved_by": "Melinda Carleton",
                "short_description": "Kafka Consumer Group Lag Spike and Partition Rebalance Storm Due to Slow Database Write Latency",
                "resolution": "Optimized consumer batch commit frequency, tuned the max.poll.interval.ms configuration parameter, and manually reset the consumer offsets after database performance stabilized."
            },
            {
                "number": "INC0012954",
                "resolved_by": "Melinda Carleton",
                "short_description": "Enterprise Service Bus JMS Destination Full Exception Caused by Unacknowledged Subscriber Backpressure",
                "resolution": "Purged orphaned consumer sessions, temporarily increased the broker destination memory quota, and coordinated with the subscriber application team to restart their processing daemon."
            },
            {
                "number": "INC0012955",
                "resolved_by": "Melinda Carleton",
                "short_description": "Managed File Transfer Cryptographic Decryption Failure Due to Expired PGP Private Key Ring",
                "resolution": "Imported the updated PGP private key ring into the keyring store, verified key fingerprints, and successfully re-executed the batch decryption and ingestion script."
            },
            {
                "number": "INC0012956",
                "resolved_by": "Melinda Carleton",
                "short_description": "Distributed Data Warehouse Incremental Ingestion Failure Caused by Schema Drift and Type Mismatch",
                "resolution": "Altered the target data warehouse table column definition to match the expanded upstream length, refreshed the source metadata definition, and resumed the pipeline execution."
            },
            {
                "number": "INC0012957",
                "resolved_by": "Jewel Agresta",
                "short_description": "Cloud Serverless Function Timeout Exception During Heavy Payload JSON Transformation Execution",
                "resolution": "Refactored the JavaScript transformation code to utilize iterative parsing logic, implemented stream-based data chunking, and increased the function execution timeout threshold to 600 seconds."
            },
            {
                "number": "INC0012958",
                "resolved_by": "Jewel Agresta",
                "short_description": "RESTful Gateway Rate Limit Threshold Exceeded Error Causing Mass Client Rejections with HTTP 429",
                "resolution": "Temporarily increased the client IP rate-limiting threshold in the gateway policy manager, and coordinated with the partner engineering team to implement exponential backoff retry logic."
            },
            {
                "number": "INC0012959",
                "resolved_by": "Jewel Agresta",
                "short_description": "Enterprise Service Bus SSL/TLS Handshake Failure Due to Untrusted Self-Signed Certificate Authority Chain",
                "resolution": "Imported the new vendor intermediate and root SSL certificates into the Java truststore (cacerts), restarted the ESB runtime container, and validated successful TLS negotiation."
            },
            {
                "number": "INC0012960",
                "resolved_by": "Jewel Agresta",
                "short_description": "Enterprise Service Bus File Poller Resource Leak Causing File System Handle Exhaustion and Lockup",
                "resolution": "Patched the custom Java service to enforce strict try-with-resources block closures, increased the OS file descriptor limit (nofile), and restarted the integration engine service."
            },
            {
                "number": "INC0012961",
                "resolved_by": "Jewel Agresta",
                "short_description": "Batch Data Synchronization Job Failure Caused by Foreign Key Constraint Violation on Target Table",
                "resolution": "Implemented dependency sequencing within the orchestration job to ensure dimension tables process completely before fact tables, and reprocessed the failed batch subset."
            },
            {
                "number": "INC0012962",
                "resolved_by": "Jewel Agresta",
                "short_description": "Cloud Storage Bucket Event Notification Trigger Failure Caused by Missing IAM Permissions Policy",
                "resolution": "Restored the necessary granular IAM permissions to the automation service account policy document, uploaded a test payload, and verified successful workflow execution."
            },
            {
                "number": "INC0012963",
                "resolved_by": "Jewel Agresta",
                "short_description": "Distributed Transaction Coordinator Rollback Due to Network Partition Between Microservices",
                "resolution": "Verified cluster network stability, inspected compensation transaction logs, manually cleared orphaned pending locks in the database, and re-initiated the workflow for affected user sessions."
            },
            {
                "number": "INC0012964",
                "resolved_by": "Jess Assad",
                "short_description": "Managed File Transfer Cluster Node Split-Brain Condition Causing Duplicate Job Execution",
                "resolution": "Restarted the cluster coordination daemon on the secondary node, forced a re-election of the active cluster master node, and cleaned up duplicate partial lock files from the shared storage mount."
            },
            {
                "number": "INC0012965",
                "resolved_by": "Jess Assad",
                "short_description": "Enterprise Service Bus Transform Mapping Exception Caused by Unescaped Special Characters in Input XML",
                "resolution": "Updated the integration service mapping to include an automated character sanitization pre-step using regular expression filtering to strip invalid control sequences before transformation."
            },
            {
                "number": "INC0012966",
                "resolved_by": "Jess Assad",
                "short_description": "Cloud API Management Service OAuth Token Introspection Latency Spike Causing Gateway Bottlenecks",
                "resolution": "Enabled local token validation caching with a 5-minute TTL on the gateway proxy nodes to bypass redundant introspection calls, instantly reducing token verification latency."
            },
            {
                "number": "INC0012967",
                "short_description": "Bulk Data Extraction Job Failure Caused by Out-of-Disk Space Condition on Database Temp Segment. Nightly database extraction workflow failed abruptly with an ORA-1652: unable to extend temp segment error. Massive parallel sorting operations generated by an unindexed multi-table join query completely filled the allocated temporary tablespace partition on the database server.",
                "resolution": "Expanded the database temporary tablespace file allocation, optimized the SQL join query execution plan by adding proper composite indexes, and restarted the extraction script.",
                 "resolved_by": "Naomi Greenly"
            },
        {
            "number": "INC0000036",
            "short_description": "Experiencing connection issues. Unable to create connection to data source.",
            "resolution": "Closed before close notes were made mandatory",
            "resolved_by": "Naomi Greenly"
        },
        {
            "number": "INC0000035",
            "short_description": "Forgot password and unable to log in. Can you reset or resend my password?",
            "resolution": "Helped user to reset password",
            "resolved_by": "Jacinto Gawron"
        },
        {
            "number": "INC0000601",
            "short_description": "I'm facing network issue. My Infrasture in not able to connect with company network",
            "resolution": "As this is intermittent. Restarting the PC fixes this.",
            "resolved_by": "Jess Assad"
        },
        {
            "number": "INC0000021",
            "short_description": "We have a new hire starting on Monday. She will need to be set up with a desk, laptop, phone, email account, and systems access.",
            "resolution": "Closed before close notes were made mandatory",
            "resolved_by": "survey user"
        },
        {
            "number": "INC0000024",
            "short_description": "The landing page for our internal wiki isn't loading. I've refreshed it multiple times and it keeps timing out.",
            "resolution": "Closed before close notes were made mandatory",
            "resolved_by": "Jewel Agresta"
        },
        {
            "number": "INC0000004",
            "short_description": "User forgot their email password.",
            "resolution": "Walked him through settng his password, again.",
            "resolved_by": "Jewel Agresta"
        },
        {
            "number": "INC0000001",
            "short_description": "User can't access email on mail.company.com.\n\t\t",
            "resolution": "Closed before close notes were made mandatory",
            "resolved_by": "Melinda Carleton"
        },
        {
            "number": "INC0000010",
            "short_description": "Currently running 10GR1 and need to upgrade to 10GR2.",
            "resolution": "Closed before close notes were made mandatory",
            "resolved_by": "Krystle Stika"
        },
        {
            "number": "INC0000026",
            "short_description": "Hard drive has been making a loud grinding noise for the last two days.",
            "resolution": "Closed before close notes were made mandatory",
            "resolved_by": "Tom Diggins-Barnes"
        },
        {
            "number": "INC0000028",
            "short_description": "Hard drive is still making grinding and clicking noises and now I can't delete a file. I've tried to delete it 3 times.",
            "resolution": "Closed before close notes were made mandatory",
            "resolved_by": "Tom Diggins-Barnes"
        }
    ]
