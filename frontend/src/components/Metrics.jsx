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
      <div className="py-12 text-center text-slate-500 animate-pulse">
        Loading metrics dashboard...
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="py-12 text-center text-red-650">
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
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Assignment Accuracy</span>
            <Award className="text-emerald-500" size={20} />
          </div>
          <h3 className="text-3xl font-extrabold text-emerald-600">{metrics.assignment_accuracy}%</h3>
          <p className="text-[10px] text-slate-500">Assignments resolved without rejections.</p>
        </div>

        <div className="glass-card p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Avg Time to Route</span>
            <Clock className="text-blue-500" size={20} />
          </div>
          <h3 className="text-3xl font-extrabold text-blue-600">{metrics.avg_time_to_assignment_seconds}s</h3>
          <p className="text-[10px] text-slate-500">ServiceNow ingestion to associate queue routing.</p>
        </div>

        <div className="glass-card p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Auto-Assignment Ratio</span>
            <CheckCircle className="text-cyan-600" size={20} />
          </div>
          <h3 className="text-3xl font-extrabold text-cyan-600">
            {metrics.total_incidents > 0 
              ? Math.round((metrics.auto_assigned_count / metrics.total_incidents) * 100) 
              : 0}%
          </h3>
          <p className="text-[10px] text-slate-500">{metrics.auto_assigned_count} auto-assigned / {metrics.flagged_review_count} flagged.</p>
        </div>

        <div className="glass-card p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Ticket Rejections</span>
            <ShieldAlert className="text-red-500" size={20} />
          </div>
          <h3 className="text-3xl font-extrabold text-red-650">{metrics.rejection_count}</h3>
          <p className="text-[10px] text-slate-500">Reassignment triggers executed automatically.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Workload Distribution Chart */}
        <div className="glass-card p-6 rounded-xl lg:col-span-5 space-y-6">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <BarChart size={18} className="text-blue-655" />
              Load Distribution
            </h3>
            <p className="text-xs text-slate-500">Current active tickets in queues per associate.</p>
          </div>

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {sortedWorkloads.map((assoc) => {
              const activeCount = assoc.active_tickets;
              const percentage = Math.min(100, (activeCount / 6) * 100);
              
              return (
                <div key={assoc.name} className="space-y-1 text-xs">
                  <div className="flex justify-between font-semibold">
                    <span className="text-slate-700">{assoc.name} <span className="text-[10px] text-slate-500 font-normal">({assoc.domain})</span></span>
                    <span className={activeCount >= 3 ? 'text-amber-600 font-bold' : 'text-blue-600'}>{activeCount} tickets</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 border border-slate-200">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        activeCount >= 4 
                          ? 'bg-red-500' 
                          : activeCount >= 2 
                            ? 'bg-amber-450' 
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
          <h3 className="text-lg font-bold text-slate-800">AI Assignment Audit Logs</h3>
          
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {logs.length === 0 ? (
              <div className="text-center py-12 text-slate-450 text-sm">
                No logs recorded. Trigger assignments in the dashboard.
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="p-4 rounded-xl bg-slate-50 border border-slate-250 hover:border-slate-350 transition space-y-2 text-xs shadow-sm">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-blue-600 font-bold">{log.incident_number}</span>
                      <span className="text-slate-400">→</span>
                      <span className="text-slate-700 font-semibold">{log.recommended_associate}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full font-bold ${
                        log.decision_status === 'Approved' 
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-250' 
                          : log.decision_status === 'Rejected' 
                            ? 'bg-red-50 text-red-705 border border-red-200' 
                            : 'bg-amber-50 text-amber-700 border border-amber-250'
                      }`}>
                        {log.decision_status}
                      </span>
                      <span className="text-slate-450 font-mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <p className="text-slate-650 leading-relaxed italic bg-white p-2.5 rounded border border-slate-200">
                    "{log.justification}"
                  </p>
                  <div className="flex justify-between text-[10px] text-slate-500 font-semibold">
                    <span>Confidence: <span className="text-slate-700">{log.confidence_score}%</span></span>
                    <span>Dispatcher: <span className="text-slate-700">{log.assigned_by} Dispatch</span></span>
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
