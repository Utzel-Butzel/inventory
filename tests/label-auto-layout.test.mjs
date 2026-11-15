import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeLabelRow, resolveLabelRow, moveRowElement, orderedRowElements } from '../lib/label-auto-layout.ts';
import { labelSetupCreateSchema, labelSetupPatchSchema, labelRowHeightError } from '../lib/label-setup-contract.ts';
import { resolveLabelLayout } from '../lib/label-dynamic-layout.ts';
import { savedLabelSchema } from '../lib/label-workspace-contract.ts';
import { readyLabelDimensions } from '../lib/label-print-dimensions.ts';

const box = { x: 0, y: 0, width: 20, height: 50, visible: true };
const setup = { id: 'fixture', name: 'Row', widthMm: 50, heightMm: 20, revision: 1, createdAt: '', updatedAt: '',
  elements: [{ ...box, type: 'name', x: 10 }, { ...box, type: 'subtitle', x: 30 }, { ...box, type: 'image', x: 70 }] };
const input = value => { const { id, revision, createdAt, updatedAt, ...rest } = value; return rest; };
const mm = (element, dimension, size) => element[dimension] / 100 * size;
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.000001, `${a} != ${b}`);

test('multiple texts grow independently and the trailing image keeps its physical size', () => {
  const row = initializeLabelRow(setup);
  const short = resolveLabelRow(row, { name: 15, subtitle: 8 });
  const long = resolveLabelRow(row, { name: 110, subtitle: 18 });
  near(short.widthMm, 41);
  near(long.widthMm, 146);
  near(mm(long.elements[2], 'x', long.widthMm), 134);
  near(mm(long.elements[2], 'width', long.widthMm), 10);
  near(mm(long.elements[2], 'height', long.heightMm), 10);
  assert.equal(long.heightMm, setup.heightMm);
});

test('asymmetric padding and all vertical alignments resolve in physical units', () => {
  const row = initializeLabelRow(setup);
  for (const [align, expected] of [['top', 2], ['middle', 4.5], ['bottom', 7]]) {
    row.layout = { ...row.layout, paddingTopMm: 2, paddingBottomMm: 3, paddingLeftMm: 4, paddingRightMm: 6, gapMm: 3, align };
    const result = resolveLabelRow(row, { name: 15, subtitle: 8 });
    near(result.widthMm, 49);
    near(mm(result.elements[0], 'x', result.widthMm), 4);
    near(mm(result.elements[0], 'y', result.heightMm), expected);
  }
});

test('fixed text ignores measured width; hidden elements consume no width or gap; background fills label', () => {
  const row = initializeLabelRow({ ...setup, elements: [
    { ...setup.elements[0], rowSizing: 'fixed' }, { ...setup.elements[1], visible: false }, setup.elements[2],
    { ...box, type: 'background', width: 100, height: 100 },
  ] });
  const result = resolveLabelRow(row, { name: 300, subtitle: 400 });
  near(result.widthMm, 26);
  assert.equal(result.elements[3].width, 100);
  assert.equal(result.elements[3].height, 100);
  near(mm(result.elements[2], 'x', result.widthMm), 14);
});

test('reorder preserves free positions and layer order across mode changes', () => {
  const row = initializeLabelRow(setup);
  row.elements = moveRowElement(row.elements, 'image', 0);
  assert.deepEqual(orderedRowElements(row.elements).map(e => e.type), ['image', 'name', 'subtitle']);
  assert.deepEqual(row.elements.map(({ x, y, width, height, layer }) => ({ x, y, width, height, layer })), setup.elements.map(({ x, y, width, height, layer }) => ({ x, y, width, height, layer })));
  assert.deepEqual(initializeLabelRow({ ...row, layout: null }).elements, row.elements);
  assert.equal(resolveLabelRow(setup, {}), setup);
  assert.equal(resolveLabelLayout(setup, 90), setup);
});

