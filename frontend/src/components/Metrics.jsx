import React, { useState, useEffect } from 'react';
import { 
  BarChart, Clock, Award, ShieldAlert, 
  Settings, CheckCircle, AlertTriangle, HelpCircle
} from 'lucide-react';
import { getMetrics, getLogs } from '../api';

export default function Metrics() {
  const [metrics, setMetrics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const metricData = await getMetrics();
      const logData = await getLogs();
      setMetrics(metricData);
      setLogs(logData);
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

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-400 animate-pulse">
        Loading metrics dashboard...
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="py-12 text-center text-red-400">
        Failed to load metrics. Ensure backend is running.
      </div>
    );
  }

  // Workload distributions sorted
  const sortedWorkloads = [...metrics.workload_distribution].sort((a, b) => b.active_tickets - a.active_tickets);

  return (
    <div className="space-y-6">
      {/* Cards summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Assignment Accuracy</span>
            <Award className="text-emerald-400" size={20} />
          </div>
          <h3 className="text-3xl font-extrabold text-emerald-400 glow-text-green">{metrics.assignment_accuracy}%</h3>
          <p className="text-[10px] text-slate-500">Assignments resolved without rejections.</p>
        </div>

        <div className="glass-card p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Avg Time to Route</span>
            <Clock className="text-blue-400" size={20} />
          </div>
          <h3 className="text-3xl font-extrabold text-blue-400 glow-text-blue">{metrics.avg_time_to_assignment_seconds}s</h3>
          <p className="text-[10px] text-slate-500">ServiceNow ingestion to associate queue routing.</p>
        </div>

        <div className="glass-card p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Auto-Assignment Ratio</span>
            <CheckCircle className="text-cyan-400" size={20} />
          </div>
          <h3 className="text-3xl font-extrabold text-cyan-400">
            {metrics.total_incidents > 0 
              ? Math.round((metrics.auto_assigned_count / metrics.total_incidents) * 100) 
              : 0}%
          </h3>
          <p className="text-[10px] text-slate-500">{metrics.auto_assigned_count} auto-assigned / {metrics.flagged_review_count} flagged.</p>
        </div>

        <div className="glass-card p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Ticket Rejections</span>
            <ShieldAlert className="text-red-400" size={20} />
          </div>
          <h3 className="text-3xl font-extrabold text-red-400">{metrics.rejection_count}</h3>
          <p className="text-[10px] text-slate-500">Reassignment triggers executed automatically.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Workload Distribution Chart */}
        <div className="glass-card p-6 rounded-xl lg:col-span-5 space-y-6">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
              <BarChart size={18} className="text-blue-500" />
              Load Distribution
            </h3>
            <p className="text-xs text-slate-400">Current active tickets in queues per associate.</p>
          </div>

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {sortedWorkloads.map((assoc) => {
              const activeCount = assoc.active_tickets;
              // Max tickets we show is 8 for progress width
              const percentage = Math.min(100, (activeCount / 6) * 100);
              
              return (
                <div key={assoc.name} className="space-y-1 text-xs">
                  <div className="flex justify-between font-semibold">
                    <span className="text-slate-300">{assoc.name} <span className="text-[10px] text-slate-550 font-normal">({assoc.domain})</span></span>
                    <span className={activeCount >= 3 ? 'text-amber-400 font-bold' : 'text-blue-400'}>{activeCount} tickets</span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-2.5 border border-slate-850">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        activeCount >= 4 
                          ? 'bg-red-500 glow-border-red' 
                          : activeCount >= 2 
                            ? 'bg-amber-500' 
                            : 'bg-blue-600'
                      }`}
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Audit Decision logs */}
        <div className="glass-card p-6 rounded-xl lg:col-span-7 space-y-4">
          <h3 className="text-lg font-bold text-slate-200">AI Assignment Audit Logs</h3>
          
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {logs.length === 0 ? (
              <div className="text-center py-12 text-slate-650 text-sm">
                No logs recorded. Trigger assignments in the dashboard.
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="p-4 rounded-xl bg-slate-900 border border-slate-850 hover:border-slate-800 transition space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-blue-400 font-bold">{log.incident_number}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-slate-300 font-semibold">{log.recommended_associate}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full font-bold ${
                        log.decision_status === 'Approved' 
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' 
                          : log.decision_status === 'Rejected' 
                            ? 'bg-red-950 text-red-400 border border-red-900' 
                            : 'bg-amber-950 text-amber-400 border border-amber-900'
                      }`}>
                        {log.decision_status}
                      </span>
                      <span className="text-slate-500 font-mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <p className="text-slate-400 leading-relaxed italic bg-slate-950 p-2.5 rounded border border-slate-850">
                    "{log.justification}"
                  </p>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Confidence: <span className="font-bold text-slate-400">{log.confidence_score}%</span></span>
                    <span>Dispatcher: <span className="font-bold text-slate-400">{log.assigned_by} Dispatch</span></span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
