#!/usr/bin/env python3
"""A22 独立 APKG 核验：zipfile + sqlite3（Python 标准库，独立于 JS 写入器）。

用法：
  python3 scripts/verify/apkg-verify.py <file.apkg> [--manifest manifest.json]

不带 --manifest：输出结构报告（integrity、计数、笔记明细、媒体文件与哈希）。
带 --manifest：额外比对卡片数/模板数/媒体数与逐笔记 ords、媒体引用、媒体哈希。
任何不一致都以 exit 1 结束，并输出 ok:false。
"""
import hashlib
import json
import sqlite3
import struct
import sys
import tempfile
import zipfile
from pathlib import Path


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    raise SystemExit(1)


def read_varint(buf: bytes, offset: int):
    value = 0
    for i in range(9):
        byte = buf[offset + i]
        value = (value << 7) | (byte & 0x7F)
        if not (byte & 0x80):
            return value, offset + i + 1
    return (value << 8) | buf[offset + 8], offset + 9


def decode_record(buf: bytes):
    header_size, offset = read_varint(buf, 0)
    types = []
    while offset < header_size:
        serial, offset = read_varint(buf, offset)
        types.append(serial)
    body = header_size
    values = []
    for serial in types:
        if serial == 0:
            values.append(None)
        elif serial == 8:
            values.append(0)
        elif serial == 9:
            values.append(1)
        elif 1 <= serial <= 6:
            width = {1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 8}[serial]
            values.append(int.from_bytes(buf[body:body + width], "big", signed=True))
            body += width
        elif serial == 7:
            values.append(struct.unpack(">d", buf[body:body + 8])[0])
            body += 8
        elif serial >= 13 and serial % 2 == 1:
            length = (serial - 13) // 2
            values.append(buf[body:body + length].decode("utf-8", "replace"))
            body += length
        else:
            length = (serial - 12) // 2
            values.append(bytes(buf[body:body + length]))
            body += length
    return values


