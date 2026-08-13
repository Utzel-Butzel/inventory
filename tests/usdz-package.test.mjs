import assert from "node:assert/strict";
import test from "node:test";

import { validateUsdzPackage } from "../lib/usdz-package.ts";

const encoder = new TextEncoder();
const concat = (...parts) => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const record = (size, write) => {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
};

const makeUsdz = (
  entries,
  { declaredEntryCount = entries.length, trailingBytes = new Uint8Array() } = {},
) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [index, entry] of entries.entries()) {
    const name = encoder.encode(entry.name);
    const data = entry.data ?? encoder.encode(index === 0 ? "#usda 1.0\n" : "data");
    const method = entry.method ?? 0;
    const flags = entry.flags ?? 0x0800;
    const storedSize = entry.declaredSize ?? data.length;
    const padding = entry.unaligned
      ? 0
      : (64 - ((offset + 30 + name.length + 4) % 64)) % 64;
    const extra = concat(
      Uint8Array.from([0x86, 0x19, padding & 0xff, padding >>> 8]),
      new Uint8Array(padding),
    );
    const localOffset = offset;
    const localHeader = record(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, flags, true);
      view.setUint16(8, method, true);
      view.setUint32(14, entry.crc ?? 0, true);
      view.setUint32(18, storedSize, true);
      view.setUint32(22, storedSize, true);
      view.setUint16(26, name.length, true);
      view.setUint16(28, extra.length, true);
    });
    const local = concat(localHeader, name, extra, data);
    localParts.push(local);
    offset += local.length;

    const centralHeader = record(46, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, flags, true);
      view.setUint16(10, method, true);
      view.setUint32(16, entry.crc ?? 0, true);
      view.setUint32(20, storedSize, true);
      view.setUint32(24, storedSize, true);
      view.setUint16(28, name.length, true);
      view.setUint16(30, extra.length, true);
      view.setUint32(42, entry.localOffset ?? localOffset, true);
    });
    centralParts.push(concat(centralHeader, name, extra));
  }

  const locals = concat(...localParts);
  const central = concat(...centralParts);
  const eocd = record(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, declaredEntryCount, true);
    view.setUint16(10, declaredEntryCount, true);
    view.setUint32(12, central.length, true);
    view.setUint32(16, locals.length, true);
  });
  return concat(locals, central, eocd, trailingBytes);
};

const expectInvalid = (bytes, pattern) => {
  const result = validateUsdzPackage(bytes);
  assert.equal(result.valid, false);
  assert.match(result.error, pattern);
};

test("accepts a minimal aligned USDA USDZ package", () => {
  const packageBytes = makeUsdz([
    { name: "model.usda", data: encoder.encode("#usda 1.0\ndef Xform \"Object\" {}\n") },
    { name: "textures/albedo.png", data: Uint8Array.from([137, 80, 78, 71]) },
  ]);
  assert.deepEqual(validateUsdzPackage(packageBytes), {
    valid: true,
    entryCount: 2,
    totalUncompressedBytes: 36,
  });
});

test("rejects an arbitrary ZIP whose root is not native USD", () => {
  expectInvalid(
    makeUsdz([{ name: "readme.txt", data: encoder.encode("not a model") }]),
    /unsupported file type|default layer/,
  );
  expectInvalid(
    makeUsdz([{ name: "model.usdc", data: encoder.encode("not a crate") }]),
    /does not contain native USDA or USDC/,
  );
});

test("rejects compressed and encrypted entries", () => {
  expectInvalid(makeUsdz([{ name: "model.usda", method: 8 }]), /STORE/);
  expectInvalid(makeUsdz([{ name: "model.usda", flags: 0x0801 }]), /Encrypted/);
});

test("rejects traversal, absolute, and executable entry paths", () => {
  expectInvalid(
    makeUsdz([
      { name: "model.usda" },
      { name: "../escape.png", data: Uint8Array.from([1]) },
    ]),
    /unsafe or duplicate entry path/,
  );
  expectInvalid(
    makeUsdz([
      { name: "model.usda" },
      { name: "script.js", data: encoder.encode("alert(1)") },
    ]),
    /unsupported file type/,
  );
});

test("rejects malformed directory and local-header metadata", () => {
  const malformedDirectory = makeUsdz([{ name: "model.usda" }]);
  new DataView(malformedDirectory.buffer).setUint32(malformedDirectory.length - 6, 4, true);
  expectInvalid(malformedDirectory, /central directory metadata/);

  const mismatchedLocal = makeUsdz([{ name: "model.usda" }]);
  new DataView(mismatchedLocal.buffer).setUint16(8, 8, true);
  expectInvalid(mismatchedLocal, /metadata do not match/);

  const malformedExtra = makeUsdz([{ name: "model.usda" }]);
  // The generated local extra field starts after the 30-byte header and name.
  const nameLength = new DataView(malformedExtra.buffer).getUint16(26, true);
  malformedExtra[30 + nameLength + 2] = 0xff;
  malformedExtra[30 + nameLength + 3] = 0xff;
  expectInvalid(malformedExtra, /extra-field metadata is malformed/);
});

test("rejects unaligned payloads and out-of-bounds declared sizes", () => {
  const unaligned = makeUsdz([{ name: "model.usda", unaligned: true }]);
  expectInvalid(unaligned, /64-byte boundary/);

  expectInvalid(
    makeUsdz([{ name: "model.usda", declaredSize: 501 * 1024 * 1024 }]),
    /safe size limit/,
  );
});

test("rejects overlapping entry byte ranges", () => {
  const overlapping = makeUsdz([
    { name: "model.usda" },
    { name: "texture.png", localOffset: 0, data: Uint8Array.from([1]) },
  ]);
  expectInvalid(
    overlapping,
    /contiguous and ordered|metadata do not match|paths do not match|byte ranges must not overlap/,
  );
});

test("rejects unsupported ZIP feature flags but permits UTF-8 names", () => {
  expectInvalid(
    makeUsdz([{ name: "model.usda", flags: 0x0820 }]),
    /unsupported ZIP flags/,
  );
  assert.equal(
    validateUsdzPackage(
      makeUsdz([
        { name: "model.usda" },
        { name: "textures/münchen.png", data: Uint8Array.from([1]) },
      ]),
    ).valid,
    true,
  );
});

test("rejects unsafe entry counts without iterating past the archive", () => {
  expectInvalid(
    makeUsdz([{ name: "model.usda" }], { declaredEntryCount: 2_049 }),
    /unsafe entry count/,
  );
});

test("rejects trailing bytes and malformed end metadata", () => {
  expectInvalid(
    makeUsdz([{ name: "model.usda" }], { trailingBytes: Uint8Array.from([1]) }),
    /end record is malformed/,
  );
});
