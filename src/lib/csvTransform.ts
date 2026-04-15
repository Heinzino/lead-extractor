import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Frontend-only base name for the synthesized full-name column we add to the
// CSV when the user maps First Name + Last Name instead of Full Name. We try
// this name first; if it already exists in the user's headers we suffix it.
export const SYNTHETIC_FULL_NAME_BASE = 'Full Name';

export type TransformResult = {
  file: File;
  fieldMapping: Record<string, string>;
};

/**
 * Normalize a website URL or domain string to a bare host.
 *
 * Mirrors normalize_domain in
 * opensearch/src/matching-engine/helpers.py:56-72:
 *   - Strips whitespace, lowercases.
 *   - Prepends http:// if no scheme so URL parsing works on bare domains.
 *   - Returns the host with leading "www." stripped.
 *   - Returns "" for empty input, parse failures, or anything that resolves
 *     to "linkedin.com" (LinkedIn employees aren't enrichment targets).
 *
 * Examples:
 *   "http://www.aramark.com"      → "aramark.com"
 *   "https://acme.com/path?q=1"   → "acme.com"
 *   "acme.com"                    → "acme.com"   (idempotent)
 *   "www.acme.com"                → "acme.com"
 *   "linkedin.com"                → ""
 *   ""                            → ""
 *   "not a url"                   → ""
 */
export function normalizeDomain(input: string): string {
  if (typeof input !== 'string' || !input.trim()) return '';
  let url = input.trim().toLowerCase();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return '';
  }
  if (host.startsWith('www.')) host = host.slice(4);
  if (host === 'linkedin.com') return '';
  return host;
}

/**
 * Transform a Contact Finder CSV before upload to S3:
 *
 *   1. If the user mapped first_name + last_name (instead of person_name),
 *      append a synthesized "Full Name" column and rewrite
 *      field_mapping.person_name to point at it. The frontend-only
 *      first_name/last_name keys are stripped from the mapping.
 *
 *   2. If the user mapped matched_company_domain (enrich-only mode),
 *      append a synthesized "{domainCol} (normalized)" column and rewrite
 *      field_mapping.matched_company_domain to point at it. Email enrichment
 *      (Findymail + Wiza name+domain) reads matched_company_domain directly.
 *
 *   3. If the user mapped website (match_and_enrich mode), append a
 *      synthesized "{websiteCol} (normalized)" column and add a NEW mapping
 *      key user_company_domain pointing at it. field_mapping.website is left
 *      unchanged — the matching engine still uses the raw column for its
 *      stage-0 domain query (it runs its own normalize_domain). Email
 *      enrichment prefers user_company_domain over matched_company_domain
 *      (LinkedIn-side) so emails go to the user's target domain.
 *
 * All transforms are append-only: the user's original columns retain their
 * original names, positions, AND values. field_mapping is updated to point
 * at the synthesized column for whichever canonical key consumes it.
 *
 * If no transformation applies, returns the original file unchanged
 * (just strips any leftover frontend-only keys from the mapping).
 *
 * Uses csv-parse / csv-stringify (already installed) to handle BOM, CRLF,
 * quoted fields with embedded commas, and ragged rows.
 */
export async function transformEnrichmentCsv(
  originalFile: File,
  mapping: Record<string, string>,
): Promise<TransformResult> {
  const { first_name: firstCol, last_name: lastCol, ...rest } = mapping;
  const domainCol = rest.matched_company_domain || '';
  const websiteCol = rest.website || '';
  const needsName = Boolean(firstCol && lastCol);
  const needsDomain = Boolean(domainCol);
  const needsWebsite = Boolean(websiteCol);

  // Nothing to do — return the original file with frontend-only keys
  // stripped from the mapping.
  if (!needsName && !needsDomain && !needsWebsite) {
    return { file: originalFile, fieldMapping: rest };
  }

  const text = await originalFile.text();
  const rows: string[][] = parse(text, {
    bom: true,
    columns: false,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: false,
    trim: false,
  });

  if (rows.length === 0) {
    throw new Error('CSV appears to be empty');
  }

  let headers = rows[0];
  let newMapping: Record<string, string> = { ...rest };

  // --- Domain normalization (append a new column; leave user's column intact) ---
  if (needsDomain) {
    const domainIdx = headers.indexOf(domainCol);
    if (domainIdx === -1) {
      throw new Error(`Could not find ${domainCol} column in CSV`);
    }

    // Pick a non-colliding header name. Prefer "{domainCol} (normalized)".
    let normalizedCol = `${domainCol} (normalized)`;
    let suffix = 0;
    const existing = new Set(headers);
    while (existing.has(normalizedCol)) {
      suffix += 1;
      normalizedCol = `${domainCol} (normalized ${suffix})`;
    }

    headers = [...headers, normalizedCol];
    rows[0] = headers;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const raw = domainIdx < row.length ? (row[domainIdx] ?? '') : '';
      rows[i] = [...row, normalizeDomain(raw)];
    }

    newMapping = { ...newMapping, matched_company_domain: normalizedCol };
  }

  // --- Website normalization for match_and_enrich (append a new column;
  //     leave user's website column intact so matching-engine's stage-0
  //     query still sees the raw value). Adds a NEW mapping key
  //     user_company_domain — email enrichment prefers it over the
  //     LinkedIn-side matched_company_domain. ---
  if (needsWebsite) {
    const websiteIdx = headers.indexOf(websiteCol);
    if (websiteIdx === -1) {
      throw new Error(`Could not find ${websiteCol} column in CSV`);
    }

    let normalizedCol = `${websiteCol} (normalized)`;
    let suffix = 0;
    const existing = new Set(headers);
    while (existing.has(normalizedCol)) {
      suffix += 1;
      normalizedCol = `${websiteCol} (normalized ${suffix})`;
    }

    headers = [...headers, normalizedCol];
    rows[0] = headers;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const raw = websiteIdx < row.length ? (row[websiteIdx] ?? '') : '';
      rows[i] = [...row, normalizeDomain(raw)];
    }

    newMapping = { ...newMapping, user_company_domain: normalizedCol };
  }

  // --- Name synthesis (append a new column) ---
  if (needsName) {
    const firstIdx = headers.indexOf(firstCol);
    const lastIdx = headers.indexOf(lastCol);
    if (firstIdx === -1 || lastIdx === -1) {
      throw new Error('Could not find first/last name columns in CSV');
    }

    // Pick a non-colliding header name. Prefer "Full Name", fall back to
    // suffixed variants if it's already used.
    let syntheticCol = SYNTHETIC_FULL_NAME_BASE;
    let suffix = 0;
    const existing = new Set(headers);
    while (existing.has(syntheticCol)) {
      suffix += 1;
      syntheticCol = `${SYNTHETIC_FULL_NAME_BASE} (${suffix})`;
    }

    headers = [...headers, syntheticCol];
    rows[0] = headers;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const first = (row[firstIdx] ?? '').trim();
      const last = (row[lastIdx] ?? '').trim();
      const full = [first, last].filter(Boolean).join(' ');
      rows[i] = [...row, full];
    }

    newMapping = { ...newMapping, person_name: syntheticCol };
  }

  const csv = stringify(rows, {
    quoted_string: true,
    record_delimiter: '\n',
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const newFile = new File([blob], originalFile.name, { type: 'text/csv' });

  return { file: newFile, fieldMapping: newMapping };
}
