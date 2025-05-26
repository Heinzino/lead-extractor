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
  const user = `Hello, can you help me find the person who holds the jobtitle: ${jobTitle} at company: ${company} which has website: ${domain}?

IMPORTANT: 
Only return a person's full name if you are at least 95% confident that the individual actually holds the job title requested. 
If you cannot confidently verify this match, return "na" instead.`;
  
  const system = `Please return ONLY the full name of the person matching the requested job title if you are at least 95% confident they hold it. 
If you are not 95% confident, return 'na'. 
Return nothing else.`;

  return { user, system };
}

function generateFallbackPrompt(domain: string) {
  const user = `For the company website ${domain}, please try to identify a contact email address found on the website. Please return a cleaned email address and nothing else.

If email is not found return na.`;
  
  const system = `The only thing that should ever be outputted is an email if it was found or "na".`;
  
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
        content: system 
      },
      { 
        role: 'user', 
        content: user 
      },
    ],
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
    await waitForFindymailToken();
    
    const requestBody = { 
      name: name.trim(),
      domain: domain.trim()
    };
    
    const res = await fetch(FINDYMAIL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FINDYMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      return 'na';
    }
    
    const json = await res.json();
    return json?.contact?.email || 'na';
    
  } catch {
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