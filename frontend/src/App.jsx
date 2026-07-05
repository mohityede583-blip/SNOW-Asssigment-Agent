import React, { useState, useEffect } from 'react';
import { 
  Cpu, Calendar, Users, Database, BarChart, 
  Clock, ShieldAlert, CircleDot, Network
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import RosterView from './components/RosterView';
import AssociateQueue from './components/AssociateQueue';
import HistoryView from './components/HistoryView';
import Metrics from './components/Metrics';
import { getIncidents } from './api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [systemTime, setSystemTime] = useState(new Date("2026-07-05T11:06:45Z"));

  const checkUnassigned = async () => {
    try {
      const data = await getIncidents('Unassigned');
      setUnassignedCount(data.length);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    checkUnassigned();
    const interval = setInterval(checkUnassigned, 10000);
    return () => clearInterval(interval);
  }, []);

  // Update system time clock
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setSystemTime(prev => new Date(prev.getTime() + 1000));
    }, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' });
  };

  const navigationItems = [
    { id: 'dashboard', name: 'Queue Dashboard', icon: Cpu, badge: unassignedCount },
    { id: 'roster', name: 'Shift Roster', icon: Calendar },
    { id: 'queues', name: 'Associate Queues', icon: Users },
    { id: 'rag', name: 'RAG Knowledge Base', icon: Database },
    { id: 'metrics', name: 'System Metrics', icon: BarChart },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Header Navigation */}
      <header className="glass-card sticky top-0 z-40 border-b border-slate-800/80 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow glow-border-blue">
            <Cpu size={22} className="animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-wide text-slate-100 flex items-center gap-1.5 uppercase">
              ServiceNow AI Agent <span className="text-[10px] bg-blue-600/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold">RAG v1.0</span>
            </h1>
            <p className="text-xs text-slate-500 font-semibold tracking-wider uppercase">Intelligent Dispatch Engine</p>
          </div>
        </div>

        {/* System clocks and statuses */}
        <div className="flex items-center gap-4 text-xs">
          {/* Simulated clock */}
          <div className="bg-slate-900 border border-slate-850 px-3.5 py-1.5 rounded-lg flex items-center gap-2 font-mono">
            <Clock size={14} className="text-blue-400" />
            <span className="text-slate-300 font-bold">{formatDate(systemTime)}</span>
            <span className="text-slate-500">|</span>
            <span className="text-blue-400 font-extrabold">{formatTime(systemTime)}</span>
          </div>

          {/* Connection Status badges */}
          <div className="flex gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-950/40 text-emerald-400 border border-emerald-900/60 flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
              <CircleDot size={10} className="text-emerald-500 animate-pulse" />
              Ollama Live
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-blue-950/40 text-blue-400 border border-blue-900/60 flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
              <Network size={10} className="text-blue-500" />
              SNOW Simulator
            </span>
          </div>
        </div>
      </header>

      {/* Sidebar/Main Content layout */}
      <div className="flex-grow flex flex-col md:flex-row">
        {/* Navigation Sidebar */}
        <aside className="w-full md:w-64 bg-slate-950/30 border-r border-slate-850/80 p-4 space-y-2 flex flex-row md:flex-col overflow-x-auto md:overflow-x-visible">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-xl transition-all border whitespace-nowrap ${
                  isActive 
                    ? 'bg-blue-600 text-white border-blue-500/30 shadow glow-border-blue translate-x-1' 
                    : 'text-slate-400 bg-transparent border-transparent hover:bg-slate-900/50 hover:text-slate-200 hover:border-slate-850'
                }`}
              >
                <Icon size={18} />
                <span className="flex-grow text-left">{item.name}</span>
                {item.badge > 0 && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-red-650 text-white animate-pulse">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        {/* Main tabs renderer */}
        <main className="flex-grow p-6 md:p-8 overflow-y-auto">
          {activeTab === 'dashboard' && <Dashboard onUpdateMetrics={checkUnassigned} />}
          {activeTab === 'roster' && <RosterView />}
          {activeTab === 'queues' && <AssociateQueue />}
          {activeTab === 'rag' && <HistoryView />}
          {activeTab === 'metrics' && <Metrics />}
        </main>
      </div>
    </div>
  );
}
