import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, symlink, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reuse the integration toolchain; the inventory application needs no browser dependency.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolchain = resolve(process.argv[2] || join(root, '../paperlesspaper-integrations'));
const require = createRequire(join(toolchain, 'package.json'));
const puppeteer = require('puppeteer-core');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ditherImage, replaceColors, spectra6OriginalPalette: palette } = require('epdoptimize');
const integration = join(root, 'integrations/paperlesspaper');
const config = JSON.parse(await readFile(join(integration, 'config.json'), 'utf8'));
// Exercise the real production routing/asset allowlist in an isolated provider.
const provider = await mkdtemp(join(tmpdir(), 'inventory-paperless-'));
await cp(join(toolchain, 'server'), join(provider, 'server'), { recursive: true });
await cp(integration, join(provider, 'applications/open-inventory'), { recursive: true });
await writeFile(join(provider, 'package.json'), '{"type":"module"}');
await symlink(join(toolchain, 'node_modules'), join(provider, 'node_modules'));
await symlink(join(toolchain, 'public'), join(provider, 'public'));
const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
const port = portProbe.address().port; portProbe.close(); await once(portProbe, 'close');
const server = spawn(process.execPath, [join(provider, 'server/index.js')], { stdio: 'pipe', env: { ...process.env, PORT: String(port) } });
let serverLog = ''; server.stdout.on('data', b => { serverLog += b; }); server.stderr.on('data', b => { serverLog += b; });
const origin = `http://127.0.0.1:${port}`;
let started = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try { if ((await fetch(`${origin}/health`)).ok) { started = true; break; } } catch {}
  await new Promise(r => setTimeout(r, 100));
}
if (!started) { server.kill(); throw new Error(serverLog || 'Preview server did not start.'); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const reports = [];
const send = (page, settings, language = 'de') => page.evaluate(({ settings, language, config }) => postMessage({ type: 'INIT', data: { meta: { language, pluginSettings: settings, pluginManifest: config } } }, location.origin), { settings, language, config });
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.paperlessRenderStatus === 'ready');

