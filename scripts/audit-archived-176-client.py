"""Compare the archived upgrade's actual files with the current candidate world."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'upstream/mir2-client/tools'))
from wil_lib import WeMadeLibrary
from crystal_lib import CrystalLibrary

source = ROOT / '.runtime/original-client-research/extracted/App_Executables'
lock = json.loads((ROOT / 'shared/archived-176-client.lock.json').read_text())
world = json.loads((ROOT / 'shared/native-world.lock.json').read_text())
maps, files, libraries = [], [], []
for path in sorted(source.rglob('*')):
    if not path.is_file():
        continue
    raw = path.read_bytes()
    entry = {'file': str(path.relative_to(source)), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    files.append(entry)
    if path.suffix.lower() == '.map':
        pin = next((pin for pin in world['maps'] if pin['graphicID'].lower() == path.stem.lower()), None)
        comparison = 'absent-from-catalog' if not pin else 'identical' if pin['sha256'] == entry['sha256'] else 'different'
        result = {**entry, 'candidateID': pin['id'] if pin else None, 'comparison': comparison}
        if comparison == 'different':
            candidate = (ROOT / '.runtime/mirserver-source/Mir200/Map' / pin['sourceFile']).read_bytes()
            assert hashlib.sha256(candidate).hexdigest() == pin['sha256']
            differing = [offset for offset in range(min(len(raw), len(candidate))) if raw[offset] != candidate[offset]]
            result.update(candidateSha256=pin['sha256'], sameLength=len(raw) == len(candidate),
                          headerByteDifferences=sum(offset < 52 for offset in differing),
                          cellByteDifferences=sum(offset >= 52 for offset in differing),
                          differingCells=len({(offset - 52) // 12 for offset in differing if offset >= 52}))
        maps.append(result)
for name in ['Tiles', 'Objects3', 'Objects4', 'Objects5']:
    wil_path = source / 'DATA' / (name + '.wil')
    wix_path = next(path for path in (source / 'DATA').iterdir() if path.name.lower() == name.lower() + '.wix')
    original = WeMadeLibrary(wil_path, wix_path)
    converted = CrystalLibrary((ROOT / '.runtime/wemade-mir2' / (name + '.Lib')).read_bytes())
    samples = sorted({0, 1, 50, 100, original.count // 2, original.count - 2, original.count - 1})
    comparisons = []
    for index in samples:
        old = original.frame(index)
        new = converted.frame(index) if index < converted.count else None
        old = old if old and old['width'] and old['height'] else None
        new = new if new and new['width'] and new['height'] else None
        match = old is None and new is None or bool(old and new and all(
            old[field] == new[field] for field in ['width', 'height', 'offsetX', 'offsetY', 'pixels']))
        def metadata(frame):
            return {**{field: frame[field] for field in ['width', 'height', 'offsetX', 'offsetY']},
                    'pixelSha256': hashlib.sha256(frame['pixels']).hexdigest()} if frame else None
        comparisons.append({'frame': index, 'pixelsAndOffsetsMatch': match,
                            'geometryMatches': old is None and new is None or bool(old and new and all(
                                old[field] == new[field] for field in ['width', 'height', 'offsetX', 'offsetY'])),
                            'archive': metadata(old), 'candidate': metadata(new)})
    libraries.append({'name': name, 'archiveFrameCount': original.count, 'candidateFrameCount': converted.count,
                      'archiveRawOffsets': original.raw_offset_count, 'discardedTerminalOffsets': original.discarded_trailing_offsets,
                      'samples': comparisons, 'allFramesCompared': False,
                      **({'D714Frame9799Present': original.count > 9799} if name == 'Objects3' else {})})
report = {'archive': lock['archive'], 'installerSha256': lock['installer']['sha256'], 'appName': lock['installer']['appName'],
          'authenticated2003Client': False, 'full176Acceptance': False, 'completeClient': False,
          'clientFiles': files, 'maps': maps, 'mapComparisons': {kind: sum(m['comparison'] == kind for m in maps)
          for kind in ['identical', 'different', 'absent-from-catalog']}, 'libraries': libraries,
          'interpretation': 'Read-only comparison with the archived upgrade. Matching source bytes or selected pixels do not authenticate an official complete 2003 release. No production assets or maps were replaced.'}
destination = ROOT / 'docs/archived-176-client-audit.json'
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'mapComparisons': report['mapComparisons'], 'libraries': [{
    'name': entry['name'], 'archiveFrames': entry['archiveFrameCount'], 'candidateFrames': entry['candidateFrameCount'],
    'pixelMatches': sum(sample['pixelsAndOffsetsMatch'] for sample in entry['samples']),
    'geometryMatches': sum(sample['geometryMatches'] for sample in entry['samples']),
    'samples': len(entry['samples'])} for entry in libraries]}, ensure_ascii=False, indent=2))
