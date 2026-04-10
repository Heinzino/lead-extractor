import { useState, useEffect, useMemo } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { FieldConfig } from '../lib/fieldConfigs';

export type FieldMapperValidationMode = 'all-required' | 'enrichment-combo';

// Active name-input form for the enrichment-combo mode. 'full' uses the
// person_name column; 'split' uses first_name + last_name columns (which
// the frontend later concatenates into a synthesized full-name column).
type NameFormat = 'full' | 'split';

interface FieldMapperProps {
  csvHeaders: string[];
  requiredFields: FieldConfig[];
  validationMode: FieldMapperValidationMode;
  helperText?: string;
  onConfirm: (mapping: Record<string, string>) => void;
}

function autoDetect(headers: string[], fields: FieldConfig[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  for (const field of fields) {
    const matchIndex = lowerHeaders.findIndex(h => field.aliases.includes(h));
    if (matchIndex !== -1) {
      mapping[field.key] = headers[matchIndex];
    }
  }

  return mapping;
}

export default function FieldMapper({
  csvHeaders,
  requiredFields,
  validationMode,
  helperText,
  onConfirm,
}: FieldMapperProps) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [nameFormat, setNameFormat] = useState<NameFormat>('full');

  const isEnrichmentMode = validationMode === 'enrichment-combo';

  // Re-run auto-detect whenever the headers or the field set changes (the
  // field set changes when the parent flips between matching and enrichment
  // modes, which clears `csvHeaders` first — so this normally fires once per
  // upload). For enrichment mode we also pick the initial name format based
  // on which name columns the CSV happens to have.
  useEffect(() => {
    const detected = autoDetect(csvHeaders, requiredFields);
    setMapping(detected);
    setConfirmed(false);
    if (validationMode === 'enrichment-combo') {
      if (detected.person_name) {
        setNameFormat('full');
      } else if (detected.first_name && detected.last_name) {
        setNameFormat('split');
      } else {
        setNameFormat('full');
      }
    }
  }, [csvHeaders, requiredFields, validationMode]);

  // Filter rendered fields based on the active name format. Only person_name
  // shows in 'full' mode; first_name/last_name show in 'split' mode. The
  // other fields (linkedin_url, matched_company_domain) always show.
  const visibleFields = useMemo(() => {
    if (!isEnrichmentMode) return requiredFields;
    return requiredFields.filter(f => {
      if (f.key === 'person_name') return nameFormat === 'full';
      if (f.key === 'first_name' || f.key === 'last_name') return nameFormat === 'split';
      return true;
    });
  }, [requiredFields, isEnrichmentMode, nameFormat]);

  const allMapped = useMemo(() => {
    if (isEnrichmentMode) {
      const hasLinkedIn = Boolean(mapping.linkedin_url);
      const hasDomain = Boolean(mapping.matched_company_domain);
      const hasName =
        nameFormat === 'full'
          ? Boolean(mapping.person_name)
          : Boolean(mapping.first_name) && Boolean(mapping.last_name);
      return hasLinkedIn || (hasName && hasDomain);
    }
    return requiredFields.every(f => mapping[f.key]);
  }, [mapping, requiredFields, isEnrichmentMode, nameFormat]);

  const handleChange = (fieldKey: string, headerValue: string) => {
    setMapping(prev => ({ ...prev, [fieldKey]: headerValue }));
    setConfirmed(false);
  };

  // Switching the name format clears the inactive form's mapping keys so the
  // confirmed mapping always reflects only the active form. The parent never
  // sees both `person_name` AND `first_name`/`last_name` at once.
  const handleNameFormatChange = (next: NameFormat) => {
    if (next === nameFormat) return;
    setNameFormat(next);
    setConfirmed(false);
    setMapping(prev => {
      const copy = { ...prev };
      if (next === 'full') {
        delete copy.first_name;
        delete copy.last_name;
      } else {
        delete copy.person_name;
      }
      return copy;
    });
  };

  const handleConfirm = () => {
    if (!allMapped) return;
    setConfirmed(true);
    onConfirm(mapping);
  };

  // Per-field "good" indicator. In matching mode this is just "is mapped".
  // In enrichment mode it's "is part of a satisfied combo" — once the user
  // satisfies the rule, all participating fields render green so the visual
  // matches "you're done."
  const isFieldGood = (fieldKey: string): boolean => {
    if (!isEnrichmentMode) return Boolean(mapping[fieldKey]);
    if (!allMapped) return Boolean(mapping[fieldKey]);

    // Combo satisfied — highlight whichever fields actually participate.
    if (mapping.linkedin_url && fieldKey === 'linkedin_url') return true;

    const hasDomain = Boolean(mapping.matched_company_domain);
    const hasName =
      nameFormat === 'full'
        ? Boolean(mapping.person_name)
        : Boolean(mapping.first_name) && Boolean(mapping.last_name);

    if (hasDomain && hasName && fieldKey === 'matched_company_domain') return true;
    if (nameFormat === 'full' && hasDomain && hasName && fieldKey === 'person_name') return true;
    if (
      nameFormat === 'split' &&
      hasDomain &&
      hasName &&
      (fieldKey === 'first_name' || fieldKey === 'last_name')
    ) {
      return true;
    }
    return Boolean(mapping[fieldKey]);
  };

  return (
    <div
      className={`bg-white p-5 rounded-xl border shadow-sm space-y-4 transition-colors ${
        confirmed ? 'border-green-300' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Map CSV Columns</h3>
        {confirmed && (
          <span className="flex items-center text-sm text-green-600">
            <Check className="w-4 h-4 mr-1" /> Confirmed
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">
        {helperText ?? 'Match your CSV columns to the required fields. We auto-detected what we could.'}
      </p>

      {isEnrichmentMode && (
        <div className="flex items-center gap-3">
          <span className="w-44 text-sm text-gray-600">Name format</span>
          <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-gray-50">
            <button
              type="button"
              onClick={() => handleNameFormatChange('full')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:cursor-pointer ${
                nameFormat === 'full'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Full Name
            </button>
            <button
              type="button"
              onClick={() => handleNameFormatChange('split')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:cursor-pointer ${
                nameFormat === 'split'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              First + Last
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visibleFields.map(field => {
          const good = isFieldGood(field.key);
          return (
            <div key={field.key} className="flex items-center gap-3">
              <label className="w-44 text-sm text-gray-600 flex items-center">
                {field.label}
                {!isEnrichmentMode && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              <select
                value={mapping[field.key] || ''}
                onChange={e => handleChange(field.key, e.target.value)}
                className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  good
                    ? 'border-green-300 bg-green-50'
                    : isEnrichmentMode
                      ? 'border-gray-300 bg-white'
                      : 'border-red-300 bg-red-50'
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
          );
        })}
      </div>

      {!allMapped && (
        <div className="flex items-center text-xs text-amber-600 mt-2">
          <AlertCircle className="w-3.5 h-3.5 mr-1" />
          {isEnrichmentMode
            ? 'Map LinkedIn URL, OR map Company Domain together with a name (Full Name, or First Name + Last Name).'
            : 'All fields must be mapped before you can continue.'}
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
