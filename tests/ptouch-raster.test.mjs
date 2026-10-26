import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { combinePtouchLabels, encodePtouchRaster, ptouchPrintableDots, PTOUCH_TAPES } from "../lib/ptouch-raster.ts";
import { isAllowedQzRequest } from "../lib/qz-signing-policy.ts";
import { signQzRequest } from "../lib/qz-signature.ts";
import { hasQzSigningConfig, readQzSigningMaterial } from "../lib/qz-signing-config.ts";
import { adaptivePtouchPhoto, clarifyPtouchPhoto, halftonePtouchPhoto } from "../lib/ptouch-photo.ts";

function white(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

test("deployment signing secrets require both PEM values and reject malformed input", async () => {
  const pem = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";
  const env = { QZ_CERTIFICATE_BASE64: Buffer.from(pem).toString("base64") };
  assert.equal(hasQzSigningConfig(env), false);
  assert.equal(hasQzSigningConfig({ ...env, QZ_PRIVATE_KEY_BASE64: "configured" }), true);
  assert.equal(await readQzSigningMaterial("CERTIFICATE", env), pem);
  await assert.rejects(readQzSigningMaterial("PRIVATE_KEY", env));
  await assert.rejects(readQzSigningMaterial("CERTIFICATE", { QZ_CERTIFICATE_BASE64: "not base64" }));
  await assert.rejects(readQzSigningMaterial("PRIVATE_KEY", { QZ_PRIVATE_KEY_BASE64: env.QZ_CERTIFICATE_BASE64 }));
});

test("Brother raster header checks the tape and finishes with feed/cut", () => {
  const result = encodePtouchRaster(white(397, 128), 24, false);
  assert.deepEqual([...result.slice(0, 100)], Array(100).fill(0));
  assert.deepEqual([...result.slice(100, 134)], [
    0x1b, 0x40, 0x1b, 0x69, 0x61, 1,
    0x1b, 0x69, 0x7a, 0x86, 1, 24, 0, 141, 1, 0, 0, 0, 0,
    0x1b, 0x69, 0x4d, 0x40, 0x1b, 0x69, 0x4b, 8,
    0x1b, 0x69, 0x64, 14, 0, 0x4d, 2,
  ]);
  assert.equal(result.length, 134 + 397 * 20 + 1);
  assert.equal(result.at(-1), 0x1a);
});

test("an asymmetric image preserves feed direction, bit order and transparent white", () => {
  const pixels = white(4, 128);
  // Top-right black; bottom-left black; fully transparent black must stay white.
  pixels.data.fill(0, 3 * 4, 3 * 4 + 3);
  const bottomLeft = 127 * 4 * 4;
  pixels.data.fill(0, bottomLeft, bottomLeft + 3);
  pixels.data.fill(0, 0, 4);
  const bytes = encodePtouchRaster(pixels, 24);
  const line = (i) => [...bytes.slice(134 + i * 20 + 4, 134 + (i + 1) * 20)];
  assert.deepEqual([...bytes.slice(134, 138)], [0x47, 17, 0, 15]);
  assert.deepEqual(line(0), [...Array(15).fill(0), 1]);
  assert.deepEqual(line(1), Array(16).fill(0));
  assert.deepEqual(line(3), [128, ...Array(15).fill(0)]);
});

test("supported tape widths center content and reject clipping or malformed buffers", () => {
  for (const tape of PTOUCH_TAPES) {
    const height = ptouchPrintableDots(tape);
    const pixels = white(4, height);
    pixels.data.fill(0, 3 * 4, 3 * 4 + 3);
    const result = encodePtouchRaster(pixels, tape);
    assert.equal(result[111], Math.round(tape));
    const pin = Math.floor((128 - height) / 2) + height - 1;
    assert.equal(result[138 + (pin >>> 3)], 0x80 >>> (pin & 7));
    assert.throws(() => encodePtouchRaster(white(4, height + 1), tape));
  }
  assert.throws(() => ptouchPrintableDots(36));
  assert.throws(() => encodePtouchRaster(white(14117, 1), 24));
  assert.throws(() => encodePtouchRaster({ ...white(4, 4), data: new Uint8ClampedArray(2) }, 24));
  assert.throws(() => encodePtouchRaster(white(4, 4), 36));
});

test("high resolution doubles feed dots and margins while preserving the print-head height", () => {
  const result = encodePtouchRaster(white(794, 128), 24);
  assert.equal(result[126], 0x48);
  assert.equal(result[130], 28);
  assert.equal(result[113] | (result[114] << 8), 794);
  assert.equal(result.length, 134 + 794 * 20 + 1);
});

test("a mixed-length series initializes once, continues pages and feeds/cuts the last label", () => {
  const labels = [40, 80, 60].map(width => encodePtouchRaster(white(width, 128), 24));
  const originals = labels.map(label => label.slice());
  const job = combinePtouchLabels(labels);
  assert.deepEqual(combinePtouchLabels([labels[0]]), labels[0]);
  assert.equal(job.length, labels.reduce((sum, label) => sum + label.length, 0) - 204);
  let offset = 0;
  labels.forEach((label, index) => {
    const skip = index ? 102 : 0;
    const page = job.subarray(offset, offset + label.length - skip);
    assert.deepEqual([...page.subarray(index ? 0 : 102, index ? 4 : 106)], [0x1b, 0x69, 0x61, 1]);
    assert.equal(page[117 - skip], index ? 1 : 0);
    assert.equal(page[126 - skip], index === 2 ? 0x48 : 0x40);
    assert.equal(page.at(-1), index === 2 ? 0x1a : 0x0c);
    assert.deepEqual(page.subarray(134 - skip, -1), label.subarray(134, -1));
    assert.deepEqual(label, originals[index]);
    offset += page.length;
  });
});

test("series reject mixed tape, invalid pages and excessive jobs before submission", () => {
  const label = encodePtouchRaster(white(40, 128), 24);
  assert.throws(() => combinePtouchLabels([]), /PTOUCH_BATCH_COUNT/);
  assert.throws(() => combinePtouchLabels(Array(101).fill(label)), /PTOUCH_BATCH_COUNT/);
  assert.throws(() => combinePtouchLabels([label, encodePtouchRaster(white(40, 112), 18)]), /PTOUCH_BATCH_MEDIA/);
  assert.throws(() => combinePtouchLabels([label, encodePtouchRaster(white(40, 128), 24, false)]), /PTOUCH_BATCH_MEDIA/);
  assert.throws(() => combinePtouchLabels([label.subarray(0, -1)]), /Invalid/);
  const longLabel = encodePtouchRaster(white(14116, 128), 24);
  assert.throws(() => combinePtouchLabels(Array(100).fill(longLabel)), /PTOUCH_BATCH_SIZE/);
});

const now = 1_790_000_000_000;

test("photo clarity separates low-contrast edges without dirtying white backgrounds", () => {
  const gray = new Float32Array(32 * 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) gray[y * 32 + x] = x < 16 ? 100 : 150;
  const result = clarifyPtouchPhoto(gray, 32, 16);
  assert.ok(result[8 * 32 + 16] - result[8 * 32 + 15] > 65);
  assert.ok(result.every(value => value >= 0 && value <= 255));
  const white = clarifyPtouchPhoto(new Float32Array(32 * 16).fill(255), 32, 16);
  assert.ok(white.every(value => value === 255));
});

test("photo shadow lift is gentler than comparison three and preserves black", () => {
  for (const tone of [64, 96, 128]) {
    const result = clarifyPtouchPhoto(new Float32Array(32 * 16).fill(tone), 32, 16);
    const strongerComparison = (255 * Math.pow(tone / 255, 0.65) - 127.5) * 1.3 + 127.5;
    assert.ok(result[0] > tone && result[0] < strongerComparison);
  }
  assert.ok(clarifyPtouchPhoto(new Float32Array(32 * 16), 32, 16).every(value => value === 0));
});

test("photo halftoning keeps half-tone detail and leaves QR/text pixels untouched", () => {
  const pixels = white(16, 4);
  for (let i = 0; i < pixels.data.length; i += 4) pixels.data.fill(128, i, i + 3);
  halftonePtouchPhoto(pixels, { x: 0, y: 0, width: 8, height: 4 });
  let black = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 16; x++) {
      const value = pixels.data[(y * 16 + x) * 4];
      if (x >= 8) assert.equal(value, 128);
      else {
        if (value === 0) black++;
        assert.equal(value, pixels.data[(y * 16 + (x ^ 1)) * 4]);
      }
    }
  }
  // Midtones retain both colors, with fewer black dots after the shadow lift.
  assert.ok(black > 0 && black < 16);
  const transparent = white(8, 4); transparent.data.fill(0);
  halftonePtouchPhoto(transparent, { x: -1, y: -1, width: 20, height: 20 });
  assert.ok(transparent.data.every(value => value === 255));
});
const validPrint = () => ({
  call: "print", timestamp: now,
  params: {
    printer: { name: "Brother PT-P710BT (Inventory / QZ)" },
    options: { forceRaw: true, copies: 1, jobName: "Inventory labels" },
    data: [{ type: "raw", format: "command", flavor: "base64", data: "GkA=" }],
  },
});
const allowed = (request) => isAllowedQzRequest(JSON.stringify(request), now);

