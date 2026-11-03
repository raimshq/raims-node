"""Verify canonical Node SDK bytes and publish stable npm releases through OIDC."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.dont_write_bytecode = True
REPOSITORY = 'raimshq/raims-node'
PACKAGE = '@raimshq/raims'
REGISTRY = 'https://registry.npmjs.org/'
WORKFLOW = '.github/workflows/validate.yml'
NODE_VERSIONS = ['22.18.0', '24.22.2', '26.1.0']
PUBLISH_NODE = '24.22.2'
GATE_NPM = '11.19.1'
PUBLISH_NPM = '12.2.0'
NPM_INTEGRITY = 'sha512-ZsJjKpTnlmSXOLLXiU1xDCzC4Wlok4IwZmh/aw2KUuXytU7q6qMv/cUT7MoeSf95Slwuw/lRXYefGzGCspHPNQ=='
JOBS = {f'validateNode ({version})': ('node-sdk-check-' + version, 'Run the canonical Node.js SDK checks')
        for version in NODE_VERSIONS}
JOBS['securityLinux'] = ('node-sdk-security', 'Run the canonical SDK security checks')
SHA = re.compile(r'[a-f0-9]{40}')
SHA256 = re.compile(r'[a-f0-9]{64}')
VERSION = re.compile(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)')
MAX_DOWNLOAD = 16 * 1024 * 1024
MAX_METADATA = 2 * 1024 * 1024
DIST = 'raims-node.tgz'
ARCHIVE_FILES = {'package/' + name for name in {
    'package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'docs/usage.md', 'docs/webhooks.md',
    'docs/reference.md', 'types/index.d.cts', 'types/index.d.mts', 'src/index.cjs', 'src/index.mjs',
    'src/errors.cjs', 'src/requestor.cjs', 'src/validation.cjs', 'src/pagination.cjs', 'src/webhook.cjs',
    'src/generated/contract.json'}}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def read_response(request, maximum=MAX_METADATA):
    with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
        raw = response.read(maximum + 1)
    require(len(raw) <= maximum, 'The remote response exceeds the allowed size.')
    return raw


def github(endpoint, binary=False):
    token = os.environ.get('GITHUB_TOKEN')
    require(token, 'A GitHub token is required for release verification.')
    url = ('https://api.github.com/repos/' + REPOSITORY + '/' + endpoint).rstrip('/')
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json', 'User-Agent': 'Raims-Node-Release',
        'X-GitHub-Api-Version': '2022-11-28'})
    try:
        raw = read_response(request, MAX_DOWNLOAD if binary else MAX_METADATA)
    except urllib.error.HTTPError as error:
        require(binary and error.code in {301, 302, 303, 307, 308}, 'GitHub metadata could not be read.')
        location = error.headers.get('Location', '')
        parsed = urllib.parse.urlsplit(location)
        require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
                and any(parsed.hostname.endswith(suffix) for suffix in
                        ['.blob.core.windows.net', '.githubusercontent.com', '.actions.githubusercontent.com']),
                'Unexpected artifact download origin.')
        raw = read_response(urllib.request.Request(location, headers={'User-Agent': 'Raims-Node-Release'}), MAX_DOWNLOAD)
    return raw if binary else json.loads(raw)


def public_download(url):
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == 'https' and parsed.hostname == 'github.com' and not parsed.username and not parsed.password
            and parsed.path.startswith('/' + REPOSITORY + '/releases/download/'), 'Unexpected public release asset origin.')
    request = urllib.request.Request(url, headers={'User-Agent': 'Raims-Node-Release'})
    try:
        return read_response(request, MAX_DOWNLOAD)
    except urllib.error.HTTPError as error:
        require(error.code in {301, 302, 303, 307, 308}, 'A public release asset could not be read.')
        location = error.headers.get('Location', '')
        target = urllib.parse.urlsplit(location)
        require(target.scheme == 'https' and target.hostname == 'release-assets.githubusercontent.com'
                and not target.username and not target.password, 'Unexpected release download origin.')
        return read_response(urllib.request.Request(location, headers={'User-Agent': 'Raims-Node-Release'}), MAX_DOWNLOAD)


def git(source, *args):
    result = subprocess.run(['git', '-C', str(source), *args], capture_output=True, text=True, timeout=60)
    require(result.returncode == 0, 'Release source identity could not be verified.')
    return result.stdout.strip()


def source_version(source):
    metadata = json.loads((source / 'package.json').read_text(encoding='utf-8'))
    require(metadata.get('name') == PACKAGE and VERSION.fullmatch(metadata.get('version', ''))
            and metadata.get('repository', {}).get('url') == 'https://github.com/' + REPOSITORY + '.git'
            and metadata.get('engines') == {'node': '>=22'} and metadata.get('private') in (None, False)
            and metadata.get('publishConfig') == {'access': 'public', 'registry': REGISTRY},
            'The official stable npm package identity is required.')
    return metadata['version']


def source_fingerprint(source):
    excluded = {'.git', '.tmp', 'node_modules', 'coverage', '__pycache__', '.idea', '.vscode'}
    files = {}
    for path in source.rglob('*'):
        relative = path.relative_to(source)
        if relative.parts[0] in excluded:
            continue
        require(not path.is_symlink(), 'Source links are not allowed.')
        if path.is_file():
            files[relative.as_posix()] = digest(path.read_bytes())
    return digest(json.dumps(files, sort_keys=True).encode('utf-8'))


def inspect_package(raw, version):
    require(0 < len(raw) <= MAX_METADATA, 'The npm package size is invalid.')
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        require(len(members) == len(ARCHIVE_FILES) and {item.name for item in members} == ARCHIVE_FILES
                and all(item.isfile() and item.size <= MAX_METADATA for item in members)
                and sum(item.size for item in members) <= 8 * MAX_METADATA,
                'The npm package contains unexpected files or links.')
        metadata = json.loads(archive.extractfile('package/package.json').read())
    require(metadata.get('name') == PACKAGE and metadata.get('version') == version
            and metadata.get('repository', {}).get('url') == 'https://github.com/' + REPOSITORY + '.git'
            and metadata.get('engines') == {'node': '>=22'} and metadata.get('private') in (None, False)
            and metadata.get('publishConfig') == {'access': 'public', 'registry': REGISTRY},
            'The npm archive metadata differs.')


def record(source, report_path, artifact, toolkit):
    version = source_version(source)
    head = git(source, 'rev-parse', 'HEAD')
    toolkit_ref = os.environ.get('RAIMS_NODE_TOOLKIT_REF', '')
    require(SHA.fullmatch(head) and head == os.environ.get('GITHUB_SHA') and SHA.fullmatch(toolkit_ref)
            and set(toolkit_ref) != {'0'} and git(toolkit, 'rev-parse', 'HEAD') == toolkit_ref
            and not git(toolkit, 'status', '--porcelain', '--untracked-files=all')
            and not git(source, 'status', '--porcelain', '--untracked-files=all'),
            'The canonical source or Toolkit identity differs.')
    raw_report = report_path.read_bytes()
    report = json.loads(raw_report)
    require(report.get('status') == 'passed' and report.get('sourceUnchanged') is True
            and report.get('finalIdentityVerified') is True and report.get('physicalTestsOnlyInTmp') is True
            and report.get('liveApiCalled') is False and report.get('installedPackage') is True
            and report.get('nodeVersion') == 'v' + PUBLISH_NODE and report.get('npmVersion') == GATE_NPM
            and Path(report.get('source', '')).resolve() == source.resolve()
            and report.get('toolingSha256') == digest((toolkit / 'scripts/release-preflight/node_sdk.py').read_bytes())
            and report.get('sourceFingerprintBefore') == report.get('sourceFingerprintAfter')
            == report.get('sourceFingerprintSha256') == source_fingerprint(source),
            'The canonical Node SDK report is not bound to these sources.')
    tests = report.get('tests', {})
    audit = report.get('dependencyAudit', {})
    require(type(tests.get('tests')) is int and tests['tests'] > 0
            and tests.get('passed') == tests['tests'] and tests.get('failed') == 0
            and report.get('sourceTypes') == report.get('installedTypes')
            and type(report.get('sourceTypes', {}).get('publicTypes')) is int
            and report['sourceTypes']['publicTypes'] > 0
            and audit.get('provider') == 'npm' and audit.get('scope') == 'installed-runtime'
            and audit.get('vulnerabilities') and all(value == 0 for value in audit['vulnerabilities'].values()),
            'Canonical runtime, installed types, or dependency checks did not pass.')
    package = report.get('package', {})
    filename = package.get('filename', '')
    require(package.get('name') == PACKAGE and package.get('version') == version
            and Path(filename).name == filename and filename == f'raimshq-raims-{version}.tgz',
            'The canonical package identity differs.')
    raw = (report_path.parent / 'dist' / filename).read_bytes()
    require(digest(raw) == package.get('sha256') and len(raw) == package.get('bytes'), 'Approved package bytes changed.')
    inspect_package(raw, version)
    manifest = {'package': {'name': PACKAGE, 'version': version}, 'sourceRevision': head,
                'toolkitRevision': toolkit_ref, 'nodeVersions': NODE_VERSIONS,
                'files': {DIST: digest(raw)}, 'canonicalReportSha256': digest(raw_report)}
    require(not artifact.exists(), 'Use a new canonical artifact directory.')
    (artifact / 'dist').mkdir(parents=True)
    (artifact / 'dist' / DIST).write_bytes(raw)
    (artifact / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


def context(source):
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY and os.environ.get('GITHUB_EVENT_NAME') == 'release',
            'Only the official repository release event may publish.')
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
    release = event.get('release', {})
    require(event.get('action') == 'published' and release.get('draft') is False and release.get('prerelease') is False,
            'Only a published stable release can be uploaded.')
    version = source_version(source)
    tag = 'v' + version
    require(release.get('tag_name') == tag and os.environ.get('GITHUB_REF') == 'refs/tags/' + tag,
            'The release tag and package version differ.')
    head = git(source, 'rev-parse', 'HEAD')
    require(SHA.fullmatch(head) and head == os.environ.get('GITHUB_SHA')
            and git(source, 'rev-parse', 'refs/tags/' + tag + '^{commit}') == head
            and not git(source, 'status', '--porcelain', '--untracked-files=all'), 'The release sources differ.')
    repo = github('')
    require(repo.get('full_name') == REPOSITORY and repo.get('private') is False and repo.get('default_branch') == 'main'
            and github('commits/' + tag).get('sha') == head, 'The public repository or tag differs.')
    git(source, 'merge-base', '--is-ancestor', head, 'origin/main')
    identifier = release.get('id')
    require(type(identifier) is int and identifier > 0, 'The release identity is invalid.')
    current = github('releases/' + str(identifier))
    require(current.get('id') == identifier and current.get('tag_name') == tag
            and current.get('draft') is False and current.get('prerelease') is False, 'The public release changed.')
    return {'sourceRevision': head, 'version': version, 'tag': tag, 'releaseId': identifier}


def validation(head):
    response = github('actions/workflows/validate.yml/runs?head_sha=' + head + '&per_page=100&page=1')
    rows = response.get('workflow_runs')
    require(isinstance(rows, list) and rows and type(response.get('total_count')) is int
            and response['total_count'] >= len(rows), 'Validation history is incomplete.')
    run = rows[0]
    require(run.get('head_sha') == head and run.get('path') == WORKFLOW and run.get('name') == 'Validate Node.js SDK'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success'
            and run.get('event') in {'push', 'workflow_dispatch'}
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('head_repository', {}).get('full_name') == REPOSITORY,
            'Successful validation of this exact commit is required.')
    identifier, attempt = run.get('id'), run.get('run_attempt')
    require(type(identifier) is int and identifier > 0 and type(attempt) is int and attempt > 0,
            'Validation attempt identity is incomplete.')
    response = github(f'actions/runs/{identifier}/attempts/{attempt}/jobs?per_page=100&page=1')
    jobs = response.get('jobs', [])
    require(response.get('total_count') == len(jobs) == len(JOBS) and {job.get('name') for job in jobs} == set(JOBS),
            'The complete Node validation job inventory is required.')
    for job in jobs:
        suffix, step_name = JOBS[job['name']]
        require(job.get('status') == 'completed' and job.get('conclusion') == 'success'
                and set(job.get('labels', [])) == {f'codebuild-raims-github-actions-{identifier}-{attempt}', suffix}
                and len(job['labels']) == 2 and isinstance(job.get('runner_name'), str)
                and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', job['runner_name'])
                and job.get('runner_group_name'), 'A required AWS validation job did not pass.')
        names = {step_name}
        if job['name'] == 'validateNode (' + PUBLISH_NODE + ')':
            names.update({'Record the canonical npm distribution', 'Upload canonical Node distribution evidence'})
        for name in names:
            required = [step for step in job.get('steps', []) if step.get('name') == name]
            require(len(required) == 1 and required[0].get('status') == 'completed'
                    and required[0].get('conclusion') == 'success', 'A canonical validation or distribution step did not pass.')
    return {'validationRunId': identifier, 'validationRunAttempt': attempt}


def artifact_files(value, proven):
    run, attempt = proven['validationRunId'], proven['validationRunAttempt']
    response = github(f'actions/runs/{run}/artifacts?per_page=100&page=1')
    require(type(response.get('total_count')) is int and 0 < response['total_count'] <= 100
            and isinstance(response.get('artifacts'), list) and len(response['artifacts']) == response['total_count'],
            'Validation artifact inventory is incomplete.')
    found = [row for row in response['artifacts'] if row.get('name') == f'raims-node-validation-{run}-{attempt}']
    require(len(found) == 1 and found[0].get('expired') is False and found[0].get('workflow_run', {}).get('id') == run
            and found[0].get('workflow_run', {}).get('head_sha') == value['sourceRevision'], 'The approved npm artifact is missing.')
    artifact = found[0]
    require(type(artifact.get('id')) is int and artifact['id'] > 0, 'The artifact identity is invalid.')
    raw_zip = github('actions/artifacts/' + str(artifact['id']) + '/zip', binary=True)
    require(artifact.get('digest') == 'sha256:' + digest(raw_zip), 'The Actions artifact digest differs.')
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        expected = {'release-manifest.json', 'dist/' + DIST}
        require(len(archive.infolist()) == len(expected) and set(archive.namelist()) == expected
                and sum(item.file_size for item in archive.infolist()) <= MAX_DOWNLOAD
                and all(not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16) for item in archive.infolist()),
                'The canonical npm artifact contains unexpected entries.')
        raw, manifest_raw = archive.read('dist/' + DIST), archive.read('release-manifest.json')
    manifest = json.loads(manifest_raw)
    toolkit = manifest.get('toolkitRevision', '')
    require(set(manifest) == {'package', 'sourceRevision', 'toolkitRevision', 'nodeVersions', 'files', 'canonicalReportSha256'}
            and manifest['package'] == {'name': PACKAGE, 'version': value['version']}
            and manifest['sourceRevision'] == value['sourceRevision']
            and toolkit == os.environ.get('RAIMS_NODE_TOOLKIT_REF') and SHA.fullmatch(toolkit) and set(toolkit) != {'0'}
            and manifest['nodeVersions'] == NODE_VERSIONS and manifest['files'] == {DIST: digest(raw)}
            and SHA256.fullmatch(str(manifest['canonicalReportSha256'])), 'The canonical manifest or package bytes differ.')
    inspect_package(raw, value['version'])
    return {DIST: raw, 'release-manifest.json': manifest_raw}


def validate_local(artifact, files):
    require(artifact.is_dir() and not artifact.is_symlink(), 'The approved npm upload directory is missing.')
    paths = list(artifact.rglob('*'))
    require({path.relative_to(artifact).as_posix() for path in paths} == {'dist', 'dist/' + DIST, 'release-manifest.json'}
            and all(not path.is_symlink() for path in paths), 'The npm upload directory contains unexpected entries.')
    for name, raw in files.items():
        target = artifact / name if name == 'release-manifest.json' else artifact / 'dist' / name
        require(target.read_bytes() == raw, 'The local npm upload differs from approved CI bytes.')


def upload_release_asset(identifier, name, raw):
    token = os.environ.get('GITHUB_TOKEN')
    require(token and type(identifier) is int and identifier > 0 and Path(name).name == name,
            'A release asset upload could not be authorized.')
    url = 'https://uploads.github.com/repos/' + REPOSITORY + '/releases/' + str(identifier) + '/assets?name=' + urllib.parse.quote(name, safe='')
    request = urllib.request.Request(url, data=raw, method='POST', headers={'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/octet-stream', 'User-Agent': 'Raims-Node-Release', 'Accept': 'application/vnd.github+json'})
    try:
        read_response(request)
    except (OSError, RuntimeError):
        current = github('releases/' + str(identifier))
        assets = [asset for asset in current.get('assets', []) if asset.get('name') == name]
        require(len(assets) == 1 and public_download(assets[0]['browser_download_url']) == raw,
                'Release asset creation was not confirmed; inspect the release before retrying.')


def release_files(value, files, create_missing=False):
    rows = github('releases/' + str(value['releaseId'])).get('assets', [])
    assets = {asset['name']: asset for asset in rows}
    expected = set(files) | {'SHA256SUMS'}
    require(len(assets) == len(rows) and set(assets).issubset(expected), 'The release contains unexpected or duplicate assets.')
    complete = dict(files, SHA256SUMS=''.join(digest(files[name]) + '  ' + name + '\n' for name in sorted(files)).encode())
    for name, raw in complete.items():
        if name in assets:
            require(public_download(assets[name]['browser_download_url']) == raw, 'An existing release asset differs from approved CI bytes.')
    missing = set(complete) - set(assets)
    require(not missing or create_missing, 'The approved npm release assets are missing.')
    for name in sorted(missing):
        upload_release_asset(value['releaseId'], name, complete[name])
    if missing:
        rows = github('releases/' + str(value['releaseId'])).get('assets', [])
        assets = {asset['name']: asset for asset in rows}
    require(len(assets) == len(rows) and set(assets) == expected, 'The release asset inventory differs.')
    for name, raw in complete.items():
        require(public_download(assets[name]['browser_download_url']) == raw, 'A public npm release asset differs.')


def registry(endpoint):
    request = urllib.request.Request(REGISTRY + endpoint, headers={'User-Agent': 'Raims-Node-Release', 'Cache-Control': 'no-cache'})
    try:
        return json.loads(read_response(request))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def indexed(version, raw):
    metadata = registry(urllib.parse.quote(PACKAGE, safe='@') + '/' + version)
    if metadata is None:
        return False
    expected_url = REGISTRY + '@raimshq/raims/-/raims-' + version + '.tgz'
    expected_integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
    require(metadata.get('name') == PACKAGE and metadata.get('version') == version
            and metadata.get('repository', {}).get('url') in {'https://github.com/' + REPOSITORY + '.git', 'git+https://github.com/' + REPOSITORY + '.git'}
            and metadata.get('dist', {}).get('tarball') == expected_url
            and metadata['dist'].get('integrity') == expected_integrity
            and metadata['dist'].get('shasum') == hashlib.sha1(raw, usedforsecurity=False).hexdigest(),
            'An immutable npm version differs from the approved identity or bytes.')
    require(read_response(urllib.request.Request(expected_url), MAX_DOWNLOAD) == raw,
            'The public npm artifact differs from approved bytes.')
    return True


def confirm(version, files, wait_seconds=300):
    deadline = time.monotonic() + wait_seconds
    while True:
        if indexed(version, files[DIST]):
            print('npm serves the exact approved package bytes.', flush=True)
            return
        require(time.monotonic() < deadline, 'npm did not confirm the package; inspect the registry before retrying.')
        time.sleep(min(10, max(0, deadline - time.monotonic())))


def cli_tree(root):
    paths = list(root.rglob('*'))
    require(all(not path.is_symlink() for path in paths), 'The publishing CLI contains links.')
    files = {path.relative_to(root).as_posix(): digest(path.read_bytes()) for path in paths if path.is_file()}
    return digest(json.dumps(files, sort_keys=True).encode('utf-8'))


def prepare_cli(target):
    require(not any(os.environ.get(name) for name in ['ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
            'NODE_AUTH_TOKEN', 'NPM_TOKEN']), 'The CLI preparation step must not receive publishing credentials.')
    require(not target.exists(), 'Use a new publishing CLI directory.')
    metadata = registry('npm/' + PUBLISH_NPM)
    expected_url = REGISTRY + 'npm/-/npm-' + PUBLISH_NPM + '.tgz'
    require(metadata and metadata.get('name') == 'npm' and metadata.get('version') == PUBLISH_NPM
            and metadata.get('dist', {}).get('integrity') == NPM_INTEGRITY
            and metadata['dist'].get('tarball') == expected_url, 'The official pinned npm CLI metadata differs.')
    raw = read_response(urllib.request.Request(expected_url), MAX_DOWNLOAD)
    require('sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode() == NPM_INTEGRITY,
            'The official npm CLI archive integrity differs.')
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        names = [item.name for item in members]
        require(0 < len(members) <= 5000 and len(names) == len(set(names))
                and sum(item.size for item in members) <= 64 * 1024 * 1024
                and all((item.isfile() or item.isdir()) and item.name.startswith('package/')
                        and not {'', '.', '..'}.intersection(Path(item.name).parts)
                        and not item.name.startswith('/') and '\\' not in item.name for item in members),
                'The npm CLI archive contains unsafe entries.')
        for item in members:
            path = target / item.name
            if item.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.extractfile(item).read())
    package = target / 'package'
    require(json.loads((package / 'package.json').read_text())['version'] == PUBLISH_NPM
            and (package / 'bin/npm-cli.js').is_file(), 'The pinned npm CLI identity differs.')
    (target / 'verified-cli.json').write_text(json.dumps({'version': PUBLISH_NPM, 'integrity': NPM_INTEGRITY,
        'archiveSha256': digest(raw), 'treeSha256': cli_tree(package)}, indent=2) + '\n', encoding='utf-8')
    (target / 'npm-cli.tgz').write_bytes(raw)
    if os.environ.get('GITHUB_OUTPUT'):
        with Path(os.environ['GITHUB_OUTPUT']).open('a', encoding='utf-8') as output:
            output.write('npmCli=' + str(package / 'bin/npm-cli.js') + '\n')


def verified_cli(path):
    require(path is not None and path.name == 'npm-cli.js' and path.parent.name == 'bin'
            and path.parent.parent.name == 'package' and not path.is_symlink(), 'The verified npm CLI path is required.')
    package = path.parent.parent
    receipt = json.loads((package.parent / 'verified-cli.json').read_text())
    archive_raw = (package.parent / 'npm-cli.tgz').read_bytes()
    require(len(archive_raw) <= MAX_DOWNLOAD and 'sha512-' + base64.b64encode(hashlib.sha512(archive_raw).digest()).decode() == NPM_INTEGRITY,
            'The cached official npm CLI archive integrity differs.')
    with tarfile.open(fileobj=io.BytesIO(archive_raw), mode='r:gz') as archive:
        files = {item.name.removeprefix('package/'): digest(archive.extractfile(item).read())
                 for item in archive.getmembers() if item.isfile()}
    expected_tree = digest(json.dumps(files, sort_keys=True).encode('utf-8'))
    require(receipt.get('version') == PUBLISH_NPM and receipt.get('integrity') == NPM_INTEGRITY
            and receipt.get('archiveSha256') == digest(archive_raw)
            and receipt.get('treeSha256') == expected_tree == cli_tree(package),
            'The pinned npm CLI changed after preparation.')
    return path


def publish(artifact, value, files, npm_cli):
    validate_local(artifact, files)
    if indexed(value['version'], files[DIST]):
        print('The exact approved npm version is already published.', flush=True)
        return
    metadata = registry(urllib.parse.quote(PACKAGE, safe='@'))
    latest = metadata.get('dist-tags', {}).get('latest') if metadata else None
    require(latest is None or VERSION.fullmatch(latest) and tuple(map(int, latest.split('.'))) <= tuple(map(int, value['version'].split('.'))),
            'Publishing this release would move latest backwards.')
    workflow_ref = REPOSITORY + '/.github/workflows/npm-release.yml@refs/tags/' + value['tag']
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and os.environ.get('RUNNER_OS') == 'Linux' and os.environ.get('GITHUB_JOB') == 'publishNpm'
            and os.environ.get('GITHUB_WORKFLOW_REF') == workflow_ref
            and os.environ.get('ACTIONS_ID_TOKEN_REQUEST_URL') and os.environ.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN'),
            'The approved GitHub-hosted OIDC publisher context is required.')
    require(not any(os.environ.get(name) for name in ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NPM_CONFIG__AUTH', 'NPM_CONFIG__AUTHTOKEN']),
            'Long-lived npm credentials are not permitted in this publisher.')
    npm_cli = verified_cli(npm_cli)
    allowed = {'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LD_LIBRARY_PATH',
               'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'GITHUB_ACTIONS', 'GITHUB_SERVER_URL',
               'GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'GITHUB_EVENT_PATH', 'GITHUB_RUN_ID',
               'GITHUB_RUN_ATTEMPT', 'GITHUB_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA', 'GITHUB_REPOSITORY_ID',
               'GITHUB_REPOSITORY_OWNER_ID', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'CI'}
    environment = {name: content for name, content in os.environ.items() if name in allowed}
    with tempfile.TemporaryDirectory(prefix='npm-oidc-', dir=artifact.parent) as temporary:
        temporary = Path(temporary)
        for filename, key in [('user.npmrc', 'NPM_CONFIG_USERCONFIG'), ('global.npmrc', 'NPM_CONFIG_GLOBALCONFIG')]:
            (temporary / filename).write_text('', encoding='utf-8')
            environment[key] = str(temporary / filename)
        environment.update(NPM_CONFIG_UPDATE_NOTIFIER='false', NPM_CONFIG_CACHE=str(temporary / 'cache'))
        for command, expected in [(['node', '--version'], 'v' + PUBLISH_NODE), (['node', str(npm_cli), '--version'], PUBLISH_NPM)]:
            result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=30)
            require(result.returncode == 0 and result.stdout.strip() == expected, 'The pinned publishing runtime differs.')
        try:
            result = subprocess.run(['node', str(npm_cli), 'publish', str(artifact / 'dist' / DIST), '--ignore-scripts', '--provenance',
                '--access', 'public', '--tag', 'latest', '--registry', REGISTRY], cwd=str(artifact), env=environment,
                capture_output=True, timeout=300, check=False)
            if result.returncode:
                print('npm returned an unsuccessful response; checking the registry before another upload.', flush=True)
        except (OSError, subprocess.SubprocessError):
            print('The npm response is uncertain; checking the registry before another upload.', flush=True)
        # Never repeat a write here. A rerun must first prove the immutable public bytes.
        validate_local(artifact, files)
        confirm(value['version'], files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('cli', 'record', 'prepare', 'verify', 'publish', 'confirm'))
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--toolkit', type=Path)
    parser.add_argument('--npm-cli', type=Path)
    args = parser.parse_args()
    source, artifact = args.source.resolve(), args.artifact.resolve()
    workspace = Path(os.environ.get('GITHUB_WORKSPACE', '.')).resolve()
    require(workspace / '.tmp' in artifact.parents, 'Release artifacts must stay in workspace .tmp.')
    if args.command == 'cli':
        prepare_cli(artifact)
        return 0
    if args.command == 'record':
        require(args.report and args.toolkit and workspace / '.tmp' in args.report.resolve().parents,
                'A canonical report and immutable Toolkit are required.')
        record(source, args.report.resolve(), artifact, args.toolkit.resolve())
        return 0
    value = context(source)
    files = artifact_files(value, validation(value['sourceRevision']))
    release_files(value, files, create_missing=args.command == 'prepare')
    if args.command == 'prepare':
        require(not artifact.exists(), 'Use a new upload directory.')
        (artifact / 'dist').mkdir(parents=True)
        for name, raw in files.items():
            (artifact / name if name == 'release-manifest.json' else artifact / 'dist' / name).write_bytes(raw)
    else:
        validate_local(artifact, files)
    if args.command == 'verify':
        required = not indexed(value['version'], files[DIST])
        if os.environ.get('GITHUB_OUTPUT'):
            with Path(os.environ['GITHUB_OUTPUT']).open('a', encoding='utf-8') as output:
                output.write('publishRequired=' + ('true' if required else 'false') + '\n')
    elif args.command == 'publish':
        require(args.npm_cli and workspace / '.tmp' in args.npm_cli.resolve().parents,
                'The isolated publishing CLI must remain in workspace .tmp.')
        publish(artifact, value, files, args.npm_cli.resolve())
    elif args.command == 'confirm':
        confirm(value['version'], files)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, zipfile.BadZipFile, tarfile.TarError) as error:
        print('Node release verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
