"""Compare pinned Paradox candidates with a read-only native snapshot; never import."""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from pypxlib import Table

native_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".runtime/reports/classic-skill-candidate-applied/evidence.json")
output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".runtime/reports/classic-skill-numbers.json")
policy_bytes = Path("shared/classic-skills.json").read_bytes()
policy = json.loads(policy_bytes)
native = json.loads(native_path.read_bytes())
assert native["policySha256"] == hashlib.sha256(policy_bytes).hexdigest()
live_rows = native["before"]["retained"]
pins = [
    {
        "repository": "mrzhqiang/mirserver-1.76",
        "revision": "39e17246a32247a2c43c4cc481e97e88c692fa53",
        "file": "mud2/db/Magic.DB",
        "path": ".runtime/mirserver-1.76-39e17246a32247a2c43c4cc481e97e88c692fa53/mud2/db/Magic.DB",
        "gitBlob": "a462ad95be7d952bbc2c41086164ce496da518b9",
        "sha256": "66adbb098efdc236e7b4a96746113eaaf29512146d7abf4a434dfb582be5426c",
    },
    {
        "repository": "pangliang/MirServer-Delphi",
        "revision": "f829679d24acb3a097d396d737ab067db2c88ca2",
        "file": "MirServer/Mud2/DB/Magic.DB",
        "path": ".runtime/data-research/delphi-Magic.DB",
        "gitBlob": "d9b09d565e9c84cf7fd651a0379db9e82098ecab",
        "sha256": "7eb49b5efb4d41687ab1e1d20f27512e971c4c520817feeeca775328d98b2662",
    },
]
fields = ["EffectType", "Effect", "Spell", "Power", "MaxPower", "DefSpell", "DefPower", "DefMaxPower",
          "NeedL1", "L1Train", "NeedL2", "L2Train", "NeedL3", "L3Train", "Delay"]
report = {"authenticated2003Data": False, "full176Acceptance": False, "nativeSnapshot": str(native_path),
          "nativeSnapshotSha256": hashlib.sha256(native_path.read_bytes()).hexdigest(),
          "policySha256": hashlib.sha256(policy_bytes).hexdigest(), "candidates": [],
          "interpretation": "Both community tables contain later content. Agreement on identities or individual numbers does not authenticate either candidate as 2003 Shanda data. No running value is changed."}
for pin in pins:
    raw = Path(pin["path"]).read_bytes()
    assert hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest() == pin["gitBlob"]
    assert hashlib.sha256(raw).hexdigest() == pin["sha256"]
    table = Table(pin["path"], encoding="gb18030")
    try:
        rows = [{field: getattr(table[i], field) for field in table.fields} for i in range(len(table))]
    finally:
        table.close()
    comparisons = []
    for skill in policy["skills"]:
        names = {skill["name"], policy["guideNameAliases"].get(skill["name"], skill["name"])}
        matches = [row for row in rows if row["MagID"] == skill["magicId"] and row["MagName"] in names and row["Job"] == skill["job"]]
        assert len(matches) == 1, f"Ambiguous classic candidate: {skill}"
        live = next(row for row in live_rows if row["MagID"] == skill["magicId"])
        comparisons.append({"magicId": skill["magicId"], "name": skill["name"], "candidateName": matches[0]["MagName"],
                            "differences": {field: {"native": live[field], "candidate": matches[0][field]}
                                            for field in fields if live[field] != matches[0][field]}})
    counts = Counter(row["MagID"] for row in rows)
    report["candidates"].append({**{key: value for key, value in pin.items() if key != "path"}, "bytes": len(raw),
                                 "rowCount": len(rows), "directImportAccepted": False,
                                 "duplicateMagicIds": {key: value for key, value in counts.items() if value > 1},
                                 "classicRowsWithNumericalDifferences": sum(bool(row["differences"]) for row in comparisons),
                                 "comparisons": comparisons})
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Compared 33 retained rows against two rejected community tables. No numerical import. Report: {output}")
