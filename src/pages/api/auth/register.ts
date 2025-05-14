import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase/supabaseClient';
import { supabaseAdmin } from '../../../lib/supabase/supabaseAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password, firstName, lastName } = req.body;

    
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          email: !email,
          password: !password,
          firstName: !firstName,
          lastName: !lastName
        }
      });
    }

    
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      console.error('Auth error:', authError);
      throw authError;
    }

    if (!authData.user?.id) {
      throw new Error('No user ID returned from auth signup');
    }

    
    const { error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        first_name: firstName,
        last_name: lastName,
      });

    if (userError) {      
      if (userError.code === '23505') {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return res.status(400).json({ error: 'This email is already registered. Please use a different email or try logging in.' });
      }
      
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw userError;
    }

    return res.status(200).json({ 
      data: authData,
      message: 'User registered successfully'
    });
  } catch (error: unknown) {    
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }
    
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
} 