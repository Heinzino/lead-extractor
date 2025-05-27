import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase/supabaseAdmin';
import { stringify } from 'csv-stringify/sync';

const CONFIG = {
  workerCount: 30,
  requestsPerSecond: 30,
  maxRetries: 3,
  retryDelay: 500,
  rateLimit: {
    perplexity: {
      maxRequests: 1800,
      windowMs: 60000  
    },
    findymail: {
      maxRequests: 30,  
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

const domainEmailCache = new Map<string, string>();
const companyEmailCache = new Map<string, string>();

type EnrichData = {
  company: string;
  website: string;
  'Normalized Domain': string;
  'Desired Job Title': string;
  'Found Person Name': string;
  'Total Cost': string;
  'Annotation': string;
  'Attempts': number;
  'Person Email': string;
  'Website Email': string;
  'Final Email': string;
};

type EnrichRow = EnrichData & {
  [key: string]: string | number;
};


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
  if (!name || name.toLowerCase() === 'na' || name.trim() === '') return 'na';
  
  const cleaned = name
    .split(/\n|\*\*Explanation:|Note:|\*\*/)[0]
    .trim()
    .replace(/[^\w\s,.-]/g, '') 
    .replace(/\s+/g, ' '); 

  
  if (cleaned.length > 50 || /\b(?:explanation|note|although|however|therefore|because|since|although|while|when|whereas|additionally|furthermore|moreover|nevertheless|nonetheless|otherwise|subsequently|thereby|thus|whereas|whereby|accordingly|consequently|hence|meanwhile|otherwise|then|thereafter|thereupon|thus|whereupon)\b/i.test(cleaned)) {
    return 'na';
  }

  
  if (name.includes('*') || name.length > 100) {
    return 'na';
  }

  return cleaned || 'na';
}

function cleanEmail(email: string): string {
  if (!email) return 'na';
  return email
    .replace(/\[.*?\]/g, '')
    .trim()
    .replace(/[.,]+$/, '');
}

function getHeaderCaseInsensitive<T extends Record<string, unknown>>(
  obj: T, 
  header: string
): string | undefined {
  const lowerHeader = header.toLowerCase();
  const key = Object.keys(obj).find(k => k.toLowerCase() === lowerHeader);
  const value = key ? obj[key] : undefined;
  return typeof value === 'string' ? value : undefined;
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


class WorkerPool<T, R> {
  private queue: Array<() => Promise<void>> = [];
  private activeWorkers = 0;
  private lastRequestTimes: number[] = [];
  private requestsPerSecond: number;
  private workers: number;
  private processItem: (item: T) => Promise<R>;
  private results: R[] = [];
  private resolveAll: (() => void) | null = null;

  constructor(workers: number, requestsPerSecond: number, processItem: (item: T) => Promise<R>) {
    this.workers = workers;
    this.requestsPerSecond = requestsPerSecond;
    this.processItem = processItem;
  }

  async process(items: T[], timeoutMs: number = 10 * 60 * 1000): Promise<R[]> {
    return new Promise((resolve, reject) => {
      this.results = [];
      let isResolved = false;
      
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.error('WorkerPool timed out after', timeoutMs, 'ms');
          reject(new Error(`WorkerPool timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      
      this.resolveAll = () => {
        if (this.activeWorkers === 0 && !isResolved) {
          clearTimeout(timeoutId);
          isResolved = true;
          resolve(this.results);
        }
      };

      try {
        items.forEach(item => {
          this.queue.push(() => this.runWorker(item));
        });

        const workerCount = Math.min(this.workers, this.queue.length);
        for (let i = 0; i < workerCount; i++) {
          this.startWorker().catch(error => {
            console.error('Error starting worker:', error);
            if (!isResolved) {
              clearTimeout(timeoutId);
              isResolved = true;
              reject(error);
            }
          });
        }
      } catch (error) {
        if (!isResolved) {
          clearTimeout(timeoutId);
          isResolved = true;
          reject(error);
        }
      }
    });
  }

  private async startWorker(): Promise<void> {
    if (this.queue.length === 0 || this.activeWorkers >= this.workers) {
      return;
    }

    this.activeWorkers++;
    const next = this.queue.shift();
    
    if (next) {
      try {
        await next();
      } catch (error) {
        console.error('Error in worker task:', error);
        throw error;
      } finally {
        this.activeWorkers--;
        
        if (this.queue.length > 0) {
          this.startWorker().catch(console.error);
        } else if (this.activeWorkers === 0 && this.resolveAll) {
          this.resolveAll();
        }
      }
    } else {
      this.activeWorkers--;
    }
  }

  private async runWorker(item: T): Promise<void> {
    const startTime = Date.now();
    const workerTimeout = 20000;
    
    try {
      const now = Date.now();
      this.lastRequestTimes = this.lastRequestTimes.filter(time => now - time < 1000);
      
      if (this.lastRequestTimes.length >= this.requestsPerSecond) {
        const timeToWait = 1000 - (now - this.lastRequestTimes[0]);
        if (timeToWait > 0) {
          await new Promise(resolve => setTimeout(resolve, timeToWait));
        }
      }

      const result = await Promise.race([
        this.processItem(item),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Worker task timed out')), workerTimeout)
        )
      ]);
      
      this.results.push(result as R);
      this.lastRequestTimes.push(Date.now());
      
      const elapsed = Date.now() - startTime;
      if (elapsed > 30000) {
        console.warn(`Worker task took ${(elapsed / 1000).toFixed(2)}s (slow)`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000 / this.requestsPerSecond));
      
    } catch (error) {
      console.error('Error in worker task:', error);
      throw error;
    }
  }
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

type PerplexityResult = 
  | { content: string; cost: number; status: 'success' }
  | { content: 'na'; cost: 0; status: 'error' };

async function callPerplexity(user: string, system: string, attempt = 1): Promise<PerplexityResult> {
  const MAX_ATTEMPTS = 2;
  const REQUEST_TIMEOUT = 20000;
  const RETRY_DELAY = 1000;
  
  try {
    await waitForPerplexityToken();
    
    const body = {
      model: PPLX_MODEL,
      messages: [
        { 
          role: 'system' as const, 
          content: system 
        },
        { 
          role: 'user' as const, 
          content: user 
        },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${REQUEST_TIMEOUT}ms`));
    }, REQUEST_TIMEOUT);

    try {
      const startTime = Date.now();
      const fetchPromise = fetch(PPLX_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PPLX_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const res = await Promise.race([
        fetchPromise,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT)
        )
      ]);

      clearTimeout(timeoutId);
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();
      let content = data.choices[0]?.message?.content || 'na';
      if (content !== 'na') {
        content = extractNameFromResponse(content);
      }
      
      console.log(`[${attempt}] Request completed - Time: ${duration.toFixed(2)}s`);
      
      return {
        content,
        cost: data.usage?.total_tokens * PPLX_COST_PER_1K_TOKENS / 1000 || 0,
        status: 'success' as const
      };
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      throw error;
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
      
      if (attempt < MAX_ATTEMPTS && !error.message.includes('HTTP error! status: 429')) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        return callPerplexity(user, system, attempt + 1);
      }
      
      console.error('Final error in callPerplexity:', error.message);
    } else {
      console.error('Unknown error in callPerplexity:', error);
    }
    
    return { content: 'na', cost: 0, status: 'error' };
  }
}

async function callFindymail(name: string, domain: string): Promise<string> {
  const REQUEST_TIMEOUT = 20000;
  
  if (!FINDYMAIL_API_KEY || !name || name.toLowerCase() === 'na' || !domain) return 'na';
  
  try {
    await waitForFindymailToken();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Findymail request timed out after ${REQUEST_TIMEOUT}ms`));
    }, REQUEST_TIMEOUT);

    try {
      const response = await fetch(FINDYMAIL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FINDYMAIL_API_KEY}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim()
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.error(`Findymail API error: ${response.status}`);
        return 'na';
      }

      const data = await response.json();
      return data.contact?.email || 'na';
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Error in callFindymail:', error);
      return 'na';
    }
  } catch (error) {
    console.error('Error in callFindymail:', error);
    return 'na';
  }
}

async function processRow(row: EnrichRow, jobTitle: string, rowIndex: number) {
  const website = getHeaderCaseInsensitive(row, 'website') || '';
  const company = getHeaderCaseInsensitive(row, 'company') || '';
  const domain = normalizeDomain(website);
  const { user, system } = generatePrompt(company, domain, jobTitle);

  let content = 'na';
  let cost = 0;
  let status = 'error';
  let duration = 0;
  let attempts = 0;

  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    const startTime = Date.now();
    try {
      console.log(`[${rowIndex}] Attempt ${attempt}...`);
      const result = await callPerplexity(user, system);
      duration = (Date.now() - startTime) / 1000;
      console.log(`[${rowIndex}] Attempt ${attempt}: ${result.status} - Time: ${duration.toFixed(2)}s`);
      
      if (result.status === 'success') {
        content = result.content;
        cost = result.cost;
        status = result.status;
        break;
      }
    } catch (error) {
      duration = (Date.now() - startTime) / 1000;
      console.error(`[${rowIndex}] Attempt ${attempt} failed after ${duration.toFixed(2)}s:`, error);
    }
    
    if (attempt < CONFIG.maxRetries) {
      const backoff = Math.pow(2, attempt) * 1000;
      console.log(`[${rowIndex}] Waiting ${backoff}ms before retry...`);
      await new Promise(r => setTimeout(r, backoff));
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
    'Attempts': attempts,
  }));
}

async function enrichRow(row: EnrichRow) {
  const name = getHeaderCaseInsensitive(row, 'Found Person Name') || '';
  const domain = getHeaderCaseInsensitive(row, 'Normalized Domain') || 
                 normalizeDomain(getHeaderCaseInsensitive(row, 'website') || '');
  
  let personEmail = 'na';
  let websiteEmail = 'na';
  
  if (name && name.toLowerCase() !== 'na' && domain) {
    personEmail = await callFindymail(name, domain);
  }

  if ((!personEmail || personEmail.toLowerCase() === 'na') && domain) {
    const { user, system } = generateFallbackPrompt(domain);
    
    for (let i = 0; i < 3; i++) {
      const result = await callPerplexity(user, system);
      if (result.status === 'success' && 
          result.content && 
          result.content.includes('@') && 
          result.content.includes('.')) {
        websiteEmail = cleanEmail(result.content);
        break;
      }
    }
  }

  const finalEmail = (personEmail && personEmail.toLowerCase() !== 'na') ? 
                    personEmail : websiteEmail;

  const company = getHeaderCaseInsensitive(row, 'company');
  if (company && finalEmail !== 'na') {
    companyEmailCache.set(company, finalEmail);
  }
  if (domain && websiteEmail !== 'na') {
    domainEmailCache.set(domain, websiteEmail);
  }

  return {
    ...row,
    'Person Email': personEmail,
    'Website Email': websiteEmail,
    'Final Email': finalEmail
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

    let nameResults: EnrichRow[] = [];
    
    console.log(`🔸 Processing ${expandedRows.length} rows with ${CONFIG.workerCount} workers...`);
    
    const rowProcessor = async (row: EnrichRow) => {
      const rowIndex = expandedRows.indexOf(row);
      return processRow(row, row['Desired Job Title'], rowIndex);
    };
    
    const workerPool = new WorkerPool<EnrichRow, EnrichRow[]>(
      CONFIG.workerCount,
      CONFIG.requestsPerSecond,
      rowProcessor
    );
    
    const batchResults = await workerPool.process(expandedRows, 30 * 60 * 1000);
    nameResults = batchResults.flat();
    
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

    console.log(`🔹 Saving ${deduplicatedResults.length} enriched results to database...`);
    
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