test('row schemas accept overlapping stored free boxes but free layout still rejects QR/image collisions', () => {
  const free = { ...setup, elements: [{ ...box, type: 'qr' }, { ...box, type: 'image' }] };
  assert.equal(labelSetupCreateSchema.safeParse(input(free)).success, false);
  const row = initializeLabelRow(free);
  assert.equal(labelSetupCreateSchema.safeParse(input(row)).success, true);
  const patch = labelSetupPatchSchema.parse({ revision: 1, layout: row.layout, elements: row.elements });
  assert.deepEqual(patch.layout, row.layout);
  assert.equal(labelSetupPatchSchema.parse({ revision: 1, layout: null }).layout, null);
});

test('height stays fixed after resizing label and invalid padding/element heights are rejected', () => {
  const row = initializeLabelRow(setup);
  const taller = resolveLabelRow({ ...row, heightMm: 30 }, {});
  near(mm(taller.elements[0], 'height', taller.heightMm), 10);
  const bad = { ...row, heightMm: 8 };
  assert.equal(labelRowHeightError(bad), true);
  assert.equal(labelSetupCreateSchema.safeParse(input(bad)).success, false);
  assert.equal(labelSetupCreateSchema.safeParse(input({ ...row, layout: { ...row.layout, paddingBottomMm: -1001 } })).success, false);
  assert.equal(labelSetupCreateSchema.safeParse(input({ ...row, elements: [{ ...row.elements[0], rowWidthMm: Infinity }] })).success, false);
});

test('empty rows use only padding and never add a phantom gap', () => {
  const row = initializeLabelRow({ ...setup, elements: [] });
  assert.equal(resolveLabelRow(row, {}).widthMm, 4);
});

test('print dimensions use resolved row width and reject overflow instead of clipping', async () => {
  const oldDocument = globalThis.document, oldRaf = globalThis.requestAnimationFrame;
  globalThis.document = { fonts: { ready: Promise.resolve() } };
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  try {
    assert.deepEqual(await readyLabelDimensions({ dataset: { labelWidthMm: '146', labelHeightMm: '20' } }, 50, 20), { widthMm: 146, heightMm: 20 });
    await assert.rejects(readyLabelDimensions({ dataset: { labelLayoutError: 'Height exceeds label' } }, 50, 20), /Height exceeds/);
    await assert.rejects(readyLabelDimensions({ dataset: { labelWidthMm: '1001' } }, 50, 20), /maximum 1000/);
  } finally { globalThis.document = oldDocument; globalThis.requestAnimationFrame = oldRaf; }
});

test('prepared labels preserve Auto Layout settings and per-element physical dimensions', () => {
  const row = initializeLabelRow(setup);
  row.elements = moveRowElement(row.elements, 'image', 0);
  row.elements[0].rowSizing = 'fixed';
  const roundtrip = savedLabelSchema.shape.setup.parse(JSON.parse(JSON.stringify(row)));
  assert.deepEqual(roundtrip.layout, row.layout);
  assert.deepEqual(roundtrip.elements, row.elements);
});


test('negative spacing survives saving and resolves overlapping and outlying elements', () => {
  const row = initializeLabelRow(setup);
  row.layout = { ...row.layout, gapMm: -2, paddingLeftMm: -3, paddingRightMm: -1,
    paddingTopMm: -4, paddingBottomMm: -5, align: 'top' };
  assert.equal(labelSetupCreateSchema.safeParse(input(row)).success, true);
  assert.deepEqual(labelSetupPatchSchema.parse({ revision: 1, layout: row.layout }).layout, row.layout);
  assert.deepEqual(savedLabelSchema.shape.setup.parse(JSON.parse(JSON.stringify(row))).layout, row.layout);
  const result = resolveLabelRow(row, { name: 15, subtitle: 8 });
  near(result.widthMm, 25);
  near(mm(result.elements[0], 'x', result.widthMm), -3);
  near(mm(result.elements[1], 'x', result.widthMm), 10);
  near(mm(result.elements[0], 'y', result.heightMm), -4);
});

