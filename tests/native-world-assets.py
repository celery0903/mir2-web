#!/usr/bin/env python3
"""Verify native world cells, file routing and every exported source frame."""
import hashlib
import json
import os
import re
from pathlib import Path
import struct
import sys
from importlib import import_module

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
native = import_module('prepare-native-map-assets')
from crystal_lib import CrystalLibrary, png_rgba
from map_tool import ClassicMap, UnsupportedMap

rules = json.loads((ROOT / 'shared/classic-map-library-rules.json').read_text())
reference = ROOT / os.environ.get('MIR_LEGACY_SOURCE', '.runtime/legacy-source') / rules['file']
reference_bytes = reference.read_bytes()
assert hashlib.sha256(reference_bytes).hexdigest() == rules['sha256']
pascal = reference_bytes.decode('gbk')
bounds = re.search(r'g_WObjectArr\s*:\s*array\[(\d+)\.\.(\d+)\]', pascal, re.I)
assert bounds and tuple(map(int, bounds.groups())) == (rules['objectFileByteMinimum'], rules['objectFileByteMaximum'])
for method in rules['methods']:
    implementation = re.split(r'\bimplementation\b', pascal, flags=re.I)[1]
    body = re.search(r'function\s+' + method + r'\s*\([^;]+;.*?(?=\nfunction|\Z)', implementation, re.I | re.S)
    assert body and re.search(r'if not \(nUnit in \[Low\(g_WObjectArr\) \.\. High\(g_WObjectArr\)\]\) then nUnit:=0;', body.group())

fixture = bytearray(52 + 4 * 12)
struct.pack_into('<HH', fixture, 0, 2, 2)
for cell, family in enumerate([0, 14, 15, 255]):
    struct.pack_into('<H', fixture, 52 + cell * 12 + 4, 1)
    fixture[52 + cell * 12 + 10] = family
world = native.checked_map(fixture)
_, routing = native.references(world, rules)
assert routing == {'0': 'Objects', '14': 'WemadeObjects15', '15': 'Objects', '255': 'Objects'}
assert native.references(world)[1]['255'] == 'WemadeObjects256', 'Converted namespaces must not use the native fallback'
struct.pack_into('<H', fixture, 52 + 3 * 12 + 4, 0x7f00)
assert '255' not in native.references(native.checked_map(fixture), rules)[1], 'Sentinel interpreted as a frame'

# Six 14-byte cells have a 12-byte-aligned excess and fooled the upstream tail heuristic.
ambiguous = bytearray(52 + 6 * 14)
struct.pack_into('<HH', ambiguous, 0, 2, 3)
assert ClassicMap(ambiguous).trailing_bytes == 12
try:
    native.checked_map(ambiguous)
except UnsupportedMap:
    pass
else:
    raise AssertionError('14-byte layout accepted as classic-12')

