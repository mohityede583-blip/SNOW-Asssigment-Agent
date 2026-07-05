import React, { useState, useEffect } from 'react';
import { Users, Shield, Clock, Plus, Minus, ArrowUpRight } from 'lucide-react';
import { getAssociates, overrideAssignment } from '../api';

export default function AssociateQueue() {
  const [associates, setAssociates] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const data = await getAssociates();
      setAssociates(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const adjustQueue = async (assocName, amount) => {
    // We can simulate load changes directly using local increments for visual testing,
    // or by making a manual dummy assignment in the database.
    // For simple mock testing, we will call the backend API or mock it.
    // Let's implement a backend mock override or let it modify local state for visual testing,
    // but wait! If we modify local state, the next refresh will overwrite it. 
    // To make it persistent in the DB, we can write a simple backend route,
    // or we can just call the override API with a dummy ticket!
    // Or we can just let it edit the SQLite database! Wait, let's look at a simpler way:
    // We can add an endpoint to manually modify workloads. Let's do that!
    // But since we can make requests, let's write a backend endpoint `/api/associates/workload` to adjust queue size!
    // Wait, let's look at if we can just update database workloads directly via an API request,
    // or we can implement it as a fetch that changes it. Yes, we can add a route `POST /api/associates/workload` 
    // in main.py. But since we didn't add it in main.py yet, we can update main.py! 
    // Wait! Can we update main.py using replace_file_content to add this endpoint? Yes! 
    // But even without modifying the backend, we can just trigger a manual override or mock resolve, 
    // which decrements/increments workload! Yes, we have `/api/incidents/resolve` which decrements workload,
    // and `/api/incidents/override` which increments workload.
    // Let's add a backend route `POST /api/associates/workload` to change the active ticket count directly.
    // This is very clean and lets the user directly test workload balancing!
    // Let's write the code for it in `AssociateQueue.jsx` and then we'll update `main.py` to support it.
    try {
      const response = await fetch('/api/associates/workload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: assocName, amount })
      });
      if (response.ok) {
        await loadData();
      }
    } catch (err) {
      console.error("Failed to adjust workload", err);
    }
  };

  const getSkillBadge = (level) => {
    switch (level) {
      case 'L3': return <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-950 text-purple-400 border border-purple-800">L3 - Senior</span>;
      case 'L2': return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-indigo-950 text-indigo-400 border border-indigo-850">L2 - Mid</span>;
      default: return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-800 text-slate-400 border border-slate-700">L1 - Junior</span>;
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-400 animate-pulse">
        Loading associate queues...
      </div>
    );
  }

  // Group associates by domain
  const domains = [...new Set(associates.map(a => a.domain))];

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 rounded-xl flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Users className="text-blue-500" />
            Support Associates & Workloads
          </h2>
          <p className="text-sm text-slate-400">
            Monitor active queues, skill levels, and shift status across technology teams. 
            Adjust queue numbers manually to test AI workload balancing.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {domains.map((dom) => {
          const teamMembers = associates.filter(a => a.domain === dom);
          return (
            <div key={dom} className="glass-card rounded-xl p-5 border border-slate-850 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-lg font-bold text-slate-200">{dom} Team</h3>
                <span className="text-xs text-slate-500 font-semibold">{teamMembers.length} members</span>
              </div>

              <div className="space-y-3">
                {teamMembers.map((member) => (
                  <div 
                    key={member.name} 
                    className={`p-3.5 rounded-xl border transition flex items-center justify-between ${
                      member.is_on_shift 
                        ? 'bg-slate-900/60 border-slate-800' 
                        : 'bg-slate-950/20 border-slate-900/40 opacity-60'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {member.is_on_shift && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        )}
                        <p className="font-bold text-slate-200">{member.name}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {getSkillBadge(member.skill_level)}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${
                          member.is_on_shift 
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' 
                            : 'bg-slate-950 text-slate-500 border border-slate-850'
                        }`}>
                          {member.current_shift_acronym} ({member.is_on_shift ? 'Active' : 'Off'})
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Clock size={10} /> {member.shift_time_block}
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Queue</p>
                      <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                        <button 
                          onClick={() => adjustQueue(member.name, -1)}
                          className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-750 transition"
                        >
                          <Minus size={12} />
                        </button>
                        <span className={`text-base font-extrabold px-1 min-w-[20px] text-center ${
                          member.active_tickets >= 3 ? 'text-amber-400 glow-text-orange' : 'text-blue-400'
                        }`}>
                          {member.active_tickets}
                        </span>
                        <button 
                          onClick={() => adjustQueue(member.name, 1)}
                          className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-750 transition"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
