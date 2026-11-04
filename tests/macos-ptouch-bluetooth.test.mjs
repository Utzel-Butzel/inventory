import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { encodePtouchRaster, combinePtouchLabels } from '../lib/ptouch-raster.ts';

test('native Bluetooth helper validates complete high-resolution jobs without connecting', { skip: process.platform !== 'darwin' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-bluetooth-test-'));
  try {
    const helper = join(dir, 'helper');
    const build = spawnSync('clang', ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-framework', 'IOBluetooth',
      'scripts/print-agent/macos_ptouch_bluetooth.m', '-o', helper], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const label = encodePtouchRaster({ width: 20, height: 128, data: new Uint8ClampedArray(20 * 128 * 4) }, 24);
    const validate = bytes => {
      const file = join(dir, 'job.bin');
      writeFileSync(file, bytes);
      return spawnSync(helper, ['--validate', file], { encoding: 'utf8' });
    };
    assert.equal(validate(label).status, 0);
    const batch = combinePtouchLabels([label, label, label]);
    assert.match(validate(batch).stdout, /pages=3 tape=24/);
    for (const [offset, value] of [[100, 0], [111, 99], [117, 1], [126, 0x08], [134, 0], [batch.length - 1, 0x0c]]) {
      const invalid = batch.slice(); invalid[offset] = value;
      assert.equal(validate(invalid).status, 1, `must reject corrupt byte ${offset}`);
    }
    assert.equal(validate(batch.subarray(0, batch.length - 1)).status, 1);
    assert.equal(validate(new Uint8Array([...label, 0])).status, 1);
    const mixedTape = batch.slice(); mixedTape[label.length + 9] = 12;
    assert.equal(validate(mixedTape).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
