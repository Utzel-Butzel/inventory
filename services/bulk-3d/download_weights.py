"""Download pinned official weights, verify original SHA256, store a compact copy."""
from pathlib import Path
import hashlib
import json
import shutil
import struct
import sys
import urllib.request
import numpy as np

REVISION = 'a1d87e9086706fb9974f3be5a3e3a0ca5401c5aa'
SOURCE_SHA256 = '981f060c64664dff3272b5f5a823d350abe71a2f144444db4cfc325f3ed5a3a0'
BASE = f'https://huggingface.co/facebook/map-anything/resolve/{REVISION}/'


def download(destination):
    destination.mkdir(parents=True, exist_ok=True)
    final = destination / 'model.safetensors'
    if final.exists():
        raise RuntimeError('Weights already exist; choose a new directory to avoid overwriting them.')
    temporary = destination / 'model.download'
    digest = hashlib.sha256()
    with urllib.request.urlopen(BASE+'model.safetensors', timeout=90) as response:
        def read_exact(length):
            parts = []
            while length:
                data = response.read(min(length, 16*1024*1024))
                if not data:
                    raise EOFError('Incomplete model download.')
                digest.update(data)
                parts.append(data)
                length -= len(data)
            return b''.join(parts)

        header_size = struct.unpack('<Q', read_exact(8))[0]
        if header_size > 10*1024*1024:
            raise RuntimeError('Unexpected checkpoint header.')
        header = json.loads(read_exact(header_size))
        ordered = sorted(((k, v) for k, v in header.items() if k != '__metadata__'), key=lambda row: row[1]['data_offsets'][0])
        new = {'__metadata__': {'model': 'facebook/map-anything', 'revision': REVISION, 'conversion': 'F32 to F16'}}
        position = 0
        for key, value in ordered:
            size = value['data_offsets'][1]-value['data_offsets'][0]
            if value['dtype'] == 'F32':
                size //= 2
            new[key] = {**value, 'dtype': 'F16' if value['dtype'] == 'F32' else value['dtype'], 'data_offsets': [position, position+size]}
            position += size
        if shutil.disk_usage(destination).free < position + 1024**3:
            raise RuntimeError('At least 3.5 GB free disk space is needed for the compact model.')
        encoded = json.dumps(new, separators=(',', ':')).encode()
        encoded += b' '*((-len(encoded)) % 8)
        try:
            with temporary.open('wb') as output:
                output.write(struct.pack('<Q', len(encoded)))
                output.write(encoded)
                cursor = 0
                for i, (key, value) in enumerate(ordered):
                    start, end = value['data_offsets']
                    if start != cursor:
                        raise RuntimeError('Unexpected checkpoint offsets.')
                    data = read_exact(end-start)
                    cursor = end
                    if value['dtype'] == 'F32':
                        original = np.frombuffer(data, dtype='<f4')
                        converted = original.astype('<f2')
                        if np.isfinite(original).all() and not np.isfinite(converted).all():
                            raise RuntimeError('Precision conversion overflow.')
                        data = converted.tobytes()
                    output.write(data)
                    if i % 100 == 0:
                        print(f'{i+1}/{len(ordered)} tensors downloaded', flush=True)
            if response.read(1) or digest.hexdigest() != SOURCE_SHA256:
                raise RuntimeError('Original checkpoint checksum mismatch.')
            config = urllib.request.urlopen(BASE+'config.json', timeout=30).read()
            json.loads(config)
            (destination / 'config.json').write_bytes(config)
            temporary.replace(final)
            (destination / 'provenance.json').write_text(json.dumps({'revision': REVISION, 'sourceSha256': SOURCE_SHA256, 'storedPrecision': 'F16', 'sourcePrecision': 'F32'}, indent=2))
        except Exception:
            temporary.unlink(missing_ok=True)
            raise


if __name__ == '__main__':
    download(Path(sys.argv[1]))
