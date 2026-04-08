import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Clock, CheckCircle, XCircle, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase/supabaseClient';
import Toast from './Toast';

const HAS_SUPABASE = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

interface SerperResult {
  id: string;
  user_id: string;
  file_name: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  result_count?: number;
  credits_used?: number;
  file_size?: number;
  file_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

interface EnrichResult {
  id: string;
  user_id: string;
  file_name: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  result_count?: number;
  file_size?: number;
  file_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

interface BatchStatus {
  batch_id: string;
  status: string;
  created_at?: string;
  completed_at?: string;
  job_titles?: string;
  enrich_emails?: boolean;
  matching?: {
    total_rows: number;
    processed_rows: number;
    total_matches: number;
  };
  enrichment?: {
    total: number;
    enriched: number;
    emails_found: number;
    findymail_credits: number;
    wiza_credits: number;
  };
}

type EnrichResultWithBatch = EnrichResult & { type: 'enrich'; batchStatus?: BatchStatus };
type SerperResultWithType = SerperResult & { type: 'serper' };
type Result = SerperResultWithType | EnrichResultWithBatch;

export default function Results() {
  const [serperResults, setSerperResults] = useState<SerperResultWithType[]>([]);
  const [enrichResults, setEnrichResults] = useState<EnrichResultWithBatch[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'error' | 'success'>('success');
  const searchParams = useSearchParams();

  const results = useMemo<Result[]>(() => {
    return [...serperResults, ...enrichResults]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [serperResults, enrichResults]);

  // --- Serper (Business Finder) fetch: always Supabase, original behavior ---
  const fetchSerperResults = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('serper_results')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching Serper results:', error);
      return;
    }

    setSerperResults(
      (data || []).map(r => {
        const result = r as unknown as SerperResult;
        return {
          ...result,
          type: 'serper' as const,
          status: result.status as 'RUNNING' | 'DONE' | 'ERROR',
          result_count: result.result_count ?? undefined,
          credits_used: result.credits_used ?? undefined,
          file_size: result.file_size ?? undefined,
          file_url: result.file_url ?? undefined,
          error_message: result.error_message ?? undefined,
        };
      })
    );
  }, []);

  // --- Enrich (Contact Finder) fetch: smart polling with batch status ---
  const fetchBatchStatus = useCallback(async (batchId: string): Promise<BatchStatus | undefined> => {
    try {
      const res = await fetch(`/api/matching/${batchId}`);
      if (!res.ok) return undefined;
      return await res.json();
    } catch {
      return undefined;
    }
  }, []);

  const fetchEnrichResults = useCallback(async (): Promise<boolean> => {
    let enrichWithStatus: EnrichResultWithBatch[] = [];

    if (HAS_SUPABASE) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { data, error } = await supabase
        .from('enrich_results')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return false;

      enrichWithStatus = await Promise.all(
        (data || []).map(async (r) => {
          const result = r as unknown as EnrichResult;
          const enrichItem: EnrichResultWithBatch = {
            ...result,
            type: 'enrich' as const,
            status: result.status as 'RUNNING' | 'DONE' | 'ERROR',
          };
          const batchStatus = await fetchBatchStatus(result.id);
          if (batchStatus) {
            enrichItem.batchStatus = batchStatus;
            if (result.status === 'RUNNING') {
              if (batchStatus.status === 'COMPLETED') {
                enrichItem.status = 'DONE';
                enrichItem.result_count = batchStatus.matching?.total_matches || 0;
                await supabase.from('enrich_results').update({
                  status: 'DONE',
                  result_count: batchStatus.matching?.total_matches || 0,
                  updated_at: new Date().toISOString(),
                }).eq('id', result.id);
              } else if (batchStatus.status === 'FAILED') {
                enrichItem.status = 'ERROR';
              }
            }
          }
          return enrichItem;
        })
      );
    } else {
      const stored = JSON.parse(localStorage.getItem('matching_batches') || '[]') as {
        batch_id: string; file_name: string; created_at: string; status?: string;
      }[];

      enrichWithStatus = await Promise.all(
        stored.map(async (s) => {
          const batchStatus = await fetchBatchStatus(s.batch_id);
          const status = s.status === 'DONE' || s.status === 'ERROR'
            ? s.status
            : batchStatus?.status === 'COMPLETED' ? 'DONE'
              : batchStatus?.status === 'FAILED' ? 'ERROR' : 'RUNNING';

          if ((status === 'DONE' || status === 'ERROR') && s.status !== status) {
            s.status = status;
          }

          const item: EnrichResultWithBatch = {
            id: s.batch_id,
            user_id: 'local',
            file_name: s.file_name,
            status: status as 'RUNNING' | 'DONE' | 'ERROR',
            result_count: batchStatus?.matching?.total_matches,
            created_at: s.created_at,
            updated_at: s.created_at,
            type: 'enrich' as const,
          };
          if (batchStatus) {
            item.batchStatus = batchStatus;
          }
          return item;
        })
      );

      localStorage.setItem('matching_batches', JSON.stringify(stored));
    }

    setEnrichResults(enrichWithStatus);
    return enrichWithStatus.some(r => r.status === 'RUNNING');
  }, [fetchBatchStatus]);

