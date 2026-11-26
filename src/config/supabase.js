const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const isConfigured = Boolean(url && publicKey && secretKey);

const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

const supabaseAdmin = isConfigured ? createClient(url, secretKey, options) : null;
const createAuthClient = () => {
  if (!isConfigured) return null;
  return createClient(url, publicKey, options);
};

module.exports = { supabaseAdmin, createAuthClient, isConfigured };
