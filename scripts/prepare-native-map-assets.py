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
from wil_lib import export as export_wil


def checked_map(data, trailing_bytes=0):
    world = ClassicMap(data)
    if world.trailing_bytes != trailing_bytes:
        raise UnsupportedMap('native world requires exact classic-12 cells and a pinned auxiliary tail; 14-byte layouts are unsupported')
    return world


def references(world, rules=None):
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
                    family = cell[7]
                    if rules and family > rules['objectFileByteMaximum']:
                        family = rules['outsideRangeFallback']
                    name = 'Objects' if not family else f'WemadeObjects{family + 1}'
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


def prepare(maps, libraries, output, ids, supplement=None, archived_client=None):
    lock = json.loads((ROOT / 'shared/native-world.lock.json').read_text())
    pins = {entry['id']: entry for entry in lock['maps']}
    archive = json.loads((ROOT / 'shared/archived-176-client.lock.json').read_text()) if archived_client else None
    archive_maps = {entry['id']: entry for entry in archive.get('maps', [])} if archive else {}
    dependencies = {}
    map_report = []
    for ident in ids:
        pin = pins[ident]
        provenance = {}
        if ident in archive_maps:
            source = archive_maps[ident]
            source_pin = next(entry for entry in archive['clientFiles'] if entry['file'] == source['file'])
            path = archived_client / source['file']
            provenance = {'sourceKind': 'archived-client', 'sourceURL': archive['archive'],
                          'installerSha256': archive['installer']['sha256'],
                          'previousSource': {'repository': lock['repository'], 'revision': lock['revision'],
                                             'file': pin['sourceFile'], 'sha256': pin['sha256'], 'gitBlob': pin['gitBlob']}}
            pin = {**pin, 'bytes': source_pin['bytes'], 'sha256': source_pin['sha256'], 'sourceFile': source['file']}
        else:
            path = maps / f'{ident}.map'
            if not path.exists() and pin.get('sourceFile'):
                path = maps / pin['sourceFile']
        data = path.read_bytes()
        if len(data) != pin['bytes'] or hashlib.sha256(data).hexdigest() != pin['sha256']:
            raise ValueError(f'Native map checksum mismatch: {ident}')
        world = checked_map(data, pin.get('trailingBytes', 0))
        refs, object_libraries = references(world, lock.get('libraryRules'))
        manifest = export_map(path, output / 'maps' / ident)
        manifest.update(id=ident, resourceNamespace='WemadeMir2', objectLibraries=object_libraries,
                        dependencies={name: sorted(values) for name, values in refs.items()},
                        authenticated2003Client=False, **provenance)
        if world.trailing_bytes:
            tail = data[52 + world.width * world.height * 12:]
            (output / 'maps' / ident / 'auxiliary-tail.bin').write_bytes(tail)
            manifest['auxiliaryTail'] = {'file': 'auxiliary-tail.bin', 'bytes': len(tail),
                                         'sha256': hashlib.sha256(tail).hexdigest()}
        (output / 'maps' / ident / 'map.json').write_text(json.dumps(manifest, indent=2) + '\n')
        for name, values in refs.items():
            dependencies.setdefault(name, set()).update(values)
        map_report.append({'id': ident, 'name': pin['name'], 'graphicID': pin.get('graphicID', ident), 'sourceSha256': pin['sha256'], 'width': world.width,
                           'height': world.height, 'objectLibraries': object_libraries,
                           'resourceNamespace': 'WemadeMir2',
                           **({'sourceRepository': lock['repository'], 'sourceRevision': lock['revision']} if not provenance else provenance),
                           'sourceFile': pin.get('sourceFile', f'{ident}.map')})
    if supplement:
        for name, values in supplement.items():
            if name in ('Tiles', 'SmTiles'):
                dependencies.setdefault(name, set()).update(values)
    library_pins = {entry['file']: entry for entry in lock['libraries']}
    archive_libraries = {entry['library']: entry for entry in archive['mapLibraries']} if archive else {}
    if archive:
        for entry in archive['clientFiles']:
            path = archived_client / entry['file']
            if path.stat().st_size != entry['bytes'] or sha256(path) != entry['sha256']:
                raise ValueError('Archived client checksum mismatch: ' + entry['file'])
    library_report = []
    missing = []
    for name, indices in sorted(dependencies.items()):
        if not indices:
            continue
        destination = output / 'libraries' / name
        if name in archive_libraries:
            source = archive_libraries[name]
            manifest = export_wil(archived_client / source['file'], destination, indices,
                                  index=archived_client / source['index'])
            manifest.update(sourceFile=source['file'], indexSourceFile=source['index'],
                            sourceURL=archive['archive'], installerSha256=archive['installer']['sha256'])
        else:
            filename = name.removeprefix('Wemade') + '.Lib'
            pin = library_pins[filename]
            path = libraries / filename
            if path.stat().st_size != pin['bytes'] or sha256(path) != pin['sha256']:
                raise ValueError(f'Native library checksum mismatch: {filename}')
            manifest = export_library(path, destination, indices)
            manifest.update(sourceFile=filename, sourceURL=lock['libraryBaseURL'] + filename)
        manifest.update(resourceNamespace='WemadeMir2', authenticated2003Client=False)
        (destination / 'library.json').write_text(json.dumps(manifest, indent=2) + '\n')
        if manifest['missing']:
            missing.append({'library': name, 'indices': manifest['missing']})
        library_report.append({'name': name, 'sourceSha256': manifest['sourceSha256'],
                               'format': manifest['format'], 'sourceFile': manifest['sourceFile'],
                               **({'indexSha256': manifest['indexSha256'], 'indexSourceFile': manifest['indexSourceFile'],
                                   'installerSha256': manifest['installerSha256']} if name in archive_libraries else {}),
                               'frames': len(manifest['frames']), 'empty': len(manifest['empty']),
                               'missing': len(manifest['missing'])})
        print(f'{name}: {len(manifest["frames"])} frames, {len(manifest["empty"])} empty, {len(manifest["missing"])} missing', flush=True)
    report = {'maps': map_report, 'libraries': library_report, 'missingMapReferences': missing,
              'mapResourceAcceptance': 'failed' if missing else 'passed',
              'full176Acceptance': False, 'authenticated2003Client': False}
    (output / 'maps' / 'catalog.json').write_text(json.dumps(map_report, indent=2) + '\n')
    (output / 'native-world.json').write_text(json.dumps(report, indent=2) + '\n')
    integration_path = output / 'integration.json'
    if integration_path.exists():
        integration = json.loads(integration_path.read_text())
        if {entry['id'] for entry in integration['maps']} != set(ids):
            raise ValueError('Existing integration map scope differs from the native export')
        integration.update(maps=map_report, mapLibrarySources=library_report,
                           missingMapReferences=missing, mapResourceAcceptance=report['mapResourceAcceptance'])
        integration_path.write_text(json.dumps(integration, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--maps', type=Path, required=True)
    parser.add_argument('--libraries', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--ids', nargs='+')
    selection.add_argument('--all', action='store_true')
    parser.add_argument('--supplement', type=Path)
    parser.add_argument('--archived-client', type=Path)
    args = parser.parse_args()
    lock = json.loads((ROOT / 'shared/native-world.lock.json').read_text())
    ids = args.ids or ([entry['id'] for entry in lock['maps']] if args.all else ['0'])
    report = prepare(args.maps, args.libraries, args.output, ids,
                     json.loads(args.supplement.read_text())['dependencies'] if args.supplement else None,
                     args.archived_client)
    if report['missingMapReferences']:
        raise SystemExit('Native map resources are incomplete: ' + json.dumps(report['missingMapReferences']))
