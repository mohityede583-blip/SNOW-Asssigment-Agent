import React, { useState, useEffect } from 'react';
import { Users, Shield, Clock, Plus, Minus, ArrowUpRight } from 'lucide-react';
import { getAssociates } from '../api';

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
      case 'L3': return <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-50 text-purple-700 border border-purple-200">L3 - Senior</span>;
      case 'L2': return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-indigo-50 text-indigo-700 border border-indigo-200">L2 - Mid</span>;
      default: return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-655 border border-slate-200">L1 - Junior</span>;
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500 animate-pulse">
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
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="text-blue-650" />
            Support Associates & Workloads
          </h2>
          <p className="text-sm text-slate-500">
            Monitor active queues, skill levels, and shift status across technology teams. 
            Adjust queue numbers manually to test AI workload balancing.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {domains.map((dom) => {
          const teamMembers = associates.filter(a => a.domain === dom);
          return (
            <div key={dom} className="glass-card rounded-xl p-5 border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 className="text-lg font-bold text-slate-850">{dom} Team</h3>
                <span className="text-xs text-slate-500 font-semibold">{teamMembers.length} members</span>
              </div>

              <div className="space-y-3">
                {teamMembers.map((member) => (
                  <div 
                    key={member.name} 
                    className={`p-3.5 rounded-xl border transition flex items-center justify-between ${
                      member.is_on_shift 
                        ? 'bg-white border-slate-200 shadow-sm' 
                        : 'bg-slate-50/50 border-slate-200/50 opacity-60'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {member.is_on_shift && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        )}
                        <p className="font-bold text-slate-800">{member.name}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {getSkillBadge(member.skill_level)}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${
                          member.is_on_shift 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {member.current_shift_acronym} ({member.is_on_shift ? 'Active' : 'Off'})
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Clock size={10} className="text-slate-400" /> {member.shift_time_block}
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Queue</p>
                      <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                        <button 
                          onClick={() => adjustQueue(member.name, -1)}
                          className="p-1 rounded bg-white hover:bg-slate-100 text-slate-650 border border-slate-200 transition"
                        >
                          <Minus size={12} />
                        </button>
                        <span className={`text-base font-extrabold px-1 min-w-[20px] text-center ${
                          member.active_tickets >= 3 ? 'text-amber-600' : 'text-blue-600'
                        }`}>
                          {member.active_tickets}
                        </span>
                        <button 
                          onClick={() => adjustQueue(member.name, 1)}
                          className="p-1 rounded bg-white hover:bg-slate-100 text-slate-650 border border-slate-200 transition"
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
