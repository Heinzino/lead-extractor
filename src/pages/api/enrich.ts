import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabase/supabaseAdmin';
import { parse } from 'csv-parse/sync';
import formidable from 'formidable';
import { promises as fs } from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {    
   
    const form = formidable({});
    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    const file = files.file?.[0];
    const jobTitles = fields.jobTitles?.[0];
    const fileName = fields.fileName?.[0];
    const userId = fields.userId?.[0];

    if (!file || !jobTitles || !fileName || !userId) {
      console.error('Missing required fields:', { 
        file: !!file, 
        jobTitles: !!jobTitles, 
        fileName: !!fileName,
        userId: !!userId 
      });
      return res.status(400).json({ error: 'Missing required fields: file, jobTitles, fileName, and userId' });
    }

    const { data: record, error: dbError } = await supabaseAdmin
      .from('enrich_results')
      .insert({
        user_id: userId,
        file_name: fileName,
        status: 'RUNNING',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (dbError) {
      console.error('Error creating record:', dbError);
      return res.status(500).json({ error: 'Error creating record' });
    }


   
    const fileContent = await fs.readFile(file.filepath, 'utf-8');
    
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    if (records.length === 0) {
      console.error('No records found in CSV file');
      return res.status(400).json({ error: 'No records found in CSV file' });
    }

    const baseUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
    fetch(`${baseUrl}/api/enrich/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resultId: record.id,
        records,
        jobTitles: jobTitles.split(',').map((t: string) => t.trim())
      }),
    }).catch(error => {
      console.error('Error starting background processing:', error);
      supabaseAdmin
        .from('enrich_results')
        .update({
          status: 'ERROR',
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', record.id);
    });

    return res.status(200).json({ 
      success: true,
      resultId: record.id
    });
  } catch (error) {
    console.error('Error in enrich API:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
} 