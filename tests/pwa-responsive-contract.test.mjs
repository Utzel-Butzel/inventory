import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);
const source = (path) => readFile(projectFile(path), "utf8");

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("the installable web app exposes Android-ready PWA metadata and icons", async () => {
  const [layout, manifest, worker, client, icon192, icon512] = await Promise.all([
    source("app/layout.tsx"),
    source("app/manifest.ts"),
    source("public/notification-sw.js"),
    source("lib/offline-support-client.ts"),
    readFile(projectFile("public/pwa/icon-192.png")),
    readFile(projectFile("public/pwa/icon-512.png")),
  ]);

  assert.match(layout, /viewportFit: "cover"/);
  assert.match(layout, /interactiveWidget: "resizes-content"/);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /src: "\/pwa\/icon-192\.png"/);
  assert.match(manifest, /src: "\/pwa\/icon-512\.png"/);
  assert.match(manifest, /purpose: "maskable"/);
  assert.match(worker, /"\/pwa\/icon-192\.png"/);
  assert.match(client, /ensureAppServiceWorker/);
  assert.deepEqual(pngSize(icon192), { width: 192, height: 192 });
  assert.deepEqual(pngSize(icon512), { width: 512, height: 512 });
});

test("the existing web shell adapts to touch devices and narrow viewports", async () => {
  const [shell, styles, offline] = await Promise.all([
    source("components/app-shell.tsx"),
    source("app/globals.css"),
    source("components/offline-support.tsx"),
  ]);

  assert.match(shell, /app-shell-mobile-drawer/);
  assert.match(shell, /size-11 shrink-0/);
  assert.match(shell, /hidden min-w-0 shrink sm:block/);
  assert.match(styles, /\.grid > \* \{\s*min-width: 0;/);
  assert.match(styles, /--safe-area-top: env\(safe-area-inset-top, 0px\)/);
  assert.match(styles, /\.mdx-editor-input \.mdxeditor-toolbar \{[\s\S]*overflow-x: auto;/);
  assert.match(offline, /env\(safe-area-inset-bottom\)/);
});
