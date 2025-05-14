import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase/supabaseAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, firstName, lastName } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    
    const { data: existingUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (userError && userError.code !== 'PGRST116') { 
      throw userError;
    }

    
    if (!existingUser) {
      const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: userId,
          first_name: firstName || '',
          last_name: lastName || '',
        });

      if (insertError) {
        
        if (insertError.code === '23505') {
          return res.status(200).json({ message: 'User record already exists' });
        }
        throw insertError;
      }
    }

    return res.status(200).json({ message: 'User record created/verified successfully' });
  } catch (error) {
    console.error('Error creating user:', error);
    return res.status(500).json({ 
      error: 'Failed to create user record',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 