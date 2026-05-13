import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Clock, CheckCircle, XCircle, Ban, Download, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
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
  status: 'RUNNING' | 'DONE' | 'ERROR' | 'ABORTED';
  mode?: 'match_and_enrich' | 'enrich_only';   // Phase 4E — read from Supabase
  result_count?: number;
  file_size?: number;
  file_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

interface EnrichmentStage {
  stage: number;
  name: string;
  status: 'completed' | 'in_progress' | 'pending';
  enriched?: number;
  validated?: number;
  emails_found?: number;
  findymail_credits?: number;
  wiza_credits?: number;
  bounceban_credits?: number;
  emails_invalidated?: number;
}

interface SkipSummary {
  name_domain: {
    total: number;
    missing_domain: number;
    missing_name: number;
    missing_both: number;
  };
  linkedin: {
    total: number;
  };
}

// Monthly LinkedIn full-reload context, attached to GET /batches/{id}
// only while the batch is QUEUED and a reload SFN is IN_PROGRESS. Mirrors
// the body that batch-status builds in _build_reload_block.
interface ReloadProgress {
  state: 'INDEX_RELOAD';
  reload_month: string | null;
  current_step: string | null;
  started_at: string;
  elapsed_min: number | null;
  docs_indexed_so_far: number;
  baseline_runtime_min: number | null;
  pct_complete: number | null;
  eta_min: number | null;
  last_progress_at: string | null;
  message: string;
}

interface BatchStatus {
  batch_id: string;
  status: string;
  mode?: 'match_and_enrich' | 'enrich_only';
  created_at?: string;
  enqueued_at?: string;
  completed_at?: string;
  job_titles?: string;
  countries?: string[];
  enrich_emails?: boolean;
  reload?: ReloadProgress;
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
    bounceban_credits?: number;
    emails_invalidated?: number;
    late_emails_invalidated?: number;
    validated_count?: number;
    total_to_validate?: number;
    validation_skipped?: boolean;
    current_stage?: number;
    stages?: EnrichmentStage[];
    skip_summary?: SkipSummary;
    rows_unresolvable?: number;   // Phase 4E — from batch-status API
    wiza_followup_at?: string;
    late_wiza_emails_found?: number;
    late_wiza_run_at?: string;
    wiza_pending_count?: number;
  };
}

type EnrichResultWithBatch = EnrichResult & { type: 'enrich'; batchStatus?: BatchStatus };
type SerperResultWithType = SerperResult & { type: 'serper' };
type Result = SerperResultWithType | EnrichResultWithBatch;

function resolveResultCount(
  mode: string | undefined,
  batchStatus: Pick<BatchStatus, 'matching' | 'enrichment'> | null | undefined,
): number {
  if (!batchStatus) return 0;
  if (mode === 'enrich_only') return batchStatus.enrichment?.total ?? 0;
  return batchStatus.matching?.total_matches ?? 0;
}

