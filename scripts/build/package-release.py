#!/usr/bin/env python3
"""Package the complete desktop plugin; install/rollback program files only."""
import argparse
import hashlib
import json
import shutil
import stat
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
CORE = ("main.js", "styles.css", "manifest.json", "pdf.worker.js", "ocr.swift", "versions.json")
REQUIRED_NATIVE = (
    "native/MarginStudy Camera.app/Contents/MacOS/MarginStudyCamera",
    "native/MarginStudy Photos.app/Contents/MacOS/MarginStudyPhotos",
    "native/transcription/whisper-cli", "native/transcription/ggml-tiny.bin",
    "native/transcription/runtime.json", "native/transcription/LICENSE-whisper-cpp",
    "native/recall/recall-hint", "native/recall/README.md",
)


def digest(value):
    h = hashlib.sha256()
    if isinstance(value, Path):
        with value.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                h.update(chunk)
    else:
        h.update(value)
    return h.hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def entry(path):
    return {"sha256": digest(path), "bytes": path.stat().st_size, "mode": stat.S_IMODE(path.stat().st_mode)}


def allowed(name):
    p = PurePosixPath(name)
    return not p.is_absolute() and ".." not in p.parts and (name in CORE or name.startswith("native/"))


def safe_target(root, name):
    if not allowed(name):
        raise ValueError("Not a plugin program path: " + name)
    target = root / name
    part = target
    while part != root.parent:
        if part.is_symlink():
            raise ValueError("Refusing symlink deployment path: " + str(target))
        part = part.parent
    return target


def load_payload(archive):
    with zipfile.ZipFile(archive) as z:
        manifest = json.loads(z.read("release-manifest.json"))
        files = manifest["files"]
        if set(z.namelist()) != set(files) | {"release-manifest.json", "INSTALL.md"}:
            raise ValueError("Archive contains files outside the release manifest")
        if not set(CORE + REQUIRED_NATIVE).issubset(files):
            raise ValueError("Release is missing a required desktop runtime")
        payload = {}
        for name, info in files.items():
            if not allowed(name):
                raise ValueError("Unexpected release path: " + name)
            mode = z.getinfo(name).external_attr >> 16
            if stat.S_ISLNK(mode) or stat.S_IMODE(mode) != info["mode"]:
                raise ValueError("Archive permissions mismatch: " + name)
            content = z.read(name)
            if digest(content) != info["sha256"] or len(content) != info["bytes"]:
                raise ValueError("Release checksum mismatch: " + name)
            if name in REQUIRED_NATIVE and (name.endswith("whisper-cli") or "/MacOS/" in name) and not info["mode"] & 0o111:
                raise ValueError("Native executable is not executable: " + name)
            payload[name] = content
    return manifest, payload


def data_hash(plugin):
    data = plugin / "data.json"
    return digest(data) if data.is_file() else None


