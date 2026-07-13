import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Cpu, ShieldCheck, ShieldAlert, AlertTriangle, UserCheck,
  CheckCircle, Edit3, Database, Clock, Calendar, X, Check,
} from 'lucide-react';
import {
  getIncidentDetails, getSimilarIncidents, getAssociates,
  assignIncidents, approveAssignment, rejectAssignment,
  overrideAssignment, resolveIncident,
} from '../api';

export default function IncidentDetails({ number, onUpdateMetrics }) {
  const auditRef = useRef(null);
  const [details, setDetails] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [associates, setAssociates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [resolutionText, setResolutionText] = useState('');

  const loadAll = async () => {
    try {
      const [d, s, a] = await Promise.all([
        getIncidentDetails(number),
        getSimilarIncidents(number).catch(() => []),
        getAssociates(),
      ]);
      setDetails(d);
      setSimilar(s);
      setAssociates(a);
      setError(null);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 404) {
        setError('not_found');
      } else {
        setError(e?.message || 'Failed to load incident');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setDetails(null);
    setError(null);
    loadAll();
    const interval = setInterval(loadAll, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number]);

  const handleAutoAssign = async () => {
    setIsProcessing(true);
    setLoadingText(`AI Agent is analyzing ticket ${number}...\n- Running skill mapping\n- Checking active shift rosters\n- Inspecting RAG knowledge base`);
    try {
      const results = await assignIncidents([number]);
      if (results[0]?.status === 'success') {
        await loadAll();
        onUpdateMetrics?.();
      } else {
        alert(`AI assignment failed: ${results[0]?.message || 'unknown error'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Error in AI assignment. Ensure Ollama service is running.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApprove = async () => {
    if (!details) return;
    const latest = details.assignment_history[details.assignment_history.length - 1];
    if (!latest) return;
    try {
      await approveAssignment(number, latest.recommended_associate);
      await loadAll();
      onUpdateMetrics?.();
    } catch (e) {
      console.error(e);
    }
  };

  const handleReject = async () => {
    if (!details) return;
    const latest = details.assignment_history[details.assignment_history.length - 1];
    if (!latest) return;
    setIsProcessing(true);
    setLoadingText(`Re-running AI matching flow for ${number}...`);
    try {
      await rejectAssignment(number, latest.recommended_associate);
      await loadAll();
      onUpdateMetrics?.();
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOverride = async () => {
    if (!selectedAssignee) return;
    try {
      await overrideAssignment(number, selectedAssignee);
      setShowOverrideModal(false);
      setSelectedAssignee('');
      await loadAll();
      onUpdateMetrics?.();
    } catch (e) {
      console.error(e);
    }
  };

  const handleResolve = async () => {
    if (!resolutionText || !details) return;
    try {
      await resolveIncident(number, resolutionText, details.incident.assigned_to);
      setShowResolveModal(false);
      setResolutionText('');
      await loadAll();
      onUpdateMetrics?.();
    } catch (e) {
      console.error(e);
    }
  };

  const getPriorityBadge = (prio) => {
    switch (prio) {
      case '1': return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-red-50 text-red-700 border border-red-200">1 - Critical</span>;
      case '2': return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-55 text-amber-700 border border-amber-200">2 - High</span>;
      case '3': return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-50 text-blue-700 border border-blue-200">3 - Moderate</span>;
      default: return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-100 text-slate-600 border border-slate-200">4 - Low</span>;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Unassigned': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-600 border border-slate-200">Unassigned</span>;
      case 'Flagged': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1 w-max"><AlertTriangle size={12}/> Human Review</span>;
      case 'Assigned': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-755 border border-blue-200 flex items-center gap-1 w-max"><UserCheck size={12}/> Assigned</span>;
      case 'Resolved': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 w-max"><CheckCircle size={12}/> Resolved</span>;
      default: return null;
    }
  };

  const getConfidenceBadge = (score) => {
    if (score == null) return null;
    if (score >= 80) return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1"><ShieldCheck size={16}/> {score}%</span>;
    if (score >= 70) return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1"><AlertTriangle size={16}/> {score}%</span>;
    return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-red-50 text-red-700 border border-red-200 flex items-center gap-1"><ShieldAlert size={16}/> {score}% (Flagged)</span>;
  };

  if (error === 'not_found') {
    return (
      <div className="space-y-6">
        <div className="glass-card p-8 rounded-xl text-center space-y-4">
          <AlertTriangle size={48} className="mx-auto text-amber-500" />
          <h2 className="text-xl font-bold text-slate-800">Incident Not Found</h2>
          <p className="text-sm text-slate-500">
            Ticket <span className="font-mono font-bold text-blue-600">{number}</span> does not exist in the database.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition shadow-sm"
          >
            <ArrowLeft size={16} /> Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (loading && !details) {
    return (
      <div className="py-12 text-center text-slate-500 animate-pulse">
        Loading incident details for {number}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-red-650">
        Failed to load incident: {error}
      </div>
    );
  }

  const { incident, assignment_history, assignee } = details;
  const isClosed = incident.status === 'Resolved';

  return (
    <div className="space-y-6">
      {/* Breadcrumb / back link */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link to="/" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft size={14} /> Queue Dashboard
        </Link>
        <span className="text-slate-400">/</span>
        <span className="font-mono font-bold text-blue-600">{incident.number}</span>
      </div>

      {/* Header strip: title, badges, timestamps */}
      <div className="glass-card p-6 rounded-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-black text-slate-800 font-mono">{incident.number}</h1>
              {getPriorityBadge(incident.priority)}
              {getStatusBadge(incident.status)}
            </div>
            <p className="text-base text-slate-700 font-semibold">{incident.short_description}</p>
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Calendar size={12} /> Created: {incident.created_at}</span>
              {incident.assigned_at && (
                <span className="flex items-center gap-1"><Clock size={12} /> Assigned: {incident.assigned_at}</span>
              )}
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-200">
          <button
            onClick={handleAutoAssign}
            disabled={isProcessing || isClosed}
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm disabled:bg-slate-100 disabled:text-slate-400 disabled:border disabled:border-slate-200"
          >
            <Cpu size={16} /> Auto-Assign (AI)
          </button>
          <button
            onClick={() => setShowOverrideModal(true)}
            disabled={isProcessing || isClosed}
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition border border-slate-200 disabled:opacity-50"
          >
            <Edit3 size={16} /> Manual Override
          </button>
          <button
            onClick={() => setShowResolveModal(true)}
            disabled={isProcessing || isClosed || !incident.assigned_to}
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm disabled:bg-slate-100 disabled:text-slate-400 disabled:border disabled:border-slate-200"
          >
            <CheckCircle size={16} /> Resolve Incident
          </button>
          <button
            onClick={() => auditRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg bg-white hover:bg-slate-50 text-slate-700 transition border border-slate-200"
          >
            <Database size={16} /> View AI Audit Trail
          </button>
        </div>
      </div>

      {/* Two-column main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Incident details card */}
        <div className="glass-card p-6 rounded-xl lg:col-span-7 space-y-4">
          <h2 className="text-lg font-bold text-slate-800">Incident Details</h2>
          <div className="space-y-3 text-sm">
            <DetailRow label="Description" value={incident.description} />
            <DetailRow label="Category" value={incident.category} />
            <DetailRow label="Urgency" value={incident.urgency} />
            <DetailRow label="SLA Limit" value={incident.sla_limit} />
            <DetailRow label="Rejection Count" value={String(incident.rejection_count)} />
            {incident.rejected_associates && incident.rejected_associates.length > 0 && (
              <div className="grid grid-cols-3 gap-3 items-start">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Rejected Associates</span>
                <div className="col-span-2 flex flex-wrap gap-1">
                  {incident.rejected_associates.map((n) => (
                    <span key={n} className="px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 border border-red-200">{n}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Approve/Reject for Flagged incidents */}
          {incident.status === 'Flagged' && assignment_history.length > 0 && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
              <button
                onClick={handleApprove}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition"
              >
                <Check size={16} /> Approve AI Recommendation
              </button>
              <button
                onClick={handleReject}
                disabled={isProcessing}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold bg-white text-red-650 hover:bg-red-50 border border-red-200 transition disabled:opacity-50"
              >
                <X size={16} /> Reject (Re-run AI)
              </button>
            </div>
          )}
        </div>

        {/* Current assignee card (name only per user preference) */}
        <div className="glass-card p-6 rounded-xl lg:col-span-5 space-y-4">
          <h2 className="text-lg font-bold text-slate-800">Current Assignee</h2>
          {assignee ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-600 font-black text-lg">
                  {assignee.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                </div>
                <p className="font-bold text-slate-800 text-base">{assignee.name}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic">
              No current assignee. Click "Auto-Assign" to dispatch via AI.
            </p>
          )}
        </div>
      </div>

      {/* AI Audit Trail */}
      <div ref={auditRef} className="glass-card p-6 rounded-xl space-y-4">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Cpu className="text-blue-600" /> AI Assignment History
        </h2>
        {assignment_history.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-4">No AI actions yet. Run Auto-Assign to generate audit entries.</p>
        ) : (
          <div className="space-y-3">
            {assignment_history.map((log) => (
              <div key={log.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-slate-400">{new Date(log.timestamp).toLocaleString()}</span>
                    <span className={`px-2 py-0.5 text-xs font-bold rounded ${
                      log.decision_status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : log.decision_status === 'Rejected' ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>{log.decision_status}</span>
                    <span className="text-xs text-slate-500 font-semibold">by {log.assigned_by}</span>
                  </div>
                  {getConfidenceBadge(log.confidence_score)}
                </div>
                <p className="text-sm font-semibold text-slate-800">Recommended: {log.recommended_associate}</p>
                <p className="text-xs text-slate-650 italic bg-white p-2.5 rounded border border-slate-200">"{log.justification}"</p>
                {log.evaluated_associates && log.evaluated_associates.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500 font-semibold">
                      {log.evaluated_associates.length} candidate(s) evaluated
                    </summary>
                    <div className="mt-2 space-y-1">
                      {log.evaluated_associates.map((c) => (
                        <div key={c.name} className="flex justify-between p-2 rounded bg-white border border-slate-200">
                          <span className="font-semibold text-slate-700">{c.name}</span>
                          <span className="font-mono text-slate-600">Score: {c.heuristic_score}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Similar Past Resolved Incidents */}
      <div className="glass-card p-6 rounded-xl space-y-4">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Database className="text-emerald-600" /> Similar Past Resolved Incidents
        </h2>
        {similar.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No similar resolved incidents found in RAG knowledge base.</p>
        ) : (
          <div className="space-y-3">
            {similar.map((s) => (
              <div key={s.number} className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-blue-600 font-bold">{s.number}</span>
                  <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {s.similarity_score}% Match
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-800">{s.short_description}</p>
                <p className="text-xs text-slate-600 leading-relaxed bg-white p-2.5 rounded border border-slate-200">
                  {s.resolution}
                </p>
                <p className="text-[10px] text-slate-500 text-right font-semibold">
                  Resolved by: <span className="text-slate-700">{s.resolved_by}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md p-6 rounded-xl border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-800">Manual Assignment Override</h3>
              <button onClick={() => setShowOverrideModal(false)} className="text-slate-400 hover:text-slate-650">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Directly route ticket <span className="font-mono text-blue-650 font-bold">{number}</span> to any team member.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-555 uppercase tracking-wide mb-2">Select Associate</label>
                <select
                  value={selectedAssignee}
                  onChange={(e) => setSelectedAssignee(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">-- Choose Associate --</option>
                  {associates.map((assoc) => (
                    <option key={assoc.name} value={assoc.name}>
                      {assoc.name} ({assoc.domain} - {assoc.skill_level}) {assoc.is_on_shift ? '• ON SHIFT' : '(OFF)'} - Queue: {assoc.active_tickets}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => setShowOverrideModal(false)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-250 text-slate-700 border border-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleOverride}
                disabled={!selectedAssignee}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition ${
                  selectedAssignee
                    ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                }`}
              >
                Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Incident Modal */}
      {showResolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-lg p-6 rounded-xl border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Database className="text-emerald-600" />
                Resolve Incident &amp; Index to RAG KB
              </h3>
              <button onClick={() => setShowResolveModal(false)} className="text-slate-400 hover:text-slate-650">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Provide resolution comments for ticket <span className="font-mono text-blue-650 font-bold">{number}</span>. Resolving will automatically vectorize and index this incident in the historical knowledge base for future assignments.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-555 uppercase tracking-wide mb-2">Resolution Notes</label>
                <textarea
                  rows="4"
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  placeholder="Explain how this incident was fixed. Be descriptive (mention systems, errors, codes, portal paths) to allow accurate future RAG lookups."
                  className="w-full bg-slate-55 border border-slate-200 rounded-lg py-2.5 px-3 text-sm text-slate-850 focus:border-blue-500 focus:outline-none placeholder-slate-400"
                ></textarea>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => setShowResolveModal(false)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-250 text-slate-700 border border-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={!resolutionText}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition ${
                  resolutionText
                    ? 'bg-emerald-600 hover:bg-emerald-505 text-white cursor-pointer shadow-sm'
                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                }`}
              >
                Submit &amp; Vectorize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-100/90 backdrop-blur-md">
          <div className="relative flex items-center justify-center">
            <div className="absolute w-24 h-24 rounded-full border border-blue-500 animate-ping opacity-20"></div>
            <div className="w-20 h-20 rounded-full border-t-2 border-r-2 border-blue-600 animate-spin"></div>
            <div className="absolute text-blue-650">
              <Cpu size={32} className="animate-pulse" />
            </div>
          </div>
          <p className="mt-8 text-lg font-bold text-slate-800 glow-text-blue text-center">AI System Processing...</p>
          <pre className="mt-4 text-xs text-slate-600 max-w-md text-center leading-relaxed font-mono whitespace-pre-line bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            {loadingText}
          </pre>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="grid grid-cols-3 gap-3 items-start">
      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <div className="col-span-2 text-sm text-slate-800 break-words">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}
