import { useState, useCallback } from 'react';
import { Upload, X, Download, FileText } from 'lucide-react';
import Spinner from './Spinner';
import Toast from './Toast';

// Main BusinessFinder Component
export default function BusinessFinder() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [jobTitles, setJobTitles] = useState('');
  const [fileName, setFileName] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<"success" | "error" | "warning">('success');
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = useCallback((uploadedFile: File) => {
    // Validate file is CSV
    if (!uploadedFile.name.endsWith('.csv')) {
      setToastMessage('Please upload a CSV file');
      setToastType('error');
      setShowToast(true);
      return;
    }
    
    setIsUploading(true);
    // Simulate upload delay
    setTimeout(() => {
      setFile(uploadedFile);
      setIsUploading(false);
      setToastMessage('File uploaded successfully');
      setToastType('success');
      setShowToast(true);
    }, 1000);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }, [isDragging]);
  
const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  
const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  }, [handleFileUpload]);

  const removeFile = useCallback(() => {
    setFile(null);
  }, []);

  const downloadSampleFile = useCallback(() => {
    setToastMessage('Sample file downloaded');
    setToastType('success');
    setShowToast(true);
  }, []);

  const handleSubmit = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (e) e.preventDefault();
    
    if (!file) {
      setToastMessage('Please upload a CSV file first');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (!jobTitles.trim()) {
      setToastMessage('Please enter job titles');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (!fileName.trim()) {
      setToastMessage('Please enter a file name');
      setToastType('error');
      setShowToast(true);
      return;
    }

    setIsEnriching(true);
    // Simulate enrichment process
    setTimeout(() => {
      setIsEnriching(false);
      setToastMessage('Enrichment completed successfully');
      setToastType('success');
      setShowToast(true);
    }, 2000);
  }, [file, jobTitles, fileName]);

  const closeToast = useCallback(() => {
    setShowToast(false);
  }, []);

  return (
    <div className="w-full mx-auto p-4 md:p-6">
      {showToast && (
        <Toast 
          message={toastMessage} 
          type={toastType} 
          onClose={closeToast} 
        />
      )}
      
      <div className="mb-8">
        <div className="flex items-center mb-2">
          <h1 className="text-2xl font-bold">Business Finder</h1>
        </div>
        <p className="text-gray-500">
          Upload a CSV with companies and websites. We&apos;ll enrich it with decision maker info and emails.
        </p>
      </div>

      <div className="space-y-8">
        <div className="space-y-3">
          <label 
            htmlFor="file-upload" 
            className="block text-sm font-medium text-gray-500"
          >
            Upload CSV File
          </label>
          
          <div
            className={`
              relative border-2 border-dashed rounded-xl p-18
              flex flex-col items-center justify-center text-center
              cursor-pointer bg-gray-200 hover:bg-gray-100 transition-all duration-200
              ${isDragging ? 'border-blue-400 bg-blue-50' : ''}
              ${file ? 'border-green-400 bg-green-50' : 'border-gray-300'}
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onClick={() => document?.getElementById('file-upload')?.click()}
          >
            {isUploading ? (
              <div className="py-4">
                <Spinner />
                <p className="mt-3 text-sm font-medium text-blue-600">Uploading...</p>
              </div>
            ) : (
              <>
                <div className="bg-white rounded-full p-3 mb-4">
                  <Upload 
                    className="w-10 h-10 text-accentBlue" 
                    strokeWidth={1.5}
                  />
                </div>
                <p className="text-sm font-medium text-gray-600 mb-1">
                  {isDragging ? 'Drop your CSV file here' : 'Drag and drop your CSV file here'}
                </p>
                <p className="text-xs text-gray-500">
                  or click to browse files
                </p>
              </>
            )}
            <input
              id="file-upload"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
              disabled={isUploading}
            />
          </div>
        </div>

        {file && (
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-50 p-2 rounded-lg">
                  <FileText className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              </div>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => window.open(URL.createObjectURL(file))}
                  className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-blue-50"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={removeFile}
                  className="p-2 text-gray-500 hover:text-red-500 transition-colors rounded-full hover:bg-red-50"
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
            className="text-darkBlue font-medium flex items-center hover:underline hover:cursor-pointer"
          >
            <Download className="w-4 h-4 mr-1" />
            Download Sample File
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <label 
              htmlFor="job-titles" 
              className="block text-sm font-medium text-gray-500 mb-2"
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
              className="block text-sm font-medium text-gray-500 mb-2"
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
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isEnriching || !file}
            className={`
              w-full md:w-auto px-6 py-3 rounded-lg font-medium text-white
              ${isEnriching || !file 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg'}
              transition-all duration-200 flex items-center justify-center
            `}
          >
            {isEnriching ? (
              <>
                <Spinner /> 
                Enriching...
              </>
            ) : (
              'Enrich'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}