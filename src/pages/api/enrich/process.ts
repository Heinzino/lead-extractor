import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase/supabaseAdmin';
import { stringify } from 'csv-stringify/sync';


const CONFIG = {
  maxWorkers: 5,
  batchDelay: 1000,
  maxRetries: 5,
  retryDelay: 1000,
  rateLimit: {
    perplexity: {
      maxRequests: 2000,
      windowMs: 60000
    },
    findymail: {
      maxRequests: 5,
      windowMs: 1000
    }
  }
};


let perplexityTokens = CONFIG.rateLimit.perplexity.maxRequests;
let findymailTokens = CONFIG.rateLimit.findymail.maxRequests;
let lastPerplexityRefill = Date.now();
let lastFindymailRefill = Date.now();

const PPLX_API_KEY = process.env.PPLX_API_KEY;
const FINDYMAIL_API_KEY = process.env.FINDYMAIL_API_KEY;
const PPLX_API_URL = 'https://api.perplexity.ai/chat/completions';
const FINDYMAIL_API_URL = 'https://app.findymail.com/api/search/name';
const PPLX_MODEL = 'sonar-pro';
const PPLX_COST_PER_1K_TOKENS = 0.002;


function normalizeDomain(url?: string | null): string {
  if (!url) return '';
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace('www.', '');
  } catch {
    return url.replace('www.', '');
  }
}

