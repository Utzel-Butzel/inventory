#!/usr/bin/env python3
"""Check AAB signing and all bundled 64-bit ELF LOAD segment alignments."""
import hashlib
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
bundle = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'android/app/build/outputs/bundle/release/app-release.aab'
if not bundle.is_file():
    sys.exit(f'Missing bundle: {bundle}')
java_home = os.environ.get('JAVA_HOME')
jarsigner = str(Path(java_home) / 'bin/jarsigner') if java_home else shutil.which('jarsigner')
if not jarsigner:
    sys.exit('Install Java 17 or set JAVA_HOME to verify the bundle signature')
result = subprocess.run([jarsigner, '-J-Duser.language=en', '-verify', str(bundle)], capture_output=True, text=True)
if result.returncode or 'jar verified.' not in result.stdout or 'unsigned entries' in result.stdout:
    sys.exit('Bundle signature verification failed: ' + result.stdout + result.stderr)
failures = []
checked = 0
with zipfile.ZipFile(bundle) as archive:
    if 'base/manifest/AndroidManifest.xml' not in archive.namelist():
        sys.exit('No base manifest in the Android App Bundle')
    for name in archive.namelist():
        if not name.endswith('.so') or not any(f'/{abi}/' in name for abi in ('arm64-v8a', 'x86_64')):
            continue
        data = archive.read(name)
        if data[:6] != b'\x7fELF\x02\x01':
            failures.append(f'{name}: expected little-endian ELF64')
            continue
        phoff = struct.unpack_from('<Q', data, 32)[0]
        phentsize, phnum = struct.unpack_from('<HH', data, 54)
        loads = 0
        for i in range(phnum):
            offset = phoff + i * phentsize
            if struct.unpack_from('<I', data, offset)[0] != 1:
                continue
            loads += 1
            file_offset, virtual_address = struct.unpack_from('<QQ', data, offset + 8)
            alignment = struct.unpack_from('<Q', data, offset + 48)[0]
            if alignment < 16384 or (virtual_address - file_offset) % 16384:
                failures.append(f'{name}: LOAD segment alignment {alignment} is not 16 KB compatible')
        if not loads:
            failures.append(f'{name}: no ELF LOAD segments found')
        checked += 1
if failures:
    sys.exit('\n'.join(failures))
print(f'Signed AAB verified; {checked} native 64-bit libraries support 16 KB LOAD alignment.')
print(f'SHA-256: {hashlib.file_digest(bundle.open("rb"), "sha256").hexdigest()}')
print(bundle)
