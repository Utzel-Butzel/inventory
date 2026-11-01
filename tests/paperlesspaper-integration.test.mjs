import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import handler, { inventoryApiUrl, parseStock, normalizeStock, loadData, fetchInventory } from '../integrations/paperlesspaper/api/data.js';
import options from '../integrations/paperlesspaper/api/options.js';

const item = (overrides = {}) => ({ resourceId: 'a', name: 'Frame', sku: 'FR-1', quantity: 8, minimumStock: 12, onOrder: 20, unitName: 'pcs', ...overrides });

test('instance and API URLs preserve deployment subpaths', () => {
  for (const url of ['https://example.com/inventory', 'https://example.com/inventory/', 'https://example.com/inventory/api/v1/']) {
    assert.equal(inventoryApiUrl(url), 'https://example.com/inventory/api/v1');
  }
  for (const url of ['', 'file:///etc/passwd', 'https://user:secret@example.com', 'https://example.com?key=secret', 'https://example.com/#fragment']) {
    assert.throws(() => inventoryApiUrl(url), (e) => !e.message.includes('secret'));
  }
});

test('uses real stock endpoint, Bearer auth and bounds; never returns the key', async () => {
  const data = await loadData({ baseUrl: 'https://example.com/api/v1', apiKey: 'inv_test-secret', language: 'en' }, async (url, opts) => {
    assert.equal(url, 'https://example.com/api/v1/stock');
    assert.equal(opts.headers.Authorization, 'Bearer inv_test-secret');
    assert.equal(opts.maxBytes, 2 * 1024 * 1024);
    assert.equal(opts.method, undefined);
    return { items: [item()] };
  });
  assert.equal(data.sample, false);
  assert.equal(data.metrics[1].value, 1);
  assert.doesNotMatch(JSON.stringify(data), /inv_test-secret|example.com/);
});

test('missing or invalid credentials do not fetch or fall back to demo data', async () => {
  for (const apiKey of ['', 'key\r\nInjected: header']) {
    await assert.rejects(loadData({ baseUrl: 'https://example.com', apiKey }, () => assert.fail('Unexpected network')));
  }
  await assert.rejects(loadData({ baseUrl: 'https://example.com', apiKey: 'inv_test' }, async () => { throw Error('inv_secret malicious provider response'); }), (e) => !e.message.includes('inv_secret'));
});

test('permission errors explain required read access without upstream details', async () => {
  for (const code of [401, 403]) {
    await assert.rejects(loadData({ baseUrl: 'https://example.com', apiKey: 'test', language: 'en' }, async () => { throw Error(`Source returned HTTP ${code}`); }), /stock read permissions/);
  }
});

test('null stock stays unknown and unlike units are never summed', () => {
  const items = parseStock({ items: [item({ quantity: null, minimumStock: null, onOrder: null }), item({ resourceId: 'b', name: 'Cable', quantity: 200, unitName: 'm' })] });
  const result = normalizeStock(items, { language: 'en' });
  assert.equal(result.metrics[0].value, 2);
  assert.equal(result.metrics[2].value, 0);
  assert.match(result.rows[0].badge, /—.*Unknown/);
  const single = normalizeStock(items, { resourceId: 'a' });
  assert.deepEqual(single.metrics.map((m) => m.value), [null, null, null]);
});

test('low-stock thresholds, priority, filters and omitted counts match stock semantics', () => {
  const items = parseStock({ items: [item(), item({ resourceId: 'empty', quantity: -2 }), item({ resourceId: 'equal', quantity: 12 }), item({ resourceId: 'ok', quantity: 13 }), item({ resourceId: 'unset', quantity: 1, minimumStock: 0 })] });
  const data = normalizeStock(items, { view: 'low-stock', maxItems: 2, language: 'en' });
  assert.equal(data.total, 3);
  assert.equal(data.rows.length, 2);
  assert.match(data.rows[0].badge, /-2.*Empty/);
  assert.equal(data.metrics[1].value, 2);
  assert.equal(normalizeStock(items, { search: 'no match' }).total, 0);
  assert.equal(normalizeStock(items, { search: 'fr-1' }).total, 5);
});

test('single item wins over search; deleted selection is an error', () => {
  const items = parseStock({ items: [item()] });
  assert.equal(normalizeStock(items, { resourceId: 'a', search: 'other' }).total, 1);
  assert.throws(() => normalizeStock(items, { resourceId: 'deleted', language: 'en' }), /Select it again/);
});

test('malformed, duplicate and oversized responses fail instead of false zero inventory', () => {
  for (const payload of [{}, { items: null }, { items: [null] }, { items: [{}] }, { items: [item(), item()] }, { items: Array(5001).fill(item()) }]) assert.throws(() => parseStock(payload));
  assert.equal(normalizeStock(parseStock({ items: [] })).metrics[0].value, 0);
});

test('demo mode is explicit and works offline in both languages; options omit stock details', async () => {
  for (const language of ['de', 'en']) {
    const data = await loadData({ sampleData: true, language }, () => assert.fail('Unexpected network'));
    assert.equal(data.sample, true);
    assert.equal(data.rows.length, 6);
  }
  const result = await options({ query: { sampleData: true }, request: { method: 'POST' } });
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['id', 'name', 'sku']);
  await assert.rejects(handler({ query: { sampleData: true }, request: { method: 'GET' } }), /POST/);
  await assert.rejects(options({ query: {}, request: { method: 'GET' } }), /POST/);
});

test('credential transport to a local fixture requires allowlisting and refuses redirects', async () => {
  let redirected = false;
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer inv_fixture');
    if (req.url === '/redirect/api/v1/stock') { res.writeHead(302, { Location: '/destination' }); res.end(); return; }
    if (req.url === '/destination') redirected = true;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ items: [item()] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const old = process.env.PAPERLESSPAPER_PRIVATE_API_ORIGINS;
  try {
    delete process.env.PAPERLESSPAPER_PRIVATE_API_ORIGINS;
    await assert.rejects(fetchInventory({ baseUrl, apiKey: 'inv_fixture' }));
    process.env.PAPERLESSPAPER_PRIVATE_API_ORIGINS = baseUrl;
    assert.equal((await fetchInventory({ baseUrl, apiKey: 'inv_fixture' })).length, 1);
    await assert.rejects(fetchInventory({ baseUrl: `${baseUrl}/redirect`, apiKey: 'inv_fixture' }));
    assert.equal(redirected, false);
  } finally {
    if (old === undefined) delete process.env.PAPERLESSPAPER_PRIVATE_API_ORIGINS; else process.env.PAPERLESSPAPER_PRIVATE_API_ORIGINS = old;
    server.close(); await once(server, 'close');
  }
});

test('manifest keeps URL and masked API key in the custom Paperlesspaper settings page', async () => {
  const config = JSON.parse(await readFile(new URL('../integrations/paperlesspaper/config.json', import.meta.url)));
  assert.equal(config.settingsPage, './settings.html');
  assert.equal(config.nativeSettings.sampleData, false);
  assert.equal(config.formSchema.properties.apiKey.format, 'password');
  for (const key of Object.keys(config.nativeSettings).filter((k) => k !== 'color')) assert.equal(config.formSchema.properties[key].inStettingsPage, true);
});