function cleanName(name: string): string {
  let cleaned = name
    .replace(/\[\d+\]/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();

  const prefixes = /(?:^|\s)(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof\.?|Professor)(?=\s|$)/gi;
  cleaned = cleaned.replace(prefixes, '').trim();

  const suffixes = /\s(?:PhD|MBA|MD|JD|DDS|DMD|DO|RN|NP|PA|Jr\.?|Sr\.?|Esq\.?|I{2,3}|IV|V)(?=\s|$)/gi;
  cleaned = cleaned.replace(suffixes, '').trim();

  cleaned = cleaned
    .replace(/\s+/, ' ')
    .replace(/\s*[,\.]+\s*/g, ' ')
    .trim();

  return cleaned;
}

function cleanEmail(email: string): string {
  return email
    .replace(/\[.*?\]/g, '')
    .trim()
    .replace(/[.,]+$/, '');
}

function generatePrompt(company: string, domain: string, jobTitle: string) {
  const user = `I need to find the person who holds the job title: ${jobTitle} at company: ${company} which has website: ${domain}. 

IMPORTANT RULES:
1. Only return a full name if you can see it explicitly listed on their website with this exact job title
2. Do NOT guess or make up names under any circumstances
3. If the name is not clearly visible on their website with this job title, return "na"
4. Do not return partial names or initials
5. If you're not 100% certain, return "na"

Please check their team page, about page, and leadership page if available.`.trim();
  
  const system = `You are a careful research assistant. Your task is to find the name of a person with a specific job title at a company.

RULES:
- Return ONLY the full name if you can see it on their website with the exact job title
- If you can't find the name with 100% certainty, return 'na'
- Never guess or make up names
- Never return partial names or initials
- If in doubt, return 'na'`;

  return { user, system };
}

function generateFallbackPrompt(domain: string) {
  const isFacebook = domain.includes('facebook.com');
  
  let user = `For the company website ${domain}, please find a professional contact email address. `;
  
  if (isFacebook) {
    user += `Since this is a Facebook page, please follow these steps carefully:
    1. Look for the 'About' section in the left sidebar and click on it
    2. Check for a 'Contact Info' or 'See contact info' button and click it
    3. In the contact information section, look for:
       - Email addresses under 'Contact Information' or 'Business Contact'
       - The 'More Info' section for additional contact details
       - Any 'Send Email' or 'Contact Us' buttons
    4. Check the page's posts for any contact information or announcements
    5. Look for a 'Page Transparency' section which might contain business email
    6. Check the 'Services' or 'Products' tabs if available
    7. Look for a website link that might contain a contact page
    `;
  } else {
    user += `Follow these steps:
    1. Look for contact, about, team, or company pages
    2. Check the website footer and header for contact links
    3. Search for email patterns like contact@, info@, hello@, support@, admin@, or firstname@
    4. Look for a contact form that might reveal an email address
    `;
  }
  
  user += `
  5. If multiple emails are found, prioritize in this order:
     - info@, contact@, hello@ (most general)
     - support@, help@ (customer service)
     - First name based emails (e.g., john@, jane@)
  6. Verify the email format is valid (contains @ and a valid domain)
  7. Return ONLY a clean email address if found, or "na" if no email is found

Example outputs:
- info@example.com
- na`.trim();
  
  const system = `You are a professional email extraction assistant. Follow these rules STRICTLY:
  - For Facebook pages: Thoroughly check all sections including About, Contact Info, and Page Transparency
  - For other websites: Systematically check all pages and sections where contact info might appear
  - Only return a single, clean email address or "na" if none found
  - Do not include any other text, explanations, or formatting
  - If the domain is invalid, inaccessible, or no email is found, return "na"
  - Skip personal emails (e.g., gmail.com, yahoo.com) unless no business email is found
  - If multiple emails are found, return the most appropriate business email`.trim();
  
  return { user, system };
}

async function waitForPerplexityToken(): Promise<void> {
  const now = Date.now();
  const timePassed = now - lastPerplexityRefill;
  const newTokens = Math.floor(timePassed / CONFIG.rateLimit.perplexity.windowMs * CONFIG.rateLimit.perplexity.maxRequests);
  
  if (newTokens > 0) {
    perplexityTokens = Math.min(CONFIG.rateLimit.perplexity.maxRequests, perplexityTokens + newTokens);
    lastPerplexityRefill = now;
  }

  if (perplexityTokens <= 0) {
    const waitTime = CONFIG.rateLimit.perplexity.windowMs - (now - lastPerplexityRefill) + 100;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return waitForPerplexityToken();
  }

  perplexityTokens--;
}

async function waitForFindymailToken(): Promise<void> {
  const now = Date.now();
  const timePassed = now - lastFindymailRefill;
  const newTokens = Math.floor(timePassed / CONFIG.rateLimit.findymail.windowMs * CONFIG.rateLimit.findymail.maxRequests);
  
  if (newTokens > 0) {
    findymailTokens = Math.min(CONFIG.rateLimit.findymail.maxRequests, findymailTokens + newTokens);
    lastFindymailRefill = now;
  }

  if (findymailTokens <= 0) {
    const waitTime = CONFIG.rateLimit.findymail.windowMs - (now - lastFindymailRefill);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return waitForFindymailToken();
  }

  findymailTokens--;
}

function extractNameFromResponse(content: string): string {
  if (!content) return 'na';
  
  const trimmedContent = content.trim();
  if (trimmedContent.toLowerCase() === 'na') return 'na';

  const patterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s|\(|$)/,
    /([A-Z][a-z]+,\s*[A-Z][a-z]+)/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
    /(\b[A-Z][a-z]+\b)/
  ];

  for (const pattern of patterns) {
    const match = trimmedContent.match(pattern);
    if (match && match[1]) {
      const name = match[1].replace(/[^\w\s,]/g, '').trim();
      if (name.split(/\s+/).length <= 4) {
        return name;
      }
    }
  }
  
  return 'na';
}

