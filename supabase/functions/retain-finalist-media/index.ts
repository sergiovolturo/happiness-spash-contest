import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL');
const secretMap = Deno.env.get('SUPABASE_SECRET_KEYS');
let secretKey = '';
if (secretMap) {
  try {
    const parsed = JSON.parse(secretMap);
    secretKey = parsed.default || Object.values(parsed)[0] || '';
  } catch {
    secretKey = '';
  }
}
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || secretKey;
if (!url || !serviceKey) throw new Error('server_key_unavailable');

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retention-worker-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers, 'Content-Type': 'application/json' },
});

const callerIsAdmin = async (request: Request) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return false;
  const { data: row, error: adminError } = await admin
    .from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  return !adminError && !!row;
};

const sameSecret = (provided: string, expected: string) => {
  if (!provided || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
};

const hasWorkerToken = (request: Request) => {
  const expected = Deno.env.get('RETENTION_WORKER_TOKEN') || '';
  const provided = request.headers.get('x-retention-worker-token') || '';
  return sameSecret(provided, expected);
};

const runRetention = async (contestId?: string) => {
  const contestsQuery = admin.from('contests').select('id').eq('status', 'CLOSED');
  const { data: contests, error: contestError } = contestId
    ? await contestsQuery.eq('id', contestId)
    : await contestsQuery;
  if (contestError) throw contestError;

  let prepared = 0;
  let completed = 0;
  for (const contest of contests || []) {
    const { data: requests, error: prepareError } = await admin.rpc(
      'admin_prepare_finalist_media_retention', { p_contest_id: contest.id },
    );
    if (prepareError) throw prepareError;
    for (const request of requests || []) {
      prepared += 1;
      const { error: removeError } = await admin.storage
        .from(request.storage_bucket).remove([request.storage_path]);
      if (removeError) continue;
      const { error: finalizeError } = await admin.rpc(
        'admin_finalize_finalist_media_retention', { p_request_id: request.request_id },
      );
      if (!finalizeError) completed += 1;
    }
  }
  return { prepared, completed };
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!hasWorkerToken(request) && !await callerIsAdmin(request)) return json({ error: 'not_authorized' }, 403);
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runRetention(typeof body.contest_id === 'string' ? body.contest_id : undefined);
    return json({ status: 'completed', ...result });
  } catch {
    return json({ error: 'retention_failed' }, 500);
  }
});
