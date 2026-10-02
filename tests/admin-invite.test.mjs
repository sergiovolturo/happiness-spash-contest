import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const functionSource = fs.readFileSync(new URL('../supabase/functions/invite-admin/index.ts', import.meta.url), 'utf8');
const functionConfig = fs.readFileSync(new URL('../supabase/functions/invite-admin/config.toml', import.meta.url), 'utf8');

test('admin invite is server-side and JWT protected', () => {
  assert.match(functionConfig, /verify_jwt\s*=\s*true/);
  assert.match(functionSource, /auth\.getUser\(token\)/);
  assert.match(functionSource, /from\('admin_users'\)/);
  assert.match(functionSource, /inviteUserByEmail/);
  assert.match(functionSource, /admin\.auth\.admin\.deleteUser/);
  assert.doesNotMatch(index, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/i);
});

test('admin invite preserves the database-backed role and supports duplicate safety', () => {
  assert.match(functionSource, /existingAdmin/);
  assert.match(functionSource, /already_admin/);
  assert.match(functionSource, /user_already_exists/);
  assert.match(index, /supabase\.functions\.invoke\('invite-admin'/);
  assert.match(index, /adminAdministratorsToggle/);
  assert.match(index, /adminInviteForm/);
});

test('admin invite does not create an alternate role or Auth flow', () => {
  assert.doesNotMatch(functionSource, /app_metadata|user_metadata.*admin|role\s*:/i);
  assert.match(index, /Amministratori/);
  assert.match(index, /Invita nuovo Admin/);
});
