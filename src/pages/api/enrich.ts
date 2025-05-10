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
  const user = `Hello, can you help me find the person who holds the jobtitle: ${jobTitle} at company: ${company} which has website: ${domain}?\n\nIMPORTANT:\nOnly return a person's full name if you are at least 95% confident that the individual actually holds the job title requested.\nIf you cannot confidently verify this match, return \"na\" instead.`;
  const system = `Please return ONLY the full name of the person matching the requested job title if you are at least 95% confident they hold it.\nIf you are not 95% confident, return 'na'.\nReturn nothing else.`;
  return { user, system };
}

function generateFallbackPrompt(domain: string) {
  const user = `For the company website ${domain}, please try to identify a contact email address found on the website. Please return a cleaned email address and nothing else.\n\nIf email is not found return na.`;
  const system = `The only thing that should ever be outputted is an email if it was found or \"na\".`;
  return { user, system };
}

async function callPerplexity(user: string, system: string) {
  console.log('\n🔹 Calling Perplexity...');
  console.log('System prompt:', system);
  console.log('User prompt:', user);

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
  console.log('Perplexity response:', JSON.stringify(json, null, 2));

  return json.choices?.[0]?.message?.content?.trim() || 'na';
}

async function callFindymail(name: string, domain: string) {
  console.log('\n🔹 Calling Findymail...');
  console.log('Searching for:', name, 'at domain:', domain);

  const res = await fetch(FINDYMAIL_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FINDYMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, domain }),
  });

  const json = await res.json();
  console.log('Findymail response:', JSON.stringify(json, null, 2));

  if (!res.ok) return 'na';
  return json?.contact?.email || 'na';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const form = new IncomingForm({ keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err || !files.file || !fields.jobTitles) {
      console.error('❌ Missing required input:', { err, fields, files });
      return res.status(400).json({ error: 'Missing required input.' });
    }

    console.log('✅ Form fields received:', fields);
    const jobTitles = String(fields.jobTitles).split(',').map(t => t.trim());

    const filePath = Array.isArray(files.file) ? files.file[0].filepath : files.file.filepath;
    console.log('📄 Uploaded file path:', filePath);

    const csv = fs.readFileSync(filePath, 'utf8');
    const records = parse(csv, { columns: true });
    console.log(`📊 Parsed ${records.length} rows from CSV`);

    let enrichedRows: any[] = [];

    for (const row of records) {
      console.log('\n🔍 Processing row:', row);

      const domain = normalizeDomain(row['Company website']);
      console.log('🌐 Normalized domain:', domain);

      for (const jobTitle of jobTitles) {
        console.log(`\n🎯 Looking for job title "${jobTitle}" at "${row['Company name']}"`);

        const { user, system } = generatePrompt(row['Company name'], domain, jobTitle);
        const personName = cleanName(await callPerplexity(user, system));

        console.log('👤 Found person name:', personName);

        let personEmail = 'na';
        let websiteEmail = 'na';

        if (personName && personName.toLowerCase() !== 'na') {
          personEmail = cleanEmail(await callFindymail(personName, domain));
          console.log('📧 Person email from Findymail:', personEmail);
        }

        if (!personEmail || personEmail.toLowerCase() === 'na') {
          console.log('🔄 Falling back to website email...');
          const fallback = generateFallbackPrompt(domain);
          websiteEmail = cleanEmail(await callPerplexity(fallback.user, fallback.system));
          console.log('🌐 Website email from Perplexity:', websiteEmail);
        }

        const finalRow = {
          ...row,
          'Desired Job Title': jobTitle,
          'Found Person Name': personName,
          'Person Email': personEmail,
          'Website Email': websiteEmail,
          'Final Email': personEmail !== 'na' ? personEmail : websiteEmail,
        };

        console.log('✅ Enriched row:', finalRow);
        enrichedRows.push(finalRow);
      }
    }

    const output = stringify(enrichedRows, { header: true });
    console.log('\n✅ Final CSV ready. Returning response...');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="enriched-data.csv"');
    res.status(200).send(output);
  });
}
 