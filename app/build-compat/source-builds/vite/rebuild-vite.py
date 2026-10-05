#!/usr/bin/env python3
"""Rebuild the reviewed Vite source patch in a new directory; never edit dist."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import shutil
import subprocess
import sys
import tarfile


def sha256(path):
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_hash(path, expected):
    actual = sha256(path)
    if actual != expected:
        raise ValueError(f'SHA256 mismatch: {path}: {actual} != {expected}')


def extract_archive(archive, destination, archive_root):
    """Strip one verified archive prefix; reject escaping paths and special files."""
    destination.mkdir()
    with tarfile.open(archive, 'r:gz') as package:
        entries = []
        seen = set()
        for member in package.getmembers():
            parts = PurePosixPath(member.name).parts
            if (not parts or parts[0] != archive_root
                    or member.name.startswith('/') or '..' in parts):
                raise ValueError(f'Unsafe archive member: {member.name}')
            relative = Path(*parts[1:])
            if str(relative) == '.':
                if not member.isdir():
                    raise ValueError('Archive root must be a directory')
                continue
            if relative in seen:
                raise ValueError(f'Duplicate archive path: {relative}')
            seen.add(relative)
            if not (member.isdir() or member.isfile() or member.issym()):
                raise ValueError(f'Unsupported archive entry: {member.name}')
            if member.issym():
                target = posixpath.normpath(
                    posixpath.join(str(relative.parent), member.linkname))
                if member.linkname.startswith('/') or target == '..' or target.startswith('../'):
                    raise ValueError(f'Escaping archive symlink: {member.name}')
            entries.append((member, relative))

        # No symlinks exist while writing archive files, so parents cannot redirect writes.
        for member, relative in entries:
            target = destination / relative
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with package.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(member.mode & 0o777)
        for member, relative in entries:
            if member.issym():
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(member.linkname)


def run_logged(command, cwd, env, logfile):
    print(f'Running {logfile.name}', flush=True)
    with logfile.open('x', encoding='utf-8') as log:
        log.write(json.dumps({'command': [str(item) for item in command], 'cwd': str(cwd)}) + '\n')
        log.flush()
        result = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
        log.write(f'\nexit_code={result.returncode}\n')
    if result.returncode:
        raise RuntimeError(f'Command failed with exit {result.returncode}; see {logfile}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vite-archive', required=True, type=Path,
                        help='Previously downloaded official source archive (hash checked)')
    parser.add_argument('--pnpm-archive', required=True, type=Path,
                        help='Previously downloaded official pnpm 10.8.1 npm archive (hash checked)')
    parser.add_argument('--node', required=True, type=Path, help='Node 22.23.3 executable')
    parser.add_argument('--output', required=True, type=Path,
                        help='New output directory; its parent must already exist')
    args = parser.parse_args()
    recipe = Path(__file__).resolve().parent
    manifest = json.loads((recipe / 'manifest.json').read_text())
    node = args.node.resolve(strict=True)
    archives = {'vite': args.vite_archive.resolve(strict=True),
                'pnpm': args.pnpm_archive.resolve(strict=True)}
    output = args.output.absolute()
    if output.exists() or output.is_symlink():
        raise ValueError(f'Output already exists; it will not be overwritten: {output}')
    if not output.parent.is_dir():
        raise ValueError('Output parent must already exist')

    env = os.environ.copy()
    # Inherited preload hooks would make the fixed runtime/build unverifiable.
    env.pop('NODE_OPTIONS', None)
    env.pop('NODE_PATH', None)
    runtime = json.loads(subprocess.check_output(
        [node, '-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'],
        text=True, env=env))
    if runtime != manifest['node']:
        raise ValueError(f'Requires verified runtime {manifest["node"]}; received {runtime}')
    patch_command = shutil.which('patch')
    if not patch_command:
        raise ValueError('The system patch utility is required')
    for name, archive in archives.items():
        verify_hash(archive, manifest[name]['archive_sha256'])
    pnpm_integrity = 'sha512-' + base64.b64encode(
        hashlib.sha512(archives['pnpm'].read_bytes()).digest()).decode()
    if pnpm_integrity != manifest['pnpm']['archive_integrity']:
        raise ValueError('pnpm npm integrity mismatch')
    for key in ['source_patch', 'braces_patch']:
        verify_hash(recipe / manifest[key]['file'], manifest[key]['sha256'])

    # Exclusive creation is intentional. Failed runs stay available for inspection.
    output.mkdir()
    shutil.copy2(recipe / 'manifest.json', output / 'recipe-manifest.json')
    source = output / 'source'
    pnpm_directory = output / 'pnpm'
    extract_archive(archives['vite'], source, manifest['vite']['archive_root'])
    extract_archive(archives['pnpm'], pnpm_directory, manifest['pnpm']['archive_root'])
    for name in ['bin', 'cache', 'state', 'data', 'store', 'logs']:
        (output / name).mkdir()
    empty_config = output / 'empty.npmrc'
    empty_config.touch(exist_ok=False)
    (output / 'bin' / 'pnpm').symlink_to('../pnpm/bin/pnpm.cjs')
    env.update({
        'PATH': os.pathsep.join([str(output / 'bin'), str(node.parent), os.defpath]),
        'XDG_CACHE_HOME': str(output / 'cache'),
        'XDG_STATE_HOME': str(output / 'state'),
        'XDG_DATA_HOME': str(output / 'data'),
        'PNPM_HOME': str(output / 'bin'),
        'npm_config_userconfig': str(empty_config),
        'npm_config_manage_package_manager_versions': 'false',
    })
    run_logged([patch_command, '-p1', '-F', '0', '-t', '-N', '-i',
                recipe / manifest['source_patch']['file']], source, env,
               output / 'logs' / 'source-patch.log')
    # source_patch creates the complete braces patch. pnpm, not this script, applies it
    # to build dependencies. The duplicate reviewed patch is an exact input check.
    braces_patch = source / manifest['braces_patch']['installed_path']
    verify_hash(braces_patch, manifest['braces_patch']['sha256'])
    if braces_patch.read_bytes() != (recipe / manifest['braces_patch']['file']).read_bytes():
        raise ValueError('Embedded and separately reviewed braces patches differ')
    for relative, expected in manifest['patched_inputs'].items():
        verify_hash(source / relative, expected)
    pnpm = [node, pnpm_directory / 'bin' / 'pnpm.cjs']
    version = subprocess.check_output(pnpm + ['--version'], cwd=source, env=env, text=True).strip()
    if version != manifest['pnpm']['version']:
        raise ValueError(f'Unexpected pnpm version: {version}')
    run_logged(pnpm + [
        '--filter', 'vite', 'install', '--frozen-lockfile', '--ignore-scripts',
        '--ignore-pnpmfile', '--store-dir', str(output / 'store'),
        '--cache-dir', str(output / 'cache'), '--config.userconfig=' + str(empty_config),
        '--config.manage-package-manager-versions=false',
        '--registry=https://registry.npmjs.org', '--package-import-method=copy',
    ], source, env, output / 'logs' / 'install.log')
    for relative, expected in manifest['patched_inputs'].items():
        verify_hash(source / relative, expected)

    locator = """const {createRequire}=require('node:module');
