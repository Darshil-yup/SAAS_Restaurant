import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://example.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy';

let inMemoryStorage = {};
const customMemoryStorage = {
  getItem: (key) => inMemoryStorage[key] || null,
  setItem: (key, value) => { inMemoryStorage[key] = value; },
  removeItem: (key) => { delete inMemoryStorage[key]; }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    storage: customMemoryStorage,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

let isHubAuthenticated = false;

export const checkSupabaseConnection = async () => {
  if (SUPABASE_URL.includes('example.supabase.co')) {
    return { online: false, isNetworkError: true, error: { message: 'Default unconfigured Supabase URL' } };
  }
  try {
    // Ping Supabase REST endpoint to verify network-level connectivity
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'GET',
      headers: { 'apikey': SUPABASE_KEY }
    });
    // Any HTTP status response (200, 400, 401, 403, 404, etc.) confirms network is ONLINE
    return { online: true, status: response.status };
  } catch (err) {
    // True network errors: ENOTFOUND, ECONNREFUSED, fetch failed
    return {
      online: false,
      isNetworkError: true,
      error: { message: err.message || 'Fetch failed', code: err.code || err.name || 'unknown' }
    };
  }
};

/**
 * Phase 2 Auth Strategy: Authenticates the hub server as a dedicated 'kitchen' staff member
 * for the paired restaurant ID. Uses anonymous auth + staff_users row mapping.
 * Avoids service_role key to respect Supabase RLS policies.
 */
export const authenticateHubStaff = async (restaurantId, kitchenPin = '9842', force = false) => {
  if (!restaurantId || SUPABASE_URL.includes('example.supabase.co')) {
    return { success: false, reason: 'Offline or default Supabase URL' };
  }

  // If already authenticated and session is active, reuse existing session
  if (isHubAuthenticated && !force) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      return { success: true, staff_id: 'cached', user_id: session.user.id };
    }
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
      console.log(`🔐 Hub authenticated as kitchen staff member (Staff ID: ${existingStaff.id}, Auth UID: ${userId})`);
      isHubAuthenticated = true;
      return { success: true, staff: existingStaff, user_id: userId };
    }

    // 3. Call provision_kitchen_staff RPC to handle pin_hash creation & user_id binding
    const { data: staffId, error: rpcErr } = await supabase.rpc('provision_kitchen_staff', {
      p_restaurant_id: restaurantId,
      p_pin: kitchenPin,
      p_user_id: userId
    });

    if (rpcErr) {
      console.warn('⚠️ Could not provision kitchen staff role via RPC:', rpcErr.message);
      // Fallback: Bind user_id to existing kitchen staff record if already present
      const { data: updatedStaff, error: updateErr } = await supabase
        .from('staff_users')
        .update({ user_id: userId })
        .eq('restaurant_id', restaurantId)
        .eq('role', 'kitchen')
        .select()
        .maybeSingle();

      if (!updateErr && updatedStaff) {
        console.log(`✅ Linked existing kitchen staff record to Hub session (Staff ID: ${updatedStaff.id}, Auth UID: ${userId})`);
        isHubAuthenticated = true;
        return { success: true, staff: updatedStaff, user_id: userId };
      }

      return { success: false, error: rpcErr.message };
    }

    console.log(`✅ Provisioned & bound dedicated 'kitchen' staff role for Hub (Staff ID: ${staffId}, Auth UID: ${userId})`);
    isHubAuthenticated = true;
    return { success: true, staff_id: staffId, user_id: userId };
  } catch (err) {
    console.warn('⚠️ Hub staff auth process error:', err.message);
    return { success: false, error: err.message };
  }
};

