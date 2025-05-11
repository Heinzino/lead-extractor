import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabase/supabaseAdmin';
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


function normalizeDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return url.replace('www.', '');
  }
}

function cleanName(name: string): string {
  return name
    .replace(/\[\d+\]/g, '')
    .replace(/\[.*?\]/g, '')
    .trim()
    .replace(/[.,]+$/, '');
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
If you cannot confidently verify this match, return "na" instead.`.trim();
  const system = `Please return ONLY the full name of the person matching the requested job title if you are at least 95% confident they hold it. 
If you are not 95% confident, return 'na'. 
Return nothing else.`.trim();
  return { user, system };
}

function generateFallbackPrompt(domain: string) {
  const user = `For the company website ${domain}, please try to identify a contact email address found on the website. Please return a cleaned email address and nothing else.

If email is not found return na.`.trim();
  const system = `The only thing that should ever be outputted is an email if it was found or "na".`.trim();
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

async function callPerplexity(user: string, system: string) {
  await waitForPerplexityToken();
  
  const body = {
    model: PPLX_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

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
  const content = json.choices?.[0]?.message?.content?.trim() || 'na';
  const tokens = json.usage?.total_tokens || 1000;
  const cost = (tokens / 1000) * PPLX_COST_PER_1K_TOKENS;
  return { content, cost, status: 'success' };
}

async function callFindymail(name: string, domain: string) {
  await waitForFindymailToken();
  
  const res = await fetch(FINDYMAIL_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FINDYMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, domain }),
  });

  if (!res.ok) return 'na';
  const json = await res.json();
  return json?.contact?.email || 'na';
}

interface EnrichRow {
  'Company name': string;
  'Company website': string;
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
  const domain = normalizeDomain(row['Company website']);
  const { user, system } = generatePrompt(row['Company name'], domain, jobTitle);

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

async function enrichRow(row: EnrichRow) {
  const name = row['Found Person Name'];
  const domain = row['Normalized Domain'];
  
  let personEmail = 'na';
  let websiteEmail = 'na';

  if (name.toLowerCase() !== 'na') {
    personEmail = await callFindymail(name, domain);
  }

  if (!personEmail || personEmail.toLowerCase() === 'na') {
    const fallback = generateFallbackPrompt(domain);
    for (let i = 0; i < 3; i++) {
      try {
        const fallbackResult = await callPerplexity(fallback.user, fallback.system);
        if (fallbackResult.status === 'success' && 
            fallbackResult.content.includes('@') && 
            fallbackResult.content.includes('.')) {
          websiteEmail = cleanEmail(fallbackResult.content);
          break;
        }
      } catch {
        await new Promise(r => setTimeout(r, 2 ** i * CONFIG.retryDelay));
      }
    }
  }

  return {
    ...row,
    'Person Email': personEmail,
    'Website Email': websiteEmail,
    'Final Email': personEmail !== 'na' ? personEmail : websiteEmail,
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
        'Normalized Domain': normalizeDomain(row['Company website']),
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

    const output = stringify(enrichedResults, { header: true });
    const fileSize = new TextEncoder().encode(output).length;
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

    const { error: updateError } = await supabaseAdmin
      .from('enrich_results')
      .update({
        status: 'DONE',
        file_url: data.signedUrl,
        result_count: enrichedResults.length,
        file_size: fileSize,
        updated_at: new Date().toISOString()
      })
      .eq('id', resultId);

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