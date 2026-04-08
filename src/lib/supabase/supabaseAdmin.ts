import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';

const adminUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key';

export const supabaseAdmin = createClient<Database>(
  adminUrl,
  adminKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
); 