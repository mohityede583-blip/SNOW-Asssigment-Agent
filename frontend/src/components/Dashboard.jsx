import React, { useState, useEffect } from 'react';
import { 
  Play, RefreshCw, CheckCircle, XCircle, AlertTriangle, 
  UserCheck, ShieldAlert, Cpu, Check, X, ShieldCheck, Database, Award,
  ChevronDown, ChevronUp, Clock
} from 'lucide-react';
import { 
  getIncidents, simulateIncident, assignIncidents, 
  approveAssignment, rejectAssignment, overrideAssignment, 
  resolveIncident, getAssociates, getLogs
} from '../api';

export default function Dashboard({ onUpdateMetrics }) {
  const [incidents, setIncidents] = useState([]);
  const [associates, setAssociates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [activeRecommendation, setActiveRecommendation] = useState(null);
  const [showOverrideModal, setShowOverrideModal] = useState(null); // ticket num
  const [resolveForm, setShowResolveModal] = useState(null);        // ticket num
  const [expandedRow, setExpandedRow] = useState(null);             // expanded ticket number

  // Form states
  const [resolutionText, setResolutionText] = useState('');
  const [selectedAssignee, setSelectedAssignee] = useState('');

  const loadData = async () => {
    try {
      const incData = await getIncidents();
      const assocData = await getAssociates();
      setIncidents(incData);
      setAssociates(assocData);
      if (onUpdateMetrics) onUpdateMetrics();
    } catch (err) {
      console.error("Error loading dashboard data:", err);
    }
  };

  useEffect(() => {
    loadData();
    // Poll for new incidents every 15 seconds
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const unassigned = incidents.filter(i => i.status === 'Unassigned').map(i => i.number);
      setSelectedIds(unassigned);
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (number) => {
    if (selectedIds.includes(number)) {
      setSelectedIds(selectedIds.filter(id => id !== number));
    } else {
      setSelectedIds([...selectedIds, number]);
    }
  };

  const handleSimulate = async () => {
    setIsLoading(true);
    setLoadingText("ServiceNow API is pushing a new unassigned ticket...");
    try {
      await simulateIncident();
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoAssign = async () => {
    if (selectedIds.length === 0) return;
    setIsLoading(true);
    setLoadingText(`AI Agent is analyzing ${selectedIds.length} ticket(s)...\n- Running skill mapping\n- Checking active shift rosters\n- Inspecting RAG knowledge base`);
    
    try {
      const results = await assignIncidents(selectedIds);
      await loadData();
      setSelectedIds([]);
      
      // If we assigned a single ticket, show its recommendation audit log details
      if (results.length === 1 && results[0].status === 'success') {
        setActiveRecommendation(results[0]);
      } else {
        alert(`Successfully processed ${results.length} ticket(s) with AI! Check flagged tickets in dashboard.`);
      }
    } catch (err) {
      console.error(err);
      alert("Error in AI assignment. Ensure Ollama service is running.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (number, assignee) => {
    try {
      await approveAssignment(number, assignee);
      setActiveRecommendation(null);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleReject = async (number, assignee) => {
    setIsLoading(true);
    setLoadingText(`Associate rejected assignment. Escalating and re-running AI matching flow for ${number}...`);
    try {
      const res = await rejectAssignment(number, assignee);
      await loadData();
      if (res.reassignment && res.reassignment.status === 'success') {
        setActiveRecommendation(res.reassignment);
      } else {
        setActiveRecommendation(null);
        alert("Escalated to fallback. No other matching associates available on shift.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOverride = async (number) => {
    if (!selectedAssignee) return;
    try {
      await overrideAssignment(number, selectedAssignee);
      setShowOverrideModal(null);
      setSelectedAssignee('');
      setActiveRecommendation(null);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolve = async (number, resolvedBy) => {
    if (!resolutionText) return;
    try {
      await resolveIncident(number, resolutionText, resolvedBy);
      setShowResolveModal(null);
      setResolutionText('');
      await loadData();
    } catch (err) {
      console.error(err);
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
    if (score >= 80) return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1"><ShieldCheck size={16}/> {score}%</span>;
    if (score >= 70) return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1"><AlertTriangle size={16}/> {score}%</span>;
    return <span className="px-2.5 py-1 text-sm font-bold rounded-lg bg-red-50 text-red-700 border border-red-200 flex items-center gap-1"><ShieldAlert size={16}/> {score}% (Flagged)</span>;
  };

  // ── Helper badges for new SNOW fields ────────────────────────────────
  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  const getSLABadge = (slaDue) => {
    if (!slaDue) return null;
    const minsLeft = (new Date(slaDue) - Date.now()) / 60000;
    if (minsLeft < 0)
      return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700 border border-red-200 flex items-center gap-1"><Clock size={10}/> SLA BREACHED</span>;
    if (minsLeft < 60)
      return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1"><Clock size={10}/> &lt;1 hr left</span>;
    if (minsLeft < 240)
      return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-600 border border-amber-200 flex items-center gap-1"><Clock size={10}/> &lt;4 hrs</span>;
    return <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1"><Clock size={10}/> On track</span>;
  };

  const IMPACT_LABELS = { '1': 'High', '2': 'Medium', '3': 'Low' };
  const getImpactBadge = (impact) => {
    if (!impact) return null;
    const label = IMPACT_LABELS[impact] || impact;
    const cls = impact === '1'
      ? 'bg-red-50 text-red-700 border-red-200'
      : impact === '2'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-100 text-slate-600 border-slate-200';
    return <span className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${cls}`}>{label} Impact</span>;
  };
  // ─────────────────────────────────────────────────────────────────────

  const unassignedIncidents = incidents.filter(i => i.status === 'Unassigned');
  const flaggedIncidents    = incidents.filter(i => i.status === 'Flagged');
  const assignedIncidents   = incidents.filter(i => i.status === 'Assigned');
  const resolvedIncidents   = incidents.filter(i => i.status === 'Resolved');

  return (
    <div className="space-y-6">
      {/* Header Cards Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-4 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-sm">Unassigned Incidents</p>
            <h3 className="text-3xl font-extrabold mt-1 text-slate-800">{unassignedIncidents.length}</h3>
          </div>
          <div className="p-3 rounded-lg bg-slate-100 border border-slate-200">
            <RefreshCw size={24} className="text-slate-500" />
          </div>
        </div>
        <div className="glass-card p-4 rounded-xl flex items-center justify-between border-l-amber-500 border-l-2">
          <div>
            <p className="text-slate-500 text-sm">Pending Human Review</p>
            <h3 className="text-3xl font-extrabold mt-1 text-amber-600">{flaggedIncidents.length}</h3>
          </div>
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
            <AlertTriangle size={24} className="text-amber-500" />
          </div>
        </div>
        <div className="glass-card p-4 rounded-xl flex items-center justify-between border-l-blue-500 border-l-2">
          <div>
            <p className="text-slate-500 text-sm">Active Assignments</p>
            <h3 className="text-3xl font-extrabold mt-1 text-blue-600">{assignedIncidents.length}</h3>
          </div>
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <UserCheck size={24} className="text-blue-500" />
          </div>
        </div>
        <div className="glass-card p-4 rounded-xl flex items-center justify-between border-l-emerald-500 border-l-2">
          <div>
            <p className="text-slate-500 text-sm">Resolved Tickets</p>
            <h3 className="text-3xl font-extrabold mt-1 text-emerald-600">{resolvedIncidents.length}</h3>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
            <CheckCircle size={24} className="text-emerald-500" />
          </div>
        </div>
      </div>

      {/* Action Buttons bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 glass-card rounded-xl">
        <div className="flex items-center gap-3">
          <button
            onClick={handleSimulate}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 transition shadow-sm"
          >
            <Play size={16} className="text-emerald-500" />
            Simulate ServiceNow Incident
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 transition shadow-sm"
          >
            <RefreshCw size={16} className="text-blue-500" />
            Fetch/Sync SNOW API
          </button>
        </div>
        <button
          onClick={handleAutoAssign}
          disabled={selectedIds.length === 0}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition ${
            selectedIds.length > 0 
              ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer shadow-sm' 
              : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
          }`}
        >
          <Cpu size={18} />
          Intelligent Auto-Assign ({selectedIds.length})
        </button>
      </div>

      {/* Main dashboard lists */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Incident Lists Table */}
        <div className="glass-card rounded-xl p-6 lg:col-span-8 space-y-6">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            ServiceNow Ticket Queue
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">
                    <input 
                      type="checkbox"
                      onChange={handleSelectAll}
                      checked={unassignedIncidents.length > 0 && selectedIds.length === unassignedIncidents.length}
                      className="rounded bg-white border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Details</th>
                  <th className="py-3 px-4">Priority / Domain</th>
                  <th className="py-3 px-4">SLA</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Assignee</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 text-sm">
                {incidents.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="py-8 text-center text-slate-500">
                      No incidents in queue. Click "Simulate ServiceNow Incident" to generate tickets.
                    </td>
                  </tr>
                ) : (
                  incidents.map((inc) => {
                    const isExpanded = expandedRow === inc.number;
                    return (
                      <React.Fragment key={inc.number}>
                        {/* ── Main row ── */}
                        <tr
                          className="hover:bg-slate-50/50 transition cursor-pointer"
                          onClick={() => setExpandedRow(isExpanded ? null : inc.number)}
                        >
                          <td className="py-4 px-4" onClick={e => e.stopPropagation()}>
                            {inc.status === 'Unassigned' && (
                              <input 
                                type="checkbox"
                                checked={selectedIds.includes(inc.number)}
                                onChange={() => handleSelectOne(inc.number)}
                                className="rounded bg-white border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                            )}
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-slate-700 font-semibold">{inc.number}</span>
                              {isExpanded
                                ? <ChevronUp size={14} className="text-slate-400" />
                                : <ChevronDown size={14} className="text-slate-400" />}
                            </div>
                          </td>
                          <td className="py-4 px-4 max-w-xs">
                            <p className="font-semibold text-slate-800 truncate">{inc.short_description}</p>
                            <p className="text-xs text-slate-500 truncate mt-0.5">{inc.description}</p>
                          </td>
                          <td className="py-4 px-4 space-y-1">
                            <div>{getPriorityBadge(inc.priority)}</div>
                            <div className="text-xs text-slate-500">Team: <span className="font-semibold text-slate-700">{inc.category}</span></div>
                          </td>
                          <td className="py-4 px-4">{getSLABadge(inc.sla_due || inc.sla_limit)}</td>
                          <td className="py-4 px-4">{getStatusBadge(inc.status)}</td>
                          <td className="py-4 px-4 font-medium text-slate-700">
                            {inc.assigned_to ? (
                              <span className="text-blue-600 font-semibold">{inc.assigned_to}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                            {inc.rejection_count > 0 && (
                              <div className="text-[10px] text-red-600 font-semibold">Rejected x{inc.rejection_count}</div>
                            )}
                          </td>
                          <td className="py-4 px-4 text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-end gap-2">
                              {inc.status === 'Flagged' && (
                                <button
                                  onClick={async () => {
                                    try {
                                      const logs = await getLogs(inc.number);
                                      if (logs.length > 0) {
                                        const cands = logs[0].evaluated_associates || [];
                                        setActiveRecommendation({
                                          incident_number: inc.number,
                                          recommended_associate: logs[0].recommended_associate,
                                          confidence_score: logs[0].confidence_score,
                                          justification: logs[0].justification,
                                          candidates: cands
                                        });
                                      }
                                    } catch (e) {
                                      console.error(e);
                                    }
                                  }}
                                  className="px-2.5 py-1 text-xs font-bold rounded bg-amber-50 text-amber-700 hover:bg-amber-100 transition border border-amber-200"
                                >
                                  Review
                                </button>
                              )}
                              {inc.status === 'Assigned' && (
                                <button
                                  onClick={() => {
                                    setShowResolveModal(inc.number);
                                    setResolutionText('');
                                  }}
                                  className="px-2.5 py-1 text-xs font-bold rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition border border-emerald-200"
                                >
                                  Resolve
                                </button>
                              )}
                              {inc.status !== 'Resolved' && (
                                <button
                                  onClick={() => {
                                    setShowOverrideModal(inc.number);
                                    setSelectedAssignee('');
                                  }}
                                  className="px-2.5 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition border border-slate-200"
                                >
                                  Manual
                                </button>
                              )}
                              {inc.status === 'Resolved' && (
                                <span className="text-xs text-slate-400 italic">Resolved</span>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* ── Expanded detail row ── */}
                        {isExpanded && (
                          <tr className="bg-slate-50/70">
                            <td colSpan="8" className="px-6 pb-4 pt-2">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                <div className="space-y-0.5">
                                  <p className="font-bold text-slate-500 uppercase tracking-wide">Opened At</p>
                                  <p className="text-slate-700">{formatDate(inc.opened_at || inc.created_at)}</p>
                                </div>
                                <div className="space-y-0.5">
                                  <p className="font-bold text-slate-500 uppercase tracking-wide">SLA Due</p>
                                  <p className="text-slate-700">{formatDate(inc.sla_due || inc.sla_limit)}</p>
                                </div>
                                <div className="space-y-0.5">
                                  <p className="font-bold text-slate-500 uppercase tracking-wide">Impact / Severity</p>
                                  <div className="flex gap-1 flex-wrap">
                                    {getImpactBadge(inc.impact)}
                                    {inc.severity && inc.severity !== inc.impact && (
                                      <span className="px-2 py-0.5 text-[10px] rounded border bg-slate-100 text-slate-600 border-slate-200">
                                        Sev {inc.severity}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="space-y-0.5">
                                  <p className="font-bold text-slate-500 uppercase tracking-wide">Assignment Group</p>
                                  <p className="text-slate-700">{inc.assignment_group || '—'}</p>
                                </div>
                                {inc.subcategory && (
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-slate-500 uppercase tracking-wide">Subcategory</p>
                                    <p className="text-slate-700">{inc.subcategory}</p>
                                  </div>
                                )}
                                {inc.sys_id && (
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-slate-500 uppercase tracking-wide">Sys ID</p>
                                    <p className="font-mono text-slate-600 text-[10px]">{inc.sys_id}</p>
                                  </div>
                                )}
                                {inc.incident_state && (
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-slate-500 uppercase tracking-wide">SNOW State</p>
                                    <p className="text-slate-700">{inc.incident_state}</p>
                                  </div>
                                )}
                                {inc.reopen_count > 0 && (
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-slate-500 uppercase tracking-wide">Reopened</p>
                                    <p className="text-amber-600 font-semibold">{inc.reopen_count}×</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI Recommendations Panel */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-card rounded-xl p-6 space-y-6">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Cpu className="text-blue-600" />
              AI Audit Trail
            </h2>

            {activeRecommendation ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-blue-600 font-bold">{activeRecommendation.incident_number}</span>
                    {getConfidenceBadge(activeRecommendation.confidence_score)}
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Recommended Agent</p>
                    <p className="text-lg font-bold text-slate-800 mt-0.5">{activeRecommendation.recommended_associate}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Justification Log</p>
                    <p className="text-sm text-slate-700 mt-1 leading-relaxed italic bg-white p-3 rounded-lg border border-slate-200">
                      "{activeRecommendation.justification}"
                    </p>
                  </div>
                </div>

                {/* Candidate Scoring Breakdown */}
                {activeRecommendation.candidates && activeRecommendation.candidates.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-550 uppercase tracking-wider">Candidates Evaluated</p>
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                      {activeRecommendation.candidates.map((cand) => (
                        <div key={cand.name} className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs flex justify-between items-start gap-2">
                          <div className="space-y-1">
                            <p className="font-bold text-slate-700">{cand.name}</p>
                            <p className="text-slate-500">Queue: <span className="font-semibold text-slate-700">{cand.active_tickets}</span> | Level: {cand.skill_level}</p>
                            <div className="text-[10px] text-slate-450 leading-tight">
                              {cand.score_breakdown && cand.score_breakdown.map((r, i) => (
                                <div key={i}>• {r}</div>
                              ))}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 font-bold rounded ${
                            cand.name === activeRecommendation.recommended_associate 
                              ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}>
                            Score: {cand.heuristic_score}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendation Actions */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => handleApprove(activeRecommendation.incident_number, activeRecommendation.recommended_associate)}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm"
                  >
                    <Check size={16} /> Approve
                  </button>
                  <button
                    onClick={() => handleReject(activeRecommendation.incident_number, activeRecommendation.recommended_associate)}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold bg-white text-red-650 hover:bg-red-50 border border-red-200 transition"
                  >
                    <X size={16} /> Reject (Escalate)
                  </button>
                </div>
                <button
                  onClick={() => {
                    setShowOverrideModal(activeRecommendation.incident_number);
                    setSelectedAssignee('');
                  }}
                  className="w-full py-2 text-sm font-bold rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 transition border border-slate-200 text-center"
                >
                  Manual Override Assignment
                </button>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                <Cpu size={36} className="text-slate-350" />
                <p className="text-sm">Select unassigned tickets and click "Auto-Assign" or click "Review" on a flagged ticket to view AI justifications.</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Manual Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md p-6 rounded-xl border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-800">Manual Assignment Override</h3>
              <button onClick={() => setShowOverrideModal(null)} className="text-slate-400 hover:text-slate-650">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Directly route ticket <span className="font-mono text-blue-650 font-bold">{showOverrideModal}</span> to any team member.
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
                onClick={() => setShowOverrideModal(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-250 text-slate-700 border border-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleOverride(showOverrideModal)}
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
      {resolveForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-lg p-6 rounded-xl border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Database className="text-emerald-600" />
                Resolve Incident & Index to RAG KB
              </h3>
              <button onClick={() => setShowResolveModal(null)} className="text-slate-400 hover:text-slate-650">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Provide resolution comments for ticket <span className="font-mono text-blue-650 font-bold">{resolveForm}</span>. Resolving will automatically vectorize and index this incident in the historical knowledge base for future assignments.
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
                onClick={() => setShowResolveModal(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-250 text-slate-700 border border-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const incObj = incidents.find(i => i.number === resolveForm);
                  handleResolve(resolveForm, incObj?.assigned_to);
                }}
                disabled={!resolutionText}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition ${
                  resolutionText 
                    ? 'bg-emerald-600 hover:bg-emerald-505 text-white cursor-pointer shadow-sm' 
                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                }`}
              >
                Submit & Vectorize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-100/90 backdrop-blur-md">
          <div className="relative flex items-center justify-center">
            {/* Pulsing ring */}
            <div className="absolute w-24 h-24 rounded-full border border-blue-500 animate-ping opacity-20"></div>
            {/* Spinning ring */}
            <div className="w-20 h-20 rounded-full border-t-2 border-r-2 border-blue-600 animate-spin"></div>
            {/* Center icon */}
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
