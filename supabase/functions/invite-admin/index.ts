import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleInviteAdminRequest } from './logic.mjs';

const readServerKey = () => {
  const secretMap = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretMap) {
    try {
      const parsed = JSON.parse(secretMap);
      const secret = parsed.default || Object.values(parsed)[0];
      if (typeof secret === 'string' && secret) return secret;
    } catch {
      // Fall through to the legacy injected key.
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('server_key_unavailable');
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  readServerKey(),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve((request) => handleInviteAdminRequest(request, admin));
