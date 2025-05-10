import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/supabaseClient';
import { Clock, CheckCircle, XCircle, Download } from 'lucide-react';
import Toast from './Toast';

interface SerperResult {
  id: string;
  file_name: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  result_count: number;
  error_message: string | null;
  file_url: string | null;
  created_at: string;
}

export default function Results() {
  const [results, setResults] = useState<SerperResult[]>([]);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning'>('success');
  const searchParams = useSearchParams();

  useEffect(() => {
    const status = searchParams?.get('status');
    if (status === 'processing') {
      setToastMessage('Processing your Serper queries! This might take a few minutes.');
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

    const { data, error } = await supabase
      .from('serper_results')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching results:', error);
      return;
    }

    setResults(data || []);
  };

  const getStatusIcon = (status: SerperResult['status']) => {
    switch (status) {
      case 'RUNNING':
        return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'DONE':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'ERROR':
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
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
          View and download your Serper query results.
        </p>
      </div>

      <div className="space-y-4">
        {results.map((result) => (
          <div key={result.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {getStatusIcon(result.status)}
                <div>
                  <p className="text-sm text-gray-800">{result.file_name}</p>
                  <p className="text-xs text-gray-500">
                    Created {new Date(result.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                {result.status === 'DONE' && (
                  <>
                    <span className="text-sm text-gray-500">
                      {result.result_count} results
                    </span>
                    <a
                      href={result.file_url!}
                      download
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
  