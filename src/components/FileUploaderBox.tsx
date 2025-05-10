import Spinner from './Spinner';
import { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';


export default function FileUploaderBox({handleFileUpload, isUploading, file, type}: {handleFileUpload: (file: File, type: 'cities' | 'queries' | 'businesses' | 'combined') => void, isUploading: boolean, file: File | null, type: 'cities' | 'queries' | 'businesses' | 'combined'}) {
    const [isDragging, setIsDragging] = useState(false);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFileUpload(e.dataTransfer.files[0], type);
        }
      }, [handleFileUpload, type]);
    
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
          handleFileUpload(e.target.files[0], type);
        }
      }, [handleFileUpload, type]);

    return (
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
        onClick={() => document?.getElementById(`file-upload-${type}`)?.click()}
      >
        {isUploading ? (
          <div className="py-4">
            <Spinner />
            <p className="mt-3 text-sm text-blue-600">Uploading...</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-full p-3 mb-4">
              <Upload 
                className="w-10 h-10 text-accentBlue" 
                strokeWidth={1.5}
              />
            </div>
            <p className="text-sm text-gray-500 mb-1">
              {isDragging ? 'Drop your CSV file here' : 'Drag and drop your CSV file here'}
            </p>
            <p className="text-xs text-gray-500">
              or click to browse files
            </p>
          </>
        )}
        <input
          id={`file-upload-${type}`}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />
      </div>
    )
}