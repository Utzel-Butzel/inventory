#!/usr/bin/env python3
"""Compare every imported record against the saved source and media manifest.
Usage: verify-migration.py SECURE_DIRECTORY [--production]
"""
import json
import subprocess
import sys
import re
from pathlib import Path
from datetime import datetime

root = Path(sys.argv[1])
production = '--production' in sys.argv
container = 'konglo-openinventory-wz8tqj-konglo-inventory-db-1' if production else 'konglo-migration-check'
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'inventory', '-d', 'inventory', '-At']
if production: command = ['ssh', 'konglo-server', ' '.join(command)]
query = "select json_build_object('resources',(select json_agg(r) from resources r),'media',(select json_agg(m) from media m),'slugs',(select json_agg(s) from resource_slugs s),'relations',(select json_agg(l) from resource_relations l));"
target = json.loads(subprocess.run(command, input=query, text=True, capture_output=True, check=True).stdout)
source = json.loads((root/'source-snapshot-approved.json').read_text())
manifest = json.loads((root/'media-manifest.json').read_text())
expected = [r for r in source['resources'] if r['type'] != 'project']
actual = {r['id']: r for r in target['resources']}
assert set(actual) == {r['id'] for r in expected}, 'Resource IDs differ'
for r in expected:
    row = actual[r['id']]
    for field in ['name','type','priority','gps_latitude','gps_longitude','gps_altitude']:
        assert row[field] == r[field], (r['id'], field)
    assert row['description'] == (r['description'] or '')
    assert row['tags'] == (r['tags'] or []) and row['categories'] == (r['categories'] or [])
    for field in ['created_at', 'updated_at']:
        assert datetime.fromisoformat(row[field]) == datetime.fromisoformat(r[field]), (r['id'], field)
    features = []
    for f in r['map_features'] or []:
        typ = f.get('geometryType', 'Polygon')
        coordinates = f['point'] if typ == 'Point' else list(f['coordinates'])
        if typ == 'Polygon' and coordinates[0] != coordinates[-1]: coordinates.append(coordinates[0])
        features.append(dict(id=f['id'], layer=f.get('layer','default'), description=f.get('description',''), type=typ.lower(), coordinates=coordinates))
    assert row['map_features'] == features, (r['id'], 'map_features')
    old_slugs = [s['pretty_title'] for s in source['slugs'] if s['resource_id'] == r['id'] and not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*',s['pretty_title'])]
    assert all(slug in row['notes'] for slug in old_slugs)
    related = {l['resource_b'] if l['resource_a'] == r['id'] else l['resource_a'] for l in source['links'] if r['id'] in (l['resource_a'],l['resource_b']) and l['resource_a'] in actual and l['resource_b'] in actual}
    assert set(row['related_resource_ids']) == related
    for link in source['links']:
        other = link['resource_b'] if link['resource_a'] == r['id'] else link['resource_a'] if link['resource_b'] == r['id'] else None
        if other and other not in actual: assert 'https://digital.konglomerat.org/showcase/' + other in row['notes']
expected_slugs = {(s['resource_id'],s['pretty_title']) for s in source['slugs'] if s['resource_id'] in actual and re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*',s['pretty_title'])}
assert {(s['resource_id'],s['slug']) for s in target['slugs']} == expected_slugs
for r in expected:
    current = next(s for s in target['slugs'] if s['resource_id']==r['id'] and s['position']==0)
    assert current['slug'] == r['pretty_title']
expected_links = {(l['resource_a'],l['resource_b']) for l in source['links'] if l['resource_a'] in actual and l['resource_b'] in actual}
assert {(l['source_resource_id'],l['target_resource_id']) for l in target['relations'] if l['relation_type_key']=='related'} == expected_links
actual_media = {m['id']:m for m in target['media']}
assert set(actual_media) == {m['id'] for m in manifest}
by_url = {m['source_url']:m for m in manifest}
for m in manifest:
    row = actual_media[m['id']]
    for field in ['resource_id','storage_key','url','name','mime_type','kind','size','position']:
        assert row[field] == m[field], (m['id'],field)
for r in expected:
    for field,column in [('media_previews','preview_media_id'),('media_posters','poster_media_id')]:
        for original,derivative in (r[field] or {}).items():
            assert actual_media[by_url[original]['id']][column] == by_url[derivative]['id']
summary = dict(environment='production' if production else 'staging', resources=len(actual), media=len(actual_media), map_features=sum(len(r['map_features']) for r in actual.values()), slugs=len(expected_slugs), related_links=len(expected_links), verified=True)
(root/('production-verification.json' if production else 'staging-verification.json')).write_text(json.dumps(summary,indent=2))
print(json.dumps(summary))
