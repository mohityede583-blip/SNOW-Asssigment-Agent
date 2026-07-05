import random
from datetime import datetime, timedelta
import httpx
from backend.config import settings
from backend.database import get_db_connection

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
                query_url = f"{self.url}/api/now/table/incident?sysparm_query=assignment_groupISEMPTY^active=true"
                with httpx.Client(auth=(self.user, self.pwd), headers=headers, timeout=10.0) as client:
                    resp = client.get(query_url)
                    if resp.status_code == 200:
                        results = resp.json().get("result", [])
                        # Map ServiceNow API output fields to our local schema format
                        mapped = []
                        for item in results:
                            mapped.append({
                                "number": item.get("number"),
                                "short_description": item.get("short_description"),
                                "description": item.get("description"),
                                "category": item.get("category", "L1 Support"),
                                "priority": item.get("priority", "3"),
                                "urgency": item.get("urgency", "3"),
                                "created_at": item.get("sys_created_on")
                            })
                        return mapped
            except Exception as e:
                print(f"Failed to fetch from real ServiceNow API: {e}. Falling back to simulation...")
        
        # In mock mode, we generate a random incident or returns empty
        return []

    def simulate_single_incident(self) -> dict:
        """
        Generates a random realistic incident that mimics a ServiceNow API response.
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
        
        return {
            "number": num_str,
            "short_description": template["short_description"],
            "description": template["description"],
            "category": template["category"],
            "priority": prio,
            "urgency": template["urgency"],
            "sla_limit": sla_str,
            "status": "Unassigned",
            "assigned_to": None,
            "assigned_at": None,
            "created_at": created_str,
            "rejection_count": 0,
            "rejected_associates": "[]"
        }

    def pull_new_incidents(self) -> list:
        """
        Queries ServiceNow API or generates simulated incidents and writes them
        to our local SQLite database.
        """
        new_tickets = []
        if not self.mock_mode:
            new_tickets = self.fetch_incidents_from_api()
            
        # In mock mode, we simulate a single ticket 60% of the time on manual pull
        if self.mock_mode or not new_tickets:
            # Generate a new mock ticket
            new_tickets = [self.simulate_single_incident()]
            
        # Insert new tickets to SQLite database if they don't already exist
        conn = get_db_connection()
        cursor = conn.cursor()
        
        added_tickets = []
        for ticket in new_tickets:
            # Check if ticket exists
            cursor.execute("SELECT number FROM incidents WHERE number = ?", (ticket["number"],))
            if not cursor.fetchone():
                cursor.execute("""
                INSERT INTO incidents (number, short_description, description, category, priority, urgency, sla_limit, status, assigned_to, assigned_at, created_at, rejection_count, rejected_associates)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    ticket["number"],
                    ticket["short_description"],
                    ticket["description"],
                    ticket["category"],
                    ticket["priority"],
                    ticket["urgency"],
                    ticket["sla_limit"],
                    ticket["status"],
                    ticket["assigned_to"],
                    ticket["assigned_at"],
                    ticket["created_at"],
                    ticket.get("rejection_count", 0),
                    ticket.get("rejected_associates", "[]")
                ))
                added_tickets.append(ticket)
                
        conn.commit()
        conn.close()
        
        return added_tickets

servicenow_client = ServiceNowClient()