  // --- Toast / URL cleanup ---
  useEffect(() => {
    const status = searchParams?.get('status');
    if (status === 'processing') {
      setToastMessage('Processing your request! This might take a few minutes.');
      setToastType('success');
      setShowToast(true);

      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('status');
        url.searchParams.delete('batchId');
        window.history.replaceState({}, '', url);
      }, 0);
    }
  }, [searchParams]);

  // --- Serper polling: setInterval, runs forever (original behavior) ---
  useEffect(() => {
    fetchSerperResults();
    const interval = setInterval(fetchSerperResults, 5000);
    return () => clearInterval(interval);
  }, [fetchSerperResults]);

  // --- Enrich polling: smart recursive setTimeout, stops when all terminal ---
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      const hasRunning = await fetchEnrichResults();
      if (hasRunning && !cancelled) {
        setTimeout(poll, 5000);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [fetchEnrichResults]);

  const getStatusIcon = (status: Result['status']) => {
    switch (status) {
      case 'RUNNING':
        return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'DONE':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'ERROR':
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const formatFileSize = (bytes: number | undefined | null) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= k && i < sizes.length - 1) { size /= k; i++; }
    return `${parseFloat(size.toFixed(2))} ${sizes[i]}`;
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleEnrichDownload = async (result: EnrichResultWithBatch) => {
    try {
      const fileName = `${result.file_name}.csv`;

      if (!result.file_url) {
        const res = await fetch(`/api/matching/${result.id}/download?filename=${encodeURIComponent(fileName)}`);
        if (!res.ok) throw new Error('Download not ready');
        const blob = await res.blob();
        downloadBlob(blob, fileName);
        return;
      }
      const response = await fetch(result.file_url);
      const blob = await response.blob();
      downloadBlob(blob, fileName);
    } catch (error) {
      console.error('Error downloading file:', error);
      setToastMessage('Error downloading file');
      setToastType('error');
      setShowToast(true);
    }
  };

  const formatDuration = (startStr: string, endStr: string) => {
    const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    if (mins < 60) return remainSecs ? `${mins}m ${remainSecs}s` : `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return remainMins ? `${hrs}h ${remainMins}m` : `${hrs}h`;
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const renderBatchInfo = (batchStatus: BatchStatus, isProcessing: boolean, resultId: string) => {
    const matching = batchStatus.matching;
    const enrichment = batchStatus.enrichment;
    const status = batchStatus.status;
    const isPastMatching = status === 'ENRICHING' || status === 'COMPLETED';
    const isComplete = status === 'COMPLETED';
    const isExpanded = expandedId === resultId;

    if (status === 'PENDING' || status === 'CONVERTING') {
      return (
        <div className="mt-3">
          <span className="text-xs text-gray-500">Preparing data…</span>
        </div>
      );
    }

    return (
      <div className="mt-3 space-y-2 w-full">
        {/* Timing */}
        <div className="text-xs text-gray-400">
          {batchStatus.created_at && formatTime(batchStatus.created_at)}
          {batchStatus.completed_at && (
            <> → {formatTime(batchStatus.completed_at)} ({formatDuration(batchStatus.created_at!, batchStatus.completed_at)})</>
          )}
        </div>

        {/* Matching */}
        {matching && matching.total_rows > 0 && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Matching {isPastMatching ? '✓' : '...'}</span>
              <span>{matching.processed_rows}/{matching.total_rows} rows · {matching.total_matches} matches</span>
            </div>
            {isProcessing && !isPastMatching && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (matching.processed_rows / matching.total_rows) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Enrichment */}
        {enrichment && enrichment.total > 0 && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Email Enrichment {isComplete ? '✓' : '...'}</span>
              <span>{enrichment.emails_found} emails found</span>
            </div>
            {isProcessing && !isComplete && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (enrichment.enriched / enrichment.total) * 100)}%` }}
                />
              </div>
            )}
            <div className="flex gap-3 text-xs text-gray-400 mt-1">
              <span>Findymail: {enrichment.findymail_credits} credits</span>
              <span>Wiza: {enrichment.wiza_credits} credits</span>
            </div>
          </div>
        )}

        {status === 'ENRICHING' && (!enrichment || enrichment.total === 0) && (
          <div className="text-xs text-gray-500">Starting email enrichment...</div>
        )}

        {/* Expandable details */}
        <button
          onClick={() => setExpandedId(isExpanded ? null : resultId)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Details
        </button>
        {isExpanded && (
          <div className="text-xs text-gray-400 space-y-1 pl-4 border-l-2 border-gray-100">
            <p>Batch ID: <span className="font-mono">{batchStatus.batch_id}</span></p>
            {batchStatus.job_titles && <p>Job titles: {batchStatus.job_titles}</p>}
            {enrichment && <p>Email enrichment: enabled ({enrichment.total} candidates, {enrichment.emails_found} emails found)</p>}
            {!enrichment && <p>Email enrichment: not requested</p>}
          </div>
        )}
      </div>
    );
  };

  // --- Serper result card: original main behavior ---
  const renderSerperResult = (result: SerperResultWithType) => (
    <div key={`serper-${result.id}`} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-50 p-2 rounded-lg">
            {getStatusIcon(result.status)}
          </div>
          <div>
            <p className="text-sm text-gray-800">
              {result.file_name}
              <span className="ml-2 text-xs text-gray-500">(Business Finder)</span>
            </p>
            <p className="text-xs text-gray-500">
              {new Date(result.created_at).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {result.status === 'DONE' && (
            <>
              {result.result_count === 0 ? (
                <div className="text-sm text-gray-500">
                  <p>No results found. Try expanding your query.</p>
                </div>
              ) : (
                <>
                  <div className="text-sm text-gray-500 space-y-1">
                    <p>Results: {result.result_count}</p>
                    {'credits_used' in result && (
                      <p>Credits: {result.credits_used}</p>
                    )}
                    <p>Size: {formatFileSize(result.file_size)}</p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(result.file_url!);
                        const blob = await response.blob();
                        downloadBlob(blob, `${result.file_name}.csv`);
                      } catch (error) {
                        console.error('Error downloading file:', error);
                        setToastMessage('Error downloading file');
                        setToastType('error');
                        setShowToast(true);
                      }
                    }}
                    className="p-2 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </>
              )}
            </>
          )}
          {result.status === 'ERROR' && (
            <span className="text-sm text-red-500">{result.error_message}</span>
          )}
        </div>
      </div>
    </div>
  );

  // --- Enrich result card: new Contact Finder behavior ---
  const renderEnrichResult = (result: EnrichResultWithBatch) => {
    const batchStatus = result.batchStatus;
    const isProcessing = result.status === 'RUNNING';
    const canDownload = result.status === 'DONE' || (isProcessing && batchStatus && ['ENRICHING', 'COMPLETED'].includes(batchStatus.status));

    return (
      <div key={`enrich-${result.id}`} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-50 p-2 rounded-lg">
              {getStatusIcon(result.status)}
            </div>
            <div>
              <p className="text-sm text-gray-800">
                {result.file_name}
                <span className="ml-2 text-xs text-gray-500">(Contact Finder)</span>
              </p>
              <p className="text-xs text-gray-500">
                {new Date(result.created_at).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {(result.status === 'DONE' || canDownload) && (
              <>
                {result.result_count === 0 && result.status === 'DONE' ? (
                  <div className="text-sm text-gray-500">
                    <p>No results found.</p>
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-gray-500 space-y-1">
                      {result.result_count != null && <p>Results: {result.result_count}</p>}
                      {result.file_size != null && <p>Size: {formatFileSize(result.file_size)}</p>}
                    </div>
                    <button
                      onClick={() => handleEnrichDownload(result)}
                      className="p-2 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                  </>
                )}
              </>
            )}
            {result.status === 'ERROR' && (
              <span className="text-sm text-red-500">
                {result.error_message}
              </span>
            )}
          </div>
        </div>

        {batchStatus && renderBatchInfo(batchStatus, isProcessing, result.id)}
      </div>
    );
  };

  return (
    <div className="w-full mx-auto p-4 md:px-6 md:pt-4 md:pb-24">
      {showToast && (
        <Toast
          message={toastMessage}
          type={toastType}
          onClose={() => setShowToast(false)}
        />
      )}

      <div className="mb-8">
        <div className="flex items-center mb-2">
          <h1 className="text-3xl font-bold">Results</h1>
        </div>
        <p className="text-gray-500">
          View and download your processed results.
        </p>
      </div>

      <div className="space-y-4">
        {results.map((result) => {
          if (result.type === 'serper') {
            return renderSerperResult(result);
          } else {
            return renderEnrichResult(result);
          }
        })}
        {results.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            No results found.
          </div>
        )}
      </div>
    </div>
  );
}