const path=require('node:path');
const fromVite=createRequire(path.resolve('packages/vite/package.json'));
const fromWatcher=createRequire(fromVite.resolve('chokidar'));
process.stdout.write(path.dirname(fromWatcher.resolve('braces/package.json')));"""
    braces = Path(subprocess.check_output([node, '-e', locator], cwd=source, env=env, text=True))
    if not braces.resolve().is_relative_to(source.resolve()):
        raise ValueError('Build dependency resolved outside the new source directory')
    for item in manifest['braces_source_files']:
        verify_hash(braces / item['path'], item['sha256'])
    run_logged(pnpm + ['--filter', 'vite', 'run', 'build'], source, env,
               output / 'logs' / 'build.log')
    package = source / 'packages' / 'vite'
    actual = [{'path': str(path.relative_to(package)), 'bytes': path.stat().st_size,
               'sha256': sha256(path)} for path in sorted((package / 'dist').rglob('*'))
              if path.is_file()]
    passed = actual == manifest['expected_dist']
    verification = {'pass': passed, 'expected_files': len(manifest['expected_dist']),
                    'actual_files': len(actual), 'runtime': runtime, 'dist': actual}
    (output / 'verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    if not passed:
        raise RuntimeError(f'Distribution differs from the 15 verified files; see {output / "verification.json"}')
    print(f'PASS: all {len(actual)} Vite distribution hashes match. Output: {output}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, tarfile.TarError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