async function callPerplexity(user: string, system: string) {
  await waitForPerplexityToken();
  
  const body = {
    model: PPLX_MODEL,
    messages: [
      { 
        role: 'system', 
        content: system + '\n\nIMPORTANT: Respond with ONLY the full name or "na". Do not include any explanations, notes, or additional text.' 
      },
      { 
        role: 'user', 
        content: user + '\n\nIMPORTANT: Respond with ONLY the full name or "na". Do not include any explanations, notes, or additional text.'
      },
    ],
    temperature: 0.3, 
    max_tokens: 50,
  };

  try {
    const res = await fetch(PPLX_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PPLX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Perplexity API error: ${res.statusText}`);
    }

    const json = await res.json();
    let content = json.choices?.[0]?.message?.content?.trim() || 'na';
    const tokens = json.usage?.total_tokens || 1000;
    const cost = (tokens / 1000) * PPLX_COST_PER_1K_TOKENS;
    
    content = extractNameFromResponse(content);
    
    return { content, cost, status: 'success' };
  } catch (error) {
    console.error('Error in callPerplexity:', error);
    return { content: 'na', cost: 0, status: 'error' };
  }
}

async function callFindymail(name: string, domain: string) {
  try {
    console.log(`[Findymail] Starting lookup for ${name}@${domain}`);
    await waitForFindymailToken();
    
    const requestBody = { 
      name: name.trim(),
      domain: domain.trim(),
      company: '' 
    };
    
    console.log('[Findymail] Request body:', JSON.stringify(requestBody, null, 2));
    
    const res = await fetch(FINDYMAIL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FINDYMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await res.text();
    console.log(`[Findymail] Response status: ${res.status} ${res.statusText}`);
    console.log('[Findymail] Response body:', responseText);

    if (!res.ok) {
      console.error(`[Findymail] API error for ${name}@${domain}: ${res.status} ${res.statusText} - ${responseText}`);
      return 'na';
    }
    
    let json;
    try {
      json = JSON.parse(responseText);
      console.log('[Findymail] Parsed JSON response:', JSON.stringify(json, null, 2));
    } catch (e) {
      console.error('[Findymail] Failed to parse JSON response:', e);
      console.error('[Findymail] Raw response that failed to parse:', responseText);
      return 'na';
    }
    
    if (json.contact) {
      console.log(`[Findymail] Contact found with ID: ${json.contact.id}`);
      
      if (json.contact.email === null || json.contact.email === '') {
        console.log('[Findymail] No email found for this contact');
        return 'na';
      }
      
      if (json.contact.email && typeof json.contact.email === 'string') {
        const cleanedEmail = cleanEmail(json.contact.email);
        if (cleanedEmail.includes('@') && cleanedEmail.includes('.')) {
          console.log(`[Findymail] Found email: ${cleanedEmail}`);
          return cleanedEmail;
        }
      }
    }
    
    const email = json?.contact?.email || json?.email || json?.data?.email;
    if (email && typeof email === 'string' && email.includes('@') && email.includes('.')) {
      const cleanedEmail = cleanEmail(email);
      console.log(`[Findymail] Found email (fallback): ${cleanedEmail}`);
      return cleanedEmail;
    }
    
    console.log(`[Findymail] No valid email found in response for ${name}@${domain}`);
    console.log('[Findymail] Response summary:', {
      hasContactObject: !!json.contact,
      contactId: json.contact?.id,
      emailInResponse: json.contact?.email,
      responseKeys: Object.keys(json)
    });
    
    return 'na';
  } catch (error) {
    console.error(`[Findymail] Unexpected error for ${name}@${domain}:`, error);
    if (error instanceof Error) {
      console.error('[Findymail] Error stack:', error.stack);
    }
    return 'na';
  }
}

interface EnrichRow {
  'company': string;
  'website': string;
  'Normalized Domain': string;
  'Desired Job Title': string;
  'Found Person Name': string;
  'Total Cost': string;
  'Annotation': string;
  'Attempts': number;
  'Person Email': string;
  'Website Email': string;
  'Final Email': string;
  [key: string]: string | number;
}

async function processRow(row: EnrichRow, jobTitle: string) {
  const website = getHeaderCaseInsensitive(row, 'website') || '';
  const company = getHeaderCaseInsensitive(row, 'company') || '';
  const domain = normalizeDomain(website);
  const { user, system } = generatePrompt(company, domain, jobTitle);

  let content = 'na';
  let cost = 0;
  let status = 'error';
  let attempts = 0;

  for (let i = 0; i < CONFIG.maxRetries; i++) {
    try {
      const result = await callPerplexity(user, system);
      content = result.content;
      cost = result.cost;
      status = result.status;
      break;
    } catch {
      await new Promise(r => setTimeout(r, 2 ** i * CONFIG.retryDelay));
    }
    attempts++;
  }

  const names = content.toLowerCase() === 'na' ? ['na'] : cleanName(content).split(',').map(n => n.trim());
  return names.map(name => ({
    ...row,
    'Normalized Domain': domain,
    'Desired Job Title': jobTitle,
    'Found Person Name': name,
    'Total Cost': cost.toFixed(6),
    'Annotation': status,
    'Attempts': attempts + 1,
  }));
}

const domainEmailCache = new Map<string, string>();
const companyEmailCache = new Map<string, string>();

function getHeaderCaseInsensitive<T extends Record<string, unknown>>(
  obj: T, 
  header: string
): string | undefined {
  const lowerHeader = header.toLowerCase();
  const key = Object.keys(obj).find(k => k.toLowerCase() === lowerHeader);
  const value = key ? obj[key] : undefined;
  return typeof value === 'string' ? value : undefined;
}

async function enrichRow(row: EnrichRow) {
  const name = getHeaderCaseInsensitive(row, 'Found Person Name') || '';
  const domain = getHeaderCaseInsensitive(row, 'Normalized Domain') || '';
  const company = (getHeaderCaseInsensitive(row, 'company') || '').toLowerCase().trim();
  
  let personEmail = getHeaderCaseInsensitive(row, 'Person Email') || 'na';
  let websiteEmail = getHeaderCaseInsensitive(row, 'Website Email') || 'na';
  
  if (company && companyEmailCache.has(company)) {
    const cachedEmail = companyEmailCache.get(company)!;
    return {
      ...row,
      'Person Email': personEmail,
      'Website Email': cachedEmail,
      'Final Email': cachedEmail,
    };
  }
  
  if (domain && domainEmailCache.has(domain)) {
    websiteEmail = domainEmailCache.get(domain)!;
  }

  if (name.toLowerCase() !== 'na') {
    personEmail = await callFindymail(name, domain);
  }

  // Only use Perplexity fallback if no email from Findymail and domain is available
  if ((!personEmail || personEmail.toLowerCase() === 'na') && domain) {
    const fallback = generateFallbackPrompt(domain);
    
    for (let i = 0; i < 3; i++) {
      try {
        const fallbackResult = await callPerplexity(fallback.user, fallback.system);
        if (fallbackResult.status === 'success' && 
            fallbackResult.content.includes('@') && 
            fallbackResult.content.includes('.')) {
          websiteEmail = cleanEmail(fallbackResult.content);
          domainEmailCache.set(domain, websiteEmail);
          break;
        }
      } catch {
        await new Promise(r => setTimeout(r, 2 ** i * CONFIG.retryDelay));
      }
    }
  }

  // We'll accept any website email that's found, including common ones like info@, contact@, etc.
  let finalWebsiteEmail = 'na';
  
  if (domain && websiteEmail && websiteEmail.toLowerCase() !== 'na') {
    finalWebsiteEmail = websiteEmail;
    
    // Update caches
    if (domain) {
      domainEmailCache.set(domain, finalWebsiteEmail);
      if (company) {
        companyEmailCache.set(company, finalWebsiteEmail);
      }
    }
  }
    
  const finalEmail = personEmail !== 'na' ? personEmail : finalWebsiteEmail;
  
  return {
    ...row,
    'Person Email': personEmail,
    'Website Email': finalWebsiteEmail,
    'Final Email': finalEmail,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let resultId: string | undefined;
  
  try {
    const { resultId: id, records, jobTitles } = req.body;
    
    if (!id || !records || !jobTitles) {
      return res.status(400).json({ error: 'Missing required fields: resultId, records, and jobTitles' });
    }

    resultId = id;

    const expandedRows = records.flatMap((row: EnrichRow) => 
      jobTitles.map((jobTitle: string) => ({
        ...row,
        'Normalized Domain': normalizeDomain(row['website']),
        'Desired Job Title': jobTitle
      }))
    );

    const nameResults = await Promise.all(
      expandedRows.map((row: EnrichRow) => processRow(row, row['Desired Job Title']))
    );
    const flattenedNameResults = nameResults.flat();

    const uniqueNameResults = flattenedNameResults
      .filter(row => String(row['Found Person Name']).toLowerCase() !== 'na')
      .filter((row, index, self) => 
        index === self.findIndex(r => r['Found Person Name'] === row['Found Person Name'])
      );

    const enrichedResults = await Promise.all(
      uniqueNameResults.map((row: EnrichRow) => enrichRow(row))
    );

    const seenEmails = new Set<string>();
    const deduplicatedResults = enrichedResults.filter(row => {
      const email = String(row['Final Email']).toLowerCase();
      if (email === 'na' || seenEmails.has(email)) {
        return false;
      }
      seenEmails.add(email);
      return true;
    });

    let fileUrl: string | undefined;
    
    // Only create and upload file if we have results
    if (deduplicatedResults.length > 0) {
      const output = stringify(deduplicatedResults, { header: true });
      const fileName = `enrich-results/${resultId}.csv`;

      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === 'enrich-results');
      
      if (!bucketExists) {
        const { error: createError } = await supabaseAdmin.storage.createBucket('enrich-results', {
          public: true,
          fileSizeLimit: 52428800,
          allowedMimeTypes: ['text/csv']
        });
        
        if (createError) {
          throw new Error(`Error creating bucket: ${createError.message}`);
        }

        const { error: policyError } = await supabaseAdmin.storage.from('enrich-results').createSignedUrl(fileName, 31536000);
        if (policyError) {
          throw new Error(`Error setting bucket policy: ${policyError.message}`);
        }
      }

      const { error: uploadError } = await supabaseAdmin.storage
        .from('enrich-results')
        .upload(fileName, output, {
          contentType: 'text/csv',
          upsert: true,
          cacheControl: '3600'
        });

      if (uploadError) {
        throw new Error(`Error uploading file: ${uploadError.message}`);
      }

      const { data } = await supabaseAdmin.storage
        .from('enrich-results')
        .createSignedUrl(fileName, 31536000);

      if (!data?.signedUrl) {
        throw new Error('Failed to generate signed URL');
      }
      
      fileUrl = data.signedUrl;
    }

    const { data: enrichResult, error: fetchUserError } = await supabaseAdmin
      .from('enrich_results')
      .select('user_id')
      .eq('id', resultId as string)
      .single();

    if (!fetchUserError && enrichResult?.user_id) {
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('user_tokens')
        .eq('id', enrichResult.user_id)
        .single();

      if (!userError && userData) {
        const currentTokens = userData.user_tokens || 0;
        const newTokens = currentTokens - enrichedResults.length;

        await supabaseAdmin
          .from('users')
          .update({ user_tokens: newTokens })
          .eq('id', enrichResult.user_id);
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('enrich_results')
      .update({
        status: 'DONE',
        file_url: fileUrl,
        result_count: deduplicatedResults.length,
        updated_at: new Date().toISOString()
      })
      .eq('id', resultId as string);

    if (updateError) {
      throw new Error(`Error updating record: ${updateError.message}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    if (resultId) {
      await supabaseAdmin
        .from('enrich_results')
        .update({
          status: 'ERROR',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          updated_at: new Date().toISOString()
        })
        .eq('id', resultId);
    }

    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
} 