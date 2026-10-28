"""Resolve installed Benchmarks and pin their official resources. No model or task dispatch.

The Project packages declare sources. This module never chooses a learning rule,
executes a README command, reads credentials, or converts an upstream dataset.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import tomllib
from urllib.parse import unquote, urlparse

import benchmarks


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode()).hexdigest()


def git(*args, cwd=None):
    # Public sources are fetched anonymously. Neither credential helpers nor a
    # caller's injected headers/hooks may switch this operation to another account.
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_CONFIG_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT='0')
    command = ['git', '-c', 'credential.helper=', '-c', 'http.extraHeader=',
               '-c', 'core.hooksPath=' + os.devnull, *map(str, args)]
    result = subprocess.run(command, cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    require(result.returncode == 0, 'resource Git operation failed: ' + args[0])
    return result.stdout.strip()


def source_link(url):
    value = urlparse(url)
    require(value.scheme == 'https' and value.hostname == 'github.com'
            and value.username is None and value.password is None and not value.query,
            'source must be a public GitHub HTTPS tree/blob URL')
    parts = [unquote(s) for s in value.path.strip('/').split('/')]
    require(len(parts) >= 5 and parts[2] in ('tree', 'blob')
            and all(s not in ('.', '..') and '/' not in s for s in parts),
            'invalid source ref/path URL')
    return 'https://github.com/' + '/'.join(parts[:2]), parts[3:]


def declared_sources(package):
    """Only native Task source fields, not arbitrary links or rubric text."""
    urls = []
    for case in package['cases']:
        text = Path(case['statement']).read_text()
        if 'harbor run' not in text:
            continue
        found = re.findall(r'(?m)^- Task:.*?\bin\s+(https://github\.com/[^\s)]+)', text)
        require(len(found) == 1, 'Harbor Case needs one declared Task source: ' + case['case_id'])
        source_link(found[0])
        urls.append(found[0])
    return list(dict.fromkeys(urls))


def resolve_ref(repo, tail):
    """Longest actual ref resolves branches/tags containing slashes."""
    for end in range(len(tail) - 1, 0, -1):
        ref, relative = '/'.join(tail[:end]), '/'.join(tail[end:])
        if ref.startswith('-'):
            continue
        result = subprocess.run(['git', '-C', str(repo), 'rev-parse', '--verify', ref + '^{commit}'],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if result.returncode:
            continue
        commit = result.stdout.strip()
        exists = subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', commit + ':' + relative],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if exists.returncode == 0:
            return ref, commit, relative
    raise ValueError('declared source ref/path does not exist')


def acquire(url, cache, memo, overrides=None):
    repository, tail = source_link(url)
    cache = Path(cache).resolve()
    identity = digest(repository)
    if repository not in memo:
        override = (overrides or {}).get(repository)
        if override:
            mirror = Path(override).resolve()
            require(mirror.is_dir(), 'configured resource checkout is missing')
            remotes = git('remote', '-v', cwd=mirror).replace(':', '/')
            require(repository.removeprefix('https:') in remotes or repository in remotes,
                    'configured resource checkout belongs to another repository')
        else:
            mirrors = cache / 'mirrors'
            mirrors.mkdir(parents=True, exist_ok=True)
            mirror = mirrors / (identity + '.git')
            require(not mirror.is_symlink(), 'resource mirror is a symlink')
            if not mirror.exists():
                stage = Path(tempfile.mkdtemp(prefix=identity[:12] + '-', dir=mirrors))
                try:
                    git('clone', '--mirror', repository + '.git', stage / 'repo')
                    (stage / 'repo').rename(mirror)
                finally:
                    shutil.rmtree(stage)
            else:
                require(git('remote', 'get-url', 'origin', cwd=mirror).removesuffix('.git') == repository,
                        'cached mirror has another origin')
                git('fetch', '--prune', 'origin', cwd=mirror)
        memo[repository] = mirror
    mirror = memo[repository]
    ref, commit, relative = resolve_ref(mirror, tail)
    target = cache / 'checkouts' / identity / commit
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=commit[:12] + '-', dir=target.parent))
        try:
            git('clone', '--no-checkout', '--no-hardlinks', mirror, stage / 'repo')
            git('checkout', '--detach', commit, cwd=stage / 'repo')
            git('remote', 'set-url', 'origin', repository + '.git', cwd=stage / 'repo')
            (stage / 'repo').rename(target)
        finally:
            shutil.rmtree(stage)
    require(not target.is_symlink() and git('rev-parse', 'HEAD', cwd=target) == commit,
            'cached resource commit differs')
    require(not git('status', '--porcelain', '--untracked-files=all', cwd=target),
            'cached resource was modified; preserve it and use a fresh cache')
    tracked = git('ls-files', '-s', cwd=target)
    require(not any(line.startswith('160000 ') for line in tracked.splitlines()),
            'source has unmaterialized submodules; a resource adapter is required')
    path = benchmarks.inside(target, relative)
    require(path.exists(), 'pinned resource path is missing')
    return {'repository': repository, 'requested_ref': ref, 'commit': commit,
            'tree': git('rev-parse', 'HEAD^{tree}', cwd=target),
            'checkout': str(target), 'path': relative, 'tracked_inventory_sha256': digest(tracked)}


def normalized(text):
    return re.sub(r'[^\w]', '', text.casefold()).replace('_', '')


def requested_name(req):
    value = req.get('dataset') or req.get('benchmark')
    if not value:
        prompt = req.get('prompt', '').strip()
        match = re.fullmatch(r'使用\s*(.+?)\s*进行\s*RSI(?:[，,。].*)?', prompt, re.I)
        value = match[1] if match else None
    require(isinstance(value, str) and value.strip(), 'name a dataset or native package path')
    return value.strip().strip('〈〉<>')


def select(project, requested):
    path = Path(requested).expanduser()
    if path.is_absolute() or path.exists():
        path = path.resolve()
        if path.name == 'benchmark_config.toml':
            path = path.parent
        return [benchmarks.package(path.parent, path.name)]
    key = normalized(requested).removesuffix('子集')
    group_alias = benchmarks.gdpevo_group_alias(requested)
    matches = []
    for path in sorted((Path(project) / 'benchmarks').glob('*/benchmark_config.toml')):
        data = tomllib.loads(path.read_text())
        if data.get('status') in ('draft', 'failed'):
            continue
        names = {normalized(data.get('id', path.parent.name)), normalized(data.get('title', ''))}
        names |= {name.removeprefix('penguinharnessbenchmark') for name in names}
        names |= {re.sub(r'(train|test)$', '', name) for name in names}
        if key in names or (key == 'gdpevo' or group_alias) and any(n.startswith('gdpevo') for n in names):
            matches.append(benchmarks.package(path.parent.parent, path.parent.name))
    require(matches, 'dataset not found in this Project; supply its native package path or import it')
    return matches


def environment(contracts):
    """Free availability probes; no downloads, container creation, or scoring."""
    harbor = any(c.get('training_case', {}).get('kind') == 'harbor'
                 or any(t['kind'] == 'harbor' for t in c.get('cases', [])) for c in contracts)
    missing = []
    checks = {'python': True, 'git': shutil.which('git') is not None}
    if harbor:
        for program in ('docker', 'uvx', 'node', 'penguin'):
            checks[program] = shutil.which(program) is not None
            if not checks[program]:
                missing.append(program + ' executable')
        if checks['docker']:
            result = subprocess.run(['docker', 'compose', 'version'], capture_output=True, timeout=15)
            checks['docker_compose'] = result.returncode == 0
            if not checks['docker_compose']:
                missing.append('Docker Compose v2')
    return {'available': not missing, 'checks': checks, 'missing': missing,
            'scope': 'tool availability only; task image/network preflight still required', 'model_calls': 0}


def prepare(req):
    project = Path(req['project']).resolve()
    settings_path = project / 'evo-experiment.json'
    settings = json.loads(settings_path.read_text()) if settings_path.is_file() else {}
    # This is the public experiment file, never .project_config.toml or a key store.
    allowed = ('runtime', 'budget_usd', 'budget_scope', 'paid_authorized', 'runs',
               'test_benchmark', 'selected_benchmark', 'resource_checkouts', 'settings')
    request = {**{k: v for k, v in settings.items() if k in allowed}, **req}
    group_alias = benchmarks.gdpevo_group_alias(requested_name(request))
    selected = select(project, requested_name(request))
    if request.get('test_benchmark'):
        selected += select(project, request['test_benchmark'])
    urls = list(dict.fromkeys(u for p in selected for u in declared_sources(p)))
    resources, memo = [], {}
    cache = Path(request.get('cache', project / '.evo-resources'))
    for url in urls:
        resources.append(acquire(url, cache, memo, request.get('resource_checkouts')))
    roots = {r['checkout'] for r in resources}
    require(len(roots) <= 1, 'selected packages require multiple execution roots; choose one supported pair')
    contracts = []
    if roots:
        repo = Path(next(iter(roots)))
        manifests = list(repo.glob('benchmarks/*/tasks/task_group.yaml'))
        ids = {p['benchmark_id'] for p in selected}
        for manifest in manifests:
            import yaml
            value = yaml.safe_load(manifest.read_text())
            info = value['benchmark']
            if group_alias and value.get('task_group', {}).get('task_group_id') != group_alias:
                continue
            if ids.intersection((info['train_package'], info['test_package'])):
                contracts.append(benchmarks.gdpevo(repo, str(manifest.relative_to(repo))))
        require(not group_alias or len(contracts) == 1, 'GDPevo group shorthand must match one source manifest')
        if not contracts:
            # Each public native package is authoritative; do not infer an RSI
            # training/test split for a plain Harbor benchmark.
            contracts = [benchmarks.ordinary(repo,
                         str(repo / 'packages' / p['benchmark_id'])
                         if (repo / 'packages' / p['benchmark_id'] / 'benchmark_config.toml').is_file()
                         else p['package_path']) for p in selected]
        selection = request.get('selected_benchmark')
        if selection:
            contracts = [c for c in contracts if selection in
                         (c['benchmark'], c['training_package']['benchmark_id'])]
    else:
        repo = project
        contracts = [benchmarks.ordinary(repo, p['package_path']) for p in selected]
    # Generic packages need an explicit held-out pair. Continuous manifests
    # already declare theirs. Reuse bootstrap's runtime/budget/import checks.
    train = contracts[0] if len(contracts) == 1 else None
    if request.get('test_benchmark') and all(c['adapter'] == 'native-cases-v1' for c in contracts):
        require(len(contracts) == 2, 'one training and one distinct test package required')
        first, second = contracts
        require(first['benchmark'] != second['benchmark'], 'training and test packages must differ')
        first['test_package'], first['test_cases'] = second['training_package'], second['cases']
        contracts, train = [first], first
    plan = benchmarks.bootstrap({**request, 'repo': str(repo),
                                 'benchmark': requested_name(request)},
                                contracts=contracts, local_source=not roots)
    plan.update(resource_lock=resources, resource_lock_sha256=digest(resources),
                settings_path=str(settings_path) if settings_path.exists() else None,
                settings_sha256=benchmarks.sha(settings_path) if settings_path.exists() else None,
                environment=environment(contracts))
    return {'schema': 'evo-resource-preparation-v1', 'plan': plan,
            'ready': plan['ready'] and plan['environment']['available'],
            'model_calls': 0, 'dispatches': 0}


def main():
    import sys
    req = json.loads(Path(sys.argv[1]).read_text())
    output = Path(req['output']).resolve()
    # A completed entry is a frozen resource lock; resuming never refreshes main
    # or another mutable source ref behind an existing experiment.
    if output.exists():
        saved = json.loads(output.read_text())
        require(saved['entry_request_sha256'] == digest({k: v for k, v in req.items() if k != 'output'}),
                'entry request changed; preserve the existing experiment')
        for item in saved['plan']['resource_lock']:
            require(git('rev-parse', 'HEAD', cwd=item['checkout']) == item['commit']
                    and not git('status', '--porcelain', '--untracked-files=all', cwd=item['checkout']),
                    'frozen resource checkout changed')
        for contract in saved['plan']['contracts']:
            for source in (contract['training_package'], contract.get('test_package')):
                if source:
                    require(benchmarks.project_package(req['project'], source)['ready'],
                            'Project package changed after resource preparation')
        print(json.dumps({'reused': True, 'receipt': str(output), 'ready': saved['ready'],
                          'model_calls': 0, 'dispatches': 0}))
        return
    result = prepare(req)
    result['entry_request_sha256'] = digest({k: v for k, v in req.items() if k != 'output'})
    plan_path = output.with_name(output.stem + '-plan.json')
    require(not plan_path.exists(), 'plan destination already exists')
    output.parent.mkdir(parents=True, exist_ok=True)
    plan_path.write_text(json.dumps(result['plan'], ensure_ascii=False, indent=2) + '\n')
    result['plan_path'] = str(plan_path)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'receipt': str(output), 'plan': str(plan_path), 'ready': result['ready'],
                      'missing_inputs': result['plan']['missing_inputs'],
                      'capability_blockers': result['plan']['capability_blockers'],
                      'environment': result['plan']['environment'], 'model_calls': 0, 'dispatches': 0}, ensure_ascii=False))


if __name__ == '__main__':
    main()
