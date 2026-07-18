import json
import random
import uuid
from datetime import datetime, timedelta
import httpx
from backend.config import settings
from backend.database import get_db_connection
from backend.snow_refs import as_ref_json, display_value
# Realistic mock incident templates
INCIDENT_TEMPLATES = [
    {
        "short_description": "Azure VM scale set fails to scale down",
        "description": "The VM scale set for our staging environment is pinned at 5 instances despite CPU utilization being under 10%. Diagnostic logs show autoscaling engine fails to communicate.",
        "category": "Azure",
        "priority": "3",
        "urgency": "2"
    },
    {
        "short_description": "Oracle database locks on payment transaction table",
        "description": "High volumes of concurrent checkout requests are causing row-exclusive locks on checkout_payment table. Blocked processes count is rising.",
        "category": "Database",
        "priority": "1",
        "urgency": "1"
    },
    {
        "short_description": "MFT transfer failed - source directory file lock issue",
        "description": "The daily invoice extraction job failed with file lock error on source folder /data/invoices/tmp. File is locked by another process.",
        "category": "MFT",
        "priority": "4",
        "urgency": "3"
    },
    {
        "short_description": "ESB JMS queue exceeding threshold of 1000 messages",
        "description": "JMS destination queue queue.orders.inbound is currently holding 1450 messages. Consumer processes are running but processing speed is sluggish.",
        "category": "ESB",
        "priority": "2",
        "urgency": "2"
    },
    {
        "short_description": "Informatica ETL session failed during bulk load",
        "description": "ETL job load_daily_facts failed in Session s_load_sales. Error code: 36401. Session failed because the target DB was temporarily unavailable.",
        "category": "ETL",
        "priority": "3",
        "urgency": "2"
    },
    {
        "short_description": "Azure Blob storage read operations timing out",
        "description": "Applications trying to download media assets from container assets-prod are receiving 504 gateway timeout errors. Network latency is normal.",
        "category": "Azure",
        "priority": "2",
        "urgency": "1"
    },
    {
        "short_description": "SQL Server replication sync agent failed",
        "description": "The merge replication agent for transactional sync has shut down. Error: The process could not retrieve database metadata. Replication is out of sync by 4 hours.",
        "category": "Database",
        "priority": "2",
        "urgency": "2"
    },
    {
        "short_description": "Employee portal login button not responding",
        "description": "The login button on our employee intranet homepage is inactive when clicked. Browser console shows JavaScript reference error on click handler.",
        "category": "L1 Support",
        "priority": "3",
        "urgency": "3"
    },
    {
        "short_description": "Reset domain password for finance directory",
        "description": "Requesting password reset for user jsmith in domain finance. Cannot access payroll dashboard after three failed login attempts.",
        "category": "L1 Support",
        "priority": "4",
        "urgency": "3"
    },
    {
        "short_description": "Slow response on ESB service catalog api",
        "description": "The inventory catalog lookup API hosted on the ESB cluster is responding in 4.5 seconds (SLA threshold is 500ms). Web team reporting timeouts.",
        "category": "ESB",
        "priority": "3",
        "urgency": "2"
    }
]

# ---------------------------------------------------------------------------
# Category / domain mapping
# ---------------------------------------------------------------------------
# ServiceNow's `category` field returns free-text values like "Software",
# "Hardware", or "Network" — not our internal domain names (MFT, ESB, Azure…).
# This function maps common SNOW values → our assignment-engine domain names,
# falling back to subcategory and finally to "L1 Support".

_SNOW_CATEGORY_MAP: dict[str, str] = {
    # Azure / Cloud
    "azure":        "Azure",
    "cloud":        "Azure",
    "microsoft":    "Azure",
    # Database
    "database":     "Database",
    "db":           "Database",
    "oracle":       "Database",
    "sql":          "Database",
    "mysql":        "Database",
    "postgres":     "Database",
    # ETL
    "etl":          "ETL",
    "informatica":  "ETL",
    "data integration": "ETL",
    "data pipeline":    "ETL",
    # ESB / Integration
    "esb":          "ESB",
    "integration":  "ESB",
    "middleware":   "ESB",
    "mq":           "ESB",
    "messaging":    "ESB",
    # MFT / File Transfer
    "mft":          "MFT",
    "file transfer":"MFT",
    "sftp":         "MFT",
    "ftp":          "MFT",
}


def _map_snow_category(category: str | None, subcategory: str | None = None) -> str:
    """
    Map a ServiceNow category (and optionally subcategory) string to one of
    our internal domain names.  Matching is case-insensitive substring lookup.
    Returns 'L1 Support' when nothing matches.
    """
    for raw in (category, subcategory):
        if not raw:
            continue
        key = raw.strip().lower()
        # Exact match first
        if key in _SNOW_CATEGORY_MAP:
            return _SNOW_CATEGORY_MAP[key]
        # Substring / partial match
        for token, domain in _SNOW_CATEGORY_MAP.items():
            if token in key:
                return domain
    return "L1 Support"


