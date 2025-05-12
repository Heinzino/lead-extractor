import { useState, useCallback } from 'react';
import { X, Download, FileText, Youtube } from 'lucide-react';
import Button from './Button';
import Toast from './Toast';
import FileUploaderBox from './FileUploaderBox';
import YouTubeModal from './YouTubeModal';
import { supabase } from '../lib/supabase/supabaseClient';

export default function ContactFinder() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [jobTitles, setJobTitles] = useState('');
  const [fileName, setFileName] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<"success" | "error" | "warning">('success');
  const [hasUploadError, setHasUploadError] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

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
    setToastMessage('File uploaded successfully');
    setToastType('success');
    setShowToast(true);
  }, []);

  const handleValidationError = useCallback((error: string) => {
    setHasUploadError(true);
    setToastMessage(error);
    setToastType('error');
    setShowToast(true);
  }, []);

  const removeFile = useCallback(() => {
    setFile(null);
  }, []);

  const downloadSampleFile = useCallback(() => {
    const link = document.createElement('a');
    link.href = '/sample-bf-input.csv';
    link.download = 'sample-bf-input.csv';
    link.click();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !jobTitles || !fileName) {
      setToastMessage('Please upload a file and enter job titles');
      setToastType('error');
      setShowToast(true);
      return;
    }

    try {
      setIsEnriching(true);
      setToastMessage('Uploading file...');
      setToastType('success');
      setShowToast(true);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('jobTitles', jobTitles);
      formData.append('fileName', fileName);

      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('You must be logged in to use this feature');
      }
      formData.append('userId', user.id);

      const response = await fetch('/api/enrich', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process file');
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
        <Toast 
          message={toastMessage} 
          type={toastType} 
          onClose={closeToast} 
        />
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
          <label 
            htmlFor="file-upload" 
            className="block text-sm text-gray-500"
          >
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
            <label 
              htmlFor="job-titles" 
              className="block text-sm text-gray-500 mb-2"
            >
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

          <div>
            <label 
              htmlFor="file-name" 
              className="block text-sm text-gray-500 mb-2"
            >
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
            disabled={isEnriching || !file || hasUploadError}
            isLoading={isEnriching}
          />
        </div>
      </div>
    </div>
  );
}