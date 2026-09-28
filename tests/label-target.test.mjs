import assert from "node:assert/strict";
import test from "node:test";
import {
  labelTargetKey,
  labelTargetName,
  labelTargetUrl,
} from "../lib/label-target.ts";
import { printableLabelBarcode } from "../lib/label-barcode.ts";
import {
  resourcePathFromShortLink,
  resourceShortUrl,
} from "../lib/resource-short-link.ts";

const resource = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  name: "AvatarMediKi",
  sku: "AVATAR",
  barcode: "4006381333931",
};
const first = {
  ...resource,
  stockUnit: {
    id: "4f2504e0-4f89-41d3-9a0c-0305e82c3302",
    code: "AMK-001",
    location: "Room A",
  },
};
const second = {
  ...resource,
  stockUnit: {
    id: "5f2504e0-4f89-41d3-9a0c-0305e82c3303",
    code: "AMK-002",
    location: "Room B",
  },
};

test("keeps parent labels and multiple devices independently selectable", () => {
  assert.equal(new Set([resource, first, second].map(labelTargetKey)).size, 3);
  assert.equal(labelTargetName(first), "AvatarMediKi · AMK-001");
  assert.equal(labelTargetName(second), "AvatarMediKi · AMK-002");
  assert.equal(labelTargetKey(resource), resource.id);
});

test("device QR links round trip to their own stock record while parent links stay unchanged", () => {
  const origin = "https://inventory.paperlesspaper.de";
  assert.equal(
    labelTargetUrl(origin, resource),
    resourceShortUrl(origin, resource.id),
  );
  for (const target of [first, second]) {
    const url = new URL(labelTargetUrl(origin, target));
    assert.equal(
      resourcePathFromShortLink(
        url.pathname.split("/").at(-1),
        url.searchParams.get("unit"),
      ),
      `/inventory/${resource.id}/stock?unit=${target.stockUnit.id}`,
    );
  }
  assert.notEqual(
    labelTargetUrl(origin, first),
    labelTargetUrl(origin, second),
  );
});

test("device barcodes use the serial number instead of the shared product barcode", () => {
  assert.equal(printableLabelBarcode(first), "AMK-001");
  assert.equal(printableLabelBarcode(second), "AMK-002");
  assert.equal(printableLabelBarcode(resource), resource.barcode);
  for (const code of ["Gerät-🧰", "x".repeat(121), ""]) {
    assert.equal(
      printableLabelBarcode({
        ...first,
        stockUnit: { ...first.stockUnit, code },
      }),
      first.stockUnit.id,
    );
  }
});
