import { useState, useCallback } from 'react';
import { Download, FileText, X, Youtube } from 'lucide-react';
import FileUploaderBox from './FileUploaderBox';
import Button from './Button';
import Toast from './Toast';
import YouTubeModal from './YouTubeModal';
import { supabase } from '../lib/supabase/supabaseClient';
import zipcodesData from '../data/zipcodes.json';


type Zipcode = { zip: string; city: string; state_id: string; state_name: string };
const zipcodes = zipcodesData as Zipcode[];

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
  const [toastType, setToastType] = useState<'error' | 'success'>('success');
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
    setToastMessage(error);
    setToastType('error');
    setShowToast(true);
  }, []);

  const downloadSampleFile = useCallback((fileName: string) => {
    const link = document.createElement('a');
    link.href = `/${fileName}`;
    link.download = fileName;
    link.click();
    setToastMessage(`Sample ${fileName} downloaded successfully`);
    setToastType('success');
    setShowToast(true);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!citiesFile && !queriesFile) {
      setToastMessage('❌ Please upload both Cities and Queries files to generate the combined CSV');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (!citiesFile) {
      setToastMessage('❌ Please upload a Cities file to generate the combined CSV');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (!queriesFile) {
      setToastMessage('❌ Please upload a Queries file to generate the combined CSV');
      setToastType('error');
      setShowToast(true);
      return;
    }

    setIsGeneratingCombined(true);
    try {
      const citiesText = await citiesFile.text();
      const queriesText = await queriesFile.text();

      
      const cleanText = (text: string, preserveQuotes = false): string => {
        let cleaned = text.trim();
        if (!preserveQuotes) {
          cleaned = cleaned.replace(/^["']|["']$/g, '');
        }
        return cleaned.replace(/\s+/g, ' ').trim();
      };

      const hasMeaningfulContent = (text: string): boolean => {
        const lettersOnly = text.replace(/[^a-zA-Z\s]/g, '');
        return lettersOnly.length > 0;
      };

      
      const cities = citiesText
        .split('\n')
        .slice(1) 
        .filter(line => line.trim())
        .map(line => {
          const parts = line.match(/(?:[^,"]|"[^"]*")+/g) || [];
          const city = cleanText(parts[0] || '', true);
          const state = cleanText(parts[1] || '', true);
          return { city, state };
        })
        .filter(({ city, state }) => 
          city && state && hasMeaningfulContent(city) && hasMeaningfulContent(state)
        );

      
      const queryLines = queriesText.split('\n');
      const queries = queryLines
        .slice(1)
        .map(line => {
          const parts = line.split(',').map(part => part.trim()).filter(part => part);
          if (parts.length === 0) return null;
          
          let query = parts[0];
          
          query = query.replace(/^["']|["']$/g, '').trim();
          
          return query ? query : null;
        })
        .filter((query): query is string => Boolean(query && hasMeaningfulContent(query)));
      
      console.log('Processed queries:', queries);

      if (cities.length === 0 || queries.length === 0) {
        setToastMessage('No valid cities or queries found after filtering.');
        setToastType('error');
        setShowToast(true);
        setIsGeneratingCombined(false);
        return;
      }

      const combinedRows = [];
      for (const { city, state } of cities) {
        
        const zipCodes = zipcodes.filter(z =>
          z.city.toLowerCase() === city.toLowerCase() &&
          (z.state_id.toLowerCase() === state.toLowerCase() || z.state_name.toLowerCase() === state.toLowerCase())
        );

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

      if (combinedRows.length === 0) {
        setToastMessage('No valid combinations found. Please check your city and state names.');
        setToastType('error');
        setShowToast(true);
        setIsGeneratingCombined(false);
        return;
      }

      const formatCsvRow = (row: { query: string; city: string; state: string; zip: string }): string => {
        const escapeCsv = (field: string): string => {
          if (field.includes(',') || field.includes('"') || field.includes('\n')) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        };

        // Clean fields while preserving leading zeros in zipcodes
        const cleanField = (field: string, isZipcode: boolean = false): string => {
          if (isZipcode) {
            // Remove quotes but don't trim whitespace to preserve leading zeros
            return field.replace(/^["']|["']$/g, '');
          }
          return field.replace(/^["']|["']$/g, '').trim();
        };

        const cleanedQuery = cleanField(row.query);
        const cleanedCity = cleanField(row.city);
        const cleanedState = cleanField(row.state);
        const cleanedZip = cleanField(row.zip, true); // Preserve leading zeros for zip

        return [
          escapeCsv(cleanedQuery),
          escapeCsv(cleanedCity),
          escapeCsv(cleanedState),
          escapeCsv(cleanedZip)
        ].join(',');
      };

      const csvHeader = 'query,city,state,zip\n';
      const csvRows = combinedRows.map(row => formatCsvRow(row)).join('\n');
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
    if (!combinedFile && !fileName) {
      setToastMessage('❌ Please upload a combined CSV file and enter a file name to run queries');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (!combinedFile) {
      setToastMessage('❌ Please upload a combined CSV file to run queries');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (!fileName) {
      setToastMessage('❌ Please enter a name for your file to run queries');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (!fileName.match(/^[a-zA-Z0-9-_]+$/)) {
      setToastMessage('File name can only contain letters, numbers, hyphens, and underscores');
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
        })
        .filter(row => row.query && row.city && row.state && row.zip);
     

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
      setToastMessage('Cities file removed successfully');
      setToastType('success');
      setShowToast(true);
    } else if (type === 'combined') {
      setCombinedFile(null);
      setToastMessage('Combined file removed successfully');
      setToastType('success');
      setShowToast(true);
    } else {
      setQueriesFile(null);
      setToastMessage('Queries file removed successfully');
      setToastType('success');
      setShowToast(true);
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
            isLoading={isRunningSerper}
            width={48}
            height={16}
          />
        </div>
      </div>
    </div>
  );
}