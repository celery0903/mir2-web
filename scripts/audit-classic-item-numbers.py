"""Compare every native item against pinned Paradox candidates without importing."""
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from pypxlib import Table

snapshot_path = Path(sys.argv[1])
output = Path(sys.argv[2])
pins_path = Path("shared/classic-item-sources.json")
pins = json.loads(pins_path.read_bytes())
snapshot = json.loads(snapshot_path.read_bytes())
native_rows = snapshot["rows"]
assert snapshot["definitionsSha256"] == hashlib.sha256(
    json.dumps(native_rows, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
fields = {
    "StdMode": "stdmode", "Shape": "shape", "Weight": "weight", "AniCount": "anicount",
    "Source": "source", "Reserved": "reserved", "ImgIndex": "looks", "DuraMax": "duramax",
    "Ac": "ac", "AcMax": "ac2", "Mac": "mac", "MacMax": "mac2", "Dc": "dc", "DcMax": "dc2",
    "Mc": "mc", "McMax": "mc2", "Sc": "sc", "ScMax": "sc2", "Need": "need", "NeedLevel": "needlevel",
    "Price": "price", "Stock": "stock",
}
candidates = []
for pin in pins["tables"]:
    raw = Path(pin["path"]).read_bytes()
    assert hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest() == pin["gitBlob"]
    assert hashlib.sha256(raw).hexdigest() == pin["sha256"]
    table = Table(pin["path"], encoding="gb18030")
    try:
        rows = [{field: getattr(table[i], field) for field in table.fields} for i in range(len(table))]
    finally:
        table.close()
    assert len(rows) == pin["rows"]
    by_name = defaultdict(list)
    for row in rows:
        by_name[row["Name"]].append(row)
    comparisons = []
    for native in native_rows:
        matches = by_name[native["Name"]]
        comparison = {"id": native["Id"], "name": native["Name"], "exactNameMatches": len(matches),
                      "candidateRows": matches, "numericalAcceptance": "unverified"}
        if len(matches) == 1:
            candidate = {key.lower(): value for key, value in matches[0].items()}
            comparison["comparedFields"] = [field for field, source in fields.items() if source in candidate]
            comparison["differences"] = {
                field: {"native": native[field], "candidate": candidate[source]}
                for field, source in fields.items() if source in candidate and native[field] != candidate[source]
            }
            comparison["unmappedCandidateFields"] = [field for field in matches[0]
                                                       if field.lower() not in set(fields.values()) | {"idx", "name"}]
        comparisons.append(comparison)
    native_names = {row["Name"] for row in native_rows}
    candidates.append({**{key: value for key, value in pin.items() if key != "path"}, "bytes": len(raw),
                       "directImportAccepted": False, "exactSingleNameMatches": sum(row["exactNameMatches"] == 1 for row in comparisons),
                       "matchedRowsWithDifferences": sum(bool(row.get("differences")) for row in comparisons),
                       "candidateOnlyRows": [row for row in rows if row["Name"] not in native_names],
                       "duplicateNames": {name: len(group) for name, group in by_name.items() if len(group) > 1},
                       "comparisons": comparisons})
report = {"authenticated2003Data": False, "full176Acceptance": False, "readOnly": True,
          "snapshotSha256": hashlib.sha256(snapshot_path.read_bytes()).hexdigest(),
          "definitionsSha256": snapshot["definitionsSha256"], "definitionRows": len(native_rows),
          "sourcePinsSha256": hashlib.sha256(pins_path.read_bytes()).hexdigest(),
          "fieldMapping": fields, "candidates": candidates, "interpretation": pins["interpretation"]}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"definitionRows": len(native_rows), "candidateRows": [pin["rows"] for pin in pins["tables"]],
                  "exactNameMatches": [candidate["exactSingleNameMatches"] for candidate in candidates], "output": str(output)}))
