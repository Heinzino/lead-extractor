// Field set configurations for the FieldMapper component.
//
// MATCHING_FIELDS — used by the existing Contact Finder "Find Contacts" tab.
//   Both fields are individually required (validationMode='all-required').
//
// ENRICHMENT_FIELDS — used by the Phase 4E "Email Enrichment" tab.
//   All entries are optional per row. The eligibility rule (enforced by
//   FieldMapper with validationMode='enrichment-combo') is satisfied by
//   either (linkedin_url) OR (matched_company_domain + a name). The name
//   can be supplied two ways:
//     - Full Name  → person_name column, OR
//     - Split form → first_name + last_name columns. The FieldMapper shows
//       a toggle and the frontend (csvTransform.ts) concatenates first/last
//       into a synthesized full-name column before S3 upload, so the
//       backend always receives the canonical key `person_name` in
//       field_mapping. first_name / last_name are FRONTEND-ONLY keys.
//   Per-row eligibility is enforced in the backend preload Lambda
//   (csv-to-ddb-enrich) — partial rows still get a chance at the stages
//   they have data for.

export type FieldConfig = {
  key: string;
  label: string;
  aliases: string[];
};

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
    key: 'first_name',
    label: 'First Name',
    aliases: ['first_name', 'firstname', 'fname', 'given_name', 'first'],
  },
  {
    key: 'last_name',
    label: 'Last Name',
    aliases: ['last_name', 'lastname', 'lname', 'surname', 'family_name', 'last'],
  },
  {
    key: 'matched_company_domain',
    label: 'Company Domain',
    aliases: ['domain', 'company_domain', 'website_domain', 'email_domain'],
  },
];
