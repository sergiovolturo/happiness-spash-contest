const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requireAdmin = async (request, admin) => {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return null;
  const { data: row, error: adminError } = await admin.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  if (adminError || !row) return null;
  return user;
};

const findUserByEmail = async (admin, email) => {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => normalizeEmail(user.email) === email);
    if (match) return match;
    if (data.users.length < 100) return null;
  }
  return null;
};

const listAdmins = async (admin) => {
  const { data: rows, error } = await admin.from('admin_users').select('user_id, created_at').order('created_at', { ascending: true });
  if (error) throw error;
  const ids = (rows || []).map((row) => row.user_id);
  const profiles = ids.length ? await admin.from('profiles').select('id, full_name').in('id', ids) : { data: [], error: null };
  if (profiles.error) throw profiles.error;
  const profileById = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
  const admins = [];
  for (const row of rows || []) {
    const { data, error: userError } = await admin.auth.admin.getUserById(row.user_id);
    if (userError || !data.user) continue;
    admins.push({
      user_id: row.user_id,
      email: data.user.email || null,
      full_name: profileById.get(row.user_id)?.full_name || null,
      status: data.user.email_confirmed_at ? 'attivo' : 'invitato',
      created_at: row.created_at,
    });
  }
  return admins;
};

export const handleInviteAdminRequest = async (request, admin) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    if (!await requireAdmin(request, admin)) return json({ error: 'not_authorized' }, 403);
    const body = await request.json().catch(() => ({}));
    if (body.action === 'list') return json({ admins: await listAdmins(admin) });
    if (body.action !== 'invite') return json({ error: 'invalid_request' }, 400);

    const email = normalizeEmail(body.email);
    if (!emailPattern.test(email) || email.length > 320) return json({ error: 'invalid_email' }, 400);

    const existing = await findUserByEmail(admin, email);
    if (existing) {
      const { data: existingAdmin, error: existingAdminError } = await admin.from('admin_users').select('user_id').eq('user_id', existing.id).maybeSingle();
      if (existingAdminError) throw existingAdminError;
      return json({ error: existingAdmin ? 'already_admin' : 'user_already_exists' }, 409);
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteError || !invited.user?.id) {
      console.error('invite-admin: invite failed');
      return json({ error: 'invite_failed' }, 502);
    }
    const { error: linkError } = await admin.from('admin_users').insert({ user_id: invited.user.id });
    if (linkError) {
      await admin.auth.admin.deleteUser(invited.user.id);
      console.error('invite-admin: admin linkage failed');
      return json({ error: 'invite_failed' }, 502);
    }
    return json({ status: 'invited' }, 201);
  } catch {
    console.error('invite-admin: request failed');
    return json({ error: 'request_failed' }, 500);
  }
};
