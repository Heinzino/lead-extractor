import { useState, useCallback } from 'react';
import { X, Download, FileText } from 'lucide-react';
import Button from './Button';
import Toast from './Toast';
import FileUploaderBox from './FileUploaderBox';
import FieldMapper from './FieldMapper';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase/supabaseClient';

const HAS_SUPABASE = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

function saveBatchToLocalStorage(batch: { batch_id: string; file_name: string; created_at: string }) {
  const key = 'matching_batches';
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.unshift(batch);
  localStorage.setItem(key, JSON.stringify(existing));
}

export default function ContactFinder() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string> | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobTitles, setJobTitles] = useState('');
  const [fileName, setFileName] = useState('');
  const [enrichEmails, setEnrichEmails] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'error' | 'success'>('success');
  const [hasUploadError, setHasUploadError] = useState(false);

  const handleFileUpload = useCallback(async (uploadedFile: File) => {
    if (!uploadedFile.name.endsWith('.csv')) {
      setToastMessage('Please upload a CSV file');
      setToastType('error');
      setShowToast(true);
      return;
    }
    setIsUploading(true);
    try {
      // Read only the first line to extract headers (not the full file)
      const text = await uploadedFile.text();
      const firstLine = text.split('\n')[0];
      // Handle BOM
      const clean = firstLine.replace(/^\uFEFF/, '');
      const headers = clean.split(',').map(h => h.trim().replace(/^"|"$/g, ''));

      if (headers.length === 0) {
        setToastMessage('CSV file has no headers');
        setToastType('error');
        setShowToast(true);
        return;
      }

      setCsvHeaders(headers);
      setFile(uploadedFile);
      setFieldMapping(null);
      setHasUploadError(false);
      setToastMessage('File uploaded — map your columns below');
      setToastType('success');
      setShowToast(true);
    } catch {
      setToastMessage('Failed to read CSV file');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleValidationError = useCallback((error: string) => {
    setHasUploadError(true);
    setToastMessage(error);
    setToastType('error');
    setShowToast(true);
  }, []);

  const handleFieldMappingConfirm = useCallback((mapping: Record<string, string>) => {
    setFieldMapping(mapping);
    setToastMessage('Column mapping confirmed');
    setToastType('success');
    setShowToast(true);
  }, []);

  const removeFile = useCallback(() => {
    setFile(null);
    setCsvHeaders([]);
    setFieldMapping(null);
  }, []);

  const downloadSampleFile = useCallback(() => {
    const link = document.createElement('a');
    link.href = '/sample-cf-input.csv';
    link.download = 'sample-cf-input.csv';
    link.click();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !fieldMapping) {
      setToastMessage('Please upload a file and confirm column mapping');
      setToastType('error');
      setShowToast(true);
      return;
    }
    if (!jobTitles) {
      setToastMessage('Please enter the job titles you want to search for');
      setToastType('error');
      setShowToast(true);
      return;
    }
    try {
      const effectiveFileName = fileName.trim()
        || file.name.replace(/\.csv$/i, '') + '-enriched';
      setIsSubmitting(true);

      if (!user) throw new Error('You must be logged in');

      // Step 1: Get pre-signed upload URL
      setToastMessage('Preparing upload...');
      setToastType('success');
      setShowToast(true);

      const presignRes = await fetch('/api/matching/presign', { method: 'POST' });
      if (!presignRes.ok) throw new Error('Failed to get upload URL');
      const { batch_id, upload_url, csv_s3_key } = await presignRes.json();

      // Step 2: Upload CSV directly to S3
      setToastMessage('Uploading file...');
      setShowToast(true);

      const uploadRes = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/csv' },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('Failed to upload file to S3');

      // Step 3: Start the pipeline
      setToastMessage('Starting processing...');
      setShowToast(true);

      const startRes = await fetch('/api/matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id,
          csv_s3_key,
          job_titles: jobTitles,
          enrich_emails: enrichEmails,
          field_mapping: fieldMapping,
        }),
      });
      if (!startRes.ok) {
        const error = await startRes.json();
        console.error('Start pipeline error:', startRes.status, error);
        throw new Error(error.error || error.message || JSON.stringify(error));
      }

      // Step 4: Store batch reference for the Results page
      if (HAS_SUPABASE) {
        await supabase.from('enrich_results').insert({
          id: batch_id,
          user_id: user.id,
          file_name: effectiveFileName,
          status: 'RUNNING',
          result_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        saveBatchToLocalStorage({
          batch_id,
          file_name: effectiveFileName,
          created_at: new Date().toISOString(),
        });
      }

      window.location.href = `/?page=Results&status=processing&batchId=${batch_id}`;
    } catch (error) {
      console.error('Error:', error);
      setToastMessage(error instanceof Error ? error.message : 'An error occurred');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeToast = useCallback(() => {
    setShowToast(false);
  }, []);

  return (
    <div className="w-full mx-auto p-4 md:px-6 md:pt-4 md:pb-24">
      {showToast && (
        <Toast
          message={toastMessage}
          type={toastType}
          onClose={closeToast}
        />
      )}

      <div className="mb-5">
        <h1 className="text-3xl font-bold mb-1">Contact Finder</h1>
        <p className="text-gray-500">
          Upload a CSV with companies and websites. We&apos;ll find LinkedIn contacts and optionally enrich with emails.
        </p>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="file-upload"
              className="block text-sm text-gray-500"
            >
              Upload CSV File
            </label>
            <button
              type="button"
              onClick={downloadSampleFile}
              className="text-darkBlue flex items-center text-sm hover:underline hover:cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              Sample File
            </button>
          </div>

          {!file ? (
            <FileUploaderBox
              handleFileUpload={handleFileUpload}
              isUploading={isUploading}
              file={file}
              type={'businesses'}
              onValidationError={handleValidationError}
            />
          ) : (
            <div className="bg-white p-3 rounded-xl border border-green-300 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="bg-green-50 p-1.5 rounded-lg">
                    <FileText className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-800">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => window.open(URL.createObjectURL(file))}
                    className="p-1.5 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={removeFile}
                    className="p-1.5 text-gray-500 hover:text-red-500 transition-colors rounded-full hover:border hover:cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {file && csvHeaders.length > 0 && (
          <FieldMapper
            csvHeaders={csvHeaders}
            onConfirm={handleFieldMappingConfirm}
          />
        )}

        <div className={`space-y-4 transition-opacity ${!fieldMapping ? 'opacity-40 pointer-events-none' : ''}`}>
          <div>
            <label
              htmlFor="job-titles"
              className="block text-sm text-gray-500 mb-1.5"
            >
              What job titles would you like to search for?
            </label>
            <input
              id="job-titles"
              type="text"
              placeholder="CEO, CTO, Marketing Director"
              value={jobTitles}
              onChange={(e) => setJobTitles(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
            <p className="mt-1 text-xs text-gray-400">
              Enter comma separated job titles
            </p>
          </div>

          <div>
            <label
              htmlFor="file-name"
              className="block text-sm text-gray-500 mb-1.5"
            >
              What do you want to name your file?
            </label>
            <input
              id="file-name"
              type="text"
              placeholder="my-enriched-list"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="enrich-emails"
              type="checkbox"
              checked={enrichEmails}
              onChange={(e) => setEnrichEmails(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <label htmlFor="enrich-emails" className="text-sm text-gray-600">
              Include email enrichment (uses Findymail + Wiza credits)
            </label>
          </div>
        </div>

        <div className="pt-4">
          <Button
            text="Enrich"
            onClick={() => {
              const event = new Event('submit') as unknown as React.FormEvent;
              handleSubmit(event);
            }}
            disabled={isSubmitting || hasUploadError || !fieldMapping}
            isLoading={isSubmitting}
          />
        </div>
      </div>
    </div>
  );
}
