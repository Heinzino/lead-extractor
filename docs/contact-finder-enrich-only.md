# Contact Finder — Standalone Email Enrichment (Phase 4E frontend)

> **Date:** 2026-04-10
> **Backend ref:** `opensearch/specs/04-api/step-functions.md` Phase 4E, `opensearch/specs/04B-enrichment/csv-to-ddb-enrich.md`, `opensearch/ARCHITECTURE.md` §18.11
> **Status:** Spec-only — source code edits deferred to the next developer per the project's docs-only rule.

---

## What we're building

A second tab in the Contact Finder page that lets users upload a CSV of **already-resolved people** (any combination of LinkedIn URL / Full Name / Company Domain) and run the 4-stage Findymail+Wiza email-enrichment waterfall on it directly — **skipping** the LinkedIn ⇄ GMaps matching step entirely.

```
┌───────────────────────────────────────────────┐
│  Contact Finder                               │
├───────────────────────────────────────────────┤
│  [ Find Contacts ] [ Email Enrichment ]  ←── 2 tabs (NEW)
│  ─────────────────                            │
│                                               │
│  Upload CSV File              [Sample File]   │
│  ┌─────────────────────────────────────────┐  │
│  │       Drop CSV here                     │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  Map CSV Columns                              │
│  ┌─────────────────────────────────────────┐  │
│  │ LinkedIn URL    [LinkedIn URL  ▾]       │  │
│  │ Full Name       [Name           ▾]      │  │
│  │ Company Domain  [Domain         ▾]      │  │
│  │                                         │  │
│  │ Map LinkedIn URL OR (Name + Domain).    │  │
│  │ Mapping all three gets the best results.│  │
│  │                                         │  │
│  │           [ Confirm Mapping ]           │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  All rows will be processed through the       │
│  Findymail + Wiza waterfall (Stages 1-4       │
│  where data permits).                         │
│                                               │
│  File name: [my-enriched-list]                │
│                                               │
│              [    Enrich    ]                 │
└───────────────────────────────────────────────┘
```

The "Find Contacts" tab is the **existing** Contact Finder behavior unchanged. Only the new "Email Enrichment" tab is new.

---

## Architecture context (so you know why this is designed this way)

The backend `enrichment-orchestrator` state machine has two entry paths:

