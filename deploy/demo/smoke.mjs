import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEMO_FAVORITE_RESOURCE_IDS, DEMO_LIST_VIEWS, DEMO_MEDIA, DEMO_ORGANIZATION, DEMO_RESOURCES } from '../../scripts/demo-seed-manifest.mjs';

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
assert.deepEqual(
  resources.filter(({ isFavorite }) => isFavorite).map(({ id }) => id).sort(),
  [...DEMO_FAVORITE_RESOURCE_IDS].sort(),
  'Seeded favorites in inventory',
);
const favoritesResponse = await request('/api/v1/resources?favorites=true&pageSize=100');
assert.equal(favoritesResponse.status, 200);
const favorites = await favoritesResponse.json();
assert.deepEqual(favorites.resources.map(({ id }) => id).sort(), [...DEMO_FAVORITE_RESOURCE_IDS].sort());
assert.ok(favorites.resources.every(({ isFavorite }) => isFavorite));
for (const { scope, collection } of DEMO_LIST_VIEWS) {
  const response = await request(`/api/v1/user/list-views?scope=${encodeURIComponent(scope)}`);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.deepEqual(saved.collection, collection, `${scope}: saved default grid view`);
  assert.equal(saved.canSave, false);
}
console.log('Default grid views and two seeded favorites verified');
for (const media of DEMO_MEDIA) {
  const resource = resources.find(({ id }) => id === media.resourceId);
  assert.ok(resource, `Missing resource for ${media.filename}`);
  const attachedImage = resource.media.find(({ id }) => id === media.id);
  assert.ok(attachedImage, `${resource.name}: missing attached image`);
  assert.equal(attachedImage.url, `/api/files/demo/${media.filename}`);
  assert.equal(attachedImage.kind, 'image');
  assert.equal(attachedImage.position, media.position, `${resource.name}: gallery position`);
  if (media.position === 0) {
    assert.equal(resource.cover?.id, media.id, `${resource.name}: displayed cover`);
  }
  assert.equal(attachedImage.altText, media.altText);
  const image = await request(`/api/files/demo/${media.filename}`);
  assert.equal(image.status, 200, media.filename);
  assert.match(image.headers.get('content-type'), /^image\/webp\b/);
  const hash = createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex');
  assert.equal(hash, media.sha256, media.filename);
}
for (const resource of resources) {
  const expected = DEMO_RESOURCES.find(({ id }) => id === resource.id);
  assert.ok(expected, `${resource.name}: unexpected demo resource`);
  assert.equal(resource.description, expected.description, `${resource.name}: description`);
  assert.equal(resource.notes, expected.notes, `${resource.name}: notes`);
  const images = resource.media.filter(({ kind }) => kind === 'image');
  const expectedImages = DEMO_MEDIA.filter(({ resourceId }) => resourceId === resource.id)
    .sort((left, right) => left.position - right.position);
  assert.deepEqual(images.map(({ position }) => position), [0, 1, 2], `${resource.name}: three ordered images`);
  assert.deepEqual(images.map(({ id }) => id), expectedImages.map(({ id }) => id), `${resource.name}: gallery order`);
}
console.log(`Demo viewer, read-only tenant, ${resources.length} resources and ${DEMO_MEDIA.length} attached generated images verified`);
const roomResponse = await request('/api/v1/room-scans/d3e00000-0000-4000-8000-000000000901');
assert.equal(roomResponse.status, 200, 'Demo office scan must be available');
const { scene: room } = await roomResponse.json();
assert.equal(room.room.id, 'd3e00000-0000-4000-8000-000000000102');
assert.equal(room.scan.scene.surfaces.length, 7);
assert.equal(room.scan.scene.objects.length, 10);
assert.equal(room.scan.scene.mapAnchor, undefined);
assert.equal(room.scan.aiAnalysis, null);
assert.deepEqual(room.scan.assets, []);
assert.deepEqual(room.scan.keyframes, []);
assert.deepEqual(room.placements.map(p => p.resource.id).sort(), [
  'd3e00000-0000-4000-8000-000000000202',
  'd3e00000-0000-4000-8000-000000000203',
]);
console.log('Office geometry and two demo item placements verified; no original photos or map location');
await checkDenied('Authenticated');
const action = await request('/demo/inventory', { method: 'POST', headers: { 'Next-Action': 'demo-smoke' } });
assert.equal(action.status, 403);
const page = await request('/demo/inventory');
assert.equal(page.status, 200);
assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
console.log('Inventory page, CSP and Server Action denial verified');