assets = ROOT / os.environ.get('MIR_SOURCE_ASSETS', '.runtime/native-world-fix/assets')
maps = ROOT / os.environ.get('MIR_SOURCE_MAPS', '.runtime/native-world-profile/Map')
libraries = ROOT / os.environ.get('MIR_NATIVE_MAP_LIBRARIES', '.runtime/wemade-mir2')
destination = ROOT / os.environ.get('MIR_NATIVE_WORLD_REPORT', '.runtime/reports/native-world-assets.json')
report = json.loads((assets / 'native-world.json').read_text())
lock = json.loads((ROOT / 'shared/native-world.lock.json').read_text())
checked_cells = checked_frames = checked_pixels = 0
map_results = []
missing_references = []
for entry in report['maps']:
    ident = entry['id']
    pin = next(pin for pin in lock['maps'] if pin['id'] == ident)
    path = maps / f'{ident}.map'
    if not path.exists() and pin.get('sourceFile'):
        path = maps / pin['sourceFile']
    raw = path.read_bytes()
    assert len(raw) == pin['bytes'] and hashlib.sha256(raw).hexdigest() == pin['sha256']
    manifest = json.loads((assets / 'maps' / ident / 'map.json').read_text())
    assert manifest['sourceSha256'] == pin['sha256']
    assert manifest['resourceNamespace'] == 'WemadeMir2'
    height, width = manifest['height'], manifest['width']
    rebuilt = bytearray(raw[:52]) + bytearray(len(raw) - 52)
    covered = bytearray(width * height)
    for chunk in manifest['chunks']:
        data = (assets / 'maps' / ident / chunk['file']).read_bytes()
        assert len(data) == chunk['bytes'] == chunk['width'] * chunk['height'] * 12
        assert hashlib.sha256(data).hexdigest() == chunk['sha256']
        for x in range(chunk['width']):
            for y in range(chunk['height']):
                cell = (chunk['x'] + x) * height + chunk['y'] + y
                assert not covered[cell]
                covered[cell] = 1
                start = (x * chunk['height'] + y) * 12
                rebuilt[52 + cell * 12:52 + (cell + 1) * 12] = data[start:start + 12]
    assert all(covered) and rebuilt == raw
    non_default = 0
    for offset in range(52, len(raw), 12):
        image = struct.unpack_from('<H', raw, offset + 4)[0] & 0x7fff
        if 0 < image < 0x7f00:
            file_byte = raw[offset + 10]
            effective = rules['outsideRangeFallback'] if file_byte > rules['objectFileByteMaximum'] else file_byte
            expected = 'Objects' if not effective else f'WemadeObjects{effective + 1}'
            assert manifest['objectLibraries'][str(file_byte)] == expected
            non_default += bool(file_byte)
    checked_cells += width * height
    map_results.append({'id': ident, 'cells': width * height, 'allCellsMatchNative': True,
                        'sourceSha256': pin['sha256'], 'nonDefaultFrontCells': non_default})

for entry in report['libraries']:
    name = entry['name']
    filename = name.removeprefix('Wemade') + '.Lib'
    pin = next(pin for pin in lock['libraries'] if pin['file'] == filename)
    path = libraries / filename
    assert path.stat().st_size == pin['bytes'] and native.sha256(path) == pin['sha256']
    library = CrystalLibrary(path.read_bytes())
    exported = json.loads((assets / 'libraries' / name / 'library.json').read_text())
    assert exported['sourceSha256'] == pin['sha256']
    assert all(index >= library.count for index in exported['missing'])
    if exported['missing']:
        missing_references.append({'library': name, 'indices': exported['missing']})
    for index in exported['empty']:
        source = library.frame(index)
        assert source is None or not source['width'] or not source['height']
    for index, frame in exported['frames'].items():
        source = library.frame(int(index))
        for field in ('width', 'height', 'offsetX', 'offsetY'):
            assert source[field] == frame[field], (name, index, field)
        for original, layer in [(source, frame), (source.get('mask'), frame.get('mask'))]:
            assert bool(original) == bool(layer), (name, index, 'mask')
            if original is None:
                continue
            data = (assets / 'libraries' / name / layer['file']).read_bytes()
            assert hashlib.sha256(data).hexdigest() == layer['sha256']
            assert data == png_rgba(original['width'], original['height'], original['pixels']), (name, index)
            checked_pixels += original['width'] * original['height']
        checked_frames += 1
    del library

assert missing_references == report['missingMapReferences']
complete = not missing_references
result = {'passed': complete, 'full176Acceptance': False, 'authenticated2003Client': False,
          'libraryFallbackMatchesPinnedPascal': True, 'libraryRules': rules,
          'rejectsAmbiguous14ByteMaps': True, 'cellsChecked': checked_cells,
          'framesChecked': checked_frames, 'rgbaPixelsChecked': checked_pixels,
          'allMapCellsAndLibraryPixelsMatch': True, 'maps': map_results,
          'mapResourceAcceptance': 'passed' if complete else 'failed',
          'libraries': report['libraries'], 'missingMapReferences': report['missingMapReferences']}
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(result, indent=2) + '\n')
print(f'{"PASS" if complete else "FAIL"} {checked_cells} cells, {checked_frames} available frames, {checked_pixels} RGBA pixels; 14-byte guard; correct library routing; {len(missing_references)} libraries with missing references.')
if not complete:
    raise SystemExit(1)
