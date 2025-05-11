import Spinner from './Spinner';
import { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';

interface FileValidationError {
  message: string;
  isValid: false;
}

interface FileValidationSuccess {
  isValid: true;
}

type FileValidationResult = FileValidationError | FileValidationSuccess;

export default function FileUploaderBox({
  handleFileUpload, 
  isUploading, 
  file, 
  type,
  onValidationError
}: {
  handleFileUpload: (file: File, type: 'cities' | 'queries' | 'businesses' | 'combined') => void, 
  isUploading: boolean, 
  file: File | null, 
  type: 'cities' | 'queries' | 'businesses' | 'combined',
  onValidationError: (error: string) => void
}) {
    const [isDragging, setIsDragging] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    const validateFile = async (file: File): Promise<FileValidationResult> => {
      try {
        const text = await file.text();
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          return {
            isValid: false,
            message: 'File must contain at least a header and one data row'
          };
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        switch(type) {
          case 'cities':
            if (!headers.includes('city') || !headers.includes('state')) {
              return {
                isValid: false,
                message: 'File must contain "city" and "state" columns'
              };
            }
            break;
          case 'queries':
            if (!headers.includes('query')) {
              return {
                isValid: false,
                message: 'File must contain a "query" column'
              };
            }
            break;
          case 'combined':
            if (!headers.includes('query') || !headers.includes('city') || 
                !headers.includes('state') || !headers.includes('zip')) {
              return {
                isValid: false,
                message: 'File must contain "query", "city", "state", and "zip" columns'
              };
            }
            break;
          case 'businesses':
            if (!headers.includes('company') || !headers.includes('website')) {
              return {
                isValid: false,
                message: 'File must contain "company" and "website" columns'
              };
            }
            break;
        }

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values.some(v => !v)) {
            return {
              isValid: false,
              message: `Row ${i} contains empty values`
            };
          }
        }

        return { isValid: true };
      } catch (error) {
        return {
          isValid: false,
          message: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
      }
    };

    const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          const file = e.dataTransfer.files[0];
          const validation = await validateFile(file);
          if (validation.isValid) {
            setValidationError(null);
            handleFileUpload(file, type);
          } else {
            setValidationError(validation.message);
            onValidationError(validation.message);
          }
        }
      }, [handleFileUpload, type, onValidationError]);
    
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
    
    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const validation = await validateFile(file);
          if (validation.isValid) {
            setValidationError(null);
            handleFileUpload(file, type);
          } else {
            setValidationError(validation.message);
            onValidationError(validation.message);
          }
        }
      }, [handleFileUpload, type, onValidationError]);

    const getTitle = () => {
      switch(type) {
        case 'cities': return 'CITIES';
        case 'queries': return 'QUERIES';
        case 'combined': return 'COMBINED CSV';
        case 'businesses': return 'COMPANIES AND WEBSITES';
        default: return '';
      }
    };

    return (
        <div
        className={`
          relative border-2 border-dashed rounded-xl p-18
          flex flex-col items-center justify-center text-center
          cursor-pointer bg-gray-200 hover:bg-gray-100 transition-all duration-200
          ${isDragging ? 'border-blue-400 bg-blue-50' : ''}
          ${validationError ? 'border-red-400 bg-red-50' : file ? 'border-green-400 bg-green-50' : 'border-gray-300'}
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
            <p className="text-2xl font-bold mb-4">{getTitle()}</p>
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
            {validationError && (
              <p className="text-sm text-red-500 mt-2">
                {validationError}
              </p>
            )}
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