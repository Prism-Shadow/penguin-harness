"""Benchmark contracts, not a scheduler or learner. No scoring/private inputs.

Resolve repository refs once; discover public packages and explicit task mappings;
prepare a frozen contract for the main Penguin to execute with native workers.
"""
import fnmatch
import json
import math
from pathlib import Path
import re
import shlex
import subprocess
import tomllib
from urllib.parse import unquote, urlparse


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def inside(root, relative):
    root = Path(root).resolve()
    path = root / relative
    require(not Path(relative).is_absolute() and '..' not in Path(relative).parts,
            'expected a repository-relative path')
    require(path.resolve().is_relative_to(root) and not path.is_symlink(), 'path escapes repository')
    return path


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True, stderr=subprocess.PIPE).strip()


def pin(repo, ref='HEAD'):
    require(isinstance(ref, str) and ref and not ref.startswith('-'), 'invalid repository ref')
    commit = git(repo, 'rev-parse', '--verify', ref + '^{commit}')
    require(re.fullmatch('[0-9a-f]{40}', commit), 'ref did not resolve to a full commit')
    require(git(repo, 'rev-parse', 'HEAD') == commit, 'check out the resolved commit before preparation')
    return commit


def resolve_link(repo, url):
    """Longest resolvable ref handles branch/tag names containing slashes."""
    parsed = urlparse(url)
    require(parsed.scheme == 'https' and parsed.hostname == 'github.com' and not parsed.query,
            'expected a GitHub HTTPS package link')
    parts = [unquote(x) for x in parsed.path.strip('/').split('/')]
    require(len(parts) >= 5 and parts[2] in ('tree', 'blob'), 'expected a tree/blob link')
    for end in range(len(parts), 3, -1):
        ref = '/'.join(parts[3:end])
        try:
            commit = git(repo, 'rev-parse', '--verify', ref + '^{commit}')
        except subprocess.CalledProcessError:
            continue
        path = '/'.join(parts[end:])
        if path and inside(repo, path).exists():
            # A checkout from a different repository cannot satisfy the link.
            remotes = git(repo, 'remote', '-v')
            suffix = '/'.join(parts[:2])
            require(suffix in remotes.replace(':', '/'), 'link and checkout repository differ')
            require(commit == git(repo, 'rev-parse', 'HEAD'), 'link resolves to another checkout commit')
            return {'repository': 'https://github.com/' + suffix, 'requested_ref': ref,
                    'commit': commit, 'path': path}
    raise ValueError('ref/path not available locally; fetch the requested ref, then resolve it once')


def package(repo, directory):
    # An explicit native package path may live in a Project or user Workspace,
    # outside its separately pinned Harbor runtime checkout.
    root = Path(directory) if Path(directory).is_absolute() else inside(repo, directory)
    manifest = root / 'benchmark_config.toml'
    require(manifest.is_file() and not manifest.is_symlink(), 'invalid Benchmark manifest')
    data = tomllib.loads(manifest.read_text())
    require(data.get('status') not in ('draft', 'failed'), 'Benchmark is not published')
    data.setdefault('id', root.name)
    require(root.name == data['id'], 'Benchmark ID differs from package directory')
    cases = []
    for p in sorted(root.iterdir()):
        statement = p / 'statement/README.md'
        if not p.name.startswith('CASE-') or not p.is_dir():
            continue
        inside(root, p.relative_to(root))
        require(statement.is_file(), 'case has no native statement')
        require((p / 'rubric/README.md').is_file(), 'case has no native rubric')
        # Never return rubric bytes to a learner.
        cases.append({'case_id': p.name, 'statement': str(statement)})
    require(cases, 'empty Benchmark')
    return {'benchmark_id': data['id'], 'version': data.get('version'),
            'package_path': str(root), 'cases': cases}