1. **Matching-chained** (existing): the parent `batch-orchestrator` SM runs the matching engine first and then nests an execution into `enrichment-orchestrator`. The frontend hits this path with a normal `POST /batches` (no `mode` field).
2. **Standalone enrichment-only** (Phase 4E): the `batch-submit` Lambda dispatches **directly** to `enrichment-orchestrator` if the request body sets `mode: "enrich_only"`. The new state machine top is a `Choice` state that routes the standalone path through `PreloadFromCSV` (a new Lambda that streams the user's CSV from S3 into DynamoDB `match_results`) and `SetStatusEnrichingStandalone` (DDB write of `total_to_enrich` and `rows_unresolvable`) before joining the existing `PrepareStage1` state.

The frontend's contract with the backend is one new optional field on `POST /batches`:

```ts
{
  batch_id: string,
  csv_s3_key: string,
  mode: 'match_and_enrich' | 'enrich_only',  // NEW — default 'match_and_enrich'
  field_mapping: { ... },                    // NEW for enrich_only: linkedin_url, person_name, matched_company_domain
  // matching path only (forbidden when mode=enrich_only):
  job_titles?: string,
  enrich_emails?: boolean,
}
```

Per-row eligibility (`bool(linkedin_url) OR (bool(person_name) AND bool(matched_company_domain))`) is enforced **in the preload Lambda**, not in the FieldMapper. The user sees per-stage skip counts in the Results UI when stages can't process partial rows. Unresolvable rows (neither LinkedIn nor Name+Domain) are dropped at preload time and surfaced as `enrichment.rows_unresolvable` in the API status response.

Backend documents the full contract here: `opensearch/specs/04-api/step-functions.md` Phase 4E.

---

## File changes

### Summary table

| File | Change | Status |
|---|---|---|
| `src/lib/fieldConfigs.ts` | **NEW** — exports `MATCHING_FIELDS` + `ENRICHMENT_FIELDS` configs | Spec-only |
| `src/components/FieldMapper.tsx` | Refactor — accept `requiredFields` + `validationMode` props instead of importing constant | Spec-only |
| `src/components/ContactFinder.tsx` | Add `mode` state + tab UI + branch FieldMapper props + branch `handleSubmit` payload + reset state on tab switch | Spec-only |
| `public/sample-cf-enrich-input.csv` | **NEW** — sample CSV demonstrating per-row optional fields | Spec-only |
| `src/components/Results.tsx` | (1) Per-stage skip-bucket display, (2) hide matching section for `enrich_only`, (3) `rows_unresolvable` line, (4) extend `EnrichResult` and `BatchStatus.enrichment` types | Spec-only |
| `src/types/supabase.ts` | Regenerate after Supabase migration to include new `mode` column | Spec-only |
| Supabase: `enrich_results` table | Add `mode` column with `match_and_enrich` default | Spec-only — one-line `ALTER TABLE` |
| `src/app/api/matching/route.ts` | **No change** — existing proxy passes body through verbatim, including the new `mode` field | — |

### Code-shape touchpoints (current → desired)

**Current `FieldMapper.tsx`** (`src/components/FieldMapper.tsx:9-12`):

```ts
const REQUIRED_FIELDS = [
  { key: 'title',   label: 'Company Name', aliases: ['title','name','company','company_name','business_name','business'] },
  { key: 'website', label: 'Website',      aliases: ['website','url','site','web','website_url','domain'] },
];
```

Hardcoded; both fields required; auto-detect uses `aliases`. The component imports nothing from a config file. To support the second mode, the constant needs to become a prop and the validation logic needs to be parameterized.

**Current `ContactFinder.tsx`** (`src/components/ContactFinder.tsx:100-160`):

The submit handler unconditionally requires `jobTitles`, sends `enrich_emails` based on a checkbox, and inserts a Supabase row with no `mode` field. The component holds a single set of state (no concept of a tab). The FieldMapper is rendered with no props that select which field set.

**Current `Results.tsx`** (`src/components/Results.tsx:23-74`):

The `EnrichResult` type already has all the fields the new mode needs, **except** `mode`. The `BatchStatus.enrichment` type already has `EnrichmentStage[]` with `skip_buckets`/`items_skipped` per stage but **does not** have `rows_unresolvable`. The matching block render is unconditional — it shows even when totals are 0.

---

## Step-by-step implementation

### Step 1 — Supabase migration (run first, blocks everything else)

Open Supabase Studio → SQL editor and run:

```sql
ALTER TABLE enrich_results
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'match_and_enrich';
```

After running, regenerate `src/types/supabase.ts`:

```bash
npx supabase gen types typescript --project-id <YOUR_PROJECT_ID> > src/types/supabase.ts
```

(Or manually patch the type if you don't run the codegen — add `mode: string` to the `enrich_results.Row`/`Insert`/`Update` types.)

**Why first:** `Results.tsx` reads `result.mode` to drive the matching-section hide. Without the column, the type-check fails when we add the `result.mode` reference, and an existing batch row's `mode` is undefined at runtime. Setting a `DEFAULT 'match_and_enrich'` keeps existing rows valid.

### Step 2 — Create `src/lib/fieldConfigs.ts`

```ts
// src/lib/fieldConfigs.ts

export type FieldConfig = {
  key: string;
  label: string;
  aliases: string[];
};

// Existing matching-mode field set (extracted from FieldMapper.tsx as-is)
export const MATCHING_FIELDS: FieldConfig[] = [
  {
    key: 'title',
    label: 'Company Name',
    aliases: ['title', 'name', 'company', 'company_name', 'business_name', 'business'],
  },
  {
    key: 'website',
    label: 'Website',
    aliases: ['website', 'url', 'site', 'web', 'website_url', 'domain'],
  },
];

// New: enrichment-mode field set. All three optional per row, but at least
// one of (linkedin_url) OR (person_name + matched_company_domain) is needed
// per row for it to actually enrich. Eligibility is enforced in the backend
// preload Lambda — the FieldMapper just needs to require that the user
// mapped enough columns to satisfy the rule.
export const ENRICHMENT_FIELDS: FieldConfig[] = [
  {
    key: 'linkedin_url',
    label: 'LinkedIn URL',
    aliases: ['linkedin_url', 'linkedin', 'linkedin_profile', 'profile_url', 'profile'],
  },
  {
    key: 'person_name',
    label: 'Full Name',
    aliases: ['person_name', 'full_name', 'name', 'contact_name', 'first_last'],
  },
  {
    key: 'matched_company_domain',
    label: 'Company Domain',
    aliases: ['domain', 'company_domain', 'website_domain', 'email_domain'],
  },
];
```

> **Note on alias collisions.** Both lists use `domain` as an alias, but they map to different canonical keys (`website` vs `matched_company_domain`). This is fine because each list is used in a different mode, so they're never compared against the same headers at the same time. Don't try to merge them.

### Step 3 — Refactor `FieldMapper.tsx` to accept props

The component now needs to:
1. Accept the field set as a prop, not import a constant.
2. Accept a `validationMode` that determines when "Confirm" enables.
3. Optionally render helper text below the title explaining the mode rule.

**New prop signature:**

```ts
import { FieldConfig } from '../lib/fieldConfigs';

interface FieldMapperProps {
  csvHeaders: string[];
  requiredFields: FieldConfig[];
  validationMode: 'all-required' | 'enrichment-combo';
  helperText?: string;
  onConfirm: (mapping: Record<string, string>) => void;
}
```

**Validation logic:**

```ts
const enrichmentValid =
  Boolean(mapping.linkedin_url) ||
  (Boolean(mapping.person_name) && Boolean(mapping.matched_company_domain));

const allMapped =
  validationMode === 'enrichment-combo'
    ? enrichmentValid
    : requiredFields.every(f => mapping[f.key]);
```

**Auto-detect.** The existing `autoDetect` function should be moved inside the component (or kept as a module helper that takes `requiredFields` as a parameter):

```ts
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
```

Inside the component, replace `useEffect` calling `autoDetect(csvHeaders)` with `autoDetect(csvHeaders, requiredFields)`.

**Visual indicators.** In `enrichment-combo` mode, the per-row red/green border on each `<select>` should reflect "this field is part of a satisfied combo" rather than "this field is mapped". The simplest implementation:
- All three selects show green if `enrichmentValid` is true.
- All three selects show neutral (no red, no green) if `enrichmentValid` is false but the user has started mapping.
- The per-field red asterisk (`*`) is removed in `enrichment-combo` mode (none of the fields are individually required).
- The helper-text line below the title (passed via the new `helperText` prop) explains the rule:

  > "Map LinkedIn URL, OR map both Full Name and Company Domain. Mapping all three gets the best results."

Keep the existing "Confirm Mapping" button + confirmed-state border behavior.

**Render the existing matching-mode UX unchanged** when `validationMode === 'all-required'` — the per-field red asterisk, the per-field validation, and the existing helper text ("Match your CSV columns to the required fields...") all stay as-is.

### Step 4 — Add tab UI + `mode` state to `ContactFinder.tsx`

Add at the top of the component (next to other `useState` calls):

```ts
import { MATCHING_FIELDS, ENRICHMENT_FIELDS } from '../lib/fieldConfigs';

// ...inside the component:
const [mode, setMode] = useState<'match_and_enrich' | 'enrich_only'>('match_and_enrich');
```

Add a tab-switch helper that resets all upload state (otherwise the user could switch tabs with a half-mapped file from the other mode):

```ts
const switchMode = useCallback((next: 'match_and_enrich' | 'enrich_only') => {
  if (next === mode) return;
  setMode(next);
  setFile(null);
  setCsvHeaders([]);
  setFieldMapping(null);
  setJobTitles('');
  setEnrichEmails(false);
  setHasUploadError(false);
  setFileName('');
  setShowToast(false);
}, [mode]);
```

Render the tab strip just above the existing "Upload CSV File" section (line 213 of the current `ContactFinder.tsx`, inside the outer `<div className="space-y-5">`):

```tsx
<div className="flex gap-2 mb-5 border-b border-gray-200">
  <button
    type="button"
    onClick={() => switchMode('match_and_enrich')}
    className={`px-4 py-2 text-sm font-medium transition-colors ${
      mode === 'match_and_enrich'
        ? 'border-b-2 border-blue-600 text-blue-600 -mb-px'
        : 'text-gray-500 hover:text-gray-700'
    }`}
  >
    Find Contacts
  </button>
  <button
    type="button"
    onClick={() => switchMode('enrich_only')}
    className={`px-4 py-2 text-sm font-medium transition-colors ${
      mode === 'enrich_only'
        ? 'border-b-2 border-blue-600 text-blue-600 -mb-px'
        : 'text-gray-500 hover:text-gray-700'
    }`}
  >
    Email Enrichment
  </button>
</div>
```

### Step 5 — Branch the FieldMapper render and the post-mapping section

Replace the existing `FieldMapper` render block (line 276-281):

```tsx
{file && csvHeaders.length > 0 && (
  <FieldMapper
    csvHeaders={csvHeaders}
    requiredFields={mode === 'enrich_only' ? ENRICHMENT_FIELDS : MATCHING_FIELDS}
    validationMode={mode === 'enrich_only' ? 'enrichment-combo' : 'all-required'}
    helperText={
      mode === 'enrich_only'
        ? 'Map LinkedIn URL, OR map both Full Name and Company Domain. Mapping all three gets the best results.'
        : undefined
    }
    onConfirm={handleFieldMappingConfirm}
  />
)}
```

Replace the post-mapping section (lines 283-333) so the job-titles input + enrich checkbox **only** render in matching mode:

```tsx
<div className={`space-y-4 transition-opacity ${!fieldMapping ? 'opacity-40 pointer-events-none' : ''}`}>
  {mode === 'match_and_enrich' && (
    <>
      <div>
        <label htmlFor="job-titles" className="block text-sm text-gray-500 mb-1.5">
          What job titles would you like to search for?
        </label>
        <input
          id="job-titles"
          type="text"
          placeholder="CEO, CTO, Marketing Director"
          value={jobTitles}
          onChange={(e) => setJobTitles(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
        />
        <p className="mt-1 text-xs text-gray-400">
          Enter comma separated job titles
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          id="enrich-emails"
          type="checkbox"
          checked={enrichEmails}
          onChange={(e) => setEnrichEmails(e.target.checked)}
          className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
        />
        <label htmlFor="enrich-emails" className="text-sm text-gray-600">
          Include email enrichment (uses Findymail + Wiza credits)
        </label>
      </div>
    </>
  )}

  {mode === 'enrich_only' && (
    <p className="text-sm text-gray-500">
      All rows will be processed through the Findymail + Wiza waterfall (Stages 1-4 where data permits).
    </p>
  )}

  {/* file-name input is shown for BOTH modes */}
  <div>
    <label htmlFor="file-name" className="block text-sm text-gray-500 mb-1.5">
      What do you want to name your file?
    </label>
    <input
      id="file-name"
      type="text"
      placeholder="my-enriched-list"
      value={fileName}
      onChange={(e) => setFileName(e.target.value)}
      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
    />
  </div>
</div>
```

### Step 6 — Branch the sample-file download

Replace the existing `downloadSampleFile` callback:

```ts
const downloadSampleFile = useCallback(() => {
  const link = document.createElement('a');
  link.href = mode === 'enrich_only' ? '/sample-cf-enrich-input.csv' : '/sample-cf-input.csv';
  link.download = mode === 'enrich_only' ? 'sample-cf-enrich-input.csv' : 'sample-cf-input.csv';
  link.click();
}, [mode]);
```

### Step 7 — Branch `handleSubmit`

Replace the existing validation guard + body construction:

```ts
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!file || !fieldMapping) {
    setToastMessage('Please upload a file and confirm column mapping');
    setToastType('error');
    setShowToast(true);
    return;
  }

  // Mode-specific validation
  if (mode === 'match_and_enrich' && !jobTitles) {
    setToastMessage('Please enter the job titles you want to search for');
    setToastType('error');
    setShowToast(true);
    return;
  }
  // For enrich_only, the FieldMapper's enrichment-combo validation already
  // ensures at least linkedin_url OR (person_name + matched_company_domain)
  // are mapped before allowing Confirm. No extra check needed here.

  try {
    const effectiveFileName = fileName.trim()
      || file.name.replace(/\.csv$/i, '') + '-enriched';
    setIsSubmitting(true);

    if (!user) throw new Error('You must be logged in');

    // Step 1: Get pre-signed upload URL (mode-agnostic)
    setToastMessage('Preparing upload...');
    setToastType('success');
    setShowToast(true);

    const presignRes = await fetch('/api/matching/presign', { method: 'POST' });
    if (!presignRes.ok) throw new Error('Failed to get upload URL');
    const { batch_id, upload_url, csv_s3_key } = await presignRes.json();

    // Step 2: Upload CSV directly to S3 (mode-agnostic)
    setToastMessage('Uploading file...');
    setShowToast(true);

    const uploadRes = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: file,
    });
    if (!uploadRes.ok) throw new Error('Failed to upload file to S3');

    // Step 3: Start the pipeline — branch on mode
    setToastMessage('Starting processing...');
    setShowToast(true);

    const body =
      mode === 'enrich_only'
        ? {
            batch_id,
            csv_s3_key,
            mode: 'enrich_only' as const,
            field_mapping: fieldMapping,
            // Note: enrich_emails is implied true by the backend for enrich_only mode.
            // job_titles is intentionally absent — the backend rejects it for enrich_only.
          }
        : {
            batch_id,
            csv_s3_key,
            // mode: 'match_and_enrich' is the backend default; omit to keep payload minimal
            // and to keep the regression path byte-identical to the pre-Phase-4E request.
            job_titles: jobTitles,
            enrich_emails: enrichEmails,
            field_mapping: fieldMapping,
          };

    const startRes = await fetch('/api/matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!startRes.ok) {
      const error = await startRes.json();
      console.error('Start pipeline error:', startRes.status, error);
      throw new Error(error.error || error.message || JSON.stringify(error));
    }

    // Step 4: Store batch reference for the Results page (with NEW mode column)
    if (HAS_SUPABASE) {
      await supabase.from('enrich_results').insert({
        id: batch_id,
        user_id: user.id,
        file_name: effectiveFileName,
        status: 'RUNNING',
        mode,                  // NEW — drives Results.tsx matching-section hide
        result_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else {
      saveBatchToLocalStorage({
        batch_id,
        file_name: effectiveFileName,
        created_at: new Date().toISOString(),
      });
    }

    window.location.href = `/?page=Results&status=processing&batchId=${batch_id}`;
  } catch (error) {
    console.error('Error:', error);
    setToastMessage(error instanceof Error ? error.message : 'An error occurred');
    setToastType('error');
    setShowToast(true);
  } finally {
    setIsSubmitting(false);
  }
};
```

### Step 8 — Add `public/sample-cf-enrich-input.csv`

```csv
linkedin_url,full_name,company_domain,company_name,role
https://linkedin.com/in/jane-doe,Jane Doe,acme.com,Acme Inc,CEO
https://linkedin.com/in/john-smith,John Smith,globex.com,Globex,CTO
,Sarah Lee,initech.com,Initech,Founder
https://linkedin.com/in/mike-jones,,,,
```

The last two rows demonstrate the two per-row optional shapes:
- Row 3: name+domain only — Stages 1-2 will process it; Stages 3-4 will skip with `skip_only_lin`.
- Row 4: linkedin URL only — Stages 3-4 will process it; Stages 1-2 will skip with `skip_both`.

### Step 9 — Update `Results.tsx`

Four changes in one commit:

#### 9a. Extend the `EnrichResult` type to include `mode`

Replace the existing `EnrichResult` interface (lines 23-34) with:

```ts
interface EnrichResult {
  id: string;
  user_id: string;
  file_name: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  mode?: 'match_and_enrich' | 'enrich_only';   // NEW — read from Supabase
  result_count?: number;
  file_size?: number;
  file_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
```

(`mode` is optional in the type so legacy rows without the column read as `undefined` and default to "show matching block" — see hide-rule below.)

#### 9b. Extend the `BatchStatus.enrichment` type to include `rows_unresolvable`

Replace the existing `enrichment` block in `BatchStatus` (lines 65-73):

```ts
enrichment?: {
  total: number;
  enriched: number;
  emails_found: number;
  findymail_credits: number;
  wiza_credits: number;
  current_stage?: number;
  stages?: EnrichmentStage[];
  rows_unresolvable?: number;                  // NEW — from batch-status API (Phase 4E)
};
```

#### 9c. Per-stage skip-bucket display

Inside whatever component renders the per-stage progress bars (search for `stage.skip_buckets` references — there are none yet, so search for `stage.name` or `stages?.map` to find the loop), add this line under each stage's progress bar:

```tsx
{stage.skip_buckets && Object.values(stage.skip_buckets).some(v => (v ?? 0) > 0) && (
  <p className="text-xs text-gray-500 mt-1">
    {(stage.items_skipped ?? 0)} rows skipped — missing required fields for this stage
  </p>
)}
```

This renders for **both** modes (matching path may also have partial rows from GMaps imports). It's not enrichment-only-specific.

#### 9d. Hide matching section for `enrich_only` batches

Inside the result card render (search for `batchStatus?.matching` — there's an unconditional render of the matching section), wrap it in a render guard:

```tsx
const isEnrichOnly = result.mode === 'enrich_only';

// ...inside the JSX:
{!isEnrichOnly && batchStatus?.matching && (
  <MatchingSection matching={batchStatus.matching} />  /* whatever the existing matching block is */
)}
```

`result` is the `EnrichResult` row from Supabase. `result.mode` is the new column.

> **Why client-side and not backend-side?** The backend `batch-status` Lambda always writes a `matching` block (even if all counters are 0 because matching never ran) to keep the API uniform. The frontend has the user context (Supabase row with `mode`) so it's the right place to suppress the rendering.

#### 9e. Render `rows_unresolvable` line above the enrichment stages

Inside the enrichment section render (above the stages list):

```tsx
{(batchStatus?.enrichment?.rows_unresolvable ?? 0) > 0 && (
  <p className="text-xs text-amber-600 mb-2">
    {batchStatus.enrichment.rows_unresolvable} rows unusable —
    no LinkedIn URL or Name+Domain provided
  </p>
)}
```

For matching-path batches `rows_unresolvable` is `0` (defaulted server-side), so this line never renders for them — the existing UX is unchanged.

### Step 10 — Smoke test (manual, against staging)

#### 10a. Tab-switching state isolation

1. Open Contact Finder. Default tab: "Find Contacts".
2. Upload a GMaps CSV. Confirm field mapping. Type "CEO" into job titles.
3. Click "Email Enrichment" tab.
4. **Expected:** the file is gone, no headers shown, no field mapping, no job titles. The new `<p>` "All rows will be processed through ..." is visible. The job-titles input is **not** rendered.
5. Click "Find Contacts" tab.
6. **Expected:** same — clean state, job-titles input back, FieldMapper renders the matching field set.

#### 10b. Enrichment-combo validation

1. On "Email Enrichment" tab, upload `sample-cf-enrich-input.csv`.
2. The FieldMapper should auto-detect `linkedin_url`, `full_name`, `company_domain` (the sample's exact column names match the aliases in `ENRICHMENT_FIELDS`).
3. Confirm. The button should be enabled because all three are mapped.
4. Now manually clear the LinkedIn URL select. Confirm should still be enabled (Name + Domain still satisfies the rule).
5. Now clear the Domain select too. Confirm should be **disabled**. Helper text should remain visible.
6. Re-select LinkedIn URL. Confirm should re-enable (LinkedIn alone satisfies the rule).

#### 10c. Standalone enrichment end-to-end

1. On "Email Enrichment" tab, upload `sample-cf-enrich-input.csv`.
2. Confirm mapping → "Enrich".
3. Watch the toast progress: presign → upload → start processing → redirect to Results.
4. On Results: a new card appears for the new batch.
5. The matching section should be **hidden** (because `mode === 'enrich_only'`).
6. The enrichment section should poll and show stage progress.
7. After completion, click Download. The CSV should contain `linkedin_url`, `full_name`, `company_domain`, `company_name`, `role` (the user's pass-through columns), plus `email`, `email_source`, `enrich_stage`.
8. Confirm at least one row has an email populated (Jane Doe with the LinkedIn URL should hit Findymail Stage 3).

#### 10d. Matching-path regression

1. On "Find Contacts" tab, upload a GMaps CSV (the existing sample at `public/sample-cf-input.csv`).
2. Map fields, type "CEO" into job titles, click "Enrich".
3. Watch toast progress and redirect to Results.
4. The matching section should be **visible** (because `mode === 'match_and_enrich'`).
5. The pipeline should run identically to pre-Phase-4E.

#### 10e. Skip-bucket display

1. From a recent enrich-only batch (10c) where the sample had a name-only-no-domain row and a linkedin-only row, expand the result card.
2. Stage 1 (Findymail name+domain): should show some `items_skipped` count for the linkedin-only row (`skip_both` or `skip_only_dom`).
3. Stage 3 (Findymail LinkedIn): should show some `items_skipped` count for the name+domain-only row (`skip_only_lin`).
4. The new "X rows skipped — missing required fields for this stage" line renders under each affected stage's progress bar.

#### 10f. Unresolvable-row display

1. Upload a CSV that includes at least one row with NEITHER LinkedIn URL nor (Name + Domain) — e.g. only `Notes`. Map the three enrichment fields. Submit.
2. After the batch starts, the Results enrichment section should show the new line near the top:
   "X rows unusable — no LinkedIn URL or Name+Domain provided"
   where X matches the count of unresolvable rows in the upload.
3. The progress bar should reach 100% (eligible rows / eligible rows).

---

## Verification checklist

### Migration + types
- [ ] Supabase `enrich_results.mode` column added with `'match_and_enrich'` default
- [ ] Existing rows still queryable (`mode` defaults to `match_and_enrich` for them)
- [ ] `src/types/supabase.ts` includes `mode` on `enrich_results.Row` / `Insert` / `Update`

### `fieldConfigs.ts`
- [ ] File created with `MATCHING_FIELDS` and `ENRICHMENT_FIELDS` exports
- [ ] `MATCHING_FIELDS` content matches the original `REQUIRED_FIELDS` constant in the pre-refactor `FieldMapper.tsx` exactly

### `FieldMapper.tsx`
- [ ] Accepts `requiredFields`, `validationMode`, `helperText`, `csvHeaders`, `onConfirm`
- [ ] No longer imports any constant — fields come from props
- [ ] `validationMode === 'all-required'` works identically to pre-refactor matching mode
- [ ] `validationMode === 'enrichment-combo'` enables Confirm when LinkedIn URL is mapped, OR when both Full Name and Company Domain are mapped, OR all three
- [ ] Helper text renders when provided, hides when omitted
- [ ] Auto-detect uses the field set's aliases

### `ContactFinder.tsx`
- [ ] `mode` state added with default `'match_and_enrich'`
- [ ] Tab strip renders both tabs, highlights the active one
- [ ] Tab switch resets file, headers, mapping, jobTitles, enrichEmails, fileName, hasUploadError, showToast
- [ ] Sample file download switches between `sample-cf-input.csv` and `sample-cf-enrich-input.csv` based on mode
- [ ] FieldMapper rendered with mode-appropriate `requiredFields` and `validationMode` and helper text
- [ ] Job-titles input + enrich checkbox only render in `match_and_enrich` mode
- [ ] "All rows will be processed..." paragraph only renders in `enrich_only` mode
- [ ] File-name input renders in both modes
- [ ] Submit handler skips the `jobTitles` validation in `enrich_only` mode
- [ ] `handleSubmit` POST body for `enrich_only`: `{batch_id, csv_s3_key, mode: 'enrich_only', field_mapping}` (no `job_titles`, no `enrich_emails` boolean)
- [ ] `handleSubmit` POST body for `match_and_enrich`: unchanged from pre-Phase-4E (no `mode` field)
- [ ] Supabase insert includes `mode` field on the new row

### `public/sample-cf-enrich-input.csv`
- [ ] File added with the 4-row content from Step 8

### `Results.tsx`
- [ ] `EnrichResult.mode` field added (optional)
- [ ] `BatchStatus.enrichment.rows_unresolvable` field added (optional)
- [ ] Per-stage skip-bucket line renders under each stage with non-zero skip buckets
- [ ] Matching section hidden when `result.mode === 'enrich_only'`
- [ ] `rows_unresolvable` line renders above the enrichment stages when > 0
- [ ] No regressions for existing match+enrich batches (matching section still visible, no skip-bucket line for stages that didn't skip anything, no rows_unresolvable line)

### Manual smoke tests
- [ ] Tab-switch state isolation (10a)
- [ ] Enrichment-combo validation (10b)
- [ ] Standalone enrichment end-to-end (10c)
- [ ] Matching-path regression (10d)
- [ ] Skip-bucket display (10e)
- [ ] Unresolvable-row display (10f)

---

## Out of scope for this dev spec

- **Sub-stage selection** ("only run Stage 3-4"). Per-row skip-bucket logic in the backend already handles partial data per row.
- **Provider-level toggles** (Findymail-only, Wiza-only). Not exposed in matching mode either.
- **Migrating the proxy route** at `src/app/api/matching/route.ts`. It's a verbatim passthrough — `mode` flows through automatically.
- **Stripe / token-gating differences for enrich-only billing.** Assumed identical to current per-result token deduction. Revisit if business rules differ — the existing token deduction reads `total_matches` for matching path and `total_to_enrich` for standalone path, and both fields are populated by the SM correctly.
- **A new sidebar entry for "Email Enrichment".** Decided against in the plan — tabs at the top of Contact Finder are lower navigation cost and more discoverable.

---

## Files this dev spec touches in summary

- **NEW:** `src/lib/fieldConfigs.ts`
- **NEW:** `public/sample-cf-enrich-input.csv`
- **EDIT:** `src/components/FieldMapper.tsx` (refactor — pure prop-based, no behavior change for matching mode)
- **EDIT:** `src/components/ContactFinder.tsx` (tab UI + `mode` state + branched render + branched submit)
- **EDIT:** `src/components/Results.tsx` (4 type/render additions)
- **EDIT:** `src/types/supabase.ts` (regenerated after migration)
- **MIGRATION:** `enrich_results.mode` column added in Supabase

No proxy-route, no API client, no auth, no Stripe changes required.