def install(archive, plugin, backup):
    manifest, payload = load_payload(archive)
    if backup.exists():
        raise ValueError("Backup directory already exists: " + str(backup))
    plugin.mkdir(parents=True, exist_ok=True)
    before = data_hash(plugin)
    snapshot = {"plugin": str(plugin.resolve()), "files": {}, "dataSha256AtInstall": before}
    for name, info in manifest["files"].items():
        target = safe_target(plugin, name)
        old = {"existed": target.is_file(), "installedSha256": info["sha256"]}
        if old["existed"]:
            old.update(entry(target))
            saved = backup / "program" / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, saved)
        snapshot["files"][name] = old
    write_json(backup / "rollback.json", snapshot)
    for name, content in payload.items():
        target = safe_target(plugin, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        target.chmod(manifest["files"][name]["mode"])
    after = data_hash(plugin)
    assert before == after, "Program installation changed data.json"
    assert all(digest(plugin / name) == info["sha256"] for name, info in manifest["files"].items())
    return {"programFiles": len(payload), "dataBefore": before, "dataAfter": after, "dataUnchanged": before == after,
            "backup": str(backup), "nativeExecutablesReady": all((plugin / n).stat().st_mode & 0o111 for n in REQUIRED_NATIVE if "/MacOS/" in n or n.endswith("whisper-cli"))}


def rollback(plugin, backup):
    snapshot = json.loads((backup / "rollback.json").read_text())
    if str(plugin.resolve()) != snapshot["plugin"]:
        raise ValueError("Rollback backup belongs to another plugin directory")
    for name, info in snapshot["files"].items():
        target = safe_target(plugin, name)
        if target.is_file() and digest(target) not in {info["installedSha256"], info.get("sha256")}:
            raise ValueError("Program changed after installation; refusing to overwrite: " + name)
        if info["existed"] and digest(backup / "program" / name) != info["sha256"]:
            raise ValueError("Rollback backup checksum mismatch: " + name)
    before = data_hash(plugin)
    for name, info in snapshot["files"].items():
        target = safe_target(plugin, name)
        if info["existed"]:
            shutil.copy2(backup / "program" / name, target)
        elif target.is_file():
            target.unlink()
    after = data_hash(plugin)
    assert before == after, "Program rollback changed data.json"
    return {"dataBefore": before, "dataAfter": after, "dataUnchanged": before == after, "restoredProgramFiles": sum(i["existed"] for i in snapshot["files"].values())}


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    version = json.loads((ROOT / "manifest.json").read_text())["version"]
    native = ROOT / "native"
    paths = sorted(set(CORE) | {p.relative_to(ROOT).as_posix() for p in native.rglob("*") if p.is_file() and not p.is_relative_to(native / "src")})
    files = {name: entry(ROOT / name) for name in paths}
    manifest = {"format": "margin-study-program-release-v1", "version": version, "files": files, "dataPolicy": "Program/runtime files only; never replace data.json or Claudian configuration."}
    archive = output / ("MarginStudy-" + version + "-P10-complete-candidate.zip")
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for name in paths:
            z.write(ROOT / name, name)
        z.writestr("release-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        z.writestr("INSTALL.md", "# MarginStudy 本地安装候选包\n\n完整程序和桌面runtime；不含data.json、文档或Claudian配置。\n\n推荐使用源码中的 scripts/build/package-release.py install ARCHIVE PLUGIN_DIR BACKUP_DIR；它会逐文件备份、校验哈希、保持可执行权限，并检查data.json哈希不变。\n回退使用 scripts/build/package-release.py rollback PLUGIN_DIR BACKUP_DIR。\n手动安装时请用macOS Archive Utility/ditto解包并完整复制native目录；勿覆盖data.json。\n\n此候选包不代表MN4全界面验收已完成。\n")
    load_payload(archive)
    source = set(CORE) | {"README.md", "esbuild.config.mjs", "package.json", "package-lock.json", "tsconfig.json", "LICENSE", "assets/licenses/LICENSE-ECDICT.txt"}
    for directory in ("src", "scripts", "native"):
        source |= {p.relative_to(ROOT).as_posix() for p in (ROOT / directory).rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.name != ".DS_Store"}
    identity = {name: entry(ROOT / name) for name in sorted(source)}
    write_json(output / "source-identity.json", identity)
    source_archive = output / "MarginStudy-P10-complete-source.tar.gz"
    with tarfile.open(source_archive, "w:gz", compresslevel=1) as t:
        for name in sorted(source):
            t.add(ROOT / name, arcname=name, recursive=False)
        t.add(output / "source-identity.json", arcname="source-identity.json")
    with tarfile.open(source_archive) as t:
        assert all(digest(t.extractfile(name).read()) == info["sha256"] for name, info in identity.items())
    with tempfile.TemporaryDirectory(prefix="marginstudy-release-") as temporary:
        temp = Path(temporary).resolve()
        plugin = temp / "clean"
        clean = install(archive, plugin, temp / "clean-backup")
        rollback(plugin, temp / "clean-backup")
        plugin = temp / "upgrade"
        plugin.mkdir()
        (plugin / "data.json").write_text('{"synthetic":"P10-release-data-retention"}')
        (plugin / "main.js").write_text("// synthetic previous program")
        (plugin / "unrelated.txt").write_text("preserve unrelated file")
        upgrade = install(archive, plugin, temp / "upgrade-backup")
        restored = rollback(plugin, temp / "upgrade-backup")
        assert (plugin / "main.js").read_text() == "// synthetic previous program"
        assert (plugin / "unrelated.txt").read_text() == "preserve unrelated file"
    result = {"version": version, "archive": archive.name, "archiveSha256": digest(archive), "payloadFiles": len(paths),
              "sourceArchive": source_archive.name, "sourceArchiveSha256": digest(source_archive), "sourceFiles": len(identity),
              "cleanInstallation": clean, "isolatedUpgrade": upgrade, "isolatedRollback": restored,
              "nativeSourceAndStyleSourcesIncluded": True, "liveObsidianAcceptance": "pending"}
    write_json(output / "package-validation.json", result)
    write_json(output / "release-manifest.json", manifest)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("build"); p.add_argument("output", type=Path)
    p = sub.add_parser("install"); p.add_argument("archive", type=Path); p.add_argument("plugin", type=Path); p.add_argument("backup", type=Path)
    p = sub.add_parser("rollback"); p.add_argument("plugin", type=Path); p.add_argument("backup", type=Path)
    args = parser.parse_args()
    if args.command == "build":
        build(args.output.resolve())
    elif args.command == "install":
        print(json.dumps(install(args.archive.resolve(), args.plugin.resolve(), args.backup.resolve()), indent=2))
    else:
        print(json.dumps(rollback(args.plugin.resolve(), args.backup.resolve()), indent=2))
