import assert from "node:assert/strict";
import test from "node:test";

import {
  dateInput,
  formatDate,
  formatMoney,
  localDateTime,
  moneyToCents,
  toIsoDate,
  toIsoDateTime,
} from "../lib/client-formatters.ts";

test("money inputs retain empty, invalid, and signed adjustment semantics", () => {
  assert.equal(moneyToCents("  "), null);
  assert.equal(moneyToCents("12,34"), 1234);
  assert.equal(moneyToCents("12.345"), 1235);
  assert.equal(moneyToCents("0"), 0);
  for (const input of ["abc", "Infinity", "1,2,3", "-2.50"]) {
    assert.ok(Number.isNaN(moneyToCents(input)), input);
  }
  assert.equal(moneyToCents("-2,50", true), -250);
});

test("stock and purchase displays preserve localized dates and currency", () => {
  for (const locale of ["de-DE", "en-US"]) {
    assert.equal(
      formatMoney(123456, "EUR", locale),
      new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(1234.56),
    );
    const value = "2026-09-05T10:45:00.000Z";
    for (const includeTime of [false, true]) {
      assert.equal(
        formatDate(value, locale, includeTime),
        new Intl.DateTimeFormat(locale, {
          month: "short", day: "numeric", year: "numeric",
          ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
        }).format(new Date(value)),
      );
    }
    for (const value of [null, undefined, "", "invalid"]) {
      assert.equal(formatDate(value, locale), "—");
    }
  }
});

test("local form dates round trip across midnight and daylight saving offsets", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    for (const [utc, local] of [
      ["2026-01-05T23:30:00.000Z", "2026-01-06T00:30"],
      ["2026-07-05T22:30:00.000Z", "2026-07-06T00:30"],
    ]) {
      assert.equal(localDateTime(utc), local);
      assert.equal(dateInput(new Date(utc)), local.slice(0, 10));
      assert.equal(toIsoDateTime(local), utc);
    }
    // Date-only purchase expectations intentionally use local noon.
    assert.equal(toIsoDate("2026-01-06"), "2026-01-06T11:00:00.000Z");
    assert.equal(toIsoDate("2026-07-06"), "2026-07-06T10:00:00.000Z");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  assert.equal(localDateTime("invalid"), "");
  for (const value of ["", "invalid"]) {
    assert.equal(toIsoDateTime(value), undefined);
    assert.equal(toIsoDate(value), undefined);
  }
});
