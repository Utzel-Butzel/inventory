import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEMO_MEDIA, DEMO_ORGANIZATION, DEMO_RESOURCES } from '../../scripts/demo-seed-manifest.mjs';

const base = new URL(process.argv[2] || 'https://demo.openinventory.polyxo.de');
assert.equal(base.hostname, 'demo.openinventory.polyxo.de', 'Run only against the isolated demo.');
const cookies = new Map();
async function request(path, options = {}) {
  const response = await fetch(new URL(path, base), {
    redirect: 'manual',
    ...options,
    headers: {
      cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}

const nonexistent = '11111111-1111-4111-8111-111111111111';
async function checkDenied(label) {
  for (const [method, path] of [
    ['POST', '/api/v1/resources'],
    ['PATCH', `/api/v1/resources/${nonexistent}`],
    ['DELETE', `/api/v1/resources/${nonexistent}`],
    ['POST', `/api/v1/resources/${nonexistent}/media`],
    ['PUT', '/api/files/demo/blocked-upload'],
    ['POST', '/api/v1/ai/recognize'],
    ['GET', '/api/v1/ai/count/jobs'],
    ['POST', '/api/v1/organizations'],
    ['POST', '/api/v1/stock/action-chains/execute'],
    ['GET', '/api/cron/notifications'],
    ['POST', '/demo/inventory'],
  ]) {
    const response = await request(path, { method });
    assert.equal(response.status, 403, `${label}: ${method} ${path}`);
    await response.arrayBuffer();
  }
  console.log(`${label}: 11 write/upload/AI/worker requests blocked`);
}

const landing = await request('/');
assert.equal(landing.status, 302);
assert.equal(new URL(landing.headers.get('location'), base).href, `${base.origin}/login?demo=1`);
await checkDenied('Unauthenticated');
const csrf = await request('/api/auth/csrf');
assert.equal(csrf.status, 200);
const { csrfToken } = await csrf.json();
assert.ok(csrfToken);
const login = await request('/api/auth/callback/demo', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' },
  body: new URLSearchParams({ csrfToken, callbackUrl: `${base.origin}/demo/inventory` }),
});
assert.equal(login.status, 200);
assert.ok(!((await login.json()).url || '').includes('error'));
const session = await (await request('/api/auth/session')).json();
assert.equal(session.user?.authProvider, 'demo');
assert.equal(session.user?.role, 'viewer');
const organizations = await request('/api/v1/organizations');
assert.equal(organizations.status, 200);
const organizationData = JSON.stringify(await organizations.json());
assert.ok(organizationData.includes(DEMO_ORGANIZATION.id));
assert.ok(organizationData.includes('"isReadOnly":true'));
const inventory = await request('/api/v1/resources?pageSize=100');
assert.equal(inventory.status, 200);
const { resources } = await inventory.json();
assert.equal(resources.length, DEMO_RESOURCES.length);
for (const media of DEMO_MEDIA) {
  const image = await request(`/api/files/demo/${media.filename}`);
  assert.equal(image.status, 200, media.filename);
  const hash = createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex');
  assert.equal(hash, media.sha256, media.filename);
}
console.log('Demo viewer, read-only tenant, 8 resources and 5 generated images verified');
await checkDenied('Authenticated');
const action = await request('/demo/inventory', { method: 'POST', headers: { 'Next-Action': 'demo-smoke' } });
assert.equal(action.status, 403);
const page = await request('/demo/inventory');
assert.equal(page.status, 200);
assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
console.log('Inventory page, CSP and Server Action denial verified');
