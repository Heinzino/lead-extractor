/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { IncomingForm } from 'formidable';

export const config = {
  api: {
    bodyParser: false,
  },
};

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
  return name.replace(/\[.*?\]/g, '').replace(/[.,]+$/, '').trim();
}

function cleanEmail(email: string): string {
  return email.replace(/\[.*?\]/g, '').replace(/[.,]+$/, '').trim();
}

function generatePrompt(company: string, domain: string, jobTitle: string) {
  const user = `Hello, can you help me find the person who holds the jobtitle: ${jobTitle} at company: ${company} which has website: ${domain}?

IMPORTANT:
Only return a person's full name if you are at least 95% confident that the individual actually holds the job title requested.
If you cannot confidently verify this match, return \"na\" instead.`;
  const system = `Please return ONLY the full name of the person matching the requested job title if you are at least 95% confident they hold it.
If you are not 95% confident, return 'na'.
Return nothing else.`;
  return { user, system };
}

function generateFallbackPrompt(domain: string) {
  const user = `For the company website ${domain}, please try to identify a contact email address found on the website. Please return a cleaned email address and nothing else.

If email is not found return na.`;
  const system = `The only thing that should ever be outputted is an email if it was found or \"na\".`;
  return { user, system };
}

async function callPerplexity(user: string, system: string) {
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

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content?.trim() || 'na';
  const tokens = json.usage?.total_tokens || 1000;
  const cost = (tokens / 1000) * PPLX_COST_PER_1K_TOKENS;
  return { content, cost, status: 'success' };
}

async function callFindymail(name: string, domain: string) {
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const form = new IncomingForm({ keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err || !files.file || !fields.jobTitles) {
      return res.status(400).json({ error: 'Missing required input.' });
    }

    const jobTitles = String(fields.jobTitles).split(',').map(t => t.trim());
    //@ts-expect-error fix this later
    const filePath = Array.isArray(files.file) ? files.file[0].filepath : files.file.filepath;

    const csv = fs.readFileSync(filePath, 'utf8');
    const records = parse(csv, { columns: true });
    let enrichedRows: any[] = [];

    for (const row of records) {
      const domain = normalizeDomain(row['Company website']);

      for (const jobTitle of jobTitles) {
        const { user, system } = generatePrompt(row['Company name'], domain, jobTitle);

        let content = 'na';
        let cost = 0;
        let status = 'error';
        let attempts = 0;

        for (let i = 0; i < 5; i++) {
          try {
            const result = await callPerplexity(user, system);
            content = cleanName(result.content);
            cost = result.cost;
            status = result.status;
            break;
          } catch {
            await new Promise(r => setTimeout(r, 2 ** i * 1000));
          }
          attempts++;
        }

        let personEmail = 'na';
        let websiteEmail = 'na';

        if (content && content.toLowerCase() !== 'na') {
          personEmail = cleanEmail(await callFindymail(content, domain));
        }

        if (!personEmail || personEmail.toLowerCase() === 'na') {
          const fallback = generateFallbackPrompt(domain);
          const fallbackResult = await callPerplexity(fallback.user, fallback.system);
          websiteEmail = cleanEmail(fallbackResult.content);
        }

        const finalRow = {
          ...row,
          'Normalized Domain': domain,
          'Desired Job Title': jobTitle,
          'Found Person Name': content,
          'Total Cost': cost.toFixed(6),
          'Annotation': status,
          'Attempts': attempts + 1,
          'Person Email': personEmail,
          'Website Email': websiteEmail,
          'Final Email': personEmail !== 'na' ? personEmail : websiteEmail,
        };

        enrichedRows.push(finalRow);
      }
    }

    const output = stringify(enrichedRows, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="enriched-data.csv"');
    res.status(200).send(output);
  });
}