def harbor_task(repo, case):
    text = Path(case['statement']).read_text()
    if '## How this case is run' not in text or 'harbor run' not in text:
        return {'kind': 'workspace', **case}
    blocks = re.findall(r'```(?:bash|sh)?\n(.*?)```', text, re.S)
    tokens = None
    for block in blocks:
        lines = block.replace('\\\n', ' ').splitlines()
        for line in lines:
            if 'harbor run ' in line:
                # Placeholders can contain spaces; source statement is never executed here.
                tokens = shlex.split(re.sub(r'<[^>]*>', 'PLACEHOLDER', line))
                break
    require(tokens is not None and '-p' in tokens, 'Harbor case has no unambiguous launch')
    path = inside(repo, tokens[tokens.index('-p') + 1])
    patterns = [tokens[i + 1] for i, x in enumerate(tokens[:-1]) if x in ('-i', '--task-name')]
    matches = ([path] if (path / 'task.toml').is_file() else
               [p for p in sorted(path.iterdir()) if p.is_dir() and (p / 'task.toml').is_file()
                and (not patterns or any(fnmatch.fnmatchcase(p.name, pat) for pat in patterns))])
    require(len(matches) == 1, 'one native Case must bind exactly one Harbor task')
    task = matches[0]
    raw = tomllib.loads((task / 'task.toml').read_text())
    options = dict(tokens[i + 1].split('=', 1) for i, t in enumerate(tokens[:-1])
                   if t == '--ak' and '=' in tokens[i + 1])
    return {'kind': 'harbor', **case, 'task_name': task.name, 'task_path': str(task),
            'limits': {'agent': raw.get('agent', {}), 'options': options},
            'launch_argv': tokens}


def gdpevo(repo, manifest):
    # PyYAML is already used by the benchmark converter; no grader is imported.
    import yaml
    path = inside(repo, manifest)
    value = yaml.safe_load(path.read_text())
    root = path.parent
    info = value['benchmark']
    train = package(repo, 'packages/' + info['train_package'])
    test = package(repo, 'packages/' + info['test_package'])
    run = value['training_run']
    continuous = inside(root, run['path'])
    require(len(train['cases']) == 1, 'continuous training must remain one native Case')
    training = harbor_task(repo, train['cases'][0])
    require(training['kind'] == 'harbor' and Path(training['task_path']) == continuous,
            'training package and manifest bind different tasks')
    workspace = continuous / 'environment/workspace'
    members = []
    for row in value['train_tasks']:
        public = inside(root, row['path'])
        require(public.is_relative_to(workspace), 'training input is outside public workspace')
        # /app is the GDPevo adapter's container mount convention, never a core rule.
        member = {'task_id': row['task_id'], 'task_name': row['task_name'],
                  'input_dir': '/app/' + str(public.relative_to(workspace))}
        members.append(member)
    require(len(members) == run['task_count'] and len({m['task_id'] for m in members}) == len(members),
            'training roster differs from manifest')
    declared = {str(inside(root, row['path'])): row for row in value['test_tasks']}
    tests = [harbor_task(repo, case) for case in test['cases']]
    require(len(tests) == len(declared), 'test package coverage differs from manifest')
    require({t.get('task_path') for t in tests} == set(declared), 'test Case/task mapping differs')
    for task in tests:
        source = declared[task['task_path']]
        require(task['task_name'] == source['task_name'], 'underlying test task name differs')
        task['member_id'] = source['task_id']
    method, route = run['feedback'].split(' ', 1)
    require(method == 'POST' and route.startswith('/'), 'unsupported training feedback transport')
    submission = run['submission']
    return {'adapter': 'gdpevo-continuous-v2', 'benchmark': info['id'],
            'source_manifest': str(path),
            'training_package': train, 'test_package': test,
            'training_case': training, 'test_cases': tests, 'members': members,
            'training_io': {'workspace': '/app', 'access_file': '/app/environment_access.md',
                            'answer_dir': submission + '/answers', 'skill_output': submission + '/skill',
                            'feedback_url': 'http://127.0.0.1:' + str(value['env']['port']) + route,
                            'feedback_route': route, 'answer_format': 'json-object'},
            'capabilities': {'continuous_session': True, 'original_solver_feedback': True,
                             'final_export': True, 'complete_live_rsi': True}}


