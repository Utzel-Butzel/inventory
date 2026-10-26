import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { labelWorkspaceMutationSchema } from '../lib/label-workspace-contract.ts';
import { serializePreparedLabel, deserializePreparedLabel } from '../lib/label-workspace-client.ts';
import { encodePtouchRaster } from '../lib/ptouch-raster.ts';
const resource = { id: randomUUID(), name: 'Helles Produkt', subtitle: 'Persistenztest', sku: null, barcode: null, location: null, type: 'product', quantity: 1, cover: { url: '/test.png', altText: '' } };
const label = { id: randomUUID(), name: resource.name, template: 'Foto', tape: 24, widthMm: 80,
  data: encodePtouchRaster({ width: 4, height: 1, data: new Uint8ClampedArray(16) }, 24), preview: 'data:image/png;base64,aGVsbG8=',
  resource, original: resource, setup: { id: 'ptouch-preset', name: 'Foto', widthMm: 80, heightMm: 18, elements: [{ type: 'image', x: 0, y: 0, width: 100, height: 100, visible: true, fit: 'contain', photoOptimization: 'auto' }], revision: 1, createdAt: '', updatedAt: '' } };

test('prepared label roundtrip preserves exact raster, photo mode, text and preview', () => {
 const wire = JSON.parse(JSON.stringify(serializePreparedLabel(label)));
 const parsed = labelWorkspaceMutationSchema.parse({ action: 'queue', revision: 0, labels: [wire] });
 const restored = deserializePreparedLabel(parsed.labels[0]);
 assert.deepEqual(restored.data, label.data);
 assert.equal(restored.resource.subtitle, label.resource.subtitle);
 assert.equal(restored.setup.elements[0].photoOptimization, 'auto');
 assert.equal(restored.preview, label.preview);
});
test('rejects invalid tape, non-image previews and excessive count', () => {
 assert.equal(labelWorkspaceMutationSchema.safeParse({ action: 'preferences', preferences: { tape: 99 } }).success, false);
 const wire = serializePreparedLabel(label);
 for (const labels of [[{...wire, preview:'https://tracker.example/test'}], Array(101).fill(wire)])
  assert.equal(labelWorkspaceMutationSchema.safeParse({action:'queue',revision:0,labels}).success, false);
});
test('database persistence, isolation and concurrent updates', { skip: !process.env.LABEL_WORKSPACE_DB_TEST }, async () => {
 const { db } = await import('../lib/db.ts');
 const { sql } = await import('drizzle-orm');
 const { readLabelWorkspace, updateLabelWorkspace } = await import('../lib/label-workspace.ts');
 const org = randomUUID(), otherOrg = randomUUID(), user = randomUUID(), otherUser = randomUUID();
 try {
  await db.execute(sql`INSERT INTO organizations (id,name,slug) VALUES (${org},'Label workspace test',${org}),(${otherOrg},'Isolation test',${otherOrg})`);
  await db.execute(sql`INSERT INTO users (id,email,name,password_hash) VALUES (${user},${user+'@test.invalid'},'Test','unused'),(${otherUser},${otherUser+'@test.invalid'},'Test','unused')`);
  const wire = serializePreparedLabel(label);
  const initial = await updateLabelWorkspace(org,user,{action:'queue',revision:0,labels:[wire]});
  assert.equal(initial.revision,1);
  assert.equal((await readLabelWorkspace(org,user)).labels[0].data,wire.data);
  assert.deepEqual((await readLabelWorkspace(org,otherUser)).labels,[]);
  assert.deepEqual((await readLabelWorkspace(otherOrg,user)).labels,[]);
  const racing = await Promise.allSettled([
   updateLabelWorkspace(org,user,{action:'queue',revision:1,labels:[]}),
   updateLabelWorkspace(org,user,{action:'queue',revision:1,labels:[wire]}),
  ]);
  assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(racing.find(r=>r.status==='rejected').reason.status,409);
  await updateLabelWorkspace(org,user,{action:'preferences',preferences:{setupId:'remember-me',tape:18}});
  await updateLabelWorkspace(org,user,{action:'preferences',preferences:{printTarget:'shared'}});
  const saved=await readLabelWorkspace(org,user);
  assert.deepEqual(saved.preferences,{setupId:'remember-me',tape:18,printTarget:'shared'});
  assert.equal(saved.revision,2);
  await assert.rejects(updateLabelWorkspace(org,user,{action:'queue',revision:2,labels:[{...wire,data:'aGVsbG8='}]}), {status:422});
 } finally {
  await db.execute(sql`DELETE FROM organizations WHERE id IN (${org},${otherOrg})`);
  await db.execute(sql`DELETE FROM users WHERE id IN (${user},${otherUser})`);
  await globalThis.inventorySql.end();
 }
});
