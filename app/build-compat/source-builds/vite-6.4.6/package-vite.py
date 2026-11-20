#!/usr/bin/env python3
"""Package two independently rebuilt Vite distributions and record their identity."""

import argparse
import importlib.util
import json
from pathlib import Path
import platform
import sys
import zlib


RECIPE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('packager', RECIPE.parent / 'package-build.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--official-archive', required=True, type=Path)
    parser.add_argument('--build-one', required=True, type=Path)
    parser.add_argument('--build-two', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads((RECIPE / 'manifest.json').read_bytes())
    builds = [args.build_one.resolve(strict=True), args.build_two.resolve(strict=True)]
    packager.require(builds[0] != builds[1], 'Two independent build directories are required')
    packager.require(manifest['verified_rebuilds'] == 2, 'Seal the reviewed recipe inventory first')
    packager.require(not args.output.exists() and not args.output.is_symlink(),
                     'Output must be a new directory')
    raw = args.official_archive.read_bytes()
    envelope = manifest['official_release']
    packager.require(packager.sha256(raw) == envelope['archive_sha256'],
                     'Official archive SHA256 mismatch')
    packager.require(packager.integrity(raw) == envelope['archive_integrity'],
                     'Official archive SHA512 mismatch')
    original, modes = packager.official_files(raw)
    metadata = original['package/package.json']
    identity = json.loads(metadata)
    packager.require(identity['name'] == 'vite' and identity['version'] == manifest['vite']['version'],
                     'Official package identity mismatch')
    packager.require(packager.sha256(metadata) == envelope['package_json_sha256'],
                     'Official package.json hash mismatch')
    expected = {item['path'].removeprefix('dist/'): item['sha256']
                for item in manifest['expected_dist']}
    distributions = []
    for build in builds:
        verification = json.loads((build / 'verification.json').read_bytes())
        packager.require(verification['runtime'] == manifest['node'], 'Build runtime mismatch')
        packager.require(verification['dist'] == manifest['expected_dist'],
                         'Build inventory differs from the sealed recipe')
        recorded_recipe = json.loads((build / 'recipe-manifest.json').read_bytes())
        for key in ['vite', 'pnpm', 'node', 'source_patch', 'braces_patch', 'patched_inputs',
                    'braces_source_files']:
            packager.require(recorded_recipe[key] == manifest[key], 'Build input mismatch: ' + key)
        dist = packager.dist_files(build / 'source/packages/vite/dist')
        hashes = {name: packager.sha256(data) for name, data in dist.items()}
        packager.require(hashes == expected, 'Complete dist hash set mismatch')
        distributions.append(dist)
    packager.require(distributions[0] == distributions[1], 'Independent dist bytes differ')
    provenance = {
        'schemaVersion': 1,
        'package': {'name': 'vite', 'version': identity['version']},
        'notice': 'Locally rebuilt upstream source with the reviewed braces depth backport. '
                  'The supervisor independently re-verifies this candidate before approval.',
        'upstreamSource': {
            'repository': 'https://github.com/vitejs/vite',
            'tag': 'v' + identity['version'],
            'commit': manifest['vite']['commit'],
            'archiveSha256': manifest['vite']['archive_sha256'],
        },
        'sourcePatch': {
            'library': 'braces',
            'upstreamVersion': '3.0.3',
            'patchSha256': manifest['braces_patch']['sha256'],
            'sourceChangeSha256': manifest['source_patch']['sha256'],
            'sourceFiles': manifest['braces_source_files'],
        },
        'build': {
            'command': 'pnpm --filter vite run build',
            'node': manifest['node']['version'].removeprefix('v'),
            'platform': manifest['node']['platform'],
            'arch': manifest['node']['arch'],
            'environment': 'tony-ws test container',
            'packageManager': 'pnpm' + manifest['pnpm']['version'],
            'patchedLockSha256': manifest['patched_inputs']['pnpm-lock.yaml'],
            'independentFreshInstalls': True,
            'sequentialBuilds': 2,
            'allDistFilesByteIdentical': True,
        },
        'officialReleaseEnvelope': {
            'tarball': envelope['archive_url'],
            'sha256': envelope['archive_sha256'],
            'integrity': envelope['archive_integrity'],
            'packageJsonSha256': envelope['package_json_sha256'],
        },
        'distFileSha256': expected,
        'packaging': {
            'strategy': 'Keep official non-dist files and package.json; replace complete dist '
                        'from frozen official source build; add this provenance and patch notice.',
            'distFiles': len(expected),
            'distHashesSha256': packager.sha256(packager.stable_json(expected)),
            'licenseChanged': False,
            'python': platform.python_version(),
            'zlib': zlib.ZLIB_RUNTIME_VERSION,
            'platform': sys.platform,
            'machine': platform.machine(),
        },
    }
    archives = []
    records = []
    for dist in distributions:
        files = {name: data for name, data in original.items()
                 if not name.startswith('package/dist/')}
        files.update({'package/dist/' + name: data for name, data in dist.items()})
        files['package/CAACI-BUILD-PROVENANCE.json'] = packager.stable_json(provenance)
        files['package/CAACI-PATCH-NOTICE.txt'] = (
            f"This is a locally rebuilt vite {identity['version']} source distribution, not an official new upstream release.\n"
            f"The complete dist directory was generated by the upstream build after applying the braces3.0.3 source patch SHA-256 {manifest['braces_patch']['sha256']}.\n"
            "Package identity, runtime dependencies, optional dependencies and upstream license files remain visible.\n"
            "See CAACI-BUILD-PROVENANCE.json for source, build and byte identities. Independent security/application validation is recorded outside this archive.\n"
        ).encode()
        archive = packager.pack(files, modes)
        digest = packager.sha256(archive)
        record = {
            'name': 'vite',
            'version': identity['version'],
            'filename': f"vite-{identity['version']}-local.{digest[:16]}.tgz",
            'sha256': digest,
            'integrity': packager.integrity(archive),
            'bytes': len(archive),
            'files': len(files),
            'distFiles': len(dist),
            'fileHashes': {name.removeprefix('package/'): {
                'bytes': len(data), 'sha256': packager.sha256(data)}
                for name, data in files.items()},
            'addedNonDistFiles': ['CAACI-BUILD-PROVENANCE.json', 'CAACI-PATCH-NOTICE.txt'],
            'officialNonDistUnchangedExcept': [],
            'officialPackageJsonByteIdentical': True,
            'removedStaleDistPaths': sorted(name.removeprefix('package/') for name in original
                                           if name.startswith('package/dist/') and name not in files),
            'status': 'Two identical clean container rebuilds; supervisor independently re-verifies before approval',
            'provenance': provenance,
        }
        archives.append(archive)
        records.append(record)
    packager.require(archives[0] == archives[1] and records[0] == records[1],
                     'Independent package archives differ')
    args.output.mkdir()
    for index, archive in enumerate(archives, 1):
        directory = args.output / f'build-{index}'
        directory.mkdir()
        (directory / records[0]['filename']).write_bytes(archive)
    (args.output / 'artifact.json').write_bytes(packager.stable_json(records[0]))
    print(json.dumps({'identicalArchives': True, 'sha256': records[0]['sha256'],
                      'integrity': records[0]['integrity'], 'filename': records[0]['filename']},
                     indent=2))


if __name__ == '__main__':
    main()
