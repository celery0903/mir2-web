#!/usr/bin/env python3
"""Export pinned classic maps using their WemadeMir2 library namespace."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'upstream/mir2-client/tools'))
from map_tool import ClassicMap, UnsupportedMap, export as export_map
from crystal_lib import export as export_library


def checked_map(data):
    world = ClassicMap(data)
    if world.trailing_bytes:
        raise UnsupportedMap('native world requires exact classic-12 cells; auxiliary/14-byte layouts are unsupported')
    return world


def references(world):
    dependencies = {'Tiles': set(), 'SmTiles': set(), 'Objects': set()}
    object_libraries = {}
    for x in range(world.width):
        for y in range(world.height):
            cell = world.cell(x, y)
            for layer, name in [(0, 'Tiles'), (1, 'SmTiles'), (2, 'Objects')]:
                if layer == 0 and (x % 2 or y % 2):
                    continue
                image = cell[layer] & 0x7fff
                if not 0 < image < 0x7f00:
                    continue
                if layer == 2:
                    name = 'Objects' if not cell[7] else f'WemadeObjects{cell[7] + 1}'
                    object_libraries[str(cell[7])] = name
                count = max(1, cell[5] & 0x7f) if layer == 2 else 1
                dependencies.setdefault(name, set()).update(range(image - 1, image - 1 + count))
    return dependencies, object_libraries


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def prepare(maps, libraries, output, ids, supplement=None):
    lock = json.loads((ROOT / 'shared/native-world.lock.json').read_text())
    pins = {entry['id']: entry for entry in lock['maps']}
    dependencies = {}
    map_report = []
    for ident in ids:
        pin = pins[ident]
        path = maps / f'{ident}.map'
        data = path.read_bytes()
        if len(data) != pin['bytes'] or hashlib.sha256(data).hexdigest() != pin['sha256']:
            raise ValueError(f'Native map checksum mismatch: {ident}')
        world = checked_map(data)
        refs, object_libraries = references(world)
        manifest = export_map(path, output / 'maps' / ident)
        manifest.update(resourceNamespace='WemadeMir2', objectLibraries=object_libraries,
                        dependencies={name: sorted(values) for name, values in refs.items()},
                        authenticated2003Client=False)
        (output / 'maps' / ident / 'map.json').write_text(json.dumps(manifest, indent=2) + '\n')
        for name, values in refs.items():
            dependencies.setdefault(name, set()).update(values)
        map_report.append({'id': ident, 'sourceSha256': pin['sha256'], 'width': world.width,
                           'height': world.height, 'objectLibraries': object_libraries,
                           'resourceNamespace': 'WemadeMir2', 'sourceRepository': lock['repository'],
                           'sourceRevision': lock['revision']})
    if supplement:
        for name, values in supplement.items():
            if name in ('Tiles', 'SmTiles'):
                dependencies.setdefault(name, set()).update(values)
    library_pins = {entry['file']: entry for entry in lock['libraries']}
    library_report = []
    missing = []
    for name, indices in sorted(dependencies.items()):
        if not indices:
            continue
        filename = name.removeprefix('Wemade') + '.Lib'
        pin = library_pins[filename]
        path = libraries / filename
        if path.stat().st_size != pin['bytes'] or sha256(path) != pin['sha256']:
            raise ValueError(f'Native library checksum mismatch: {filename}')
        destination = output / 'libraries' / name
        manifest = export_library(path, destination, indices)
        manifest.update(resourceNamespace='WemadeMir2', sourceURL=lock['libraryBaseURL'] + filename,
                        authenticated2003Client=False)
        (destination / 'library.json').write_text(json.dumps(manifest, indent=2) + '\n')
        if manifest['missing']:
            missing.append({'library': name, 'indices': manifest['missing']})
        library_report.append({'name': name, 'sourceSha256': pin['sha256'],
                               'frames': len(manifest['frames']), 'empty': len(manifest['empty']),
                               'missing': len(manifest['missing'])})
        print(f'{name}: {len(manifest["frames"])} frames, {len(manifest["empty"])} empty, {len(manifest["missing"])} missing', flush=True)
    report = {'maps': map_report, 'libraries': library_report, 'missingMapReferences': missing,
              'mapResourceAcceptance': 'failed' if missing else 'passed',
              'authenticated2003Client': False}
    (output / 'native-world.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--maps', type=Path, required=True)
    parser.add_argument('--libraries', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ids', nargs='+', default=['0'])
    parser.add_argument('--supplement', type=Path)
    args = parser.parse_args()
    report = prepare(args.maps, args.libraries, args.output, args.ids,
                     json.loads(args.supplement.read_text())['dependencies'] if args.supplement else None)
    if report['missingMapReferences']:
        raise SystemExit('Native map resources are incomplete: ' + json.dumps(report['missingMapReferences']))
