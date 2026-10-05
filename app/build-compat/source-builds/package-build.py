#!/usr/bin/env python3
"""Reproduce a reviewed local archive from official files and rebuilt dist.

No downloads, extraction to disk, build execution, or application changes occur.
The reviewed manifest is an input, not a security certification generated here.
"""

import argparse
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def stable_json(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def official_files(raw):
    files, modes = {}, {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and ".." not in path.parts
                    and path.parts and path.parts[0] == "package",
                    "Invalid official archive path: " + member.name)
            require(member.isfile() or member.isdir(),
                    "Unexpected official archive entry: " + member.name)
            if member.isfile():
                name = str(path)
                require(name not in files, "Duplicate archive file: " + name)
                files[name] = archive.extractfile(member).read()
                modes[name] = 0o755 if member.mode & 0o111 else 0o644
    return files, modes


def dist_files(directory):
    require(directory.is_dir() and not directory.is_symlink(),
            "--dist must be a real directory")
    files = {}
    for path in sorted(directory.rglob("*")):
        require(not path.is_symlink(), "Unexpected dist symlink: " + str(path))
        require(path.is_file() or path.is_dir(),
                "Unexpected dist entry: " + str(path))
        if path.is_file():
            files[path.relative_to(directory).as_posix()] = path.read_bytes()
    return files


def pack(files, modes):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0,
                       compresslevel=9) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for name, data in sorted(files.items()):
                member = tarfile.TarInfo(name)
                member.size = len(data)
                member.mode = modes.get(name, 0o644)
                member.mtime = member.uid = member.gid = 0
                member.uname = member.gname = ""
                archive.addfile(member, io.BytesIO(data))
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--package", choices=("vite", "rollup"), required=True)
    parser.add_argument("--official-archive", type=Path, required=True)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records = json.loads(args.manifest.read_bytes())["artifacts"]
    matches = [record for record in records if record["name"] == args.package]
    require(len(matches) == 1, "Expected one reviewed artifact for this package")
    record = matches[0]
    provenance = record["provenance"]
    expected_identity = {"name": record["name"], "version": record["version"]}
    require(provenance["package"] == expected_identity, "Provenance identity mismatch")
    envelope = provenance["officialReleaseEnvelope"]
    raw = args.official_archive.read_bytes()
    require(sha256(raw) == envelope["sha256"], "Official archive SHA256 mismatch")
    require(integrity(raw) == envelope["integrity"], "Official archive SHA512 mismatch")
    original, modes = official_files(raw)
    metadata = original["package/package.json"]
    identity = json.loads(metadata)
    require(all(identity[key] == value for key, value in expected_identity.items()),
            "Official package identity mismatch")
    require(sha256(metadata) == envelope["packageJsonSha256"],
            "Official package.json hash mismatch")
    require(provenance["packaging"]["licenseChanged"] is False,
            "This recipe requires unchanged official license bytes")

    dist = dist_files(args.dist)
    hashes = {name: sha256(data) for name, data in dist.items()}
    require(hashes == provenance["distFileSha256"], "Complete dist hash set mismatch")
    require(sha256(stable_json(hashes)) == provenance["packaging"]["distHashesSha256"],
            "Dist provenance digest mismatch")
    require(len(dist) == record["distFiles"] == provenance["packaging"]["distFiles"],
            "Dist file count mismatch")

    # Discard every official dist file before adding the complete rebuilt tree.
    files = {name: data for name, data in original.items()
             if not name.startswith("package/dist/")}
    files.update({"package/dist/" + name: data for name, data in dist.items()})
    files["package/CAACI-BUILD-PROVENANCE.json"] = stable_json(provenance)
    patch_hash = provenance["sourcePatch"]["patchSha256"]
    files["package/CAACI-PATCH-NOTICE.txt"] = (
        f"This is a locally rebuilt {record['name']} {record['version']} source distribution, not an official new upstream release.\n"
        f"The complete dist directory was generated by the upstream build after applying the braces3.0.3 source patch SHA-256 {patch_hash}.\n"
        "Package identity, runtime dependencies, optional dependencies and upstream license files remain visible.\n"
        "See CAACI-BUILD-PROVENANCE.json for source, build and byte identities. Independent security/application validation is recorded outside this archive.\n"
    ).encode()
    actual = {name.removeprefix("package/"): {"bytes": len(data), "sha256": sha256(data)}
              for name, data in files.items()}
    require(actual == record["fileHashes"], "Complete package file manifest mismatch")
    require(len(files) == record["files"], "Package file count mismatch")
    result = pack(files, modes)
    require(sha256(result) == record["sha256"], "Repacked archive SHA256 mismatch")
    require(integrity(result) == record["integrity"], "Repacked archive SHA512 mismatch")
    require(len(result) == record["bytes"], "Repacked archive byte length mismatch")
    filename = f"{record['name']}-{record['version']}-local.{record['sha256'][:16]}.tgz"
    require(filename == record["filename"], "Content-addressed filename mismatch")

    require(not args.output.is_symlink(), "Output directory cannot be a symlink")
    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output / filename
    require(not target.is_symlink(), "Output archive cannot be a symlink")
    try:
        with target.open("xb") as stream:
            stream.write(result)
    except FileExistsError:
        require(target.is_file() and target.read_bytes() == result,
                "Refusing to overwrite different output: " + str(target))
    print(json.dumps({"file": str(target), "sha256": record["sha256"],
                      "integrity": record["integrity"], "files": len(files)}, indent=2))


if __name__ == "__main__":
    main()
