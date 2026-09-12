import test from 'node:test';
import assert from 'node:assert/strict';
import { server, sanitizeText } from './server.js';

test('sanitizeText removes angle brackets and caps input', () => {
  assert.equal(sanitizeText('<script>alert(1)</script>'), 'scriptalert(1)/script');
  assert.equal(sanitizeText('a'.repeat(20), 5), 'aaaaa');
});

test('sanitizeText rejects non-string values', () => {
  assert.equal(sanitizeText(null), '');
  assert.equal(sanitizeText({}), '');
});

test('account lifecycle persists data and deletes it', async () => {
  await new Promise(resolve => server.listen(0, resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const unauthenticated = await fetch(`${base}/api/overview`);
  assert.equal(unauthenticated.status, 401);

  const signup = await fetch(`${base}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email: `test-${Date.now()}@example.com`, password: 'correct horse battery staple' })
  });
  assert.equal(signup.status, 201);
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const overview = await fetch(`${base}/api/overview`, { headers: { Cookie: cookie } });
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).pipeline.industry, 'B2B SaaS');

  const discovery = await fetch(`${base}/api/discover`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'demo' }) });
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).targets.length, 3);
  const deletion = await fetch(`${base}/api/account`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(deletion.status, 200);
  server.close();
});

test('first-time sign-in creates an account instead of returning not found', async () => {
  await new Promise(resolve => server.listen(0, resolve));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/signin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `signin-${Date.now()}@example.com`, password: 'correct horse battery staple' })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).created, true);
  server.close();
});