def ordinary(repo, package_path):
    value = package(repo, package_path)
    cases = [harbor_task(repo, c) for c in value['cases']]
    kinds = {c['kind'] for c in cases}
    # A stock Harbor verifier runs after the solver/container closes. Re-reading
    # its trace in a fresh Agent would change Evo, so do not pretend it works.
    return {'adapter': 'native-cases-v1', 'benchmark': value['benchmark_id'],
            'training_package': value, 'cases': cases,
            'capabilities': {'evaluation': True, 'capture': True,
                             'original_solver_feedback': kinds == {'workspace'},
                             'complete_live_rsi': kinds == {'workspace'}},
            'limitation': None if kinds == {'workspace'} else
                'Post-exit Harbor verifier has no live original-Solver feedback channel. '
                'Frozen evaluation/export works; full Evo learning needs a declared live-feedback adapter.'}


def gdpevo_group_alias(requested):
    """Public group shorthand; the manifest, not a table of domains, binds it."""
    key = re.sub(r'[\s_-]', '', requested.lower()).removeprefix('gdpevo').removeprefix('taskgroup')
    return 'task_group_' + key if key.isascii() and key.isdigit() else None


def discover(repo, requested):
    require(isinstance(requested, str) and requested.strip(), 'name the requested Benchmark')
    manifests = sorted(Path(repo).glob('benchmarks/*/tasks/task_group.yaml'))
    normalized = requested.strip().lower().replace(' ', '')
    if normalized in ('gdpevo', 'gdpevo子集', 'gdpevosubset'):
        return [gdpevo(repo, str(p.relative_to(repo))) for p in manifests]
    matches = [p for p in manifests if normalized in (p.parents[1].name.lower(),)]
    if matches:
        return [gdpevo(repo, str(p.relative_to(repo))) for p in matches]
    for p in manifests:
        import yaml
        data = yaml.safe_load(p.read_text())['benchmark']
        if requested in (data['train_package'], data['test_package']):
            return [gdpevo(repo, str(p.relative_to(repo)))]
    path = 'packages/' + requested
    if inside(repo, path).is_dir():
        return [ordinary(repo, path)]
    raise ValueError('unknown Benchmark; select a published package or GDPevo domain')


def project_package(project, source):
    """Locate the installed Project package."""
    directory = Path(project) / 'benchmarks' / source['benchmark_id']
    ready = (directory / 'benchmark_config.toml').is_file()
    return {'ready': ready, 'reason': 'installed' if ready else 'not_imported',
            'benchmark_id': source['benchmark_id'], 'package_path': str(directory)}


