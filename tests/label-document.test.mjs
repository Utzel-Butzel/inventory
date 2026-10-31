import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_PRINT_MEDIA, layoutLabelPages, labelDocumentSchema } from '../lib/label-document.ts';
import { createLabelPdf } from '../lib/label-document-pdf.ts';
import { sharedPrintSchema, printerCreateSchema } from '../lib/shared-label-print-contract.ts';
import { labelWorkspaceMutationSchema } from '../lib/label-workspace-contract.ts';

const sheet = {...DEFAULT_PRINT_MEDIA, mode: 'sheet'};
const label = {widthMm: 60, heightMm: 30};
async function snapshot(widthMm = 60, heightMm = 30) {
 const png = await sharp({create: {width: Math.round(widthMm * 10), height: Math.round(heightMm * 10), channels: 3, background: 'white'}})
  .composite([{input: Buffer.from(`<svg width="${widthMm*10}" height="${heightMm*10}"><rect x="10" y="10" width="${widthMm*10-20}" height="${heightMm*10-20}" fill="none" stroke="black" stroke-width="2"/><text x="30" y="70" font-size="30">Inventory · 100%</text></svg>`)}]).png().toBuffer();
 return {png: 'data:image/png;base64,' + png.toString('base64'), widthMm, heightMm};
}
test('sheet starts at the requested slot, wraps rows/pages and retains physical dimensions', () => {
 const pages = layoutLabelPages(Array(4).fill(label), {...sheet, startPosition: 23});
 assert.equal(pages.length, 2);
 assert.deepEqual(pages.map(p=>p.labels.map(l=>l.index)), [[0,1],[2,3]]);
 assert.equal(pages[0].labels[0].x, 73.75);
 assert.ok(Math.abs(pages[0].labels[0].y - 250.2) < 0.0001);
 assert.equal(pages[1].labels[0].x, 7.75);
 assert.equal(pages[1].labels[0].width, 60);
});
test('rejects overflowing grids, invalid start positions, clipping and silent scaling', () => {
 for (const changes of [{startPosition:25}, {marginLeftMm:30}, {offsetXMm:-10}, {columns:0}, {rows:NaN}])
  assert.throws(()=>layoutLabelPages([label], {...sheet,...changes}));
 assert.throws(()=>layoutLabelPages([{...label,widthMm:64}],sheet), /PRINT_LABEL_TOO_LARGE/);
 assert.throws(()=>layoutLabelPages([label], {...DEFAULT_PRINT_MEDIA,offsetXMm:1}), /PRINT_INDIVIDUAL_OFFSET/);
 assert.throws(()=>layoutLabelPages(Array(101).fill(label),sheet));
});
test('individual pages preserve different dimensions; sheet corrections do not scale', () => {
 const pages = layoutLabelPages([label,{widthMm:102,heightMm:152}],DEFAULT_PRINT_MEDIA);
 assert.deepEqual(pages.map(p=>[p.width,p.height]),[[60,30],[102,152]]);
 const corrected = layoutLabelPages([label],{...sheet,offsetXMm:1,offsetYMm:-1});
 assert.equal(corrected[0].labels[0].x,8.75);
 assert.equal(corrected[0].labels[0].y,11.9);
});
test('PDF contains exact A4 pages, deterministic bytes for retries and retained blank cells', async () => {
 const image = await snapshot();
 const document = {labels:Array(4).fill(image),media:{...sheet,startPosition:23}};
 const a = await createLabelPdf(document), b = await createLabelPdf(document);
 assert.deepEqual(a,b);
 const pdf=await PDFDocument.load(a);
 assert.equal(pdf.getPageCount(),2);
 for(const page of pdf.getPages()) {
  assert.ok(Math.abs(page.getWidth()-210*72/25.4)<0.001);
  assert.ok(Math.abs(page.getHeight()-297*72/25.4)<0.001);
 }
 if(process.env.PRINT_QA_PDF) {
  const {mkdir,writeFile}=await import('node:fs/promises');
  await mkdir('tmp/pdfs',{recursive:true});
  await writeFile('tmp/pdfs/inventory-sheet.pdf',a);
  await writeFile('tmp/pdfs/inventory-single.pdf',await createLabelPdf({labels:[image],media:DEFAULT_PRINT_MEDIA}));
 }
});
test('PDF rejects non-PNG content and mismatched physical proportions', async () => {
 const image=await snapshot();
 await assert.rejects(()=>createLabelPdf({labels:[{...image,heightMm:60}],media:sheet}),/dimensions|PRINT_LABEL_TOO_LARGE/);
 await assert.rejects(()=>createLabelPdf({labels:[{...image,png:'data:image/png;base64,aGVsbG8='}],media:sheet}));
 assert.equal(labelDocumentSchema.safeParse({labels:[{...image,png:'https://example.test/image.png'}],media:sheet}).success,false);
});
test('remote formats remain explicit, legacy P-touch inputs work and printer configuration is bounded', async () => {
 const id=crypto.randomUUID(), printerId=crypto.randomUUID();
 assert.ok(sharedPrintSchema.safeParse({id,printerId,tape:24,labels:['AAAA']}).success);
 assert.ok(sharedPrintSchema.safeParse({id,printerId,format:'pdf',document:{labels:[await snapshot()],media:sheet}}).success);
 assert.equal(sharedPrintSchema.safeParse({id,printerId,format:'pdf',data:'arbitrary PDF'}).success,false);
 assert.equal(printerCreateSchema.parse({name:'Legacy'}).kind,'ptouch');
 assert.equal(printerCreateSchema.parse({name:'Office',kind:'system',maxWidthMm:210}).maxWidthMm,210);
 assert.equal(printerCreateSchema.safeParse({name:'Office',kind:'system',maxWidthMm:0}).success,false);
 assert.ok(labelWorkspaceMutationSchema.safeParse({action:'preferences',preferences:{media:sheet}}).success);
});
