import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStockMovementPayload,
} from "../components/resource-stock/movement-form.ts";
import {
  customFieldValuesEqual,
  defaultMovementForm,
  isManualMovement,
  normalizeStock,
  parseMetadata,
} from "../components/resource-stock/model.ts";

const t = (key) => key;
const form = (overrides = {}) => ({
  ...defaultMovementForm("in"),
  quantity: "3",
  occurredAt: "2026-09-05T10:30:00.000Z",
  ...overrides,
});
const options = (overrides = {}) => ({
  mode: "create",
  direction: "in",
  purchaseUnitFactor: 12,
  currentQuantity: 10,
  allowNegativeStock: false,
  currency: "EUR",
  unitName: "pieces",
  numberFormat: new Intl.NumberFormat("en"),
  t,
  ...overrides,
});

test("new bookings preserve the payload shape, contact, date and optional fields", () => {
  const payload = buildStockMovementPayload(form({
    reason: "  Delivery  ", note: "  ", location: "  Shelf A  ",
    contactId: "contact-id", totalPrice: "12,34",
  }), options());
  assert.deepEqual(payload, {
    delta: 3, type: "receipt", reason: "Delivery", note: undefined,
    location: "Shelf A", occurredAt: "2026-09-05T10:30:00.000Z",
    contactId: "contact-id", totalPriceCents: 1234, priceCurrency: "EUR",
  });
  const empty = buildStockMovementPayload(form({ occurredAt: "" }), options());
  assert.equal(empty.contactId, null);
  assert.equal(empty.occurredAt, undefined);
  assert.equal(Object.hasOwn(empty, "totalPriceCents"), false);
  assert.equal(Object.hasOwn(empty, "quantity"), false);
});

test("purchase packs convert only on receipts; corrections use base quantities", () => {
  const purchase = form({ quantityUnit: "purchase" });
  assert.equal(buildStockMovementPayload(purchase, options()).delta, 36);
  const outgoing = buildStockMovementPayload(purchase, options({ direction: "out" }));
  assert.equal(outgoing.delta, -3);
  const corrected = buildStockMovementPayload(purchase, options({ mode: "edit", previousDelta: 1 }));
  assert.equal(corrected.delta, 3);
  assert.equal(corrected.quantity, 3);
  assert.throws(() => buildStockMovementPayload(
    form({ quantity: "2000000000", quantityUnit: "purchase" }), options(),
  ), RangeError);
});

test("corrections first reverse the old movement when checking available stock", () => {
  const edit = options({ mode: "edit", previousDelta: 8, direction: "out" });
  assert.throws(() => buildStockMovementPayload(form(), edit), /resource.errors.onlyAvailable/);
  const reduced = buildStockMovementPayload(form({ quantity: "2" }), edit);
  assert.equal(reduced.delta, -2);
  assert.equal(reduced.quantity, 2);
  // Reversing a previous issue makes those units available to its replacement.
  assert.equal(buildStockMovementPayload(
    form({ quantity: "13" }), options({ mode: "edit", previousDelta: -3, direction: "out" }),
  ).delta, -13);
});

test("the negative-stock policy permits receipts that reduce an existing deficit", () => {
  assert.equal(buildStockMovementPayload(form(), options({ currentQuantity: -10 })).delta, 3);
  assert.throws(() => buildStockMovementPayload(
    form(), options({ mode: "edit", previousDelta: 1, currentQuantity: -10 }),
  ), /resource.errors.onlyAvailable/);
  assert.throws(() => buildStockMovementPayload(
    form({ quantity: "11" }), options({ direction: "out" }),
  ), /resource.errors.onlyAvailable/);
  assert.equal(buildStockMovementPayload(
    form({ quantity: "11" }), options({ direction: "out", allowNegativeStock: true }),
  ).delta, -11);
});

test("creation and correction share quantity, date, and signed-price validation", () => {
  for (const mode of ["create", "edit"]) {
    const context = options({ mode, previousDelta: 0 });
    for (const quantity of ["0", "-1", "1.5", "Infinity", "invalid"]) {
      assert.throws(() => buildStockMovementPayload(form({ quantity }), context), /resource.errors.validQuantity/);
    }
    assert.throws(() => buildStockMovementPayload(form({ occurredAt: "invalid" }), context), /resource.errors.validBookingDate/);
    for (const totalPrice of ["-1", "invalid"]) {
      assert.throws(() => buildStockMovementPayload(form({ totalPrice }), context), /resource.errors.validPrice/);
    }
    const signed = buildStockMovementPayload(form({ totalPrice: "-2,50" }), { ...context, direction: "out" });
    assert.equal(signed.totalPriceCents, -250);
    assert.equal(signed.delta, -3);
  }
});

test("normalization handles API envelopes and retains inventory defaults", () => {
  const resource = { id: "resource-id", name: "Part", quantity: 5 };
  const data = { resource, units: [{ id: "unit-id" }] };
  for (const payload of [data, { stock: data }, { data }]) {
    const normalized = normalizeStock(payload, t);
    assert.equal(normalized.resource.currency, "EUR");
    assert.equal(normalized.config.trackingMode, "bulk");
    assert.equal(normalized.procurement.projectedQuantity, 5);
    assert.deepEqual(normalized.movements, []);
    assert.deepEqual(normalized.units[0].customFields, {});
    assert.deepEqual(normalized.units[0].metadata, {});
  }
  assert.throws(() => normalizeStock({}, t), /resource.errors.missingResource/);
});

test("history editing excludes transfers and every system-managed movement link", () => {
  for (const type of ["receipt", "issue", "adjustment", "return", "waste"]) {
    assert.equal(isManualMovement({ type }), true);
    for (const link of ["unitId", "variantId", "assemblyBuildId", "purchaseReceiptId", "fromLocationResourceId", "toLocationResourceId"]) {
      assert.equal(isManualMovement({ type, [link]: "linked-record" }), false);
    }
  }
  assert.equal(isManualMovement({ type: "transfer" }), false);
  assert.equal(isManualMovement({ type: "unknown" }), false);
});

test("unit metadata remains an object and custom-field comparisons ignore key order", () => {
  assert.deepEqual(parseMetadata(" ", t), {});
  assert.deepEqual(parseMetadata('{"serial":"ABC"}', t), { serial: "ABC" });
  for (const value of ["[]", "null", '"text"', "123"]) {
    assert.throws(() => parseMetadata(value, t), /resource.errors.metadataObject/);
  }
  assert.throws(() => parseMetadata("invalid", t), SyntaxError);
  assert.equal(customFieldValuesEqual({ serial: "A", count: 2 }, { count: 2, serial: "A" }), true);
  assert.equal(customFieldValuesEqual({ count: 2 }, { count: "2" }), false);
  assert.equal(customFieldValuesEqual({}, { count: 0 }), false);
});
