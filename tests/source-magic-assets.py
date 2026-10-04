#!/usr/bin/env python3
"""Check pinned Pascal rules and every exported effect frame against its library."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'upstream/mir2-client/tools'))
sys.path.insert(0, str(ROOT / 'scripts'))
from crystal_lib import CrystalLibrary, png_rgba
from importlib import import_module
references = import_module('prepare-source-magic').references

assets = ROOT / os.environ.get('MIR_SOURCE_ASSETS', '.runtime/source-magic-fix/assets')
destination = ROOT / os.environ.get('MIR_MAGIC_ASSET_REPORT', '.runtime/reports/source-magic-assets.json')
rules = json.loads((ROOT / 'shared/classic-magic.json').read_text())
source_dir = ROOT / '.runtime/legacy-source'
source = (source_dir / rules['source']['file']).read_bytes()
assert hashlib.sha256(source).hexdigest() == rules['source']['sha256']
for entry in rules['source']['references']:
    assert hashlib.sha256((source_dir / entry['file']).read_bytes()).hexdigest() == entry['sha256']
# This is the bounded Pascal array literal, not the later commented effect table.
array = re.search(rb'EffectBase:\s*array\[0\.\.MAXEFFECT-1\]\s*of integer\s*=\s*\((.*?)\);', source, re.S)
assert array is not None
values = [int(value.strip()) for value in re.sub(rb'//[^\r\n]*', b'', array[1]).split(b',')]
assert len(values) == 31 and values == rules['readyBases']
pins = json.loads((ROOT / 'upstream/mir2-client/content/classic-176/asset-sources.json').read_text())['effectFiles']
integration = json.loads((assets / 'effects/integration.json').read_text())
assert integration['rulesSha256'] == hashlib.sha256((ROOT / 'shared/classic-magic.json').read_bytes()).hexdigest()
frames, pixels, libraries = 0, 0, []
for name, indices in references(rules).items():
    pin = next(value for value in pins if value['file'] == f'{name}.Lib')
    data = (ROOT / 'upstream/mir2-client/assets/raw/crystal-effects' / pin['file']).read_bytes()
    assert len(data) == pin['bytes'] and hashlib.sha256(data).hexdigest() == pin['sha256']
    source_library = CrystalLibrary(data)
    exported = json.loads((assets / 'effects' / name / 'library.json').read_text())
    assert exported['missing'] == [] and exported['empty'] == []
    assert {int(value) for value in exported['frames']} == indices
    for index in sorted(indices):
        original, frame = source_library.frame(index), exported['frames'][str(index)]
        for field in ['width', 'height', 'offsetX', 'offsetY']:
            assert frame[field] == original[field], (name, index, field)
        file = assets / 'effects' / name / frame['file']
        expected = png_rgba(original['width'], original['height'], original['pixels'])
        assert hashlib.sha256(file.read_bytes()).hexdigest() == frame['sha256']
        assert file.read_bytes() == expected, (name, index)
        frames += 1
        pixels += original['width'] * original['height']
    libraries.append({'library': name, 'frames': len(indices), 'sourceSha256': pin['sha256']})
report = {'correctionChecksPassed': True, 'fullSkillAcceptance': False, 'authenticated2003Client': False,
          'traditionalTableMatchesPinnedSource': True, 'readyEffects': len(values), 'frames': frames,
          'rgbaPixels': pixels, 'allFramePixelsAndOffsetsMatch': True, 'libraries': libraries,
          'remaining': rules['remaining']}
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