test("QZ signatures verify against its SHA-256 hex / RSA-SHA512 protocol", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const request = JSON.stringify(validPrint());
  const signature = Buffer.from(signQzRequest(request, privateKey.export({ type: "pkcs8", format: "pem" })), "base64");
  const digest = createHash("sha256").update(request).digest("hex");
  assert.equal(verify("RSA-SHA512", Buffer.from(digest), publicKey, signature), true);
  assert.equal(verify("RSA-SHA512", Buffer.from(request), publicKey, signature), false);
  assert.equal(verify("RSA-SHA512", Buffer.from(digest.replace(/./, "x")), publicKey, signature), false);
});

test("QZ signing only permits recent discovery and P710 raw label jobs", () => {
  assert.equal(allowed(validPrint()), true);
  assert.equal(allowed({ call: "printers.find", timestamp: now, params: {} }), true);
  for (const call of ["file.write", "usb.sendData", "networking.devices", "serial.sendData"]) {
    assert.equal(allowed({ ...validPrint(), call }), false);
  }
  assert.equal(allowed({ ...validPrint(), timestamp: now - 60_000 }), false);
  assert.equal(isAllowedQzRequest("not json", now), false);
  for (const printer of [{ name: "Other printer" }, { name: "PT-P710BT", host: "example.com" }, { file: "/tmp/output" }]) {
    const request = validPrint(); request.params.printer = printer;
    assert.equal(allowed(request), false);
  }
  const request = validPrint(); request.params.data[0].flavor = "file";
  assert.equal(allowed(request), false);
  request.params.data[0].flavor = "base64"; request.params.options.copies = 999;
  assert.equal(allowed(request), false);
  const longLabel = validPrint();
  longLabel.params.data[0].data = Buffer.from(encodePtouchRaster(white(14116, 128), 24)).toString("base64");
  assert.equal(allowed(longLabel), true);
  const series = validPrint();
  series.params.data[0].data = Buffer.from(combinePtouchLabels(Array(100).fill(encodePtouchRaster(white(1134, 128), 24)))).toString("base64");
  assert.equal(allowed(series), true);
  series.params.data[0].data = "A".repeat(5_500_000);
  assert.equal(allowed(series), false);
});


