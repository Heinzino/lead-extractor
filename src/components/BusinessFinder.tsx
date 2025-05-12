import { useState, useCallback } from 'react';
import { Download, FileText, X, Youtube } from 'lucide-react';
import FileUploaderBox from './FileUploaderBox';
import Button from './Button';
import Toast from './Toast';
import YouTubeModal from './YouTubeModal';
import { supabase } from '../lib/supabase/supabaseClient';

export default function BusinessFinder() {
  const [citiesFile, setCitiesFile] = useState<File | null>(null);
  const [queriesFile, setQueriesFile] = useState<File | null>(null);
  const [combinedFile, setCombinedFile] = useState<File | null>(null);
  const [isUploadingCities, setIsUploadingCities] = useState(false);
  const [isUploadingQueries, setIsUploadingQueries] = useState(false);
  const [isUploadingCombined, setIsUploadingCombined] = useState(false);
  const [isGeneratingCombined, setIsGeneratingCombined] = useState(false);
  const [isRunningSerper, setIsRunningSerper] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<"success" | "error" | "warning">('success');
  const [hasUploadError, setHasUploadError] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [fileName, setFileName] = useState('');

  const handleFileUpload = useCallback((file: File, type: 'cities' | 'queries' | 'businesses' | 'combined') => {
    if (!file.name.endsWith('.csv')) {
      setToastMessage('Please upload a CSV file');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (type === 'cities') {
      setIsUploadingCities(true);
      setCitiesFile(file);
      setIsUploadingCities(false);
      setToastMessage('Cities file uploaded successfully');
      setToastType('success');
      setShowToast(true);
    } else if (type === 'combined') {
      setIsUploadingCombined(true);
      setCombinedFile(file);
      setIsUploadingCombined(false);
      setToastMessage('Combined CSV file uploaded successfully');
      setToastType('success');
      setShowToast(true);
    } else if (type === 'queries') {
      setIsUploadingQueries(true);
      setQueriesFile(file);
      setIsUploadingQueries(false);
      setToastMessage('Queries file uploaded successfully');
      setToastType('success');
      setShowToast(true);
    }
  }, []);

  const handleValidationError = useCallback((error: string) => {
    setHasUploadError(true);
    setToastMessage(error);
    setToastType('error');
    setShowToast(true);
  }, []);

  const downloadSampleFile = useCallback((fileName: string) => {
    const link = document.createElement('a');
    link.href = `/${fileName}`;
    link.download = fileName;
    link.click();
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!citiesFile || !queriesFile) {
      setToastMessage('Please upload both Cities and Queries files');
      setToastType('error');
      setShowToast(true);
      return;
    }

    setIsGeneratingCombined(true);
    try {
      const citiesText = await citiesFile.text();
      const queriesText = await queriesFile.text();

      const cities = citiesText
        .split('\n')
        .slice(1)
        .filter(line => line.trim())
        .map(line => {
          const [city, state] = line.split(',').map(s => s.trim());
          return { city, state };
        });

      const queries = queriesText
        .split('\n')
        .slice(1)
        .filter(line => line.trim())
        .map(line => line.trim());

     
      const combinedRows = [];
      for (const { city, state } of cities) {
        const { data: zipCodes, error } = await supabase
          .from('zip_codes')
          .select('zip')
          .eq('city', city)
          .or(`state_id.eq.${state},state_name.eq.${state}`);

        if (error) {
          throw new Error(`Error fetching zip codes: ${error.message}`);
        }

        if (!zipCodes || zipCodes.length === 0) {
          console.warn(`No zip codes found for city: ${city}, state: ${state}`);
          continue;
        }

        for (const query of queries) {
          for (const { zip } of zipCodes) {
            combinedRows.push({
              query,
              city,
              state,
              zip
            });
          }
        }
      }

     
      const csvHeader = 'query,city,state,zip\n';
      const csvRows = combinedRows.map(row => 
        `${row.query},${row.city},${row.state},${row.zip}`
      ).join('\n');
      const csvContent = csvHeader + csvRows;

     
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'combined_queries.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setToastMessage('Combined CSV generated successfully');
      setToastType('success');
      setShowToast(true);
    } catch (error) {
      console.error('Error generating CSV:', error);
      setToastMessage(error instanceof Error ? error.message : 'Error generating CSV');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsGeneratingCombined(false);
    }
  }, [citiesFile, queriesFile]);

  const handleSerperQueries = useCallback(async () => {
    if (!combinedFile) {
      setToastMessage('Please upload the combined CSV file');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (!fileName) {
      setToastMessage('Please enter a name for your file');
      setToastType('error');
      setShowToast(true);
      return;
    }

    setIsRunningSerper(true);
    let resultId: string | null = null;
    
    try {      
      const combinedText = await combinedFile.text();      
      const rows = combinedText
        .split('\n')
        .slice(1)
        .filter(line => line.trim())
        .map(line => {
          const [query, city, state, zip] = line.split(',').map(s => s.trim());
          return { query, city, state, zip };
        });
     

      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        throw new Error('User not authenticated');
      }

      const { data: result, error: createError } = await supabase
        .from('serper_results')
        .insert({
          user_id: user.user.id,
          file_name: fileName,
          status: 'RUNNING'
        })
        .select('id')
        .single();

      if (createError) {
        throw new Error(`Error creating result record: ${createError.message}`);
      }

      resultId = result.id;

      const response = await fetch('/api/serper/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          resultId,
          rows
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error starting background processing');
      }

      window.location.href = '/?page=Results&status=processing';
    } catch (error) {
      console.error('Error starting Serper queries:', error);
      

      if (resultId) {
        await supabase
          .from('serper_results')
          .update({
            status: 'ERROR',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString()
          })
          .eq('id', resultId);
      }

      setToastMessage(error instanceof Error ? error.message : 'Error starting Serper queries');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsRunningSerper(false);
    }
  }, [combinedFile, fileName]);

  const closeToast = useCallback(() => {
    setShowToast(false);
  }, []);

  const removeFile = useCallback((type: 'cities' | 'queries' | 'combined') => {
    if (type === 'cities') {
      setCitiesFile(null);
    } else if (type === 'combined') {
      setCombinedFile(null);
    } else {
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
        <div className="flex flex-col mb-2">
          <h1 className="text-3xl font-bold">Business Finder</h1>
          <button
            onClick={() => setIsTutorialOpen(true)}
            className="flex items-center text-blue-600 hover:text-blue-800 transition-colors mt-2 w-fit hover:cursor-pointer"
          >
            <Youtube className="w-5 h-5 mr-1" />
            <span className="underline">Tutorial</span>
          </button>
        </div>
        <p className="text-gray-500">
          Upload two CSV files: one with cities and one with queries. We&apos;ll combine them into a single CSV.
        </p>
      </div>

      <YouTubeModal
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
        videoId="ZEFLcPjxw6w"
      />

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
              onValidationError={handleValidationError}
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
              onValidationError={handleValidationError}
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
            disabled={isGeneratingCombined || !citiesFile || !queriesFile}
            isLoading={isGeneratingCombined}
            width={48}
            height={16}
          />
        </div>
        <div>
          <label 
            htmlFor="combined-upload" 
            className="block text-sm text-gray-500 mb-2"
          >
            Upload Combined CSV
          </label>
          <FileUploaderBox
            handleFileUpload={handleFileUpload}
            isUploading={isUploadingCombined}
            file={combinedFile}
            type={'combined'}
            onValidationError={handleValidationError}
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
        <div className="space-y-6">
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
              placeholder="my-business-list"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>
        </div>
        <div className="w-full flex flex-col items-center mt-16">
          <Button
            text="Run Serper Queries"
            onClick={handleSerperQueries}
            disabled={isRunningSerper || !combinedFile || hasUploadError}
            isLoading={isRunningSerper}
            width={48}
            height={16}
          />
        </div>
      </div>
    </div>
  );
}