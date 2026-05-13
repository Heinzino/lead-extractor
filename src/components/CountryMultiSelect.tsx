import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { COUNTRIES, countryName } from '../data/countries';

interface Props {
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
}

export default function CountryMultiSelect({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = COUNTRIES.filter(
      (c) =>
        !selectedSet.has(c.code) &&
        (q === '' ||
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().startsWith(q)),
    );
    return filtered.slice(0, 50);
  }, [query, selectedSet]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const add = (code: string) => {
    if (selectedSet.has(code)) return;
    onChange([...value, code]);
    setQuery('');
    inputRef.current?.focus();
  };

  const remove = (code: string) => {
    onChange(value.filter((c) => c !== code));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && query === '' && value.length > 0) {
      remove(value[value.length - 1]);
    } else if (e.key === 'Enter' && suggestions.length > 0) {
      e.preventDefault();
      add(suggestions[0].code);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className={`flex flex-wrap gap-1.5 px-2.5 py-2 border rounded-lg min-h-[42px] transition-all ${
          disabled
            ? 'bg-gray-50 border-gray-200 cursor-not-allowed'
            : open
              ? 'border-blue-500 ring-2 ring-blue-500'
              : 'border-gray-300 bg-white'
        }`}
        onClick={() => {
          if (disabled) return;
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        {value.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-md"
          >
            {code} — {countryName(code)}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(code);
              }}
              disabled={disabled}
              className="hover:text-blue-900 disabled:cursor-not-allowed"
              aria-label={`Remove ${code}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={
            value.length === 0
              ? 'All countries (no filter) — type to add'
              : 'Add country…'
          }
          className="flex-1 min-w-[160px] text-sm outline-none bg-transparent disabled:cursor-not-allowed"
        />
      </div>

      {open && !disabled && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 left-0 right-0 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {suggestions.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                onClick={() => add(c.code)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2"
              >
                <span className="font-mono text-xs text-gray-500 w-7">{c.code}</span>
                <span className="text-gray-800">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !disabled && suggestions.length === 0 && query.trim() !== '' && (
        <div className="absolute z-20 mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-500">
          No matches
        </div>
      )}
    </div>
  );
}
