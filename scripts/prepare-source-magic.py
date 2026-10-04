#!/usr/bin/env python3
"""Export only the locked effect frames referenced by the traditional table."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'upstream/mir2-client'
sys.path.insert(0, str(SOURCE / 'tools'))
from crystal_lib import export


def references(rules):
    result = {'Magic': set(), 'Magic2': set()}
    def sequence(value, directions=1):
        for direction in range(directions):
            start = value['start'] + direction * value.get('stride', 0)
            result[value['library']].update(range(start, start + value['count']))
    for effect, start in enumerate(rules['readyBases'], 1):
        sequence({'library': 'Magic2' if effect in rules['magic2ReadyEffects'] else 'Magic', 'start': start,
                  'count': rules['readyOverrides'].get(str(effect), {}).get('count', rules['readyCount'])})
    for value in rules['impactSequences'].values():
        sequence(value)
    for value in rules['projectiles'].values():
        sequence(value, 16)
        sequence(value['impact'])
    sequence(rules['thunder'])
    sequence(rules['beam'], 16)
    return result


def main():
    output = Path(sys.argv[1])
    rules_file = ROOT / 'shared/classic-magic.json'
    rules = json.loads(rules_file.read_text())
    pins = json.loads((SOURCE / 'content/classic-176/asset-sources.json').read_text())['effectFiles']
    libraries = []
    for name, indices in references(rules).items():
        pin = next(value for value in pins if value['file'] == f'{name}.Lib')
        file = SOURCE / 'assets/raw/crystal-effects' / pin['file']
        data = file.read_bytes()
        if len(data) != pin['bytes'] or hashlib.sha256(data).hexdigest() != pin['sha256']:
            raise ValueError(f'Effect source changed: {name}')
        result = export(file, output / 'effects' / name, sorted(indices))
        libraries.append({'library': name, 'sourceSha256': pin['sha256'], 'requested': len(indices),
                          'frames': len(result['frames']), 'empty': result['empty'], 'missing': result['missing']})
        print(f"{name}: {len(result['frames'])} effect frames, {len(result['empty'])} empty, {len(result['missing'])} missing", flush=True)
        if result['missing']:
            raise ValueError(f'Unresolved effect source indices: {name}')
    report = {'schemaVersion': 1, 'rulesSha256': hashlib.sha256(rules_file.read_bytes()).hexdigest(),
              'source': rules['source'], 'authenticated2003Client': False, 'fullSkillAcceptance': False,
              'libraries': libraries, 'remaining': rules['remaining']}
    (output / 'effects/integration.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