test("automatic photo processing preserves dark products and white backgrounds", () => {
  const gray = new Float32Array(48 * 24).fill(255);
  for (let y = 5; y < 20; y++) for (let x = 8; x < 40; x++) gray[y * 48 + x] = 35 + (x % 4) * 12;
  assert.deepEqual(adaptivePtouchPhoto(gray, 48, 24), clarifyPtouchPhoto(gray, 48, 24));
  assert.ok(adaptivePtouchPhoto(new Float32Array(48 * 24).fill(255), 48, 24).every(value => value === 255));
});

test("automatic photo processing retains pale surfaces and subtle darker controls", () => {
  const gray = new Float32Array(48 * 24).fill(255);
  for (let y = 4; y < 20; y++) for (let x = 8; x < 40; x++) gray[y * 48 + x] = 235;
  for (let y = 9; y < 15; y++) for (let x = 20; x < 28; x++) gray[y * 48 + x] = 220;
  const standard = clarifyPtouchPhoto(gray, 48, 24), optimized = adaptivePtouchPhoto(gray, 48, 24);
  assert.ok(optimized[12 * 48 + 12] < standard[12 * 48 + 12] - 25);
  assert.ok(optimized[12 * 48 + 24] < optimized[12 * 48 + 12]);
  assert.equal(optimized[0], 255);
  assert.ok(optimized.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
});

test("automatic halftone adds printable pale detail without marking outside the photo", () => {
  const make = () => ({width:48,height:24,data:Uint8ClampedArray.from({length:48*24*4},(_,i)=>i%4===3?255:235)});
  const standard = make(), auto = make();
  halftonePtouchPhoto(standard,{x:0,y:0,width:24,height:24},"standard");
  halftonePtouchPhoto(auto,{x:0,y:0,width:24,height:24},"auto");
  const count = p => Array.from(p.data).filter((v,i)=>i%4===0 && v===0).length;
  assert.ok(count(auto) > count(standard) + 30);
  for (let y=0;y<24;y++) for(let x=24;x<48;x++) assert.equal(auto.data[(y*48+x)*4],235);
});
