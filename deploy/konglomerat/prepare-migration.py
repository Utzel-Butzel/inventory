#!/usr/bin/env python3
"""Read a resource snapshot, copy original files, emit an atomic SQL import.

Usage: python3 prepare-migration.py /secure/migration-directory
Requires source-snapshot-approved.json. Does not write to either database.
Downloads are resumable, verified against the saved SHA-256 manifest.
The generated SQL refuses to import into a nonempty target organization.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import sys
import uuid
import time
import re

ROOT = Path(sys.argv[1]).resolve()
ORG = '00000000-0000-4000-8000-000000000001'
source = json.loads((ROOT / 'source-snapshot-approved.json').read_text())
resources = [r for r in source['resources'] if r['type'] != 'project']
ids = {r['id'] for r in resources}
by_id = {r['id']: r for r in source['resources']}
jobs = []
for resource in resources:
    urls = list(dict.fromkeys(([resource['image']] if resource['image'] else []) + (resource['images'] or [])))
    for field in ['media_previews', 'media_posters']:
        urls.extend(u for u in (resource[field] or {}).values() if u not in urls)
    for position, url in enumerate(urls):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != 'media.konglomerat.org':
            raise ValueError('Unexpected source media host; review before importing: ' + url)
        path = parsed.path
        if path.startswith('/t/resources/'):
            path = path.replace('/t/', '/api/download/', 1)
        elif not path.startswith('/api/download/resources/'):
            raise ValueError('Unexpected media path: ' + path)
        name = unquote(path.rsplit('/', 1)[-1])
        key = f"legacy-konglomerat/{resource['id']}/{hashlib.sha256(url.encode()).hexdigest()[:24]}{Path(name).suffix.lower()}"
        jobs.append(dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL, 'konglomerat-inventory:' + url)), resource_id=resource['id'], source_url=url,
                         download_url='https://media.konglomerat.org' + path, storage_key=key,
                         url='/api/files/' + key, name=name[:280], position=position))

manifest_path = ROOT / 'media-manifest.json'
previous = {r['source_url']: r for r in json.loads(manifest_path.read_text())} if manifest_path.exists() else {}

def download(job):
    file = ROOT / 'uploads' / job['storage_key']
    old = previous.get(job['source_url'])
    if old and file.exists() and hashlib.sha256(file.read_bytes()).hexdigest() == old['sha256']:
        return old
    for attempt in range(3):
        try:
            with urlopen(Request(job['download_url']), timeout=90) as response:
                mime = response.headers.get_content_type()
                if mime not in ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']:
                    raise ValueError('Unexpected MIME type: ' + mime)
                content = response.read()
                if not content:
                    raise ValueError('Empty media response')
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)
            return dict(job, mime_type=mime, kind='video' if mime.startswith('video/') else 'image', size=len(content), sha256=hashlib.sha256(content).hexdigest())
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)

manifest = []
with ThreadPoolExecutor(max_workers=4) as pool:
    for future in as_completed([pool.submit(download, job) for job in jobs]):
        manifest.append(future.result())
        if len(manifest) % 100 == 0:
            # Persist partial progress, including prior completed downloads.
            merged = {**previous, **{r['source_url']: r for r in manifest}}
            manifest_path.write_text(json.dumps(list(merged.values()), indent=2))
            manifest_path.chmod(0o600)
            print(f'Downloaded and hashed {len(manifest)}/{len(jobs)} files', flush=True)
manifest.sort(key=lambda m: (m['resource_id'], m['position']))
manifest_path.write_text(json.dumps(manifest, indent=2)); manifest_path.chmod(0o600)
media_by_url = {m['source_url']: m for m in manifest}

def quote(value):
    if value is None: return 'NULL'
    if isinstance(value, bool): return 'true' if value else 'false'
    if isinstance(value, (float, int)): return str(value)
    return "'" + str(value).replace("'", "''") + "'"

def js(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
def insert(table, row):
    return 'INSERT INTO ' + table + ' (' + ','.join(row) + ') VALUES (' + ','.join(quote(v) for v in row.values()) + ');'

sql = ['BEGIN;', "SET LOCAL standard_conforming_strings = on;", 'LOCK TABLE resources IN SHARE ROW EXCLUSIVE MODE;',
       f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM resources WHERE organization_id='{ORG}') THEN RAISE EXCEPTION 'Target organization must be empty; no changes applied'; END IF; END $$;"]
features_count = 0
for r in resources:
    features = []
    for f in r['map_features'] or []:
        typ = f.get('geometryType', 'Polygon')
        coords = f['point'] if typ == 'Point' else list(f['coordinates'])
        if typ == 'Polygon' and coords[0] != coords[-1]: coords.append(coords[0])
        features.append(dict(id=f['id'], layer=f.get('layer', 'default'), description=f.get('description', ''), type=typ.lower(), coordinates=coords))
    features_count += len(features)
    related = []; showcase_links = []
    for link in source['links']:
        other = link['resource_b'] if link['resource_a'] == r['id'] else link['resource_a'] if link['resource_b'] == r['id'] else None
        if not other: continue
        if other in ids: related.append(other)
        else: showcase_links.append('https://digital.konglomerat.org/showcase/' + other)
    notes = 'Importiert aus https://digital.konglomerat.org/resources/' + (r['pretty_title'] or r['id'])
    if showcase_links: notes += '\n\nVerknüpfte Showcases im bisherigen System:\n' + '\n'.join(showcase_links)
    legacy_slugs = [s['pretty_title'] for s in source['slugs'] if s['resource_id'] == r['id'] and not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', s['pretty_title'])]
    if legacy_slugs: notes += '\n\nHistorische URL-Namen im bisherigen System:\n' + '\n'.join(legacy_slugs)
    row = dict(organization_id=ORG, id=r['id'], name=r['name'], description=r['description'] or '', type=r['type'],
               priority=r['priority'], tags='{' + ','.join('"' + t.replace('\\','\\\\').replace('"','\\"') + '"' for t in (r['tags'] or [])) + '}',
               categories=js(r['categories'] or []), related_resource_ids='{' + ','.join(related) + '}',
               gps_latitude=r['gps_latitude'], gps_longitude=r['gps_longitude'], gps_altitude=r['gps_altitude'], map_features=js(features),
               notes=notes, created_by='migration:konglodigital', created_at=r['created_at'], updated_at=r['updated_at'])
    sql.append(insert('resources', row))
    slugs = sorted([s for s in source['slugs'] if s['resource_id'] == r['id'] and re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', s['pretty_title'])], key=lambda s: (not s['is_current'], s['created_at'], s['pretty_title']))
    for position, slug in enumerate(slugs):
        sql.append(insert('resource_slugs', dict(organization_id=ORG, resource_id=r['id'], slug=slug['pretty_title'], position=position, created_by='migration:konglodigital', created_at=slug['created_at'])))
for link in source['links']:
    if link['resource_a'] in ids and link['resource_b'] in ids:
        sql.append(insert('resource_relations', dict(organization_id=ORG, source_resource_id=link['resource_a'], target_resource_id=link['resource_b'], relation_type_key='related', origin='manual', created_by='migration:konglodigital', created_at=link['created_at'])))
for m in manifest:
    row = {k:m[k] for k in ['id','resource_id','storage_key','url','name','mime_type','kind','size','position']}
    row.update(organization_id=ORG, source='migration', created_at=by_id[m['resource_id']]['created_at'])
    sql.append(insert('media', row))
for r in resources:
    for field, column in [('media_previews','preview_media_id'), ('media_posters','poster_media_id')]:
        for original, derivative in (r[field] or {}).items():
            parent, child = media_by_url[original], media_by_url[derivative]
            assert parent['resource_id'] == child['resource_id'] == r['id'] and parent['kind'] == 'video'
            sql.append(f"UPDATE media SET {column}={quote(child['id'])} WHERE id={quote(parent['id'])} AND organization_id={quote(ORG)};")
sql += [f"DO $$ BEGIN IF (SELECT count(*) FROM resources WHERE organization_id='{ORG}') <> {len(resources)} OR (SELECT count(*) FROM media WHERE organization_id='{ORG}') <> {len(manifest)} THEN RAISE EXCEPTION 'Import count mismatch'; END IF; END $$;", 'COMMIT;']
(ROOT / 'import.sql').write_text('\n'.join(sql)); (ROOT / 'import.sql').chmod(0o600)
print(json.dumps(dict(resources=len(resources), map_features=features_count, media=len(manifest), bytes=sum(m['size'] for m in manifest), sql=str(ROOT/'import.sql'))), flush=True)