try {
  for (const variant of config.configVariants) {
    for (const [width, height] of [[800, 480], [480, 800], [1600, 1200], [1200, 1600]]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', r => { if (/\.(css|js|woff2)(\?|$)/.test(r.url()) && r.status() >= 400) errors.push(`Asset HTTP ${r.status()}: ${new URL(r.url()).pathname}`); });
      await page.goto(`${origin}/open-inventory/render.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__paperlessRenderDone));
      await send(page, variant); await ready(page);
      const metrics = await page.evaluate(() => {
        const overflow = [...document.querySelectorAll('#app,.pp-dash-metrics,.pp-dash-metric,.pp-dash-footer,.pp-dash-header')]
          .filter(n => n.scrollWidth > n.clientWidth + 2 || n.scrollHeight > n.clientHeight + 2).map(n => n.className || n.id);
        const offscreen = [...document.querySelectorAll('.pp-dash-row:not([hidden]),.pp-dash-metric,.pp-dash-footer')].filter(n => {
          const r = n.getBoundingClientRect(); return r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
        }).map(n => n.className);
        return { overflow, offscreen, sample: document.body.innerText.includes('BEISPIELDATEN') };
      });
      assert.deepEqual(errors, []); assert.deepEqual(metrics.overflow, []); assert.deepEqual(metrics.offscreen, []); assert.equal(metrics.sample, true);
      const filename = join(integration, variant.screenshots[`${width}x${height}`]);
      const png = await page.screenshot({ path: filename });
      if (width <= 800) {
        const source = createCanvas(width, height), dithered = createCanvas(width, height), device = createCanvas(width, height);
        source.getContext('2d').drawImage(await loadImage(png), 0, 0);
        const options = await page.$eval('meta[name="paperless:epd-optimize"]', n => JSON.parse(n.content).canvasDitherOptions);
        await ditherImage(source, dithered, { ...options, palette });
        replaceColors(dithered, device, palette);
        await writeFile(filename.replace('.png', '-epd.png'), device.toBuffer('image/png'));
      }
      await send(page, { ...variant, title: 'Updated inventory', color: 'green-light' }, 'en');
      await page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('h1')?.textContent === 'Updated inventory' && document.body.classList.contains('green-light') && document.documentElement.dataset.paperlessRenderStatus === 'ready');
      await page.setRequestInterception(true);
      page.on('request', req => req.url().includes('/api/data') ? req.respond({ status: 403, contentType: 'application/json', body: '{"error":"SECRET_TEST_VALUE"}' }) : req.continue());
      await send(page, { ...variant, sampleData: false }, 'en');
      await page.waitForFunction(() => document.documentElement.dataset.paperlessRenderStatus === 'error');
      assert.equal(await page.evaluate(() => /SECRET_TEST_VALUE|DEMO DATA/.test(document.body.innerText)), false);
      reports.push({ color: variant.color, view: variant.view, resourceId: variant.resourceId, width, height, ...metrics, hostUpdate: true, errorState: true });
      console.log(`${variant.color} ${variant.view} ${width}x${height}: OK`);
      await page.close();
    }
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1100 });
  await page.setContent(`<iframe style="width:850px;height:1050px;border:0" src="${origin}/open-inventory/settings.html"></iframe>`);
  await page.evaluate(() => { window.patches = []; addEventListener('message', e => { if (e.data.type === 'UPDATE_SETTINGS') window.patches.push(e.data.payload); }); });
  const frame = await page.waitForFrame(f => f.url() === `${origin}/open-inventory/settings.html`);
  await frame.waitForSelector('#connect');
  await send(frame, config.nativeSettings, 'en');
  await frame.waitForFunction(() => document.querySelector('#connect').textContent === 'Test connection & load items');
  assert.equal(await page.evaluate(() => window.patches.length), 0);
  await frame.click('#sampleData'); await frame.click('#connect');
  await frame.waitForFunction(() => document.querySelector('#resourceId').options.length === 7);
  await frame.select('#resourceId', 'demo-oak');
  await page.waitForFunction(() => window.patches.some(p => p.resourceId === 'demo-oak'));
  await frame.$eval('#baseUrl', node => { node.value = 'https://inventory.example.com'; node.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await frame.$eval('#resourceId', n => n.value), '');
  await frame.$eval('#apiKey', node => { node.value = 'inv_browser_test'; node.dispatchEvent(new Event('change', { bubbles: true })); });
  await frame.click('#sampleData');
  const calls = [];
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('/api/options')) {
      calls.push({ url: req.url(), method: req.method(), body: JSON.parse(req.postData()) });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ id: 'real-item', name: '<img src=x onerror=alert(1)>', sku: 'ABC' }] }) });
    }
    return req.continue();
  });
  await frame.click('#connect');
  await frame.waitForFunction(() => document.querySelector('#resourceId').options.length === 2);
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.apiKey, 'inv_browser_test'); assert.ok(!calls[0].url.includes('inv_browser_test'));
  assert.equal(await frame.$eval('#apiKey', n => n.type), 'password');
  assert.equal(await frame.$('img'), null);
  await frame.select('#resourceId', 'real-item');
  const settings = { ...config.nativeSettings, baseUrl: 'https://inventory.example.com', apiKey: 'inv_browser_test', resourceId: 'real-item' };
  await send(frame, settings, 'de');
  await frame.waitForFunction(() => document.querySelector('#connect').textContent === 'Verbindung prüfen & Artikel laden');
  assert.equal(await frame.$eval('#resourceId', n => n.value), 'real-item');
  // Screenshots use explicit demo settings, never fixture credentials.
  await send(frame, { ...config.nativeSettings, sampleData: true }, 'de');
  await frame.waitForFunction(() => document.querySelector('#apiKey').value === '');
  await page.setRequestInterception(false);
  page.removeAllListeners('request');
  await frame.click('#connect');
  await frame.waitForFunction(() => document.querySelector('#resourceId').options.length === 7);
  await page.screenshot({ path: join(integration, 'screenshots/settings.png') });
  await page.close();
  await mkdir(join(root, 'output/paperlesspaper'), { recursive: true });
  await writeFile(join(root, 'output/paperlesspaper/check.json'), JSON.stringify({ renders: reports, settings: 'passed' }, null, 2));
  console.log('Settings: initialization, credentials, connection, selection and language update OK');
} finally {
  await browser.close(); server.kill(); await once(server, 'exit');
  await rm(provider, { recursive: true, force: true });
}