def main() -> None:
    args = sys.argv[1:]
    if not args:
        fail("usage: apkg-verify.py <file.apkg> [--manifest manifest.json]")
    apkg_path = Path(args[0])
    manifest_path = None
    if "--manifest" in args:
        manifest_path = Path(args[args.index("--manifest") + 1])
    if not apkg_path.exists():
        fail(f"apkg 不存在：{apkg_path}")

    result = {"apkg": str(apkg_path), "errors": []}

    try:
        archive = zipfile.ZipFile(apkg_path)
    except zipfile.BadZipFile as error:
        fail(f"zip 打不开：{error}")
    names = set(archive.namelist())
    if "collection.anki2" not in names:
        fail("zip 内没有 collection.anki2")
    if "media" not in names:
        result["errors"].append("zip 内没有 media 索引")
        media_map = {}
    else:
        media_map = json.loads(archive.read("media").decode("utf-8"))

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "collection.anki2"
        db_path.write_bytes(archive.read("collection.anki2"))
        conn = sqlite3.connect(str(db_path))
        result["integrity"] = [row[0] for row in conn.execute("PRAGMA integrity_check")]
        if result["integrity"] != ["ok"]:
            result["errors"].append(f"integrity_check 未通过：{result['integrity']}")
        col = conn.execute("SELECT ver, models, decks, conf FROM col WHERE id=1").fetchone()
        if col is None:
            fail("col 表没有行")
        ver, models_json, decks_json, _conf = col
        result["ver"] = ver
        if ver != 11:
            result["errors"].append(f"schema ver={ver}，期望 11")
        models = json.loads(models_json)
        decks = json.loads(decks_json)
        result["models"] = sorted(model["name"] for model in models.values())
        result["decks"] = sorted(deck["name"] for deck in decks.values())

        # 一次性读 notes，再按 mid 关联模板名
        model_names = {int(key): value["name"] for key, value in models.items()}
        notes = []
        for nid, guid, tags, flds, mid in conn.execute("SELECT id, guid, tags, flds, mid FROM notes ORDER BY id"):
            fields = flds.split("\x1f")
            referenced = []
            for field in fields:
                start = 0
                while True:
                    idx = field.find('src="', start)
                    if idx < 0:
                        break
                    end = field.find('"', idx + 5)
                    if end < 0:
                        break
                    referenced.append(field[idx + 5:end])
                    start = end + 1
            referenced = list(dict.fromkeys(referenced))
            ords = [row[0] for row in conn.execute("SELECT ord FROM cards WHERE nid=? ORDER BY ord", (nid,))]
            notes.append({
                "nid": nid,
                "guid": guid,
                "model": model_names.get(mid, f"未知模板 {mid}"),
                "tags": tags.strip().split(" ") if tags.strip() else [],
                "fields": fields,
                "referencedMedia": referenced,
                "ords": ords,
            })
        result["notes"] = notes
        counts = {
            "notes": conn.execute("SELECT count(*) FROM notes").fetchone()[0],
            "cards": conn.execute("SELECT count(*) FROM cards").fetchone()[0],
            "models": len(models),
            "media": len(media_map),
        }
        result["counts"] = counts
        result["revlogRows"] = conn.execute("SELECT count(*) FROM revlog").fetchone()[0]
        result["gravesRows"] = conn.execute("SELECT count(*) FROM graves").fetchone()[0]
        conn.close()

    # 媒体文件存在性与哈希
    media_report = {}
    for index, filename in media_map.items():
        if index not in names:
            result["errors"].append(f"媒体 {index}（{filename}）不在 zip 中")
            continue
        data = archive.read(index)
        media_report[index] = {"filename": filename, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "sha1": hashlib.sha1(data).hexdigest()}
    result["mediaFiles"] = media_report
    # 字段引用的媒体必须在 media_map 值里
    referenced_all = set()
    for note in notes:
        referenced_all.update(note["referencedMedia"])
    known = set(media_map.values())
    for name in sorted(referenced_all - known):
        result["errors"].append(f"字段引用的媒体不在 media 索引：{name}")
    unused = sorted(known - referenced_all)
    if unused:
        result["errors"].append(f"media 索引里没有被任何笔记引用的文件：{unused}")
    result["referencedMediaCount"] = len(referenced_all)

    ok = not result["errors"] and result["integrity"] == ["ok"]

    if manifest_path is not None:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        expected = {
            "notes": manifest["noteCount"],
            "cards": manifest["cardCount"],
            "models": manifest["modelCount"],
            "media": manifest["mediaCount"],
        }
        if counts != expected:
            ok = False
            result["errors"].append(f"计数与清单不一致：库={counts} 清单={expected}")
        manifest_notes = {note["guid"]: note for note in manifest["notes"]}
        if {note["guid"] for note in notes} != set(manifest_notes):
            ok = False
            result["errors"].append("笔记 guid 集合与清单不一致")
        for note in notes:
            expect = manifest_notes.get(note["guid"])
            if not expect:
                continue
            if note["ords"] != expect["ords"]:
                ok = False
                result["errors"].append(f"笔记 {note['guid']} ords 不一致：库={note['ords']} 清单={expect['ords']}")
            if sorted(note["referencedMedia"]) != sorted(expect["mediaNames"]):
                ok = False
                result["errors"].append(f"笔记 {note['guid']} 媒体引用不一致：库={note['referencedMedia']} 清单={expect['mediaNames']}")
            if expect.get("modelName") and note["model"] != expect["modelName"]:
                ok = False
                result["errors"].append(f"笔记 {note['guid']} 模板不一致：库={note['model']} 清单={expect['modelName']}")
            if note["tags"] != expect["tags"]:
                ok = False
                result["errors"].append(f"笔记 {note['guid']} 标签不一致：库={note['tags']} 清单={expect['tags']}")
        manifest_media = {entry["filename"]: entry for entry in manifest["media"]}
        if {entry["filename"] for entry in manifest["media"]} != set(media_map.values()):
            ok = False
            result["errors"].append("媒体文件名集合与清单不一致")
        for index, entry in media_report.items():
            expect = manifest_media.get(entry["filename"])
            if expect and expect.get("sha1") != entry["sha1"]:
                ok = False
                result["errors"].append(f"媒体哈希不一致：{entry['filename']}")

    result["ok"] = ok
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
