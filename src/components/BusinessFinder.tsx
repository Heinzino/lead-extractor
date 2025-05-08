import { useState, useCallback } from 'react';
import { Download, FileText, X } from 'lucide-react';
import FileUploaderBox from './FileUploaderBox';
import Button from './Button';
import Toast from './Toast';

export default function BusinessFinder() {
  const [citiesFile, setCitiesFile] = useState<File | null>(null);
  const [queriesFile, setQueriesFile] = useState<File | null>(null);
  const [combinedFile, setCombinedFile] = useState<File | null>(null);
  const [isUploadingCities, setIsUploadingCities] = useState(false);
  const [isUploadingQueries, setIsUploadingQueries] = useState(false);
  const [isUploadingCombined, setIsUploadingCombined] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<"success" | "error" | "warning">('success');

  const handleFileUpload = useCallback((file: File, type: 'cities' | 'queries' | 'businesses' | 'combined') => {
    if (!file.name.endsWith('.csv')) {
      setToastMessage('Please upload a CSV file');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (type === 'cities') {
      setIsUploadingCities(true);
      setTimeout(() => {
        setCitiesFile(file);
        setIsUploadingCities(false);
        setToastMessage('Cities file uploaded successfully');
        setToastType('success');
        setShowToast(true);
      }, 1000);
    }
      if (type === 'combined') {
        setIsUploadingCombined(true);
        setTimeout(() => {
          setCombinedFile(file);
          setIsUploadingCombined(false);
          setToastMessage('Combined CSV file uploaded successfully');
          setToastType('success');
          setShowToast(true);
        }, 1000);
    } else {
      setIsUploadingQueries(true);
      setTimeout(() => {
        setQueriesFile(file);
        setIsUploadingQueries(false);
        setToastMessage('Queries file uploaded successfully');
        setToastType('success');
        setShowToast(true);
      }, 1000);
    }
  }, []);

  const downloadSampleFile = useCallback((fileName: string) => {
    const link = document.createElement('a');
    link.href = `/${fileName}`;
    link.download = fileName;
    link.click();
  }, []);

  const handleGenerate = useCallback(() => {
    if (!citiesFile || !queriesFile) {
      setToastMessage('Please upload both Cities and Queries files');
      setToastType('error');
      setShowToast(true);
      return;
    }

    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setToastMessage('Combined CSV generated successfully');
      setToastType('success');
      setShowToast(true);
    }, 2000);
  }, [citiesFile, queriesFile]);

  const closeToast = useCallback(() => {
    setShowToast(false);
  }, []);

  const removeFile = useCallback((type: 'cities' | 'queries' | 'combined') => {
    if (type === 'cities') {
      setCitiesFile(null);
    }
    if (type === 'combined') {
      setCombinedFile(null);
    }
    else {
      setQueriesFile(null);
    }
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
        <div className="flex items-center mb-2">
          <h1 className="text-2xl font-bold">Business Finder</h1>
        </div>
        <p className="text-gray-500">
          Upload two CSV files: one with cities and one with queries. We&apos;ll combine them into a single CSV.
        </p>
      </div>
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label 
              htmlFor="cities-upload" 
              className="block text-sm text-gray-500 mb-2"
            >
              Upload Cities CSV
            </label>
            <FileUploaderBox
              handleFileUpload={handleFileUpload}
              isUploading={isUploadingCities}
              file={citiesFile}
              type={'cities'}
            />
            {citiesFile && (
              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="bg-blue-50 p-2 rounded-lg">
                      <FileText className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-800">{citiesFile.name}</p>
                      <p className="text-xs text-gray-500">
                        {(citiesFile.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={() => window.open(URL.createObjectURL(citiesFile))}
                      className="p-2 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFile('cities')}
                      className="p-2 text-gray-500 hover:text-red-500 transition-colors rounded-full hover:border hover:cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => downloadSampleFile('sample-cities.csv')}
              className="text-darkBlue flex items-center hover:underline hover:cursor-pointer mt-4"
            >
              <Download className="w-4 h-4 mr-1" />
              Download Sample Cities File
            </button>
          </div>
          <div>
            <label 
              htmlFor="queries-upload" 
              className="block text-sm text-gray-500 mb-2"
            >
              Upload Queries CSV
            </label>
            <FileUploaderBox
              handleFileUpload={handleFileUpload}
              isUploading={isUploadingQueries}
              file={queriesFile}
              type={'queries'}
            />
            {queriesFile && (
              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="bg-blue-50 p-2 rounded-lg">
                      <FileText className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-800">{queriesFile.name}</p>
                      <p className="text-xs text-gray-500">
                        {(queriesFile.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={() => window.open(URL.createObjectURL(queriesFile))}
                      className="p-2 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFile('queries')}
                      className="p-2 text-gray-500 hover:text-red-500 transition-colors rounded-full hover:border hover:cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => downloadSampleFile('sample-queries.csv')}
              className="text-darkBlue flex items-center hover:underline hover:cursor-pointer mt-4"
              >
              <Download className="w-4 h-4 mr-1" />
              Download Sample Queries File
            </button>
          </div>
        </div>
        <div className="w-full flex justify-center mt-16">
          <Button
            text="Generate Combined CSV"
            onClick={handleGenerate}
            disabled={isGenerating || !citiesFile || !queriesFile}
            isLoading={isGenerating}
            width={48}
            height={16}
          />
        </div>
        <div>
            <label 
              htmlFor="queries-upload" 
              className="block text-sm text-gray-500 mb-2"
            >
              Upload Combined CSV
            </label>
            <FileUploaderBox
              handleFileUpload={handleFileUpload}
              isUploading={isUploadingCombined}
              file={combinedFile}
              type={'combined'}
            />
            {combinedFile && (
              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="bg-blue-50 p-2 rounded-lg">
                      <FileText className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-800">{combinedFile.name}</p>
                      <p className="text-xs text-gray-500">
                        {(combinedFile.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={() => window.open(URL.createObjectURL(combinedFile))}
                      className="p-2 text-gray-500 hover:text-accentBlue hover:cursor-pointer transition-colors rounded-full hover:border"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFile('combined')}
                      className="p-2 text-gray-500 hover:text-red-500 transition-colors rounded-full hover:border hover:cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="w-full flex justify-center mt-16">
            <Button
              text="Run Serper Queries"
              onClick={handleGenerate}
              disabled={isGenerating || !combinedFile}
              isLoading={isGenerating}
              width={48}
              height={16}
            />
        </div>
      </div>
    </div>
  );
}