const groupId = 'e9b11ec3-20a4-4c30-9905-26578ab21101';
const grouped = () => {
  const row = initializeLabelRow(setup);
  row.layout.groups = [{ id: groupId, name: 'Texts', direction: 'column', gapMm: 1, paddingMm: 1, align: 'center' }];
  row.elements = row.elements.map((element, index) => index < 2 ? { ...element, groupId, rowHeightMm: 4 } : element);
  return row;
};

test('vertical groups hug measured content and remain one item beside the image', () => {
  const row = grouped();
  const result = resolveLabelRow(row, { name: 15, subtitle: 8 });
  near(result.widthMm, 33); // 2 + 17 + 2 + 10 + 2
  near(mm(result.elements[0], 'x', result.widthMm), 3);
  near(mm(result.elements[1], 'x', result.widthMm), 6.5);
  near(mm(result.elements[0], 'y', result.heightMm), 5.5);
  near(mm(result.elements[1], 'y', result.heightMm), 10.5);
  near(mm(result.elements[2], 'x', result.widthMm), 21);
  near(mm(result.elements[2], 'width', result.widthMm), 10);
  const longer = resolveLabelRow(row, { name: 30, subtitle: 8 });
  near(longer.widthMm, 48);
  near(mm(longer.elements[2], 'width', longer.widthMm), 10);
});

test('horizontal group direction, alignment and hidden children affect physical bounds', () => {
  const row = grouped();
  row.layout.groups[0] = { ...row.layout.groups[0], direction: 'row', align: 'end' };
  row.elements[0].rowHeightMm = 6;
  const result = resolveLabelRow(row, { name: 15, subtitle: 8 });
  near(result.widthMm, 42);
  near(mm(result.elements[1], 'x', result.widthMm), 19);
  near(mm(result.elements[1], 'y', result.heightMm), 9);
  row.elements[1].visible = false;
  near(resolveLabelRow(row, { name: 15 }).widthMm, 33);
  row.elements[0].visible = false;
  near(resolveLabelRow(row, {}).widthMm, 14);
});

test('groups survive saving and validate stacked height and membership', () => {
  const row = grouped();
  assert.equal(labelSetupCreateSchema.safeParse(input(row)).success, true);
  const saved = savedLabelSchema.shape.setup.parse(JSON.parse(JSON.stringify(row)));
  assert.deepEqual(saved.layout.groups, row.layout.groups);
  assert.equal(saved.elements[0].groupId, groupId);
  assert.equal(labelRowHeightError({ ...row, heightMm: 10 }), true);
  assert.equal(labelSetupCreateSchema.safeParse(input({ ...row, heightMm: 10 })).success, false);
  assert.equal(labelSetupCreateSchema.safeParse(input({ ...row, layout: { ...row.layout, groups: [] } })).success, false);
  assert.equal(labelSetupCreateSchema.safeParse(input({ ...row, layout: { ...row.layout, groups: [...row.layout.groups, ...row.layout.groups] } })).success, false);
});

test('reordering children stays inside a group and moving a group preserves child order', async () => {
  const { moveRowGroup, rowBlocks } = await import('../lib/label-auto-layout.ts');
  const row = grouped();
  row.elements = moveRowElement(row.elements, 'subtitle', 0);
  assert.deepEqual(rowBlocks(row.elements).map(block => block.map(e => e.type)), [['subtitle', 'name'], ['image']]);
  row.elements = moveRowGroup(row.elements, groupId, 1);
  assert.deepEqual(rowBlocks(row.elements).map(block => block.map(e => e.type)), [['image'], ['subtitle', 'name']]);
  const result = resolveLabelRow(row, { name: 15, subtitle: 8 });
  near(mm(result.elements[2], 'x', result.widthMm), 2);
  assert.ok(result.elements[1].y < result.elements[0].y);
});
