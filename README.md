# 🤖 ServiceNow AI Incident Assignment Agent

A RAG-based full-stack web application that automates ServiceNow incident assignment using AI. It routes unassigned tickets to the most qualified on-shift associate by combining shift roster data, workload balancing, domain experience (via vector similarity), and LLM-powered reasoning.

---

## 🧠 How It Works

```
ServiceNow API (or Simulator)
        │
        ▼
  Unassigned Incidents Queue
        │
        ▼
  AI Assignment Engine
  ┌─────────────────────────────────────────────┐
  │  1. Filter: Is associate on shift right now? │
  │  2. Match:  Correct tech domain (MFT/Azure…) │
  │  3. Balance: Who has the lowest ticket queue? │
  │  4. RAG:    Who solved similar issues before? │
  │  5. Skill:  L3 for critical, L1 for low P?   │
  │  6. LLM:    Generate recommendation + reason │
  │  7. Score:  Confidence ≥ 70% → Auto-assign   │
  │             Confidence < 70% → Human review  │
  └─────────────────────────────────────────────┘
        │
        ▼
  Associate Notified + Audit Log Written
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite 8, Tailwind CSS v4 |
| **Backend** | Python 3.14, FastAPI, Uvicorn |
| **AI / LLM** | Ollama — `qwen3:1.7b` (reasoning) |
| **Embeddings** | Ollama — `qwen3-embedding:4b` (RAG vectors) |
| **Vector Store** | SQLite + NumPy cosine similarity |
| **Shift Roster** | Excel (`.xlsx`) via Pandas + OpenPyXL |
| **ServiceNow** | REST API wrapper (simulator mode if no credentials) |

---

## 📋 Prerequisites

Make sure the following are installed on your machine:

| Tool | Version | Download |
|---|---|---|
| Python | 3.10+ | https://python.org |
| Node.js | 18+ | https://nodejs.org |
| Ollama | 0.3+ | https://ollama.com |

### Required Ollama Models

Pull both models before starting:

```powershell
ollama pull qwen3:1.7b
ollama pull qwen3-embedding:4b
```

Verify Ollama is running:

```powershell
ollama list
```

---

## 🚀 Getting Started

### 1. Clone / Navigate to the Project

```powershell
cd "c:\Users\<your-user>\Desktop\AI project\SNOW-Asssigment-Agent"
```

### 2. Start the Backend (FastAPI)

```powershell
# Create and activate the virtual environment (first time only)
python -m venv backend/.venv
& "backend/.venv/Scripts/pip" install -r backend/requirements.txt

# Start the server
& "backend/.venv/Scripts/python" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

The backend will automatically:
- Create the SQLite database (`incident_assignment.db`)
- Sync associates from `shift_roster.xlsx`
- Seed 10 historical resolved incidents into the RAG knowledge base
- Start a background worker that simulates a new ServiceNow ticket every 45 seconds

✅ Backend API available at: **http://localhost:8000**  
📄 Interactive API docs: **http://localhost:8000/docs**

---

### 3. Start the Frontend (React + Vite)

Open a **second terminal**:

```powershell
# Add Node.js to PATH if needed
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH

cd frontend
npm install        # First time only
npm run dev
```

✅ Frontend dashboard available at: **http://localhost:5173**

---

## 📁 Project Structure

```
SNOW-Asssigment-Agent/
│
├── backend/
│   ├── __init__.py              # Python package marker
│   ├── main.py                  # FastAPI app & all REST endpoints
│   ├── config.py                # App configuration (Ollama models, paths)
│   ├── database.py              # SQLite schema, seeding & associate sync
│   ├── roster_manager.py        # Excel shift parser + real-time shift check
│   ├── rag_engine.py            # Embedding-based vector similarity search
│   ├── assignment_engine.py     # Scoring logic + Ollama LLM routing
│   ├── servicenow_client.py     # ServiceNow API client / ticket simulator
│   └── requirements.txt         # Python dependencies
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Main layout with tab navigation
│   │   ├── api.js               # Axios API calls to FastAPI
│   │   └── components/
│   │       ├── Dashboard.jsx    # Incident queue + AI recommendation panel
│   │       ├── RosterView.jsx   # Monthly shift calendar grid
│   │       ├── AssociateQueue.jsx # Team queues + workload adjuster
│   │       ├── HistoryView.jsx  # RAG knowledge base browser + search
│   │       └── Metrics.jsx      # Performance metrics + audit log viewer
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── vite.config.js           # Proxy: /api/* → http://localhost:8000
│
├── shift_roster.xlsx            # Monthly shift schedule (July 2026)
├── verify_backend.py            # Automated backend test suite
└── README.md                    # This file
```

---

## 📊 Excel Shift Roster Format (`shift_roster.xlsx`)

