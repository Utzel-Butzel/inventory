import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import {
  normalizeWooCommerceStoreUrl,
  redactWooCommerceConsumerKey,
  wooCommerceApiUrl,
  wooCommerceConnectionInputSchema,
} from "../lib/woocommerce-contract.ts";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("WooCommerce store URLs are normalized and keep WordPress subdirectories", () => {
  assert.equal(
    normalizeWooCommerceStoreUrl("HTTPS://Shop.Example.COM:443/wordpress/"),
    "https://shop.example.com/wordpress",
  );
  assert.equal(
    normalizeWooCommerceStoreUrl("shop.example.com"),
    "https://shop.example.com",
  );
  assert.equal(
    wooCommerceApiUrl("https://shop.example.com/wordpress", "/products"),
    "https://shop.example.com/wordpress/wp-json/wc/v3/products",
  );
});

test("WooCommerce store URLs reject insecure and SSRF-sensitive targets", () => {
  for (const value of [
    "http://shop.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.8",
    "https://user:password@shop.example.com",
    "https://shop.example.com?token=secret",
    "https://shop.example.com#fragment",
  ]) {
    assert.throws(
      () => normalizeWooCommerceStoreUrl(value),
      undefined,
      value,
    );
  }

  assert.equal(
    normalizeWooCommerceStoreUrl("https://192.168.10.42/shop", {
      allowPrivateNetworks: true,
    }),
    "https://192.168.10.42/shop",
  );
});

test("connection credentials use WooCommerce key prefixes and reject extra fields", () => {
  const valid = {
    storeUrl: "https://shop.example.com",
    consumerKey: "ck_1234567890",
    consumerSecret: "cs_1234567890",
  };

  assert.equal(wooCommerceConnectionInputSchema.safeParse(valid).success, true);
  assert.equal(
    wooCommerceConnectionInputSchema.safeParse({
      ...valid,
      consumerKey: "key_1234567890",
    }).success,
    false,
  );
  assert.equal(
    wooCommerceConnectionInputSchema.safeParse({ ...valid, role: "admin" })
      .success,
    false,
  );
});

test("Consumer Key labels reveal only a short non-secret hint", () => {
  const key = "ck_1234567890abcdef";
  const redacted = redactWooCommerceConsumerKey(key);

  assert.equal(redacted, "ck_1234…cdef");
  assert.equal(redacted.includes("567890ab"), false);
});

test("the server tests first, encrypts both credentials, and pins DNS results", async () => {
  const backend = await source("lib/woocommerce.ts");
  const connectFunction = backend.slice(
    backend.indexOf("export async function connectWooCommerce"),
    backend.indexOf("export async function testSavedWooCommerceConnection"),
  );
  const dto = backend.slice(
    backend.indexOf("function connectionDto"),
    backend.indexOf("async function resolveWooCommerceTarget"),
  );

  assert.ok(
    connectFunction.indexOf("testWooCommerceCredentials(input)") <
      connectFunction.indexOf(".insert(wooCommerceConnections)"),
    "credentials must be verified before the connection is persisted",
  );
  assert.match(connectFunction, /encryptSecret\(\s*input\.consumerKey/);
  assert.match(connectFunction, /encryptSecret\(\s*input\.consumerSecret/);
  assert.match(backend, /Authorization: `Basic/);
  assert.match(backend, /lookup\(hostname, \{ all: true, verbatim: true \}\)/);
  assert.match(backend, /isPrivateWebhookAddress\(address\)/);
  assert.match(backend, /lookup: pinnedLookup/);
  assert.doesNotMatch(dto, /encryptedConsumer(Key|Secret)/);
});

test("connections are organization-scoped and API routes require management permission", async () => {
  const [migration, route, testRoute] = await Promise.all([
    source("db/migrations/0054_woocommerce_connections.sql"),
    source("app/api/v1/integrations/woocommerce/route.ts"),
    source("app/api/v1/integrations/woocommerce/test/route.ts"),
  ]);

  assert.match(
    migration,
    /UNIQUE INDEX[\s\S]*woocommerce_connections_organization_unique[\s\S]*organization_id/,
  );
  assert.match(migration, /REFERENCES "organizations"\("id"\) ON DELETE CASCADE/);
  assert.match(route, /requireSessionPermission\([\s\S]*"webhooks\.manage"/);
  assert.match(testRoute, /requireSessionPermission\([\s\S]*"webhooks\.manage"/);
  assert.match(route, /Cache-Control": "no-store"/);
});

test("settings UI exposes connect, test, replace, and disconnect flows", async () => {
  const [manager, navigation, page] = await Promise.all([
    source("components/woocommerce-connection-manager.tsx"),
    source("components/settings-navigation.tsx"),
    source("app/(dashboard)/settings/woocommerce/page.tsx"),
  ]);

  assert.match(manager, /method: "PUT"/);
  assert.match(manager, /integrations\/woocommerce\/test/);
  assert.match(manager, /method: "DELETE"/);
  assert.match(manager, /confirmDisconnect/);
  assert.match(navigation, /settings\/woocommerce/);
  assert.match(page, /WooCommerceConnectionManager/);
});

test("OpenAPI documents the secret-free WooCommerce administration contract", async () => {
  const document = parseYaml(await source("public/openapi.yaml"));
  const integration = document.paths["/integrations/woocommerce"];

  assert.ok(integration.get);
  assert.ok(integration.put);
  assert.ok(integration.delete);
  assert.ok(document.paths["/integrations/woocommerce/test"].post);
  assert.equal(
    document.components.schemas.WooCommerceConnectionInput.properties
      .consumerSecret.writeOnly,
    true,
  );
  assert.equal(
    "consumerSecret" in
      document.components.schemas.WooCommerceConnection.properties,
    false,
  );
});
