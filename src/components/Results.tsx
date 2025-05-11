import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Clock, CheckCircle, XCircle, Download } from 'lucide-react';
import { supabase } from '../lib/supabase/supabaseClient';
import Toast from './Toast';

interface SerperResult {
  id: string;
  user_id: string;
  file_name: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  result_count: number | null;
  credits_used: number | null;
  file_size: number | null;
  file_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface EnrichResult {
  id: string;
  user_id: string;
  file_name: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  result_count: number | null;
  file_size: number | null;
  file_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

type Result = (SerperResult | EnrichResult) & { type: 'serper' | 'enrich' };

export default function Results() {
  const [results, setResults] = useState<Result[]>([]);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning'>('success');
  const searchParams = useSearchParams();

  useEffect(() => {
    const status = searchParams?.get('status');
    if (status === 'processing') {
      setToastMessage('Processing your request! This might take a few minutes.');
      setToastType('success');
      setShowToast(true);
    }

    fetchResults();
    const interval = setInterval(() => {
      fetchResults();
    }, 5000);

    return () => clearInterval(interval);
  }, [searchParams]);

  const fetchResults = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [serperResults, enrichResults] = await Promise.all([
      supabase
        .from('serper_results')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('enrich_results')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
    ]);

    if (serperResults.error) {
      console.error('Error fetching Serper results:', serperResults.error);
      return;
    }

    if (enrichResults.error) {
      console.error('Error fetching Enrich results:', enrichResults.error);
      return;
    }

    const combinedResults: Result[] = [
      ...(serperResults.data || []).map(r => ({ ...r, type: 'serper' as const })),
      ...(enrichResults.data || []).map(r => ({ ...r, type: 'enrich' as const }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setResults(combinedResults);
  };

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

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const closeToast = () => {
    setShowToast(false);
  };

  return (
    <div className="w-full mx-auto p-4 md:px-6 md:pt-4 md:pb-24">
      {showToast && (
        <Toast 
          message={toastMessage} 
          type={toastType} 
          onClose={closeToast} 
        />
      )}
      
      <div className="mb-8">
        <div className="flex items-center mb-2">
          <h1 className="text-2xl font-bold">Results</h1>
        </div>
        <p className="text-gray-500">
          View and download your processed results.
        </p>
      </div>

      <div className="space-y-4">
        {results.map((result) => (
          <div key={`${result.type}-${result.id}`} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-50 p-2 rounded-lg">
                  {getStatusIcon(result.status)}
                </div>
                <div>
                  <p className="text-sm text-gray-800">
                    {result.file_name}
                    <span className="ml-2 text-xs text-gray-500">
                      ({result.type === 'serper' ? 'Business Finder' : 'Contact Finder'})
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(result.created_at).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                {result.status === 'DONE' && (
                  <>
                    <div className="text-sm text-gray-500 space-y-1">
                      <p>Results: {result.result_count}</p>
                      {result.type === 'serper' && 'credits_used' in result && (
                        <p>Credits: {result.credits_used}</p>
                      )}
                      <p>Size: {formatFileSize(result.file_size)}</p>
                    </div>
                    <a
                      href={result.file_url!}
                      download={`${result.file_name}.csv`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border"
                    >
                      <Download className="w-5 h-5" />
                    </a>
                  </>
                )}
                {result.status === 'ERROR' && (
                  <span className="text-sm text-red-500">
                    {result.error_message}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {results.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            No results found.
          </div>
        )}
      </div>
    </div>
  );
}
  