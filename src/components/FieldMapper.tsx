import { useState, useEffect } from 'react';
import { Check, AlertCircle } from 'lucide-react';

interface FieldMapperProps {
  csvHeaders: string[];
  onConfirm: (mapping: Record<string, string>) => void;
}

const REQUIRED_FIELDS = [
  { key: 'cid', label: 'Google Maps ID (CID)', aliases: ['cid', 'place_id', 'placeid', 'google_id', 'id'] },
  { key: 'title', label: 'Company Name', aliases: ['title', 'name', 'company', 'company_name', 'business_name', 'business'] },
  { key: 'website', label: 'Website', aliases: ['website', 'url', 'site', 'web', 'website_url', 'domain'] },
];

function autoDetect(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  for (const field of REQUIRED_FIELDS) {
    const matchIndex = lowerHeaders.findIndex(h => field.aliases.includes(h));
    if (matchIndex !== -1) {
      mapping[field.key] = headers[matchIndex];
    }
  }

  return mapping;
}

export default function FieldMapper({ csvHeaders, onConfirm }: FieldMapperProps) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const detected = autoDetect(csvHeaders);
    setMapping(detected);
    setConfirmed(false);
  }, [csvHeaders]);

  const allMapped = REQUIRED_FIELDS.every(f => mapping[f.key]);

  const handleChange = (fieldKey: string, headerValue: string) => {
    setMapping(prev => ({ ...prev, [fieldKey]: headerValue }));
    setConfirmed(false);
  };

  const handleConfirm = () => {
    if (!allMapped) return;
    setConfirmed(true);
    onConfirm(mapping);
  };

  return (
    <div className={`bg-white p-5 rounded-xl border shadow-sm space-y-4 transition-colors ${
      confirmed ? 'border-green-300' : 'border-gray-200'
    }`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Map CSV Columns</h3>
        {confirmed && (
          <span className="flex items-center text-sm text-green-600">
            <Check className="w-4 h-4 mr-1" /> Confirmed
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Match your CSV columns to the required fields. We auto-detected what we could.
      </p>

      <div className="space-y-3">
        {REQUIRED_FIELDS.map(field => (
          <div key={field.key} className="flex items-center gap-3">
            <label className="w-44 text-sm text-gray-600 flex items-center">
              {field.label}
              <span className="text-red-400 ml-0.5">*</span>
            </label>
            <select
              value={mapping[field.key] || ''}
              onChange={e => handleChange(field.key, e.target.value)}
              className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                mapping[field.key] ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'
              }`}
            >
              <option value="">-- Select column --</option>
              {csvHeaders.map(header => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {!allMapped && (
        <div className="flex items-center text-xs text-amber-600 mt-2">
          <AlertCircle className="w-3.5 h-3.5 mr-1" />
          All fields must be mapped before you can continue.
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={!allMapped || confirmed}
        className={`w-full mt-2 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
          confirmed
            ? 'bg-green-600 text-white cursor-default'
            : allMapped
              ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}
      >
        {confirmed && <Check className="w-4 h-4" />}
        {confirmed ? 'Mapping Confirmed' : 'Confirm Mapping'}
      </button>
    </div>
  );
}
