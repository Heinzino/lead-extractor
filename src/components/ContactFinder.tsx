import { useState, useCallback, useMemo } from 'react';
import { X, Download, FileText, Youtube } from 'lucide-react';
import Papa from 'papaparse';
import Button from './Button';
import Toast from './Toast';
import FileUploaderBox from './FileUploaderBox';
import YouTubeModal from './YouTubeModal';
import LocationPicker from './LocationPicker';
import { supabase } from '../lib/supabase/supabaseClient';

async function uploadCsvAndGetSignedUrl(file: File, userId: string) {
  const bucket = 'php-csv-uploads';
  const path = `uploads/${userId}/${Date.now()}-${file.name}`;

  const up = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'text/csv',
  });
  if (up.error) throw up.error;

  const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    throw signed.error || new Error('Could not create signed URL');
  }
  return signed.data.signedUrl;
}

export default function ContactFinder() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [jobTitles, setJobTitles] = useState('');
  const [fileName, setFileName] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'error' | 'success'>('success');
  const [hasUploadError, setHasUploadError] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  const [headers, setHeaders] = useState<string[]>([]);
  const [websiteColumn, setWebsiteColumn] = useState<string>('');
  const [companyColumn, setCompanyColumn] = useState<string>('');

  const [locationColumn, setLocationColumn] = useState<string>('');
  const [companyLocation, setCompanyLocation] = useState('');
  const [excludeTitles, setExcludeTitles] = useState('');
  const [useVariants, setUseVariants] = useState(false);
  const [useAiVariants, setUseAiVariants] = useState(false);
  const [pageSize, setPageSize] = useState<number>(10);

  const handleFileUpload = useCallback((uploadedFile: File) => {
    if (!uploadedFile.name.endsWith('.csv')) {
      setToastMessage('Please upload a CSV file');
      setToastType('error');
      setShowToast(true);
      return;
    }

    setIsUploading(true);
    setFile(uploadedFile);
    setIsUploading(false);
    setHasUploadError(false);
    setToastMessage('File uploaded successfully');
    setToastType('success');
    setShowToast(true);

    Papa.parse(uploadedFile, {
      header: true,
      preview: 1,
      skipEmptyLines: true,
      complete: (results) => {

        const detected =
            (results.meta?.fields as string[] | undefined)?.filter(Boolean) ??
            (results.data && results.data[0] ? Object.keys(results.data[0] as object) : []);
        const uniqueHeaders = Array.from(new Set(detected)).filter(Boolean);

        setHeaders(uniqueHeaders);

        const guess = (needle: RegExp) =>
            uniqueHeaders.find((h) => needle.test(h.toLowerCase())) || '';
        setWebsiteColumn((prev) => prev || guess(/\b(url|website|site|domain)\b/));
        setCompanyColumn((prev) => prev || guess(/\b(company|business|org|name)\b/));
      },
      error: (err) => {
        console.error('CSV parse error:', err);
        setHeaders([]);
        setWebsiteColumn('');
        setCompanyColumn('');
        setToastMessage('Could not read CSV headers');
        setToastType('error');
        setShowToast(true);
      },
    });
  }, []);

  const handleValidationError = useCallback((error: string) => {
    setHasUploadError(true);
    setToastMessage(error);
    setToastType('error');
    setShowToast(true);
  }, []);

  const removeFile = useCallback(() => {
    setFile(null);
    setHeaders([]);
    setWebsiteColumn('');
    setCompanyColumn('');
    setLocationColumn('');
  }, []);

  const downloadSampleFile = useCallback(() => {
    const link = document.createElement('a');
    link.href = '/sample-cf-input.csv';
    link.download = 'sample-cf-input.csv';
    link.click();
  }, []);

  const mappingReady = useMemo(
      () => !!websiteColumn && !!companyColumn,
      [websiteColumn, companyColumn]
  );

  const locationReady = useMemo(
      () => Boolean(locationColumn) || Boolean(companyLocation),
      [locationColumn, companyLocation]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setToastMessage('Please upload a file');
      setToastType('error'); setShowToast(true); return;
    } else if (!jobTitles) {
      setToastMessage('Please enter the job titles you want to search for');
      setToastType('error'); setShowToast(true); return;
    } else if (!fileName) {
      setToastMessage('Please enter a name for your file');
      setToastType('error'); setShowToast(true); return;
    } else if (!mappingReady) {
      setToastMessage('Please select which columns are Website and Company Name');
      setToastType('error'); setShowToast(true); return;
    } else if (!locationReady) {
      setToastMessage('Please either map a Location column or pick a location.');
      setToastType('error'); setShowToast(true); return;
    } else if (!pageSize || pageSize < 1) {
      setToastMessage('Page size must be at least 1');
      setToastType('error'); setShowToast(true); return;
    }

    try {
      setIsEnriching(true);
      setToastMessage('Uploading file...');
      setToastType('success');
      setShowToast(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be logged in to use this feature');

      const fileUrl = await uploadCsvAndGetSignedUrl(file, user.id);

      const API_BASE_URL = process.env.NEXT_PUBLIC_LARAVEL_API_BASE_URL!;
      const payload = {
        fileUrl,
        jobTitles,
        fileName,
        websiteColumn,
        companyColumn,
        locationColumn: locationColumn || null,
        companyLocation,
        excludeTitles,
        useVariants,
        useAiVariants,
        pageSize: Math.min(200, Math.max(1, pageSize)),
        userId: user.id,
      };

      const response = await fetch(`${API_BASE_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || 'Failed to process file');
      }

      await response.json();
      window.location.href = `/?page=Results&status=processing`;
    } catch (error) {
      console.error('Error:', error);
      setToastMessage(error instanceof Error ? error.message : 'An error occurred');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsEnriching(false);
    }
  };

  const closeToast = useCallback(() => {
    setShowToast(false);
  }, []);

  return (
      <div className="w-full mx-auto p-4 md:px-6 md:pt-4 md:pb-24">
        {showToast && (
            <Toast message={toastMessage} type={toastType} onClose={closeToast} />
        )}

        <div className="mb-8">
          <div className="flex flex-col mb-2">
            <h1 className="text-3xl font-bold">Contact Finder</h1>
            <button
                onClick={() => setIsTutorialOpen(true)}
                className="flex items-center text-blue-600 hover:text-blue-800 transition-colors mt-2 w-fit hover:cursor-pointer"
            >
              <Youtube className="w-5 h-5 mr-1" />
              <span className="underline">Tutorial</span>
            </button>
          </div>
          <p className="text-gray-500">
            Upload a CSV with companies and websites. We&apos;ll enrich it with decision maker info and emails.
          </p>
        </div>

        <YouTubeModal
            isOpen={isTutorialOpen}
            onClose={() => setIsTutorialOpen(false)}
            videoId="ZEFLcPjxw6w"
        />

        <div className="space-y-8">
          <div className="space-y-3">
            <label htmlFor="file-upload" className="block text-sm text-gray-500">
              Upload CSV File
            </label>
            <FileUploaderBox
                handleFileUpload={handleFileUpload}
                isUploading={isUploading}
                file={file}
                type={'businesses'}
                onValidationError={handleValidationError}
            />
          </div>

          {file && (
              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="bg-blue-50 p-2 rounded-lg">
                      <FileText className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-800">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex space-x-3">
                    <button
                        type="button"
                        onClick={() => window.open(URL.createObjectURL(file))}
                        className="p-2 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        onClick={removeFile}
                        className="p-2 text-gray-500 hover:text-red-500 transition-colors rounded-full hover:border hover:cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* NEW: Column mapping UI */}
                {headers.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-sm text-gray-500 mb-1">
                          Website column
                        </label>
                        <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            value={websiteColumn}
                            onChange={(e) => setWebsiteColumn(e.target.value)}
                        >
                          <option value="" disabled>
                            Select column…
                          </option>
                          {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-500 mb-1">
                          Company name column
                        </label>
                        <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            value={companyColumn}
                            onChange={(e) => setCompanyColumn(e.target.value)}
                        >
                          <option value="" disabled>
                            Select column…
                          </option>
                          {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-500 mb-1">Location column (optional)</label>
                        <select className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                value={locationColumn}
                                onChange={(e) => setLocationColumn(e.target.value)}>
                          <option value="">(None)</option>
                          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">If set, we’ll use this column per row. Otherwise we can use the free-text below.</p>
                      </div>
                    </div>
                ) : (
                    <p className="text-xs text-gray-400 mt-3">
                      Reading CSV headers… if this doesn’t populate, make sure your file has a header row.
                    </p>
                )}
              </div>
          )}

          <div className="text-sm">
            <button
                type="button"
                onClick={downloadSampleFile}
                className="text-darkBlue flex items-center hover:underline hover:cursor-pointer"
            >
              <Download className="w-4 h-4 mr-1" />
              Download Sample File
            </button>
          </div>

          <div className="space-y-6">
            <div>
              <label htmlFor="job-titles" className="block text-sm text-gray-500 mb-2">
                What job titles would you like to search for?
              </label>
              <input
                  id="job-titles"
                  type="text"
                  placeholder="CEO, CTO, Marketing Director"
                  value={jobTitles}
                  onChange={(e) => setJobTitles(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              <p className="mt-2 text-xs text-gray-400">
                Enter comma separated job titles
              </p>
            </div>

          {/* EXCLUDE TITLES */}
          <div>
            <label htmlFor="exclude-titles" className="block text-sm text-gray-500 mb-2">
              Exclude titles (optional)
            </label>
            <input
                id="exclude-titles"
                type="text"
                placeholder="Intern, Assistant"
                value={excludeTitles}
                onChange={(e) => setExcludeTitles(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
            <p className="mt-2 text-xs text-gray-400">Comma-separated list. These will be filtered out.</p>
          </div>

          {/* LOCATION FREE TEXT */}
          <div>
            <label className="block text-sm text-gray-500 mb-2">
              Location (optional)
            </label>

            <LocationPicker
                onChange={(loc) => setCompanyLocation(loc)}
                className="w-full"
            />

            <p className="mt-2 text-xs text-gray-400">
              If a Location column is mapped, that per-row value wins. Otherwise we’ll send this picker’s value.
            </p>
          </div>

          {/* PAGE SIZE */}
          <div>
            <label htmlFor="page-size" className="block text-sm text-gray-500 mb-2">
              Page size (1–200)
            </label>
            <input
                id="page-size"
                type="number"
                min={1}
                max={200}
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value || 10))}
                className="w-full max-w-xs px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          {/* TOGGLES */}
          <div className="flex items-center gap-6">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                  type="checkbox"
                  checked={useVariants}
                  onChange={(e) => setUseVariants(e.target.checked)}
                  className="h-4 w-4"
              />
              <span className="text-sm text-gray-700">Use variants</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                  type="checkbox"
                  checked={useAiVariants}
                  onChange={(e) => setUseAiVariants(e.target.checked)}
                  className="h-4 w-4"
              />
              <span className="text-sm text-gray-700">Use AI variants</span>
            </label>
          </div>

          <div>
            <label htmlFor="file-name" className="block text-sm text-gray-500 mb-2">
              What do you want to name your file?
            </label>
            <input
                id="file-name"
                type="text"
                placeholder="my-enriched-list"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>
        </div>

          <div className="pt-2">
            <Button
                text="Enrich"
                onClick={() => {
                  const event = new Event('submit') as unknown as React.FormEvent;
                  handleSubmit(event);
                }}
                disabled={isEnriching || hasUploadError || !mappingReady}
                isLoading={isEnriching}
            />
          </div>
        </div>
      </div>
  );
}