class ServiceNowClient:
    def __init__(self):
        self.url = settings.SERVICENOW_URL
        self.user = settings.SERVICENOW_USER
        self.pwd = settings.SERVICENOW_PASSWORD
        self.mock_mode = settings.is_servicenow_mocked
        self.inc_counter = 100234

    def fetch_incidents_from_api(self) -> list:
        """
        Simulates call to real ServiceNow Table API:
        GET /api/now/table/incident?sysparm_query=assignment_groupISEMPTY^active=true
        """
        if not self.mock_mode:
            try:
                # Real API call
                headers = {"Accept": "application/json"}
                query_url = f"{self.url}/api/now/table/incident"
                params = {
                    "sysparm_limit": 10,
                    "sysparm_display_value": "true",
                }
                with httpx.Client(auth=(self.user, self.pwd), headers=headers, timeout=10.0) as client:
                    resp = client.get(query_url, params=params)
                    # print("RESPONSE JSON:\n",resp)
                    if resp.status_code == 200:
                        results = resp.json().get("result", [])
                        print("GET SNOW INCIDENT CALL:\n",json.dumps(results,indent=4))

                        # Map ServiceNow API output fields to our local schema format.
                        # The DB now stores the full SNOW payload, so the mapper
                        # must emit every column (typed + reference JSON + raw).
                        # Helpers from backend.snow_refs handle the {link,value}
                        # reference-object form so we accept both display_value
                        # and raw shapes transparently.
                        mapped = []
                        for item in results:
                            mapped.append({
                                # Original slim fields (preserved for engine + UI)
                                "number":            item.get("number"),
                                "short_description": item.get("short_description"),
                                "description":       item.get("description"),
                                # Map SNOW free-text category → our domain names
                                "category":          _map_snow_category(
                                                         item.get("category"),
                                                         item.get("subcategory"),
                                                     ),
                                "priority":          item.get("priority") or "3",
                                "urgency":           item.get("urgency")  or "3",
                                "created_at":        item.get("sys_created_on"),
                                "state":             item.get("state"),

                                # Display strings for legacy compatibility
                                # (assigned_to stays a plain name; *_ref gets
                                # the full JSON for the new columns)
                                "assigned_to":       display_value(item.get("assigned_to")),
                                "assignment_group":  display_value(item.get("assignment_group")),

                                # New typed SNOW fields
                                "sys_id":            item.get("sys_id"),
                                "sys_class_name":    item.get("sys_class_name") or "incident",
                                "sys_mod_count":     int(item.get("sys_mod_count") or 0),
                                "sys_updated_on":    item.get("sys_updated_on"),
                                "sys_updated_by":    display_value(item.get("sys_updated_by")),
                                "incident_state":    item.get("incident_state"),
                                "impact":            item.get("impact"),
                                "severity":          item.get("severity"),
                                "subcategory":       item.get("subcategory"),
                                "close_code":        item.get("close_code"),
                                "close_notes":       item.get("close_notes"),
                                "made_sla":          item.get("made_sla"),
                                "hold_reason":       item.get("hold_reason"),
                                "reassignment_count":int(item.get("reassignment_count") or 0),
                                "reopen_count":      int(item.get("reopen_count") or 0),
                                "opened_at":         item.get("opened_at"),
                                "resolved_at":       item.get("resolved_at"),
                                "closed_at":         item.get("closed_at"),
                                "sla_due":           item.get("sla_due"),
                                "activity_due":      item.get("activity_due"),

                                # Reference objects (JSON: {value, display_value, link})
                                "opened_by_ref":        as_ref_json(item.get("opened_by")),
                                "caller_id_ref":        as_ref_json(item.get("caller_id")),
                                "assignment_group_ref": as_ref_json(item.get("assignment_group")),
                                "assigned_to_ref":      as_ref_json(item.get("assigned_to")),

                                # Frozen full copy of the original SNOW row
                                "raw_payload":       json.dumps(item),
                            })
                        return mapped
            except Exception as e:
                print(f"Failed to fetch from real ServiceNow API: {e}. Falling back to simulation...")

        # In mock mode, we generate a random incident or returns empty
        return []

    def simulate_single_incident(self) -> dict:
        """
        Generates a random realistic incident that mimics a ServiceNow API response.
        Returns the FULL schema shape (all typed columns + reference JSON +
        raw_payload) so mock mode exercises the same code paths as the real API.
        """
        template = random.choice(INCIDENT_TEMPLATES)
        self.inc_counter += 1
        num_str = f"INC00{self.inc_counter}"

        # Calculate random SLA limit based on priority
        # Priority 1: 2 hours, Priority 2: 8 hours, Priority 3: 24 hours, Priority 4: 72 hours
        prio = template["priority"]
        hours = 72
        if prio == "1":
            hours = 2
        elif prio == "2":
            hours = 8
        elif prio == "3":
            hours = 24

        now = datetime.utcnow()
        created_str = now.isoformat()
        sla_str = (now + timedelta(hours=hours)).isoformat()

        # impact / severity scale alongside priority so the dispatcher has
        # a real urgency matrix even in mock mode
        impact_severity = {"1": "1", "2": "2", "3": "3"}.get(prio, "3")

        return {
            # Original slim fields (preserved for engine + UI)
            "number":            num_str,
            "short_description": template["short_description"],
            "description":       template["description"],
            "category":          template["category"],
            "priority":          prio,
            "urgency":           template["urgency"],
            "sla_limit":         sla_str,
            "status":            "Unassigned",
            "assigned_to":       None,
            "assigned_at":       None,
            "created_at":        created_str,
            "rejection_count":   0,
            "rejected_associates":"[]",
            "state":             "1",
            "assignment_group":  None,

            # New typed SNOW fields (sane defaults so downstream code
            # paths exercise the new shape)
            "sys_id":            f"sys_{uuid.uuid4().hex}",
            "sys_class_name":    "incident",
            "sys_mod_count":     0,
            "sys_updated_on":    created_str,
            "sys_updated_by":    "system",
            "incident_state":    "1",
            "impact":            impact_severity,
            "severity":          impact_severity,
            "subcategory":       template["category"],
            "close_code":        None,
            "close_notes":       None,
            "made_sla":          None,
            "hold_reason":       "",
            "reassignment_count":0,
            "reopen_count":      0,
            "opened_at":         created_str,
            "resolved_at":       None,
            "closed_at":         None,
            "sla_due":           sla_str,
            "activity_due":      sla_str,

            # Reference objects (JSON: {value, display_value, link})
            "opened_by_ref":         None,
            "caller_id_ref":         as_ref_json({
                "value":         "sys_user_demo",
                "display_value": "Demo Caller",
                "link":          None,
            }),
            "assignment_group_ref":  None,
            "assigned_to_ref":       None,

            # Mock mode: no upstream payload to freeze
            "raw_payload":           None,
        }

    def pull_new_incidents(self) -> list:
        """
        Queries ServiceNow API or generates simulated incidents and writes
        them to our local SQLite database.

        Re-pulling an existing incident refreshes the SNOW-owned columns
        (description, category, priority, the new typed fields, the *_ref
        JSON, and the raw_payload) but explicitly leaves the local
        app-owned columns (status, assigned_to, assigned_at, rejection
        count, rejected_associates) untouched. This is implemented with
        INSERT ... ON CONFLICT(number) DO UPDATE so a periodic sync can
        never silently undo a human override.
        """
        new_tickets = []
        if not self.mock_mode:
            new_tickets = self.fetch_incidents_from_api()

        # In mock mode, we simulate a single ticket 60% of the time on manual pull
        if self.mock_mode or not new_tickets:
            # Generate a new mock ticket
            new_tickets = [self.simulate_single_incident()]

        # Insert (or refresh) tickets in SQLite.
        # The full column list below MUST stay in sync with the CREATE TABLE
        # in backend/database.py:init_db(). If a new column is added there,
        # add it here too.
        insert_sql = """
        INSERT INTO incidents (
            number, short_description, description, category, priority, urgency,
            sla_limit, status, assigned_to, assigned_at, created_at,
            rejection_count, rejected_associates,
            sys_id, sys_class_name, sys_mod_count, sys_updated_on, sys_updated_by,
            incident_state, impact, severity, subcategory, close_code, close_notes,
            made_sla, hold_reason, reassignment_count, reopen_count,
            opened_at, resolved_at, closed_at, sla_due, activity_due,
            opened_by_ref, caller_id_ref, assignment_group_ref, assigned_to_ref,
            raw_payload
        ) VALUES (
            :number, :short_description, :description, :category, :priority, :urgency,
            :sla_limit, :status, :assigned_to, :assigned_at, :created_at,
            :rejection_count, :rejected_associates,
            :sys_id, :sys_class_name, :sys_mod_count, :sys_updated_on, :sys_updated_by,
            :incident_state, :impact, :severity, :subcategory, :close_code, :close_notes,
            :made_sla, :hold_reason, :reassignment_count, :reopen_count,
            :opened_at, :resolved_at, :closed_at, :sla_due, :activity_due,
            :opened_by_ref, :caller_id_ref, :assignment_group_ref, :assigned_to_ref,
            :raw_payload
        )
        ON CONFLICT(number) DO UPDATE SET
            short_description    = excluded.short_description,
            description          = excluded.description,
            category             = excluded.category,
            priority             = excluded.priority,
            urgency              = excluded.urgency,
            sla_limit            = excluded.sla_limit,
            created_at           = excluded.created_at,
            sys_id               = excluded.sys_id,
            sys_class_name       = excluded.sys_class_name,
            sys_mod_count        = excluded.sys_mod_count,
            sys_updated_on       = excluded.sys_updated_on,
            sys_updated_by       = excluded.sys_updated_by,
            incident_state       = excluded.incident_state,
            impact               = excluded.impact,
            severity             = excluded.severity,
            subcategory          = excluded.subcategory,
            close_code           = excluded.close_code,
            close_notes          = excluded.close_notes,
            made_sla             = excluded.made_sla,
            hold_reason          = excluded.hold_reason,
            reassignment_count   = excluded.reassignment_count,
            reopen_count         = excluded.reopen_count,
            opened_at            = excluded.opened_at,
            resolved_at          = excluded.resolved_at,
            closed_at            = excluded.closed_at,
            sla_due              = excluded.sla_due,
            activity_due         = excluded.activity_due,
            opened_by_ref        = excluded.opened_by_ref,
            caller_id_ref        = excluded.caller_id_ref,
            assignment_group_ref = excluded.assignment_group_ref,
            assigned_to_ref      = excluded.assigned_to_ref,
            raw_payload          = excluded.raw_payload
            -- status, assigned_to, assigned_at, rejection_count,
            -- rejected_associates are intentionally NOT touched:
            -- they are app-owned state, not SNOW-owned.
        """

        conn = get_db_connection()
        cursor = conn.cursor()

        added_tickets = []
        for ticket in new_tickets:
            # Normalize to a dict with the full column set. Missing keys
            # become None so the INSERT never blows up on a sparse mock
            # row or a partial real-SNOW response.
            row = {
                "number":             ticket.get("number"),
                "short_description":  ticket.get("short_description"),
                "description":        ticket.get("description"),
                "category":           ticket.get("category") or "L1 Support",
                "priority":           ticket.get("priority") or "3",
                "urgency":            ticket.get("urgency") or "3",
                "sla_limit":          ticket.get("sla_limit"),
                # App-owned defaults for a brand-new row
                "status":             ticket.get("status") or "Unassigned",
                "assigned_to":        ticket.get("assigned_to"),
                "assigned_at":        ticket.get("assigned_at"),
                "created_at":         ticket.get("created_at"),
                "rejection_count":    ticket.get("rejection_count", 0),
                "rejected_associates":ticket.get("rejected_associates", "[]"),

                # New typed fields
                "sys_id":             ticket.get("sys_id"),
                "sys_class_name":     ticket.get("sys_class_name"),
                "sys_mod_count":      ticket.get("sys_mod_count", 0),
                "sys_updated_on":     ticket.get("sys_updated_on"),
                "sys_updated_by":     ticket.get("sys_updated_by"),
                "incident_state":     ticket.get("incident_state"),
                "impact":             ticket.get("impact"),
                "severity":           ticket.get("severity"),
                "subcategory":        ticket.get("subcategory"),
                "close_code":         ticket.get("close_code"),
                "close_notes":        ticket.get("close_notes"),
                "made_sla":           ticket.get("made_sla"),
                "hold_reason":        ticket.get("hold_reason"),
                "reassignment_count": ticket.get("reassignment_count", 0),
                "reopen_count":       ticket.get("reopen_count", 0),
                "opened_at":          ticket.get("opened_at"),
                "resolved_at":        ticket.get("resolved_at"),
                "closed_at":          ticket.get("closed_at"),
                "sla_due":            ticket.get("sla_due"),
                "activity_due":       ticket.get("activity_due"),

                # Reference JSON
                "opened_by_ref":        ticket.get("opened_by_ref"),
                "caller_id_ref":        ticket.get("caller_id_ref"),
                "assignment_group_ref": ticket.get("assignment_group_ref"),
                "assigned_to_ref":      ticket.get("assigned_to_ref"),

                # Raw payload
                "raw_payload":        ticket.get("raw_payload"),
            }

            cursor.execute("SELECT number FROM incidents WHERE number = ?", (row["number"],))
            is_new = cursor.fetchone() is None

            cursor.execute(insert_sql, row)

            if is_new:
                added_tickets.append(ticket)

        conn.commit()
        conn.close()

        return added_tickets

servicenow_client = ServiceNowClient()