The system reads your `shift_roster.xlsx` from the project root. It must contain the following sheets:

| Sheet Name | Purpose |
|---|---|
| `Associate_Skills` | `Associate Name`, `Technology Domain`, `Skill Level` (L1/L2/L3) |
| `Shift_Definitions` | `Shift Acronym` → `Time Block` (e.g. `AM` → `06:00-14:00`) |
| `MFT` | Calendar: `Associate Name` + columns `1`–`31` with shift acronyms |
| `ESB` | Same format for ESB team |
| `Azure` | Same format for Azure team |
| `Database` | Same format for Database team |
| `ETL` | Same format for ETL team |
| `L1_Support` | Same format for L1 Support (escalation fallback) team |

**Supported shift acronyms:**

| Acronym | Meaning | Default Time Block |
|---|---|---|
| `AM` | Morning Shift | `06:00–14:00` |
| `EVE` | Evening Shift | `14:00–22:00` |
| `N` | Night Shift | `22:00–06:00` |
| `OFF` | Day Off | — |

> To use your own roster, replace `shift_roster.xlsx` with your file following the structure above and restart the backend.

---

## 🔌 ServiceNow Integration

By default the app runs in **Simulator Mode** — it generates realistic mock tickets automatically.

To connect to a real ServiceNow instance, create a `.env` file in the project root:

```env
SERVICENOW_URL=https://your-instance.service-now.com
SERVICENOW_USER=your_username
SERVICENOW_PASSWORD=your_password
```

The backend will automatically switch to live API mode when these are set.

---

## 🎯 Feature Walkthrough

### Dashboard — Incident Queue
- Displays all unassigned, assigned, flagged, and resolved tickets
- Select one or multiple unassigned tickets → click **"Intelligent Auto-Assign"**
- The AI panel shows: recommended associate, confidence score, candidate scoring breakdown, and the LLM justification
- **Approve** → confirms the assignment  
- **Reject (Escalate)** → removes that associate and re-runs the engine automatically  
- **Manual Override** → lets you pick any associate directly  
- **Resolve** → marks the ticket done and indexes the resolution into the RAG knowledge base

### Shift Roster — Calendar View
- Shows the full July 2026 shift calendar color-coded by shift type
- Highlights today's column with a blue ring
- Filter by technology team using the team tabs

### Associate Queues — Workload Manager
- See all associates grouped by team with their current shift status and active ticket counts
- Use the `+` / `−` buttons to manually simulate workload changes and test the AI's balancing logic

### RAG Knowledge Base — History Search
- Browse all resolved incidents stored in the vector database
- Enter any free-text query (e.g. *"Azure blob storage timeout"*) and see similarity-ranked results powered by `qwen3-embedding:4b` cosine matching

### Performance Metrics — Audit Dashboard
- View assignment accuracy, average time-to-route, rejection counts, and auto vs flagged ratios
- Load distribution bar chart shows each associate's current queue depth
- Full AI audit log with confidence scores, LLM justifications, and approval status

---

## 🧪 Running the Automated Test Suite

```powershell
& "backend/.venv/Scripts/python" verify_backend.py
```

This tests:
1. ✅ Database initialization and associate sync from Excel
2. ✅ Shift roster parsing and active-shift detection
3. ✅ RAG vector similarity search (requires Ollama embedding model)
4. ✅ Full AI assignment workflow end-to-end

---

## ⚙️ Configuration

All settings live in [`backend/config.py`](backend/config.py):

| Setting | Default | Description |
|---|---|---|
| `OLLAMA_TEXT_MODEL` | `qwen3:1.7b` | LLM used for reasoning and justification |
| `OLLAMA_EMBED_MODEL` | `qwen3-embedding:4b` | Model used for RAG vector embeddings |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `CONFIDENCE_THRESHOLD` | `70.0` | Scores below this % are flagged for human review |
| `ROSTER_FILE_PATH` | `shift_roster.xlsx` (auto-resolved) | Path to the Excel roster file |

---

## 🐛 Troubleshooting

| Issue | Fix |
|---|---|
| `No such file or directory: shift_roster.xlsx` | Ensure `shift_roster.xlsx` exists in the project root directory |
| `Ollama embedding API error` | Run `ollama pull qwen3-embedding:4b` and make sure Ollama is running |
| `node not recognized` | Add `C:\Program Files\nodejs` to your PATH or prefix commands with `$env:PATH = "C:\Program Files\nodejs;" + $env:PATH` |
| Frontend shows blank page | Check browser console. Ensure backend is running on port 8000 first |
| Assignment always falls back to heuristic | Ollama LLM may be cold-starting. The fallback still works — wait a moment and retry |
| All associates show "OFF shift" | Check the date column in your `shift_roster.xlsx` matches the current month |
