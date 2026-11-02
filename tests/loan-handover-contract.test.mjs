import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { loanHandoverSchema, readHandoverRequest, validateHandoverTransition, HANDOVER_MAX_BODY_BYTES } from "../lib/loan-handover-contract.ts";
import { normalizeHandoverPhotos } from "../lib/loan-handovers.ts";
import { renderLoanHandoverPdf } from "../lib/loan-handover-pdf.ts";
import { PDFDocument } from "pdf-lib";

const valid = { condition: "good", givenBy: "Anna", receivedBy: "Ben", confirmed: true };
test("confirmation, participants, damage and missing accessory evidence are required", () => {
  assert.equal(loanHandoverSchema.safeParse(valid).success, true);
  for (const input of [
    { ...valid, confirmed: false }, { ...valid, receivedBy: " " },
    { ...valid, condition: "damaged" }, { ...valid, accessories: [{ name: "Battery", present: false }] },
    { ...valid, accessories: [{ name: "Battery", present: true }, { name: "battery", present: true }] },
    { ...valid, recordedBy: "forged" }, { ...valid, photos: ["https://example.com/image.jpg"] },
    { ...valid, photos: ["data:image/svg+xml;base64,PHN2Zy8+"] },
  ]) assert.equal(loanHandoverSchema.safeParse(input).success, false, JSON.stringify(input));
  assert.equal(loanHandoverSchema.safeParse({ ...valid, condition: "damaged", notes: "Cracked casing" }).success, true);
});

test("documented checkouts require return evidence and preserve the original checklist", () => {
  const base = { phase: "return", kind: "checkout", documentedCheckout: true };
  assert.match(validateHandoverTransition(base), /required/);
  assert.match(validateHandoverTransition({ ...base, phase: "cancel" }), /not cancelled/);
  const handover = loanHandoverSchema.parse(valid);
  assert.match(validateHandoverTransition({ ...base, handover, originalAccessories: [{ name: "Cable", present: true }] }), /every accessory/);
  assert.equal(validateHandoverTransition({ ...base, handover: { ...handover, accessories: [{ name: "Cable", present: false }], notes: "Cable missing" }, originalAccessories: [{ name: "Cable", present: true }] }), null);
  assert.equal(validateHandoverTransition({ ...base, documentedCheckout: false }), null);
  assert.match(validateHandoverTransition({ ...base, kind: "reservation", handover }), /only supported/);
});

test("request size is enforced without relying on Content-Length", async () => {
  const request = (body, headers) => new Request("http://localhost/handover", { method: "POST", body, headers });
  assert.deepEqual(await readHandoverRequest(request(JSON.stringify(valid))), valid);
  await assert.rejects(readHandoverRequest(request("invalid")), (error) => error.status === 400);
  await assert.rejects(readHandoverRequest(request("{}", { "Content-Length": String(HANDOVER_MAX_BODY_BYTES + 1) })), (error) => error.status === 413);
  await assert.rejects(readHandoverRequest(request(" ".repeat(HANDOVER_MAX_BODY_BYTES + 1))), (error) => error.status === 413);
});

test("photo snapshots decode real images and discard metadata; PDFs embed them", async () => {
  const source = await sharp({ create: { width: 1800, height: 100, channels: 3, background: "#665cff" } }).jpeg().withMetadata().toBuffer();
  const handover = await normalizeHandoverPhotos({ ...loanHandoverSchema.parse(valid), photos: [`data:image/jpeg;base64,${source.toString("base64")}`] });
  const image = await sharp(Buffer.from(handover.photos[0].split(",")[1], "base64")).metadata();
  assert.equal(image.width, 1600);
  assert.equal(image.exif, undefined);
  await assert.rejects(normalizeHandoverPhotos({ ...handover, photos: ["data:image/png;base64,bm90YW5pbWFnZQ=="] }));
  const document = { ...handover, version: 1, phase: "checkout", assignmentId: "test-loan", resourceId: "item", resourceName: "Kamera", unitCode: "SN-12", quantity: 1, borrower: "Ben", dueAt: null, occurredAt: "2026-11-01T12:00:00Z", recordedAt: "2026-11-01T12:00:01Z", recordedBy: "anna@example.com" };
  const pdf = await renderLoanHandoverPdf([document], "de");
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 2);
});
