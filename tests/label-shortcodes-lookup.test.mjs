import assert from "node:assert/strict";
import { mock, test } from "node:test";

const resourceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const stockUnitId = "4f2504e0-4f89-41d3-9a0c-0305e82c3302";
const resource = { id: resourceId, name: "Test item" };
mock.module("../lib/label-shortcodes.ts", { namedExports: {
  resolveLabelShortcode: async (code, org) => code === "K7m4Xp2A" && org === "workshop"
    ? { resourceId, stockUnitId } : null,
} });
mock.module("../lib/resources.ts", { namedExports: {
  getResource: async (org, id) => {
    assert.equal(org, "workshop");
    assert.equal(id, resourceId);
    return resource;
  },
} });
const { lookupResourceByCode } = await import("../lib/resource-lookup.ts");

test("scanner lookup resolves a saved label URL and retains its stock unit", async () => {
  assert.deepEqual(await lookupResourceByCode("workshop", "https://inventory.example/q/K7m4Xp2A"), {
    resource, matchedBy: "id", stockUnitId,
  });
});

test("scanner lookup cannot resolve another tenant's shortcode or an absent code", async () => {
  assert.equal(await lookupResourceByCode("another-tenant", "https://inventory.example/q/K7m4Xp2A"), null);
  assert.equal(await lookupResourceByCode("workshop", "https://inventory.example/q/Deleted1"), null);
});
