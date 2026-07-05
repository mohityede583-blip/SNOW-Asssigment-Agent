import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Sun, Moon, Coffee } from 'lucide-react';
import { getRoster } from '../api';

export default function RosterView() {
  const [rosterData, setRosterData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterTeam, setFilterTeam] = useState('ALL');

  useEffect(() => {
    const fetchRoster = async () => {
      try {
        const data = await getRoster();
        setRosterData(data);
      } catch (err) {
        console.error("Error loading roster:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchRoster();
  }, []);

  const getShiftColor = (shift) => {
    switch (shift) {
      case 'AM': return 'bg-cyan-950 text-cyan-400 border border-cyan-800';
      case 'EVE': return 'bg-amber-950 text-amber-400 border border-amber-800';
      case 'N': return 'bg-indigo-950 text-indigo-400 border border-indigo-800';
      case 'OFF': return 'bg-slate-900 text-slate-500 border border-slate-800/40';
      default: return 'bg-slate-950 text-slate-600';
    }
  };

  const getShiftIcon = (shift) => {
    switch (shift) {
      case 'AM': return <Sun size={14} className="text-cyan-400 inline mr-1" />;
      case 'EVE': return <Sun size={14} className="text-amber-400 inline mr-1" />;
      case 'N': return <Moon size={14} className="text-indigo-400 inline mr-1" />;
      case 'OFF': return <Coffee size={14} className="text-slate-500 inline mr-1" />;
      default: return null;
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-400 animate-pulse">
        Loading Shift Roster and calendars...
      </div>
    );
  }

  if (!rosterData) {
    return (
      <div className="py-12 text-center text-red-400">
        Failed to load shift roster data. Ensure backend is running.
      </div>
    );
  }

  // Current day is 5 (July 5, 2026)
  const currentDay = 5; 
  const teams = ['ALL', 'MFT', 'ESB', 'Azure', 'Database', 'ETL', 'L1 Support'];
  
  const filteredRoster = filterTeam === 'ALL'
    ? rosterData.roster
    : rosterData.roster.filter(item => item.domain === filterTeam);

  return (
    <div className="space-y-6">
      {/* Shift Definitions Legend */}
      <div className="glass-card p-6 rounded-xl space-y-4">
        <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <Clock className="text-blue-500" />
          Shift Schedule Master Key (July 2026)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-cyan-950/40 border border-cyan-900 flex items-center gap-3">
            <Sun className="text-cyan-400" size={24} />
            <div>
              <p className="font-bold text-cyan-400">AM Shift</p>
              <p className="text-xs text-slate-400">{rosterData.shift_definitions.AM}</p>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-900 flex items-center gap-3">
            <Sun className="text-amber-400" size={24} />
            <div>
              <p className="font-bold text-amber-400">Evening Shift</p>
              <p className="text-xs text-slate-400">{rosterData.shift_definitions.EVE}</p>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-900 flex items-center gap-3">
            <Moon className="text-indigo-400" size={24} />
            <div>
              <p className="font-bold text-indigo-400">Night Shift</p>
              <p className="text-xs text-slate-400">{rosterData.shift_definitions.N}</p>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center gap-3">
            <Coffee className="text-slate-500" size={24} />
            <div>
              <p className="font-bold text-slate-500">Day Off</p>
              <p className="text-xs text-slate-400">Rest / Offline</p>
            </div>
          </div>
        </div>
      </div>

      {/* Roster Calendar Grid */}
      <div className="glass-card p-6 rounded-xl space-y-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Calendar className="text-blue-500" />
            Associate Shift Rosters
          </h2>
          <div className="flex items-center gap-2 bg-slate-900 p-1.5 rounded-lg border border-slate-800 text-xs">
            {teams.map(t => (
              <button
                key={t}
                onClick={() => setFilterTeam(t)}
                className={`px-3 py-1.5 rounded-md font-semibold transition ${
                  filterTeam === t 
                    ? 'bg-blue-600 text-white shadow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable grid layout */}
        <div className="overflow-x-auto border border-slate-800/60 rounded-lg">
          <div className="min-w-[1200px]">
            {/* Header row */}
            <div className="grid grid-cols-12 bg-slate-900/80 text-slate-400 text-xs font-bold uppercase py-3 border-b border-slate-800">
              <div className="col-span-3 px-4 flex items-center">Associate Name / Domain</div>
              <div className="col-span-9 grid grid-cols-31 text-center font-mono">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                  <div 
                    key={day} 
                    className={`py-1 ${day === currentDay ? 'bg-blue-600 text-white font-black rounded-sm scale-110 shadow-lg glow-border-blue' : ''}`}
                  >
                    {day}
                  </div>
                ))}
              </div>
            </div>

            {/* Grid rows */}
            <div className="divide-y divide-slate-850/60 max-h-[500px] overflow-y-auto">
              {filteredRoster.map((item) => (
                <div key={item.name} className="grid grid-cols-12 py-3 hover:bg-slate-900/30 transition text-sm">
                  <div className="col-span-3 px-4 flex flex-col justify-center">
                    <p className="font-semibold text-slate-200">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.domain}</p>
                  </div>
                  <div className="col-span-9 grid grid-cols-31 items-center text-center font-mono">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                      const shift = item.schedule[day.toString()];
                      return (
                        <div key={day} className="px-0.5">
                          <span 
                            title={`${item.name} - Day ${day}: ${shift}`}
                            className={`w-7 h-7 flex items-center justify-center text-[10px] font-bold rounded-md mx-auto ${getShiftColor(shift)} ${
                              day === currentDay ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-950' : ''
                            }`}
                          >
                            {shift}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