def bootstrap(req, *, contracts=None, local_source=False):
    repo = Path(req['repo']).resolve()
    commit = None if local_source else pin(repo, req.get('ref', 'HEAD'))
    selected = req['benchmark']
    link = resolve_link(repo, selected) if selected.startswith('https://') else None
    if link:
        require(link['path'].startswith('packages/') and len(Path(link['path']).parts) == 2,
                'select a Benchmark package folder')
        selected = Path(link['path']).name
    contracts = discover(repo, selected) if contracts is None else contracts
    require(contracts, 'no matching Benchmark contract')
    selection=req.get('selected_benchmark')
    if selection:
        contracts=[c for c in contracts if selection in (c['benchmark'],c['training_package']['benchmark_id'])]
        require(len(contracts)==1, 'configured Benchmark selection is not in the discovered subset')
    split_missing=[]
    if len(contracts)>1:
        split_missing.append('GDPevo domain selection: this native controller binds one Benchmark; resolve the current selection or public experiment configuration')
    for contract in contracts:
        if contract['adapter'] != 'native-cases-v1':
            continue
        if contract.get('test_package'):
            require(contract['training_package']['benchmark_id'] != contract['test_package']['benchmark_id'],
                    'training and held-out Benchmark must differ')
            def execution_identity(case):
                return case['kind'], case.get('task_path', case['statement'])
            require(not {execution_identity(c) for c in contract['cases']} &
                    {execution_identity(c) for c in contract['test_cases']},
                    'training/test execution roster overlaps')
            continue
        if not req.get('test_benchmark'):
            split_missing.append('distinct held-out test Benchmark')
            continue
        heldout=discover(repo, req['test_benchmark'])
        require(len(heldout)==1 and heldout[0]['adapter']=='native-cases-v1', 'one compatible held-out Benchmark required')
        test=heldout[0]
        require(contract['training_package']['benchmark_id'] != test['training_package']['benchmark_id'],
                'training and held-out Benchmark must differ')
        def identity(case):
            return (case['kind'],case.get('task_path',case['statement']))
        require(not {identity(c)for c in contract['cases']} & {identity(c)for c in test['cases']},
                'training/test execution roster overlaps')
        contract['test_package']=test['training_package']
        contract['test_cases']=test['cases']
    require(type(req.get('runs', 3)) is int and req.get('runs', 3) > 0, 'test repeats must be a positive integer')
    runtime = req.get('runtime', {})
    missing = split_missing + [k for k in ('provider', 'model_id', 'thinking_level') if not runtime.get(k)]
    if not req.get('budget_usd') or not req.get('paid_authorized'):
        missing.append('current budget authorization')
    scope=req.get('budget_scope','total')
    require(scope in ('total','per-benchmark'), 'budget scope must be total or explicit per-benchmark')
    budget=req.get('budget_usd')
    if budget is not None:
        require(type(budget) in (int,float) and math.isfinite(budget) and budget>0, 'invalid authorized budget')
    allocations={c['benchmark']: (budget/len(contracts) if scope=='total' else budget)
                 for c in contracts} if budget else {}
    project = Path(req['project']).resolve()
    imports = [project_package(project, source) for c in contracts
               for source in (c['training_package'], c.get('test_package')) if source]
    return {'schema': 'evo-experiment-contract-v2', 'source_commit': commit,
            'source_kind': 'local-package' if local_source else 'git-checkout',
            'source_ref': link or req.get('ref', 'HEAD'), 'contracts': contracts, 'runtime': runtime,
            'budget_usd': budget, 'budget_scope': scope, 'budget_allocations':allocations,
            'authorized_total_usd':budget if scope=='total' else budget*len(contracts) if budget else None,
            'requested_benchmark':req['benchmark'], 'project':str(project),
            'paid_authorized': req.get('paid_authorized', False),
            'missing_inputs': missing, 'project_packages': imports,
            'capability_blockers': [{'benchmark': c['benchmark'], 'reason': c.get('limitation')}
                                    for c in contracts if not c['capabilities'].get('complete_live_rsi')],
            'ready': not missing and all(x['ready'] for x in imports)
                     and all(c['capabilities'].get('complete_live_rsi') for c in contracts),
            'algorithm': {'passes': 1, 'attempts_per_task': 1, 'compile_per_batch': 1,
                          'candidate_source': 'negative-original-solver', 'operations': ['ADD', 'MERGE', 'REVISE', 'SKIP'],
                          'limits': {'general': 5, 'topic': 5}, 'max_bytes': 16000,
                          'general_storage': 'description-only', 'test_repeats': req.get('runs', 3)},
            'model_calls': 0, 'dispatches': 0}



if __name__ == '__main__':
    import sys
    request = json.loads(Path(sys.argv[1]).read_text())
    result = bootstrap(request)
    destination = Path(request['output'])
    require(not destination.exists(), 'frozen contract already exists; reconcile it, never replace')
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'contract': str(destination),
                      'ready': result['ready'], 'missing_inputs': result['missing_inputs'],
                      'project_packages': result['project_packages']}, ensure_ascii=False))
