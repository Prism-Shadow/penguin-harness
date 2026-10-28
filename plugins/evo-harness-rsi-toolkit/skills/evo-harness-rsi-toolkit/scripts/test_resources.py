"""Resource preparation through public native packages; no API/model calls.

Given an installed package and one-sentence request, resolve its declared source
and existing settings. Cache once by commit; reject escaping URLs.
Given a new Workspace package path, use it without dataset-specific source code.
Given post-exit Harbor, expose launch configuration but refuse full RSI learning.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import benchmarks
import resources


class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'source'
        self.repo.mkdir()
        self.project = self.root / 'project'
        self.project.mkdir()
        self.url = 'https://github.com/fixture/resources'
        self.runtime = {'provider': 'fixture', 'model_id': 'no-model', 'thinking_level': 'max'}
        self.git('init', '-b', 'main')
        self.git('remote', 'add', 'origin', self.url + '.git')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args],
                                       stderr=subprocess.DEVNULL, text=True).strip()

    def commit(self):
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                 'commit', '-qm', 'synthetic source')
        return self.git('rev-parse', 'HEAD')

    def package(self, name, *, harbor=False, title=None):
        root = self.repo / 'packages' / name
        for kind in ('statement', 'rubric'):
            part = root / 'CASE-local' / kind
            part.mkdir(parents=True)
            (part / 'README.md').write_text('Public task' if kind == 'statement' else 'Private rubric')
        (root / 'benchmark_config.toml').write_text(
            f'id="{name}"\ntitle="{title or name}"\nstatus="published"\nversion="1"\nruns=1\n')
        if harbor:
            task = self.repo / 'tasks' / name
            task.mkdir(parents=True)
            (task / 'task.toml').write_text('[agent]\ntimeout_sec=600\nnetwork_mode="no-network"\n')
            (root / 'CASE-local/statement/README.md').write_text(
                f'- Task: `local` in {self.url}/tree/main/tasks/{name}\n'
                '## How this case is run\n```bash\n'
                f'harbor run -p tasks/{name} -a fixture:Agent -m <provider>/<model_id> '
                '--ak thinking=<level> -n 1 -k 1\n```\n')
        dest = self.project / 'benchmarks' / name
        shutil.copytree(root, dest)
        return dest

    def settings(self, **extra):
        config = {'runtime': self.runtime, 'budget_usd': 10, 'paid_authorized': True,
                  'resource_checkouts': {self.url: str(self.repo)}, **extra}
        (self.project / 'evo-experiment.json').write_text(json.dumps(config))

    def test_one_sentence_reads_existing_settings_and_reports_harbor_capability(self):
        self.package('custom-train', harbor=True, title='Custom Data-Train')
        self.commit(); self.settings()
        result = resources.prepare({'project': str(self.project),
                                    'prompt': '使用 Custom Data 进行 RSI，沿用本项目已有实验配置。'})
        self.assertFalse(result['ready'])
        self.assertEqual(result['plan']['runtime'], self.runtime)
        self.assertEqual(result['plan']['algorithm']['test_repeats'], 3)
        self.assertEqual(result['plan']['resource_lock'][0]['commit'], self.git('rev-parse', 'HEAD'))
        case = result['plan']['contracts'][0]['cases'][0]
        self.assertEqual(case['task_name'], 'custom-train')
        self.assertIn('harbor', case['launch_argv'])
        self.assertIn('original-Solver', result['plan']['capability_blockers'][0]['reason'])
        self.assertNotIn('Private rubric', json.dumps(result))
        self.assertEqual(result['dispatches'], 0)

    def test_new_workspace_path_uses_native_pair_without_git_or_code_changes(self):
        first = self.package('never-seen-training')
        second = self.package('never-seen-test')
        self.settings(test_benchmark=str(second))
        result = resources.prepare({'project': str(self.project), 'dataset': str(first)})
        self.assertTrue(result['ready'])
        self.assertIsNone(result['plan']['source_commit'])
        self.assertEqual(result['plan']['source_kind'], 'local-package')
        self.assertEqual(result['plan']['resource_lock'], [])
        self.assertEqual(result['plan']['contracts'][0]['test_package']['benchmark_id'], second.name)
        self.assertEqual(result['plan']['algorithm']['candidate_source'], 'negative-original-solver')

    @unittest.skipUnless(os.environ.get('EVO_BENCHMARK'), 'actual official source required')
    def test_024_aliases_bind_the_same_manifest_as_the_domain_name(self):
        source = Path(os.environ['EVO_BENCHMARK'])
        for package in (source / 'packages').glob('*gdpevo*'):
            shutil.copytree(package, self.project / 'benchmarks' / package.name)
        self.settings(resource_checkouts={'https://github.com/Prism-Shadow/penguin-harness-benchmark': str(source)})
        names = []
        for name in ('024', 'GDPevo 024', 'GDPevo DataAnalysis'):
            result = resources.prepare({'project': str(self.project), 'dataset': name})
            contracts = result['plan']['contracts']
            self.assertEqual(len(contracts), 1)
            names.append(contracts[0]['source_manifest'])
            self.assertEqual(contracts[0]['benchmark'], 'gdpevo-data-analysis')
            self.assertEqual(len(contracts[0]['members']), 5)
        self.assertEqual(len(set(names)), 1)
        with self.assertRaisesRegex(ValueError, 'shorthand'):
            resources.prepare({'project': str(self.project), 'dataset': 'GDPevo 999'})

    def test_ref_with_slashes_and_tag_resolve_to_actual_commit(self):
        self.package('plain', harbor=True); expected = self.commit()
        self.git('branch', 'feature/dataset'); self.git('tag', 'release/one')
        memo = {}; overrides = {self.url: str(self.repo)}
        for ref in ('main', 'feature/dataset', 'release/one'):
            record = resources.acquire(self.url + '/tree/' + ref + '/tasks/plain',
                self.root / 'cache', memo, overrides)
            self.assertEqual(record['commit'], expected)
            self.assertEqual(record['requested_ref'], ref)
            self.assertTrue((Path(record['checkout']) / record['path'] / 'task.toml').is_file())

    def test_missing_authorization_does_not_dispatch(self):
        self.package('plain', harbor=True); self.commit(); self.settings(paid_authorized=False)
        # Source discovery is permitted before authorization; no rubric text is returned.
        result = resources.prepare({'project': str(self.project), 'dataset': 'plain'})
        self.assertFalse(result['ready'])
        self.assertIn('current budget authorization', result['plan']['missing_inputs'])
        self.assertEqual(result['model_calls'], 0)

    def test_unsupported_source_urls_and_same_train_test_refused(self):
        for url in ('https://user:secret@github.com/x/y/tree/main/tasks/x',
                    'https://github.com/x/y/tree/main/../escape',
                    'https://github.com/x/y/tree/main%2Fescape/task', 'file:///tmp/repo'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                resources.source_link(url)
        first = self.package('local')
        self.settings(test_benchmark=str(first))
        with self.assertRaisesRegex(ValueError, 'must differ'):
            resources.prepare({'project': str(self.project), 'dataset': str(first)})


if __name__ == '__main__':
    unittest.main()