export default function Results() {
  const [serperResults, setSerperResults] = useState<SerperResultWithType[]>([]);
  const [enrichResults, setEnrichResults] = useState<EnrichResultWithBatch[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'error' | 'success'>('success');
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Map<string, number>>(new Map());
  const [downloadPhase, setDownloadPhase] = useState<Map<string, 'generating' | 'downloading'>>(new Map());
  const [downloadErrors, setDownloadErrors] = useState<Map<string, string>>(new Map());
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
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
            status: result.status as 'RUNNING' | 'DONE' | 'ERROR' | 'ABORTED',
          };
          const batchStatus = await fetchBatchStatus(result.id);
          if (!batchStatus) return enrichItem;

          enrichItem.batchStatus = batchStatus;
          const mode = result.mode ?? batchStatus.mode;

          if (result.status === 'RUNNING') {
            if (batchStatus.status === 'COMPLETED') {
              const count = resolveResultCount(mode, batchStatus);
              enrichItem.status = 'DONE';
              enrichItem.result_count = count;
              await supabase.from('enrich_results').update({
                status: 'DONE',
                result_count: count,
                updated_at: new Date().toISOString(),
              }).eq('id', result.id);
            } else if (batchStatus.status === 'FAILED') {
              enrichItem.status = 'ERROR';
            } else if (batchStatus.status === 'ABORTED') {
              const count = resolveResultCount(mode, batchStatus);
              enrichItem.status = 'ABORTED';
              enrichItem.result_count = count;
              await supabase.from('enrich_results').update({
                status: 'ABORTED',
                result_count: count,
                updated_at: new Date().toISOString(),
              }).eq('id', result.id);
            }
          } else if (
            (result.status === 'DONE' || result.status === 'ABORTED') &&
            mode === 'enrich_only' &&
            (result.result_count == null || result.result_count === 0)
          ) {
            const healed = resolveResultCount('enrich_only', batchStatus);
            if (healed > 0) {
              enrichItem.result_count = healed;
              await supabase.from('enrich_results').update({
                result_count: healed,
                updated_at: new Date().toISOString(),
              }).eq('id', result.id);
            }
          }

          return enrichItem;
        })
      );
    } else {
      const stored = JSON.parse(localStorage.getItem('matching_batches') || '[]') as {
        batch_id: string; file_name: string; created_at: string; status?: string; mode?: string;
      }[];

      enrichWithStatus = await Promise.all(
        stored.map(async (s) => {
          const batchStatus = await fetchBatchStatus(s.batch_id);
          const status = s.status === 'DONE' || s.status === 'ERROR' || s.status === 'ABORTED'
            ? s.status
            : batchStatus?.status === 'COMPLETED' ? 'DONE'
              : batchStatus?.status === 'FAILED' ? 'ERROR'
                : batchStatus?.status === 'ABORTED' ? 'ABORTED' : 'RUNNING';

          if ((status === 'DONE' || status === 'ERROR' || status === 'ABORTED') && s.status !== status) {
            s.status = status;
          }

          const mode = s.mode ?? batchStatus?.mode;
          const item: EnrichResultWithBatch = {
            id: s.batch_id,
            user_id: 'local',
            file_name: s.file_name,
            status: status as 'RUNNING' | 'DONE' | 'ERROR' | 'ABORTED',
            mode: mode as EnrichResult['mode'],
            result_count: resolveResultCount(mode, batchStatus),
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
      case 'ABORTED':
        return <Ban className="w-5 h-5 text-orange-500" />;
    }
  };

  const getStageStatusIcon = (status: EnrichmentStage['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />;
      case 'in_progress':
        return <Clock className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />;
      case 'pending':
        return <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 flex-shrink-0" />;
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

  const handleEnrichDownload = async (
    result: EnrichResultWithBatch,
    isRetry = false,
  ) => {
    const id = result.id;
    const fileName = `${result.file_name}.csv`;

    // Reset any prior error for this row.
    setDownloadErrors(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setDownloadingIds(prev => new Set(prev).add(id));
    setDownloadProgress(prev => new Map(prev).set(id, 0));
    setDownloadPhase(prev => new Map(prev).set(id, 'generating'));

    const clearProgress = () => {
      setDownloadProgress(prev => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setDownloadPhase(prev => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };

    try {
      // Business Finder (Serper) path: file_url is a direct S3/Storage URL.
      if (result.file_url) {
        const response = await fetch(result.file_url);
        const blob = await response.blob();
        downloadBlob(blob, fileName);
        return;
      }

      // Contact Finder path: poll async-export status until READY, then
      // stream-download the CSV through the proxy.
      const MAX_WAIT_MS = 15 * 60 * 1000;
      const startTime = Date.now();
      let useRetryFlag = isRetry;

      while (Date.now() - startTime < MAX_WAIT_MS) {
        const statusParams = new URLSearchParams({ filename: fileName });
        if (useRetryFlag) statusParams.set('retry', '1');
        const statusUrl = `/api/matching/${id}/download-status?${statusParams.toString()}`;
        const statusRes = await fetch(statusUrl);
        if (!statusRes.ok && statusRes.status !== 409) {
          throw new Error(`Status check failed (${statusRes.status})`);
        }
        const data = await statusRes.json();

        if (data.status === 'READY') {
          // Direct-download from S3 via the presigned URL. Skipping the
          // Vercel proxy avoids the serverless maxDuration cap and the
          // browser-side blob buffer, so 100+ MB exports work. S3 returns
          // Content-Disposition: attachment (set via the presigned URL's
          // ResponseContentDisposition param), which forces download even
          // cross-origin.
          if (!data.download_url) {
            throw new Error('Download failed: no URL returned');
          }
          const link = document.createElement('a');
          link.href = data.download_url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return;
        }
        if (data.status === 'FAILED') {
          throw new Error(data.error || 'Export failed');
        }
        if (data.status === 'NOT_READY') {
          throw new Error(
            `Batch is ${data.batch_status || 'not ready'}`
          );
        }
        // GENERATING — update elapsed counter, wait using backend's
        // retry_after (fall back to 3s if missing/invalid).
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setDownloadProgress(prev => new Map(prev).set(id, elapsed));
        const retryAfter = Number(data.retry_after);
        const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 3) * 1000;
        await new Promise(r => setTimeout(r, waitMs));
        useRetryFlag = false;
      }
      throw new Error('Generation taking too long — please retry');
    } catch (error) {
      console.error('Error downloading file:', error);
      const message = error instanceof Error ? error.message : 'Download failed';
      setDownloadErrors(prev => new Map(prev).set(id, message));
    } finally {
      clearProgress();
    }
  };

  const handleStopBatch = async (resultId: string) => {
    setConfirmStopId(null);
    setStoppingIds(prev => new Set(prev).add(resultId));
    try {
      const res = await fetch(`/api/matching/${resultId}/stop`, { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        // Update local state
        setEnrichResults(prev =>
          prev.map(r => r.id === resultId ? { ...r, status: 'ABORTED' as const } : r)
        );
        // Update Supabase or localStorage
        if (HAS_SUPABASE) {
          await supabase.from('enrich_results').update({
            status: 'ABORTED',
            updated_at: new Date().toISOString(),
          }).eq('id', resultId);
        } else {
          const stored = JSON.parse(localStorage.getItem('matching_batches') || '[]');
          const entry = stored.find((s: { batch_id: string }) => s.batch_id === resultId);
          if (entry) entry.status = 'ABORTED';
          localStorage.setItem('matching_batches', JSON.stringify(stored));
        }
        setToastMessage('Batch execution stopped.');
        setToastType('success');
        setShowToast(true);
      } else if (res.status === 409) {
        // Race condition: batch already finished
        setToastMessage(data.error || 'Batch already completed.');
        setToastType('success');
        setShowToast(true);
        fetchEnrichResults();
      } else {
        setToastMessage(data.error || 'Failed to stop batch.');
        setToastType('error');
        setShowToast(true);
      }
    } catch (error) {
      console.error('Error stopping batch:', error);
      setToastMessage('Failed to stop batch. Please try again.');
      setToastType('error');
      setShowToast(true);
    } finally {
      setStoppingIds(prev => {
        const next = new Set(prev);
        next.delete(resultId);
        return next;
      });
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

  const getStageEligible = (
    stageNum: number,
    enrichment: NonNullable<BatchStatus['enrichment']>,
  ): number => {
    const total = enrichment.total || 0;
    const ndSkip = enrichment.skip_summary?.name_domain.total ?? 0;
    const liSkip = enrichment.skip_summary?.linkedin.total ?? 0;
    let eligible: number;
    switch (stageNum) {
      case 1: case 2: eligible = total - ndSkip; break;
      case 3: case 4: eligible = total - liSkip; break;
      case 5:         eligible = enrichment.total_to_validate ?? enrichment.emails_found ?? 0; break;
      default:        eligible = total;
    }
    return eligible > 0 ? eligible : total;
  };

  const getEnrichmentProgress = (enrichment: BatchStatus['enrichment']): number => {
    const stages = enrichment?.stages;
    if (!enrichment || !stages?.length) return 0;
    const completed = stages.filter(s => s.status === 'completed').length;
    const active = stages.find(s => s.status === 'in_progress');
    let fraction = 0;
    if (active) {
      const eligible = getStageEligible(active.stage, enrichment);
      const done = active.stage === 5 ? (active.validated ?? 0) : (active.enriched ?? 0);
      fraction = eligible > 0 ? Math.max(0, Math.min(1, done / eligible)) : 0;
    }
    return Math.min(100, ((completed + fraction) / stages.length) * 100);
  };

  const renderBatchInfo = (
    batchStatus: BatchStatus,
    isProcessing: boolean,
    resultId: string,
    isEnrichOnly: boolean = false,
  ) => {
    const matching = batchStatus.matching;
    const enrichment = batchStatus.enrichment;
    const status = batchStatus.status;
    const isPastMatching = status === 'ENRICHING' || status === 'COMPLETED' || status === 'ABORTED' || status === 'FAILED';
    const isComplete = status === 'COMPLETED';
    const isAborted = status === 'ABORTED';
    const isFailed = status === 'FAILED';
    const isExpanded = expandedId === resultId;

    if (status === 'QUEUED') {
      const reload = batchStatus.reload;
      if (!reload) {
        return (
          <div className="mt-3">
            <span className="text-xs text-gray-500">
              Queued
              {batchStatus.enqueued_at
                ? ` — waiting since ${formatTime(batchStatus.enqueued_at)}`
                : ''}
            </span>
          </div>
        );
      }
      // Queued behind a monthly LinkedIn full-reload: show progress so the
      // user knows why their batch hasn't started and roughly when it will.
      // The dispatcher promotes QUEUED → PENDING automatically once the
      // reload SFN completes (EventBridge), so no manual action is needed.
      const pct = reload.pct_complete;
      return (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-amber-900">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-amber-600" />
            <div className="flex-1 space-y-2">
              <div className="text-sm font-medium">
                Matching index is being rebuilt with the latest LinkedIn data
              </div>
              <p className="text-xs text-amber-800">{reload.message}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-amber-800 md:grid-cols-4">
                {reload.current_step && (
                  <div>
                    <span className="text-amber-700">Step:</span>{' '}
                    <span className="font-mono">{reload.current_step}</span>
                  </div>
                )}
                {reload.elapsed_min !== null && (
                  <div>
                    <span className="text-amber-700">Elapsed:</span>{' '}
                    {reload.elapsed_min} min
                  </div>
                )}
                {reload.eta_min !== null && (
                  <div>
                    <span className="text-amber-700">ETA:</span>{' '}
                    ~{reload.eta_min} min
                  </div>
                )}
                {pct !== null && (
                  <div>
                    <span className="text-amber-700">Progress:</span> {pct}%
                  </div>
                )}
              </div>
              {pct !== null && (
                <div className="h-2 w-full overflow-hidden rounded bg-amber-100">
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                  />
                </div>
              )}
              <div className="pt-0.5 text-xs text-amber-700">
                Your file is uploaded — processing will start automatically when the rebuild finishes.
                {batchStatus.enqueued_at && (
                  <> Queued at {formatTime(batchStatus.enqueued_at)}.</>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (status === 'PENDING' || status === 'CONVERTING') {
      return (
        <div className="mt-3">
          <span className="text-xs text-gray-500">Preparing data…</span>
        </div>
      );
    }

    // Phase 4E: render the enrichment block whenever enrichment exists AND
    // there's something to show — eligible rows OR an unresolvable count.
    // The original guard `enrichment.total > 0` would have hidden the entire
    // block (and the "X rows unusable" notice) for an all-unresolvable CSV.
    const enrichmentRowsUnresolvable = enrichment?.rows_unresolvable ?? 0;
    const showEnrichmentBlock =
      !!enrichment && (enrichment.total > 0 || enrichmentRowsUnresolvable > 0);

    return (
      <div className="mt-3 space-y-2 w-full">
        {/* Timing */}
        <div className="text-xs text-gray-400">
          {batchStatus.created_at && formatTime(batchStatus.created_at)}
          {batchStatus.completed_at && (
            <> → {formatTime(batchStatus.completed_at)} ({formatDuration(batchStatus.created_at!, batchStatus.completed_at)})</>
          )}
        </div>

        {/* Matching — Phase 4E: hidden entirely for enrich_only batches */}
        {!isEnrichOnly && matching && matching.total_rows > 0 && (
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
        {showEnrichmentBlock && enrichment && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>
                Email Enrichment{' '}
                {isComplete
                  ? '✓'
                  : isAborted
                    ? '(stopped)'
                    : isFailed
                      ? '(failed)'
                      : (() => {
                          const active = enrichment.stages?.find(s => s.status === 'in_progress');
                          if (!active) {
                            return enrichment.current_stage
                              ? `(Stage ${enrichment.current_stage}/${enrichment.stages?.length || 5})`
                              : '...';
                          }
                          const eligible = getStageEligible(active.stage, enrichment);
                          const done = active.stage === 5 ? (active.validated ?? 0) : (active.enriched ?? 0);
                          const segs: string[] = [`· ${active.name}`];
                          if (eligible > 0) segs.push(`${done.toLocaleString()}/${eligible.toLocaleString()} processed`);
                          segs.push(`${(active.emails_found ?? 0).toLocaleString()} emails`);
                          if ((active.findymail_credits ?? 0) > 0) segs.push(`${active.findymail_credits!.toLocaleString()} FM credits`);
                          if ((active.wiza_credits ?? 0) > 0) segs.push(`${active.wiza_credits!.toLocaleString()} Wiza credits`);
                          if ((active.bounceban_credits ?? 0) > 0) segs.push(`${active.bounceban_credits!.toLocaleString()} BB credits`);
                          return segs.join(' · ');
                        })()}
              </span>
              <span>
                {enrichment.emails_found + (enrichment.late_wiza_emails_found ?? 0)} emails found
                {((enrichment.emails_invalidated ?? 0) > 0 || (enrichment.late_emails_invalidated ?? 0) > 0) && (
                  <> · {(enrichment.emails_invalidated ?? 0) + (enrichment.late_emails_invalidated ?? 0)} invalidated · {enrichment.emails_found + (enrichment.late_wiza_emails_found ?? 0) - (enrichment.emails_invalidated ?? 0) - (enrichment.late_emails_invalidated ?? 0)} usable</>
                )}
              </span>
            </div>
            {isProcessing && !isComplete && !isAborted && !isFailed && enrichment.total > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${getEnrichmentProgress(enrichment)}%` }}
                />
              </div>
            )}

            {/* Phase 4E: rows the preload Lambda dropped because they had
                neither linkedin_url nor (person_name + matched_company_domain).
                Defaults to 0 for non-standalone batches, so this never renders
                for them. */}
            {enrichmentRowsUnresolvable > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                {enrichmentRowsUnresolvable.toLocaleString()} rows unusable —
                no LinkedIn URL or Name+Domain provided
              </p>
            )}

            {enrichment.validation_skipped && (
              <p className="text-xs text-amber-600 mt-1">
                BounceBan validation was skipped — set BOUNCEBAN_API_KEY on the
                email-enrichment Lambda to enable.
              </p>
            )}

            {/* Skip summary banner — static pre-scan counts shown once above stages */}
            {enrichment.skip_summary && (() => {
              const nd = enrichment.skip_summary!.name_domain;
              const li = enrichment.skip_summary!.linkedin;
              const total = enrichment.total || 0;
              const hasNameSkips = nd.total > 0;
              const hasLinkedinSkips = li.total > 0;
              if (!hasNameSkips && !hasLinkedinSkips) return null;
              const ndParts: string[] = [];
              if (nd.missing_domain > 0) ndParts.push(`${nd.missing_domain.toLocaleString()} missing domain`);
              if (nd.missing_name > 0) ndParts.push(`${nd.missing_name.toLocaleString()} missing name`);
              if (nd.missing_both > 0) ndParts.push(`${nd.missing_both.toLocaleString()} missing both`);
              return (
                <div className="mt-1 space-y-0.5">
                  {hasNameSkips && (
                    <p className="text-xs text-amber-500">
                      {nd.total.toLocaleString()} of {total.toLocaleString()} missing fields for name search
                      {ndParts.length > 0 && ` (${ndParts.join(' · ')})`}
                    </p>
                  )}
                  {hasLinkedinSkips && (
                    <p className="text-xs text-amber-500">
                      {li.total.toLocaleString()} of {total.toLocaleString()} missing LinkedIn URL
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Per-stage breakdown */}
            {enrichment.stages && enrichment.stages.length > 0 && (
              <div className="mt-2 space-y-1">
                {enrichment.stages.map((stage) => (
                  <div key={stage.stage} className="flex items-center gap-2 text-xs">
                    {getStageStatusIcon(stage.status)}
                    <span className={`w-44 flex-shrink-0 ${stage.status === 'pending' ? 'text-gray-400' : 'text-gray-600'}`}>
                      {stage.name}
                    </span>
                    {stage.status !== 'pending' && (
                      <span className="text-gray-400">
                        {stage.stage === 5 ? (
                          <>
                            {(stage.validated ?? 0).toLocaleString()} validated · {(stage.emails_invalidated ?? 0).toLocaleString()} dropped · {(stage.bounceban_credits ?? 0).toLocaleString()} BB credits
                          </>
                        ) : (
                          <>
                            {(stage.enriched ?? 0).toLocaleString()} processed · {(stage.emails_found ?? 0).toLocaleString()} emails
                            {(stage.findymail_credits ?? 0) > 0 && ` · ${(stage.findymail_credits ?? 0).toLocaleString()} FM credits`}
                            {(stage.wiza_credits ?? 0) > 0 && ` · ${(stage.wiza_credits ?? 0).toLocaleString()} Wiza credits`}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 text-xs text-gray-400 mt-1">
              <span>Findymail: {enrichment.findymail_credits} credits</span>
              <span>Wiza: {enrichment.wiza_credits} credits</span>
              {(enrichment.bounceban_credits ?? 0) > 0 && (
                <span>BounceBan: {enrichment.bounceban_credits} credits</span>
              )}
            </div>
            {/* Wiza follow-up status */}
            {enrichment.wiza_credits > 0 && (enrichment.wiza_followup_at || enrichment.late_wiza_run_at) && (
              <div className="text-xs text-gray-400 mt-1 pt-1 border-t border-gray-100">
                {enrichment.late_wiza_run_at ? (
                  <>
                    <span className="text-green-500 mr-1">&#10003;</span>
                    Wiza follow-up completed {formatTime(enrichment.late_wiza_run_at)}
                    {' '}&mdash; {enrichment.late_wiza_emails_found || 0} late email{(enrichment.late_wiza_emails_found || 0) !== 1 ? 's' : ''} found
                    {(enrichment.late_wiza_emails_found || 0) > 0 && (
                      <span className="block text-gray-400 mt-0.5">Re-download CSV to include late emails</span>
                    )}
                  </>
                ) : enrichment.wiza_followup_at ? (
                  <>
                    <span className="mr-1">&#9203;</span>
                    Wiza follow-up scheduled for {formatTime(enrichment.wiza_followup_at)} &mdash; {enrichment.wiza_pending_count || 0} pending emails
                  </>
                ) : null}
              </div>
            )}
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
            {batchStatus.countries && batchStatus.countries.length > 0 && (
              <p>Countries: {batchStatus.countries.join(', ')}</p>
            )}
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
    const canDownload = result.status === 'DONE' || result.status === 'ABORTED' || (isProcessing && batchStatus && ['ENRICHING', 'COMPLETED'].includes(batchStatus.status));
    const isEnrichOnly = result.mode === 'enrich_only';   // Phase 4E — drives matching-section hide

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
            {result.status === 'RUNNING' && (
              <button
                onClick={() => setConfirmStopId(result.id)}
                disabled={stoppingIds.has(result.id)}
                className="p-2 text-gray-400 hover:text-red-500 hover:cursor-pointer transition-colors rounded-full hover:border disabled:opacity-50 disabled:cursor-not-allowed"
                title="Stop execution"
              >
                {stoppingIds.has(result.id)
                  ? <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  : <Ban className="w-5 h-5" />
                }
              </button>
            )}
            {(result.status === 'DONE' || canDownload) && (
              <>
                {result.result_count === 0 && result.status === 'DONE' && result.mode !== 'enrich_only' ? (
                  <div className="text-sm text-gray-500">
                    <p>No results found.</p>
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-gray-500 space-y-1">
                      {result.result_count != null && <p>Results: {result.result_count}</p>}
                      {result.file_size != null && <p>Size: {formatFileSize(result.file_size)}</p>}
                    </div>
                    {downloadErrors.has(result.id) ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-red-500">
                          Export failed: {downloadErrors.get(result.id)}
                        </span>
                        <button
                          onClick={() => handleEnrichDownload(result, true)}
                          className="text-xs px-3 py-1 bg-accentBlue text-white rounded hover:opacity-90 transition-colors"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {downloadingIds.has(result.id) && (
                          <span className="text-xs text-gray-500">
                            {downloadPhase.get(result.id) === 'downloading' ? 'Downloading' : 'Generating'}... {downloadProgress.get(result.id) ?? 0}s
                          </span>
                        )}
                        <button
                          onClick={() => handleEnrichDownload(result)}
                          disabled={downloadingIds.has(result.id)}
                          className="p-2 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {downloadingIds.has(result.id)
                            ? <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                            : <Download className="w-5 h-5" />
                          }
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {result.status === 'ERROR' && (
              <span className="text-sm text-red-500">
                {result.error_message}
              </span>
            )}
            {result.status === 'ABORTED' && (
              <span className="text-sm text-orange-500">
                Stopped by user
              </span>
            )}
          </div>
        </div>

        {batchStatus && renderBatchInfo(batchStatus, isProcessing, result.id, isEnrichOnly)}
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

      {confirmStopId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Stop batch execution?</h3>
            <p className="text-sm text-gray-600 mb-6">
              This cannot be undone. Any partial results will still be available for download.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setConfirmStopId(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStopBatch(confirmStopId)}
                className="px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Stop Execution
              </button>
            </div>
          </div>
        </div>
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
