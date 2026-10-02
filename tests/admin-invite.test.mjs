import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { handleInviteAdminRequest } from '../supabase/functions/invite-admin/logic.mjs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const edgeSource = fs.readFileSync(new URL('../supabase/functions/invite-admin/index.ts', import.meta.url), 'utf8');
const functionConfig = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

const makeRequest = (body, token = null) => new Request('https://example.test/functions/v1/invite-admin', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

const makeMockAdmin = ({ caller = { id: 'caller' }, adminIds = [], users = [], insertError = null } = {}) => {
  const calls = { invited: [], inserted: [], deleted: [] };
  const admin = {
    auth: {
      getUser: async (token) => token === 'valid-token' ? { data: { user: caller }, error: null } : { data: { user: null }, error: new Error('invalid') },
      admin: {
        listUsers: async () => ({ data: { users }, error: null }),
        inviteUserByEmail: async (email) => { calls.invited.push(email); return { data: { user: { id: 'new-user', email } }, error: null }; },
        deleteUser: async (id) => { calls.deleted.push(id); return { error: null }; },
        getUserById: async (id) => ({ data: { user: users.find((user) => user.id === id) }, error: null }),
      },
    },
    from: (table) => {
      const query = { filterId: null, selected: null };
      query.select = () => query;
      query.eq = (_column, value) => { query.filterId = value; return query; };
      query.maybeSingle = async () => {
        if (table !== 'admin_users') return { data: null, error: null };
        return { data: adminIds.includes(query.filterId) ? { user_id: query.filterId } : null, error: null };
      };
      query.order = async () => ({ data: adminIds.map((user_id) => ({ user_id, created_at: '2026-01-01T00:00:00Z' })), error: null });
      query.in = async () => ({ data: [], error: null });
      query.insert = async (row) => { calls.inserted.push(row); return { error: insertError }; };
      return query;
    },
  };
  return { admin, calls };
};

const responseBody = async (response) => ({ status: response.status, body: await response.json() });

test('unauthenticated and non-Admin callers are rejected by the real handler', async () => {
  const unauth = await responseBody(await handleInviteAdminRequest(makeRequest({ action: 'list' }), makeMockAdmin().admin));
  assert.equal(unauth.status, 403);
  const nonAdmin = await responseBody(await handleInviteAdminRequest(makeRequest({ action: 'list' }, 'valid-token'), makeMockAdmin({ adminIds: [] }).admin));
  assert.equal(nonAdmin.status, 403);
});

test('valid Admin receives validation errors before any invite attempt', async () => {
  const { admin, calls } = makeMockAdmin({ adminIds: ['caller'] });
  const result = await responseBody(await handleInviteAdminRequest(makeRequest({ action: 'invite', email: 'not-an-email' }, 'valid-token'), admin));
  assert.equal(result.status, 400);
  assert.deepEqual(calls.invited, []);
});

test('existing Admin and existing non-Admin Auth user are handled distinctly', async () => {
  const alreadyAdmin = makeMockAdmin({ adminIds: ['caller', 'existing'], users: [{ id: 'existing', email: 'existing@example.com' }] });
  const adminResult = await responseBody(await handleInviteAdminRequest(makeRequest({ action: 'invite', email: 'existing@example.com' }, 'valid-token'), alreadyAdmin.admin));
  assert.equal(adminResult.status, 409);
  assert.equal(adminResult.body.error, 'already_admin');

  const existingUser = makeMockAdmin({ adminIds: ['caller'], users: [{ id: 'existing', email: 'existing@example.com' }] });
  const userResult = await responseBody(await handleInviteAdminRequest(makeRequest({ action: 'invite', email: 'existing@example.com' }, 'valid-token'), existingUser.admin));
  assert.equal(userResult.status, 409);
  assert.equal(userResult.body.error, 'user_already_exists');
});

test('new invite uses inviteUserByEmail and links the returned user id', async () => {
  const { admin, calls } = makeMockAdmin({ adminIds: ['caller'] });
  const result = await responseBody(await handleInviteAdminRequest(makeRequest({ action: 'invite', email: 'New.Admin@Example.com' }, 'valid-token'), admin));
  assert.equal(result.status, 201);
  assert.deepEqual(calls.invited, ['new.admin@example.com']);
  assert.deepEqual(calls.inserted, [{ user_id: 'new-user' }]);
  assert.deepEqual(calls.deleted, []);
});

test('failed Admin linkage rolls back the newly invited Auth user', async () => {
  const { admin, calls } = makeMockAdmin({ adminIds: ['caller'], insertError: new Error('constraint') });
  const result = await responseBody(await handleInviteAdminRequest(makeRequest({ action: 'invite', email: 'new@example.com' }, 'valid-token'), admin));
  assert.equal(result.status, 502);
  assert.deepEqual(calls.deleted, ['new-user']);
});

test('production function is JWT protected, supports both server key generations, and frontend has no privileged key', () => {
  assert.match(functionConfig, /verify_jwt\s*=\s*true/);
  assert.match(edgeSource, /SUPABASE_SECRET_KEYS/);
  assert.match(edgeSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edgeSource, /createClient/);
  assert.doesNotMatch(index, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS|sb_secret_|service_role/i);
  assert.match(index, /supabase\.functions\.invoke\('invite-admin'/);
  assert.match(index, /adminAdministratorsToggle/);
  assert.match(index, /Invita nuovo Admin/);
});
