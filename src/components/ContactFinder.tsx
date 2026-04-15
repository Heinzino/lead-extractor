import { useState, useCallback } from 'react';
import { X, Download, FileText } from 'lucide-react';
import Button from './Button';
import Toast from './Toast';
import FileUploaderBox from './FileUploaderBox';
import FieldMapper from './FieldMapper';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase/supabaseClient';
import { MATCHING_FIELDS, ENRICHMENT_FIELDS } from '../lib/fieldConfigs';
import { transformEnrichmentCsv } from '../lib/csvTransform';

type ContactFinderMode = 'match_and_enrich' | 'enrich_only';

const HAS_SUPABASE = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

function saveBatchToLocalStorage(batch: { batch_id: string; file_name: string; created_at: string }) {
  const key = 'matching_batches';
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.unshift(batch);
  localStorage.setItem(key, JSON.stringify(existing));
}

export default function ContactFinder() {
  const { user } = useAuth();
  const [mode, setMode] = useState<ContactFinderMode>('match_and_enrich');
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string> | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobTitles, setJobTitles] = useState('');
  const [fileName, setFileName] = useState('');
  const [enrichEmails, setEnrichEmails] = useState(false);
  const [maxMatchesPerBusiness, setMaxMatchesPerBusiness] = useState(20);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'error' | 'success'>('success');
  const [hasUploadError, setHasUploadError] = useState(false);

  // Tab switch resets all upload state so a half-mapped file from one mode
  // doesn't leak into the other.
  const switchMode = useCallback((next: ContactFinderMode) => {
    if (next === mode) return;
    if (isSubmitting) return; // tab buttons are also disabled in JSX, but guard here too
    setMode(next);
    setFile(null);
    setCsvHeaders([]);
    setFieldMapping(null);
    setJobTitles('');
    setEnrichEmails(false);
    setMaxMatchesPerBusiness(20);
    setFileName('');
    setHasUploadError(false);
    setIsSubmitting(false);
    setShowToast(false);
  }, [mode, isSubmitting]);

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
    if (mode === 'enrich_only') {
      link.href = '/sample-cf-enrich-input.csv';
      link.download = 'sample-cf-enrich-input.csv';
    } else {
      link.href = '/sample-cf-input.csv';
      link.download = 'sample-cf-input.csv';
    }
    link.click();
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !fieldMapping) {
      setToastMessage('Please upload a file and confirm column mapping');
      setToastType('error');
      setShowToast(true);
      return;
    }
    // Mode-specific validation. For enrich_only, the FieldMapper's
    // 'enrichment-combo' rule has already enforced that at least linkedin_url
    // OR (person_name + matched_company_domain) is mapped — no extra check.
    if (mode === 'match_and_enrich' && !jobTitles) {
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

      // Step 1: Get pre-signed upload URL (mode-agnostic)
      setToastMessage('Preparing upload...');
      setToastType('success');
      setShowToast(true);

      const presignRes = await fetch('/api/matching/presign', { method: 'POST' });
      if (!presignRes.ok) throw new Error('Failed to get upload URL');
      const { batch_id, upload_url, csv_s3_key } = await presignRes.json();

      // Clean the CSV client-side before upload (both modes):
      //   - First Name + Last Name → synthesize "Full Name" (person_name).
      //   - enrich_only: mapped Company Domain → append "{col} (normalized)"
      //     and rewrite matched_company_domain to point at it (Findymail's
      //     name+domain stages read matched_company_domain directly).
      //   - match_and_enrich: mapped website → append "{col} (normalized)"
      //     and set a new user_company_domain key. Email enrichment prefers
      //     this over the LinkedIn-side matched_company_domain so emails go
      //     to the user's target domain. field_mapping.website is unchanged;
      //     matching-engine stage-0 still reads the raw column.
      const transformed = await transformEnrichmentCsv(file, fieldMapping);
      const uploadFile: File = transformed.file;
      const effectiveFieldMapping: Record<string, string> = transformed.fieldMapping;

      // Step 2: Upload CSV directly to S3 (mode-agnostic)
      setToastMessage('Uploading file...');
      setShowToast(true);

      const uploadRes = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/csv' },
        body: uploadFile,
      });
      if (!uploadRes.ok) throw new Error('Failed to upload file to S3');

      // Step 3: Start the pipeline — branch on mode.
      // - match_and_enrich: pre-Phase-4E body (no `mode` field, keeps the
      //   regression path byte-identical for the backend's default branch).
      // - enrich_only: new Phase 4E body. Backend dispatches directly to
      //   enrichment-orchestrator. job_titles is intentionally absent —
      //   the backend rejects it for enrich_only.
      setToastMessage('Starting processing...');
      setShowToast(true);

      const requestBody =
        mode === 'enrich_only'
          ? {
              batch_id,
              csv_s3_key,
              mode: 'enrich_only' as const,
              field_mapping: effectiveFieldMapping,
            }
          : {
              batch_id,
              csv_s3_key,
              job_titles: jobTitles,
              enrich_emails: enrichEmails,
              max_matches_per_business: maxMatchesPerBusiness,
              field_mapping: effectiveFieldMapping,
            };

      const startRes = await fetch('/api/matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!startRes.ok) {
        const error = await startRes.json();
        console.error('Start pipeline error:', startRes.status, error);
        throw new Error(error.error || error.message || JSON.stringify(error));
      }

      // Step 4: Store batch reference for the Results page (with NEW mode column)
      if (HAS_SUPABASE) {
        await supabase.from('enrich_results').insert({
          id: batch_id,
          user_id: user.id,
          file_name: effectiveFileName,
          status: 'RUNNING',
          mode,
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
          {mode === 'enrich_only'
            ? 'Upload a CSV of already-resolved people (LinkedIn, name, domain) and run the email enrichment waterfall directly.'
            : 'Upload a CSV with companies and websites. We\u2019ll find LinkedIn contacts and optionally enrich with emails.'}
        </p>
      </div>

      <div className="flex gap-2 mb-5 border-b border-gray-200">
        <button
          type="button"
          onClick={() => switchMode('match_and_enrich')}
          disabled={isSubmitting}
          className={`px-4 py-2 text-sm font-medium transition-colors -mb-px ${
            mode === 'match_and_enrich'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700 disabled:text-gray-300 disabled:cursor-not-allowed'
          }`}
        >
          Find Contacts
        </button>
        <button
          type="button"
          onClick={() => switchMode('enrich_only')}
          disabled={isSubmitting}
          className={`px-4 py-2 text-sm font-medium transition-colors -mb-px ${
            mode === 'enrich_only'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700 disabled:text-gray-300 disabled:cursor-not-allowed'
          }`}
        >
          Email Enrichment
        </button>
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
              compact
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
            requiredFields={mode === 'enrich_only' ? ENRICHMENT_FIELDS : MATCHING_FIELDS}
            validationMode={mode === 'enrich_only' ? 'enrichment-combo' : 'all-required'}
            helperText={
              mode === 'enrich_only'
                ? 'Map LinkedIn URL, OR map Company Domain together with a name (Full Name, or First Name + Last Name). Mapping LinkedIn plus a name+domain gets the best results.'
                : undefined
            }
            onConfirm={handleFieldMappingConfirm}
          />
        )}

        <div className={`space-y-4 transition-opacity ${!fieldMapping ? 'opacity-40 pointer-events-none' : ''}`}>
          {mode === 'match_and_enrich' && (
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
          )}

          {mode === 'match_and_enrich' && (
            <div>
              <label
                htmlFor="max-matches"
                className="block text-sm text-gray-500 mb-1.5"
              >
                Max matches per business
              </label>
              <input
                id="max-matches"
                type="number"
                min={1}
                max={20}
                value={maxMatchesPerBusiness}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isNaN(n)) {
                    setMaxMatchesPerBusiness(20);
                    return;
                  }
                  setMaxMatchesPerBusiness(Math.min(20, Math.max(1, n)));
                }}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              <p className="mt-1 text-xs text-gray-400">
                Up to 20 LinkedIn matches per input business (default 20).
              </p>
            </div>
          )}

          {mode === 'enrich_only' && (
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
              <p className="text-sm text-blue-800">
                All rows will be processed through the Findymail + Wiza waterfall
                (Stages 1&ndash;4 where data permits). Rows missing required fields
                for a given stage are automatically skipped.
              </p>
            </div>
          )}

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

          {mode === 'match_and_enrich' && (
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
          )}
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
