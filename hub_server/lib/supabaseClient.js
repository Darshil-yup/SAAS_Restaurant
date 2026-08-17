import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://example.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

export const checkSupabaseConnection = async () => {
  if (SUPABASE_URL.includes('example.supabase.co')) {
    return false;
  }
  try {
    const { error } = await supabase.from('restaurants').select('id').limit(1);
    return !error;
  } catch (err) {
    return false;
  }
};

/**
 * Phase 2 Auth Strategy: Authenticates the hub server as a dedicated 'kitchen' staff member
 * for the paired restaurant ID. Uses anonymous auth + staff_users row mapping.
 * Avoids service_role key to respect Supabase RLS policies.
 */
export const authenticateHubStaff = async (restaurantId) => {
  if (!restaurantId || SUPABASE_URL.includes('example.supabase.co')) {
    return { success: false, reason: 'Offline or default Supabase URL' };
  }

  try {
    // 1. Sign in anonymously if not already signed in
    let { data: { session }, error: authErr } = await supabase.auth.getSession();
    
    if (!session) {
      const authRes = await supabase.auth.signInAnonymously();
      session = authRes.data?.session;
      authErr = authRes.error;
    }

    if (authErr || !session?.user) {
      console.warn('ℹ️ Anonymous auth not enabled or failed:', authErr?.message || 'No session');
      return { success: false, error: authErr?.message };
    }

    const userId = session.user.id;

    // 2. Check if staff_users record exists for this user_id
    const { data: existingStaff, error: staffCheckErr } = await supabase
      .from('staff_users')
      .select('id, restaurant_id, role')
      .eq('user_id', userId)
      .maybeSingle();

    if (!staffCheckErr && existingStaff) {
      console.log(`🔐 Hub authenticated as kitchen staff member (Staff ID: ${existingStaff.id}, Tenant: ${existingStaff.restaurant_id})`);
      return { success: true, staff: existingStaff };
    }

    // 3. Create staff_users record for role = 'kitchen'
    const { data: newStaff, error: insertErr } = await supabase
      .from('staff_users')
      .insert({
        restaurant_id: restaurantId,
        user_id: userId,
        full_name: 'Kitchen Hub Server',
        role: 'kitchen',
        pin_code: '0000'
      })
      .select()
      .single();

    if (insertErr) {
      console.warn('⚠️ Could not insert staff_users row for hub kitchen role:', insertErr.message);
      return { success: false, error: insertErr.message };
    }

    console.log(`✅ Created & bound dedicated 'kitchen' staff role for Hub (Staff ID: ${newStaff.id})`);
    return { success: true, staff: newStaff };
  } catch (err) {
    console.warn('⚠️ Hub staff auth process error:', err.message);
    return { success: false, error: err.message };
  }
};

