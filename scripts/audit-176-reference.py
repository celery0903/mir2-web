"""Read the pinned candidate's Paradox tables; never import them into the game."""
import hashlib
import json
import re
import sys
from pathlib import Path
from pypxlib import Table

revision = "39e17246a32247a2c43c4cc481e97e88c692fa53"
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(f".runtime/mirserver-1.76-{revision}/mud2/db")
pins = {
    "Magic.DB": "a462ad95be7d952bbc2c41086164ce496da518b9",
    "StdItems.DB": "b3c2aab7e94d71c3eb34453971574cf9b1fd9632",
    "Monster.DB": "0636063f33a090480e219066cd30be73093a8be7",
}
tables, hashes = {}, {}
for name, expected in pins.items():
    data = (source / name).read_bytes()
    blob = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    if blob != expected:
        raise ValueError(f"Candidate {name} does not match the pinned Git blob")
    hashes[name] = {"bytes": len(data), "gitBlob": blob, "sha256": hashlib.sha256(data).hexdigest()}
    table = Table(str(source / name), encoding="gb18030")
    try:
        tables[name] = [{field: getattr(table[i], field) for field in table.fields} for i in range(len(table))]
    finally:
        table.close()

skills = tables["Magic.DB"]
items = tables["StdItems.DB"]
later = re.compile("\u5143\u5b9d|\u5f00\u5929|\u9547\u5929|\u7384\u5929|\u96f7\u9706|\u5929\u9f99|\u96f7\u708e|\u82f1\u96c4|\u706b\u96e8|\u566c\u8840|\u9010\u65e5|\u501a\u5929")
report = {
    "repository": "mrzhqiang/mirserver-1.76",
    "revision": revision,
    "sourceFiles": hashes,
    "tableCounts": {"skills": len(skills), "items": len(items), "monsters": len(tables["Monster.DB"])},
    "laterSkills": [row["MagName"] for row in skills if later.search(row["MagName"])],
    "laterItems": [row["Name"] for row in items if later.search(row["Name"])],
    "first33Skills": [row for row in skills if 1 <= row["MagID"] <= 33],
    "itemNameExamples": [{"id": row["Idx"], "name": row["Name"]} for row in items if row["Idx"] in [206, 207, 208, 221, 267, 268, 269]],
    "directImportAccepted": False,
    "officialVersionAuthenticated": False,
    "interpretation": "The repository name is not version evidence. The pinned tables contain later skills, equipment and currency, and modified item names. Historical data must be cross-checked before import.",
}
Path("docs/reference-176-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Candidate rejected for direct import: {len(skills)} skills, {len(items)} items, {len(tables['Monster.DB'])} monsters. See docs/reference-176-audit.json.")
