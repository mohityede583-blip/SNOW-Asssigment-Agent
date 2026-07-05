import React, { useState, useEffect } from 'react';
import { Search, Database, FileText, CheckCircle } from 'lucide-react';
import { getHistory, searchHistory } from '../api';

export default function HistoryView() {
  const [history, setHistory] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadHistory = async () => {
    try {
      const data = await getHistory();
      setHistory(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    try {
      const results = await searchHistory(searchQuery);
      setSearchResults(results);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Database className="text-emerald-500" />
            RAG Historical Knowledge Base
          </h2>
          <p className="text-sm text-slate-400">
            Explore past resolved incidents used by the assignment engine to match domain experience and recommend associates.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* RAG search query tool */}
        <div className="lg:col-span-5 space-y-6">
          <div className="glass-card rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-200">Query Similarity Search</h3>
            
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-grow">
                <input
                  type="text"
                  placeholder="e.g. Oracle Database pool saturated..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg py-2 pl-9 pr-3 text-sm text-slate-200 focus:border-blue-500 focus:outline-none placeholder-slate-600"
                />
                <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-bold rounded-lg bg-blue-650 hover:bg-blue-600 text-white transition shadow glow-border-blue"
              >
                Search
              </button>
            </form>

            <div className="space-y-3 pt-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Similarity Results</p>
              
              {isSearching ? (
                <div className="text-center py-6 text-slate-500 text-xs animate-pulse">
                  Analyzing embeddings and computing cosine similarity...
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-3">
                  {searchResults.map((match) => (
                    <div key={match.number} className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-blue-400 font-bold">{match.number}</span>
                        <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-950 text-emerald-400 border border-emerald-900">
                          {match.similarity_score}% Match
                        </span>
                      </div>
                      <h4 className="font-semibold text-slate-200 text-sm">{match.short_description}</h4>
                      <p className="text-xs text-slate-400 leading-relaxed bg-slate-950 p-2 rounded border border-slate-850">
                        {match.resolution}
                      </p>
                      <p className="text-[10px] text-slate-500 text-right font-semibold">
                        Resolved by: <span className="text-slate-300">{match.resolved_by}</span>
                      </p>
                    </div>
                  ))}
                </div>
              ) : searchQuery ? (
                <div className="text-center py-6 text-slate-600 text-xs">
                  No matching resolved incidents found.
                </div>
              ) : (
                <div className="text-center py-6 text-slate-600 text-xs">
                  Enter keywords or descriptions to test the vector matching similarity.
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Database records */}
        <div className="glass-card rounded-xl p-6 lg:col-span-7 space-y-4">
          <h3 className="text-base font-bold text-slate-200">Indexed Resolutions</h3>
          
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {loading ? (
              <div className="text-center py-6 text-slate-500 text-sm animate-pulse">
                Loading indexed records...
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-slate-600 text-sm">
                No resolved incidents indexed. Complete and resolve active incidents to populate RAG KB.
              </div>
            ) : (
              history.map((record) => (
                <div key={record.id} className="p-4 rounded-xl bg-slate-900/60 border border-slate-850 hover:border-slate-800 transition flex items-start gap-3">
                  <div className="p-2 rounded bg-emerald-950/40 border border-emerald-900 text-emerald-400 mt-0.5">
                    <FileText size={18} />
                  </div>
                  <div className="flex-grow space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-slate-500 font-bold">{record.number}</span>
                      <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
                        <CheckCircle size={12} className="text-emerald-400" />
                        {record.resolved_by}
                      </span>
                    </div>
                    <h4 className="font-bold text-slate-200 text-sm leading-snug">{record.short_description}</h4>
                    <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/40 p-2.5 rounded border border-slate-900">
                      {record.resolution}
                    </p>
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
