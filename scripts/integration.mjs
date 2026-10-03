import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { checkAttachments } from './attachment-checks.mjs';

// Uses its own local D1 state. Never touches the developer's DB or a remote DB.
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const state = `.wrangler/integration-${Date.now()}`;
const port = 8791;
async function wrangler(args) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: 'pipe', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(output);
  return output;
}
const config = ['--config', 'wrangler.toml', '--persist-to', state];
await wrangler(['d1', 'migrations', 'apply', 'DB', '--local', ...config]);
const server = spawn(process.execPath, [cli, 'dev', '--ip', '127.0.0.1', '--port', String(port), ...config], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
let logs = '';
server.stdout.on('data', d => logs += d);
server.stderr.on('data', d => logs += d);
const root = `http://127.0.0.1:${port}`;
async function request(path, method = 'GET', body, headers = {}) {
  const response = await fetch(root + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  return { status: response.status, result, headers: response.headers };
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(root + '/api/config')).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise(r => setTimeout(r, 300));
  }
  assert.ok(ready, logs);
  const initial = await request('/api/config');
  assert.equal(initial.result.linkLength, 8);
  const publicAdminStatus = await new Promise((resolveStatus, reject) => {
    const req = httpRequest(root + '/api/admin/stats', { headers: { host: 'notes.example.com', 'cf-access-jwt-assertion': 'forged-token' } }, res => { res.resume(); resolveStatus(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(publicAdminStatus, 401, 'public host must not use local-admin bypass or accept forged JWT');
  const draft = (await request('/api/new', 'POST', {})).result;
  assert.equal((await request(`/api/notes/${draft.id}`)).status, 404);
  assert.equal((await request('/api/admin/stats')).result.active, 0, 'empty link must not create DB note');
  const created = await request(`/api/notes/${draft.id}`, 'PUT', { content: '# Hello 中文', createToken: draft.createToken });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.equal((await request(`/api/notes/${draft.id}`, 'PUT', { content: 'collision', createToken: draft.createToken })).status, 409);
  const noChange = await request(`/api/notes/${draft.id}`, 'PUT', { content: '# Hello 中文' });
  assert.equal(noChange.result.expiresAt, created.result.expiresAt, 'no-op save must not renew');
  const changed = await request(`/api/notes/${draft.id}`, 'PUT', { content: 'last writer' });
  assert.equal(changed.result.content, 'last writer');
  assert.equal((await request(`/api/notes/${draft.id}`, 'PUT', { content: '' })).status, 200, 'existing notes may be emptied');
  assert.equal((await request(`/api/notes/${draft.id}`, 'PUT', { content: '中'.repeat(70000) })).status, 413);
  assert.equal((await request('/api/admin/settings', 'PUT', { ...initial.result, backgroundUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await request('/api/admin/settings', 'PUT', { ...initial.result, linkLength: 3, retentionDays: 1 })).status, 200);
  assert.equal((await request('/api/new', 'POST', {})).result.id.length, 3);
  assert.equal((await request('/api/admin/cleanup', 'POST', { kind: 'all', confirmation: 'wrong' })).status, 400);
  assert.equal((await request('/api/admin/cleanup', 'POST', { kind: 'all', confirmation: '清空全部' }, { origin: 'https://evil.example' })).status, 403);
  await wrangler(['d1', 'execute', 'DB', '--local', ...config, '--command', 'UPDATE notes SET expires_at = 1']);
  assert.equal((await request(`/api/notes/${draft.id}`)).status, 404);
  assert.equal((await request(`/api/notes/${draft.id}`, 'PUT', { content: 'resurrect' })).status, 404);
  assert.equal((await request('/api/admin/stats')).result.expired, 1);
  const clean = await request('/api/admin/cleanup', 'POST', { kind: 'expired' });
  assert.equal(clean.result.deleted, 1);
  assert.equal(clean.result.remaining, 0);
  const another = (await request('/api/new', 'POST', {})).result;
  await request(`/api/notes/${another.id}`, 'PUT', { content: 'delete me', createToken: another.createToken });
  await wrangler(['d1', 'execute', 'DB', '--local', ...config, '--command', 'UPDATE notes SET expires_at = 1']);
  const scheduled = await fetch(root + '/cdn-cgi/local/scheduled');
  assert.equal(scheduled.status, 200, 'local scheduled handler should execute');
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await request('/api/admin/stats')).result.expired === 0) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal((await request('/api/admin/stats')).result.expired, 0, 'scheduled job removes expired records');
  const finalNote = (await request('/api/new', 'POST', {})).result;
  await request(`/api/notes/${finalNote.id}`, 'PUT', { content: 'clear all test', createToken: finalNote.createToken });
  assert.equal((await request('/api/admin/cleanup', 'POST', { kind: 'all', confirmation: '清空全部' })).result.deleted, 1);
  assert.equal((await request('/api/config')).result.retentionDays, 1, 'cleanup must preserve settings');
  const malformed = await fetch(root + '/api/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await fetch(root + '/n/abc')).status, 200, 'SPA deep links work');
  await checkAttachments({root,request,sql:command=>wrangler(['d1','execute','DB','--local',...config,'--command',command])});
  console.log('Integration passed: create, save, collisions, UTF-8 limit, no-op expiry, settings, CSRF, public admin rejection, expiration, scheduled cleanup and SPA.');
} catch (error) {
  console.error(logs.slice(-12000));
  throw error;
} finally {
  // Wrangler owns workerd; gracefully close its input before terminating the CLI.
  server.stdin.end();
  server.kill();
}
