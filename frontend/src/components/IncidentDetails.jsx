import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Cpu, ShieldCheck, ShieldAlert, AlertTriangle, UserCheck,
  CheckCircle, Edit3, Database, Clock, X, Check, History, Info
} from 'lucide-react';
import {
  getIncidentDetails, getSimilarIncidents, getAssociates,
  assignIncidents, approveAssignment, rejectAssignment,
  overrideAssignment, resolveIncident
} from '../api';

export default function IncidentDetails({ number, onClose, onUpdateMetrics }) {
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

  const loadAll = useCallback(async () => {
    try {
      const [d, s, a] = await Promise.all([
        getIncidentDetails(number),
        getSimilarIncidents(number).catch(() => []),
        getAssociates()
      ]);
      setDetails(d);
      setSimilar(s);
      setAssociates(a);
      setError(null);
    } catch (e) {
      if (e?.response?.status === 404) {
        setError('not_found');
      } else {
        setError(e?.message || 'Failed to load incident details');
      }
    } finally {
      setLoading(false);
    }
  }, [number]);

  useEffect(() => {
    setLoading(true);
    setDetails(null);
    setError(null);
    loadAll();
    const interval = setInterval(loadAll, 15000);
    return () => clearInterval(interval);
  }, [loadAll]);

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
    const latest = details.assignment_history[0]; // Ordered by timestamp desc
    if (!latest) return;
    try {
      await approveAssignment(number, latest.recommended_associate);
      await loadAll();
      onUpdateMetrics?.();
    } catch (e) {
      console.error(e);
      alert('Failed to approve assignment');
    }
  };

  const handleReject = async () => {
    if (!details) return;
    const latest = details.assignment_history[0];
    if (!latest) return;
    setIsProcessing(true);
    setLoadingText(`Re-running AI matching flow for ${number}...`);
    try {
      await rejectAssignment(number, latest.recommended_associate);
      await loadAll();
      onUpdateMetrics?.();
    } catch (e) {
      console.error(e);
      alert('Failed to reject and reassign');
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
      alert('Failed to override assignment');
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
      alert('Failed to resolve incident');
    }
  };

  const getPriorityBadge = (prio) => {
    switch (prio) {
      case '1': return <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-red-50 text-red-700 border border-red-200 uppercase">1 - Critical</span>;
      case '2': return <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 uppercase">2 - High</span>;
      case '3': return <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-50 text-blue-700 border border-blue-200 uppercase">3 - Moderate</span>;
      default: return <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-100 text-slate-655 border border-slate-200 uppercase">4 - Low</span>;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Unassigned': return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase">Unassigned</span>;
      case 'Flagged': return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1 w-max uppercase"><AlertTriangle size={12}/> Human Review</span>;
      case 'Assigned': return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1 w-max uppercase"><UserCheck size={12}/> Assigned</span>;
      case 'Resolved': return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 w-max uppercase"><CheckCircle size={12}/> Resolved</span>;
      default: return null;
    }
  };

  const getConfidenceBadge = (score) => {
    if (score == null) return null;
    if (score >= 80) return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-250 flex items-center gap-1"><ShieldCheck size={16}/> {score}%</span>;
    if (score >= 70) return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-amber-50 text-amber-700 border border-amber-255 flex items-center gap-1"><AlertTriangle size={16}/> {score}%</span>;
    return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-red-50 text-red-700 border border-red-255 flex items-center gap-1"><ShieldAlert size={16}/> {score}% (Flagged)</span>;
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  const getSLABadge = (slaDue) => {
    if (!slaDue) return null;
    const minsLeft = (new Date(slaDue) - Date.now()) / 60000;
    if (minsLeft < 0)
      return <span className="px-3 py-1 text-xs font-bold rounded-lg bg-red-100 text-red-850 border border-red-200 flex items-center gap-1"><Clock size={12}/> SLA BREACHED</span>;
    if (minsLeft < 60)
      return <span className="px-3 py-1 text-xs font-bold rounded-lg bg-amber-100 text-amber-850 border border-amber-200 flex items-center gap-1"><Clock size={12}/> SLA urgent (&lt;1 hr)</span>;
    if (minsLeft < 240)
      return <span className="px-3 py-1 text-xs font-bold rounded-lg bg-amber-50 text-amber-750 border border-amber-200 flex items-center gap-1"><Clock size={12}/> SLA warning (&lt;4 hrs)</span>;
    return <span className="px-3 py-1 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-255 flex items-center gap-1"><Clock size={12}/> SLA on track</span>;
  };

  const IMPACT_LABELS = { '1': 'High', '2': 'Medium', '3': 'Low' };
  const getImpactBadge = (impact) => {
    if (!impact) return null;
    const label = IMPACT_LABELS[impact] || impact;
    const cls = impact === '1'
      ? 'bg-red-50 text-red-750 border-red-200'
      : impact === '2'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-100 text-slate-600 border-slate-200';
    return <span className={`px-2 py-0.5 text-xs font-semibold rounded-md border ${cls}`}>{label} Impact</span>;
  };

  if (error === 'not_found') {
    return (
      <div className="space-y-6">
        <div className="glass-card p-10 rounded-xl text-center space-y-4">
          <AlertTriangle size={48} className="mx-auto text-amber-500 animate-bounce" />
          <h2 className="text-xl font-bold text-slate-800">Incident Not Found</h2>
          <p className="text-sm text-slate-500">
            Ticket <span className="font-mono font-bold text-blue-600">{number}</span> does not exist in the system.
          </p>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition shadow-sm"
          >
            <ArrowLeft size={16} /> Return to Queue
          </button>
        </div>
      </div>
    );
  }

  if (loading && !details) {
    return (
      <div className="py-24 text-center space-y-3">
        <div className="w-12 h-12 rounded-full border-t-2 border-r-2 border-blue-600 animate-spin mx-auto"></div>
        <p className="text-slate-500 font-semibold animate-pulse text-sm">Loading incident details for {number}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-red-650 font-bold border border-red-200 bg-red-50 rounded-xl max-w-md mx-auto">
        Failed to load incident details: {error}
      </div>
    );
  }

  const { incident, assignment_history, assignee } = details;
  const isClosed = incident.status === 'Resolved';
  const latestRec = assignment_history.length > 0 ? assignment_history[0] : null;
  const showRecommendationPanel = (incident.status === 'Flagged' || incident.status === 'Unassigned') && latestRec && latestRec.decision_status === 'Pending_Approval';

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Breadcrumb / Back Navigation */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button onClick={onClose} className="hover:text-blue-600 flex items-center gap-1 font-semibold transition">
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
        <span className="text-slate-350">/</span>
        <span className="font-mono font-bold text-slate-800">{incident.number}</span>
      </div>

      {/* Main Header Strip */}
      <div className="glass-card p-6 rounded-xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-black text-slate-800 font-mono tracking-tight">{incident.number}</h1>
              {getPriorityBadge(incident.priority)}
              {getStatusBadge(incident.status)}
              {getSLABadge(incident.sla_due || incident.sla_limit)}
            </div>
            <p className="text-lg font-bold text-slate-800 leading-snug">{incident.short_description}</p>
          </div>
          
          {/* Top Actions Block */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleAutoAssign}
              disabled={isProcessing || isClosed}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm disabled:bg-slate-100 disabled:text-slate-400 disabled:border disabled:border-slate-200"
            >
              <Cpu size={14} /> Auto-Assign (AI)
            </button>
            <button
              onClick={() => {
                setShowOverrideModal(true);
                setSelectedAssignee('');
              }}
              disabled={isProcessing || isClosed}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition disabled:opacity-50"
            >
              <Edit3 size={14} /> Override Assignment
            </button>
            <button
              onClick={() => {
                setShowResolveModal(true);
                setResolutionText('');
              }}
              disabled={isProcessing || isClosed || !incident.assigned_to}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm disabled:bg-slate-100 disabled:text-slate-400 disabled:border disabled:border-slate-200"
            >
              <CheckCircle size={14} /> Resolve Ticket
            </button>
          </div>
        </div>
      </div>

      {/* AI Recommendation Panel (Approve / Reject UI) */}
      {showRecommendationPanel && (
        <div className="p-5 rounded-xl border border-amber-250 bg-amber-50/70 space-y-4 shadow-sm animate-fade-in">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex gap-3">
              <div className="p-2 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 mt-0.5">
                <Cpu size={20} className="animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-amber-800">Pending AI Assignment Approval</h3>
                <p className="text-xs text-amber-700 font-medium">
                  The Intelligent Assignment engine recommends routing this incident to <span className="font-bold text-slate-800">{latestRec.recommended_associate}</span>.
                </p>
              </div>
            </div>
            {getConfidenceBadge(latestRec.confidence_score)}
          </div>
          
          <div className="p-4 rounded-lg bg-white border border-amber-200 text-sm space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">AI Recommendation Justification</p>
            <p className="text-slate-700 italic leading-relaxed">"{latestRec.justification}"</p>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={handleApprove}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm"
            >
              <Check size={14} /> Approve AI Assignment
            </button>
            <button
              onClick={handleReject}
              disabled={isProcessing}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-white text-red-650 hover:bg-red-50 border border-red-200 transition disabled:opacity-50"
            >
              <X size={14} /> Reject &amp; Re-run AI
            </button>
          </div>
        </div>
      )}

      {/* Main Details grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Categorized incident fields */}
        <div className="lg:col-span-8 space-y-6">
          <div className="glass-card p-6 rounded-xl space-y-6">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
              <Info size={18} className="text-blue-500" />
              ServiceNow Incident Parameters
            </h2>
            
            {/* Category Groups */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              {/* Section: Core Data */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Classification &amp; Urgency</h3>
                <div className="space-y-3">
                  <DetailField label="Category" value={incident.category} />
                  <DetailField label="Subcategory" value={incident.subcategory} />
                  <DetailField label="Urgency" value={incident.urgency} />
                  <DetailField label="Impact" value={getImpactBadge(incident.impact)} />
                  <DetailField label="Severity" value={incident.severity ? `Level ${incident.severity}` : null} />
                </div>
              </div>

              {/* Section: SLA & Stats */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Timestamps &amp; SLA</h3>
                <div className="space-y-3">
                  <DetailField label="Opened At" value={formatDate(incident.opened_at)} />
                  <DetailField label="Created At" value={formatDate(incident.created_at)} />
                  <DetailField label="SLA Due" value={formatDate(incident.sla_due || incident.sla_limit)} />
                  <DetailField label="Activity Due" value={formatDate(incident.activity_due)} />
                  <DetailField label="Made SLA" value={incident.made_sla} />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Description Details</h3>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-150 space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Detailed Description</p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{incident.description || 'No description provided.'}</p>
              </div>
            </div>

            {/* ServiceNow System Audit parameters */}
            <div className="border-t border-slate-100 pt-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">System Audit Metadata</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <DetailField label="Sys ID" value={<span className="font-mono text-[11px] text-slate-650">{incident.sys_id}</span>} />
                <DetailField label="Class Name" value={incident.sys_class_name} />
                <DetailField label="Mod Count" value={incident.sys_mod_count != null ? String(incident.sys_mod_count) : null} />
                <DetailField label="Re-assignment" value={incident.reassignment_count != null ? `${incident.reassignment_count} times` : null} />
                <DetailField label="Re-opens" value={incident.reopen_count != null ? `${incident.reopen_count} times` : null} />
                <DetailField label="Updated By" value={incident.sys_updated_by} />
                <DetailField label="Updated On" value={formatDate(incident.sys_updated_on)} />
              </div>
            </div>

            {/* Resolution parameters */}
            {isClosed && (
              <div className="border-t border-slate-100 pt-5 space-y-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider text-emerald-700">Resolution Information</h3>
                <div className="grid grid-cols-1 gap-4 text-sm bg-emerald-50/50 p-4 border border-emerald-150 rounded-xl">
                  <DetailField label="Close Code" value={incident.close_code || 'Resolved by AI dispatcher'} />
                  <DetailField label="Resolved At" value={formatDate(incident.resolved_at)} />
                  <DetailField label="Closed At" value={formatDate(incident.closed_at)} />
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Resolution Notes</span>
                    <p className="text-slate-750 bg-white border border-slate-150 p-3 rounded-lg text-xs leading-relaxed font-medium italic">
                      "{incident.close_notes || 'Resolved directly in matching.'}"
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Hold reason */}
            {incident.hold_reason && (
              <div className="border-t border-slate-100 pt-5">
                <DetailField label="Hold Reason" value={<span className="text-amber-700 font-semibold">{incident.hold_reason}</span>} />
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Assignee card, Rejections */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Current Assignee info card */}
          <div className="glass-card p-6 rounded-xl space-y-5">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
              <UserCheck size={18} className="text-blue-500" />
              Assigned Associate
            </h2>

            {assignee ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-blue-55 border border-blue-200 flex items-center justify-center text-blue-600 font-extrabold text-base shadow-sm">
                    {assignee.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-850 text-base">{assignee.name}</h3>
                    <p className="text-xs text-slate-500 font-semibold">{assignee.domain} Team</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-150 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Skill Level</span>
                    <span className="font-bold text-slate-700">{assignee.skill_level}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Active Queue</span>
                    <span className="font-bold text-slate-700">{assignee.active_tickets} ticket(s)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Roster Status</span>
                    <span className={`font-bold ${assignee.is_on_shift ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {assignee.is_on_shift ? 'ON SHIFT' : 'OFF SHIFT'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 space-y-2">
                <p className="text-sm text-slate-400 italic">No associate currently assigned.</p>
                <p className="text-xs text-slate-405">Trigger Auto-Assign to find a qualified available match.</p>
              </div>
            )}
          </div>

          {/* SLA countdown/timeline visual */}
          <div className="glass-card p-6 rounded-xl space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
              <Clock size={18} className="text-blue-500" />
              SLA Delivery Window
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Response Target</span>
                <span className="font-bold text-slate-700">{formatDate(incident.sla_due || incident.sla_limit)}</span>
              </div>
              {incident.assigned_at && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Assigned At</span>
                  <span className="font-bold text-slate-700">{formatDate(incident.assigned_at)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">SLA Class</span>
                <span className="font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-850 border border-blue-150">
                  Priority {incident.priority} SLA
                </span>
              </div>
            </div>
          </div>

          {/* Rejection Logs */}
          <div className="glass-card p-6 rounded-xl space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
              <X className="text-red-505" />
              Incident Rejections
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Rejection Count</span>
                <span className="font-bold text-slate-700">{incident.rejection_count || 0}</span>
              </div>
              {incident.rejected_associates && incident.rejected_associates.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Excluded Candidates</span>
                  <div className="flex flex-wrap gap-1.5">
                    {incident.rejected_associates.map((name) => (
                      <span key={name} className="px-2 py-0.5 text-xs font-semibold rounded bg-red-50 text-red-705 border border-red-200">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section 1: AI Assignment Audit Trail */}
      <div className="glass-card p-6 rounded-xl space-y-4">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
          <History className="text-blue-500" />
          AI Assignment History Logs
        </h2>
        {assignment_history.length === 0 ? (
          <p className="text-xs text-slate-450 italic py-4">No AI dispatcher logs recorded for this ticket.</p>
        ) : (
          <div className="space-y-4">
            {assignment_history.map((log, idx) => (
              <div key={log.id || idx} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-800">Dispatch Recommendation #{assignment_history.length - idx}</span>
                    <span className="text-slate-355">|</span>
                    <span className="text-slate-500">{formatDate(log.timestamp)}</span>
                    <span className="text-slate-355">|</span>
                    <span className={`px-2.5 py-0.5 rounded font-bold uppercase tracking-wide text-[9px] ${
                      log.decision_status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : log.decision_status === 'Rejected' ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>{log.decision_status}</span>
                    <span className="text-slate-450">by {log.assigned_by}</span>
                  </div>
                  {getConfidenceBadge(log.confidence_score)}
                </div>
                
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800">Recommended Associate: <span className="text-blue-600">{log.recommended_associate}</span></p>
                  <p className="text-xs text-slate-700 italic bg-white p-3 rounded-lg border border-slate-150">
                    "{log.justification}"
                  </p>
                </div>

                {log.evaluated_associates && log.evaluated_associates.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500 font-bold hover:text-slate-700 transition">
                      Show Compatibility Score Details ({log.evaluated_associates.length} candidates evaluated)
                    </summary>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {log.evaluated_associates.map((c) => (
                        <div key={c.name} className="p-2.5 bg-white border border-slate-150 rounded-lg flex flex-col justify-between gap-1">
                          <div className="flex justify-between font-bold">
                            <span className="text-slate-850">{c.name}</span>
                            <span className="font-mono text-blue-650">Score: {c.heuristic_score}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-semibold">{c.domain} Team ({c.skill_level}) | Queue: {c.active_tickets}</div>
                          {c.score_breakdown && c.score_breakdown.length > 0 && (
                            <div className="border-t border-slate-100 pt-1.5 mt-1.5 space-y-0.5">
                              {c.score_breakdown.map((reason, rIdx) => (
                                <div key={rIdx} className="text-[10px] text-slate-500 flex items-center gap-1">
                                  <span className="text-blue-500 font-bold">•</span> {reason}
                                </div>
                              ))}
                            </div>
                          )}
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

      {/* Bottom Section 2: Similar Past Resolved Incidents (RAG matches) */}
      <div className="glass-card p-6 rounded-xl space-y-4">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
          <Database className="text-emerald-600" />
          RAG Similarity Matches (Historical Resolved Database)
        </h2>
        {similar.length === 0 ? (
          <p className="text-xs text-slate-455 italic py-4">No matching resolved cases found in RAG vector database.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {similar.map((s) => (
              <div key={s.number} className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold">
                    <span className="font-mono text-blue-650">{s.number}</span>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-250 font-bold uppercase tracking-wide text-[9px]">
                      {s.similarity_score}% Similar
                    </span>
                  </div>
                  <p className="text-sm font-bold text-slate-850 line-clamp-1">{s.short_description}</p>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-450 uppercase tracking-wide">Historical Resolution</span>
                    <p className="p-2.5 bg-white border border-slate-150 rounded-lg text-[11px] text-slate-650 leading-relaxed italic line-clamp-4">
                      "{s.resolution}"
                    </p>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 font-bold text-right pt-2 border-t border-slate-100">
                  Resolved by: <span className="text-slate-700">{s.resolved_by}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODAL: Manual Assignment Override */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md p-6 rounded-xl border border-slate-250 shadow-xl space-y-6 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-800">Manual Assignment Override</h3>
              <button onClick={() => setShowOverrideModal(false)} className="text-slate-400 hover:text-slate-650 transition">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-500 leading-relaxed">
                Manually dispatch ticket <span className="font-mono text-blue-655 font-bold">{number}</span>. This skips shift roster verification.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Select Associate</label>
                <select
                  value={selectedAssignee}
                  onChange={(e) => setSelectedAssignee(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none transition"
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
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleOverride}
                disabled={!selectedAssignee}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition ${
                  selectedAssignee
                    ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                    : 'bg-slate-100 text-slate-400 border border-slate-250 cursor-not-allowed'
                }`}
              >
                Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Resolve Incident */}
      {showResolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-lg p-6 rounded-xl border border-slate-250 shadow-xl space-y-6 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Database className="text-emerald-600" />
                Resolve Incident &amp; Index to RAG KB
              </h3>
              <button onClick={() => setShowResolveModal(false)} className="text-slate-400 hover:text-slate-655 transition">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-500 leading-relaxed">
                Provide resolution comments for ticket <span className="font-mono text-blue-655 font-bold">{number}</span>. Resolving will automatically vectorize and index this incident in the historical knowledge base.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Resolution Notes</label>
                <textarea
                  rows="4"
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  placeholder="Explain how this incident was fixed. Be descriptive (mention systems, errors, codes, portal paths) to allow accurate future RAG matches."
                  className="w-full bg-slate-55 border border-slate-200 rounded-lg py-2.5 px-3 text-sm text-slate-850 focus:border-blue-500 focus:outline-none placeholder-slate-400 transition"
                ></textarea>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => setShowResolveModal(false)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={!resolutionText}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition ${
                  resolutionText
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-sm'
                    : 'bg-slate-100 text-slate-400 border border-slate-255 cursor-not-allowed'
                }`}
              >
                Submit &amp; Vectorize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Processing overlay */}
      {isProcessing && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-100/90 backdrop-blur-md">
          <div className="relative flex items-center justify-center">
            <div className="absolute w-24 h-24 rounded-full border border-blue-500 animate-ping opacity-20"></div>
            <div className="w-20 h-20 rounded-full border-t-2 border-r-2 border-blue-600 animate-spin"></div>
            <div className="absolute text-blue-600">
              <Cpu size={32} className="animate-pulse" />
            </div>
          </div>
          <p className="mt-8 text-lg font-bold text-slate-850 text-center">AI System Routing...</p>
          <pre className="mt-4 text-xs text-slate-600 max-w-md text-center leading-relaxed font-mono whitespace-pre-line bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            {loadingText}
          </pre>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-2 border-b border-slate-100 gap-1">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="text-slate-850 font-medium text-right text-xs break-all">{value}</span>
    </div>
  );
}
