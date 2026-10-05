"""Export the pinned upgrade's original mmap frames without renumbering them."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'upstream/mir2-client/tools'))
from wil_lib import export


def prepare(source, output):
    lock = json.loads((ROOT / 'shared/archived-176-client.lock.json').read_text())
    for pin in lock['clientFiles']:
        path = source / pin['file']
        raw = path.read_bytes()
        if len(raw) != pin['bytes'] or hashlib.sha256(raw).hexdigest() != pin['sha256']:
            raise ValueError('Archived minimap checksum mismatch: ' + pin['file'])
    manifest = export(source / 'DATA/mmap.wil', output / 'ui-national/mmap', index=source / 'DATA/mmap.WIX')
    catalog = json.loads((output / 'maps/catalog.json').read_text())
    manifest.update(archive=lock['archive'], installerSha256=lock['installer']['sha256'],
                    authenticated2003Client=False, full176Acceptance=False,
                    names={entry['id']: entry['name'] for entry in catalog})
    (output / 'ui-national/mmap/library.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Exported {len(manifest["frames"])} original minimap frames; {len(manifest["empty"])} empty; indices and signed offsets preserved.')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT / '.runtime/original-client-research/extracted/App_Executables')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source, args.output)
