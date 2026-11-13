"""专家团 P0–P2 + 优化1/3/4 + 欠账#1–#9 + 审改闭环验证（106 项）。

用法：TRACKER_DB=sqlite python3 scripts/verify_expert_team.py
- 强制 sqlite + 临时库文件（`/tmp/verify_expert_team.db`）：绝不碰生产 PG，
  也不用 `data/tracker.db` 这个陈旧文件（它缺历史迁移列，建表会倒在老语句上）；
- 全程 dry_run：不调模型、不建 Harness 会话。
"""
import os
import sys

assert os.environ.get('TRACKER_DB', '').strip().lower() == 'sqlite', \
    '必须 TRACKER_DB=sqlite 运行（防误碰生产 PG）'

sys.path.insert(0, '.')

from pathlib import Path as _Path

_TMP = _Path('/tmp/verify_expert_team.db')
if _TMP.exists():
    _TMP.unlink()
from app import config as _config

_config.DB_PATH = _TMP

PASSED, FAILED = 0, 0


def check(name, cond, extra=''):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f'  ✓ {name}')
    else:
        FAILED += 1
        print(f'  ✗ {name} {extra}')


def main():
    from app import database, expert_team
    database.init_db()
    user = {'id': 1, 'group_id': 0, 'role': 'admin', 'username': 'p0test'}
    tag = '__P0T__'
    created_agents, created_teams = [], []

    try:
        # —— 建表 ——
        with database.db() as conn:
            tables = {r['name'] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        check('expert_agents 表存在', 'expert_agents' in tables)
        check('expert_teams 表存在', 'expert_teams' in tables)

        # —— 专家 CRUD ——
        a = expert_team.create_agent({'name': f'{tag}商务', 'role': '商务组'}, user)
        created_agents.append(a['id'])
        check('创建专家', a.get('name') == f'{tag}商务' and a.get('kind') == 'expert')
        b = expert_team.create_agent({'name': f'{tag}技术', 'role': '技术组'}, user)
        created_agents.append(b['id'])
        h = expert_team.create_agent({'name': f'{tag}主持人', 'kind': 'team'}, user)
        created_agents.append(h['id'])
        check('创建主持人 kind=team', h.get('kind') == 'team')
        check('列表可见 3 个', len([x for x in expert_team.list_agents(user)
                                    if str(x.get('name') or '').startswith(tag)]) >= 3)
        u = expert_team.update_agent(a['id'], {'role': '商务组v2'}, user)
        check('更新专家', u.get('role') == '商务组v2')
        try:
            expert_team.create_agent({'name': '  '}, user)
            check('空名拒绝', False)
        except ValueError:
            check('空名拒绝', True)
        try:
            expert_team.create_agent({'name': f'{tag}x', 'kind': 'alien'}, user)
            check('非法 kind 拒绝', False)
        except ValueError:
            check('非法 kind 拒绝', True)

        # —— 团门禁 ——
        try:
            expert_team.create_team({'name': f'{tag}团', 'host_id': h['id'],
                                     'member_ids': [a['id']]}, user)
            check('成员<2 拒绝', False)
        except ValueError as e:
            check('成员<2 拒绝', 'TEAM_MEMBERS_TOO_FEW' in str(e))
        try:
            expert_team.create_team({'name': f'{tag}团', 'host_id': a['id'],
                                     'member_ids': [a['id'], b['id']]}, user)
            check('主持人须 kind=team', False)
        except ValueError as e:
            check('主持人须 kind=team', 'TEAM_MEMBER_INVALID' in str(e))
        try:
            expert_team.create_team({'name': f'{tag}团', 'host_id': h['id'],
                                     'member_ids': [a['id'], h['id']]}, user)
            check('主持人不许是成员', False)
        except ValueError as e:
            check('主持人不许是成员', 'TEAM_MEMBER_INVALID' in str(e))
        try:
            expert_team.create_team({'name': f'{tag}团', 'host_id': h['id'],
                                     'member_ids': [a['id'], a['id']]}, user)
            check('成员重复拒绝', False)
        except ValueError as e:
            check('成员重复拒绝', 'TEAM_MEMBER_INVALID' in str(e))
        h2 = expert_team.create_agent({'name': f'{tag}主持人2', 'kind': 'team'}, user)
        created_agents.append(h2['id'])
        try:
            expert_team.create_team({'name': f'{tag}团', 'host_id': h2['id'],
                                     'member_ids': [h['id'], a['id']]}, user)
            check('成员不能套娃', False)
        except ValueError as e:
            check('成员不能套娃', 'TEAM_MEMBER_INVALID' in str(e))
        try:
            expert_team.create_team({'name': f'{tag}团', 'host_id': h['id'],
                                     'member_ids': [a['id'], 999999]}, user)
            check('幽灵成员拒绝', False)
        except ValueError as e:
            check('幽灵成员拒绝', 'TEAM_MEMBER_INVALID' in str(e))

        t = expert_team.create_team({'name': f'{tag}团', 'host_id': h['id'],
                                     'member_ids': [a['id'], b['id']],
                                     'rules': '先商务后技术'}, user)
        created_teams.append(t['id'])
        check('建团成功', len(t.get('member_ids') or []) == 2)
        check('团列表含成员摘要', any(
            len(x.get('members') or []) == 2 for x in expert_team.list_teams(user)
            if x['id'] == t['id']))
        # —— 欠账#9a：无历史用先验（必须在任何派工落盘之前查，否则全局均值已污染） ——
        est0 = expert_team.estimate(t['id'], user)
        check('#9 无历史用先验', est0['samples'] == 0 and est0['est_seconds'] == 300 * est0['members'])

        # —— 改写纯函数 ——
        hs = expert_team.host_system(t, [a, b])
        check('主持人模板含成员名', a['name'] in hs and '只调度' in hs)
        check('P2 团准则进主持人模板', '先商务后技术' in hs)
        mt = expert_team.rewrite_for_member('列报价表', a, '项目X')
        check('成员任务书禁原样转发可独立执行',
              '项目X' in mt and '列报价表' in mt and '只输出一个 JSON' in mt)
        mt2 = expert_team.rewrite_for_member('列报价表', a, '项目X', rules='先商务后技术')
        check('P2 团准则注入成员任务书', '先商务后技术' in mt2 and '团准则' in mt2)
        ms = expert_team.member_system({'role': '商务组', 'system_prompt': '严谨',
                                        'skills': ['bid-response-doc'], 'knowledge': ['公司资料库']})
        check('P2 成员 system 声明技能与知识',
              '商务组' in ms and '严谨' in ms and 'bid-response-doc' in ms and '公司资料库' in ms)

        # —— 同步问 dry_run ——
        r = expert_team.ask_sync(a['id'], '保证金收不收？', user, dry_run=True)
        check('同步问演练', r.get('ok') and '保证金' in r.get('answer', ''))

        # —— 串行跑团 dry_run ——
        out = expert_team.run_team_sync(t['id'], '出一份投标要点核对', user,
                                        context='项目X', dry_run=True)
        check('跑团成功', out.get('ok') and len(out.get('results') or []) == 2)
        check('成员回调用 job_id 隔离',
              len({x.get('job_id') for x in out['results']}) == 2)
        check('主持人总结收工', '主持人总结' in out.get('summary', ''))
        check('在途清零（内存无 running）',
              all(j.get('status') != 'running' for j in expert_team.list_jobs(t['id'])))
        check('欠账#6 派工已落盘（done 进历史）',
              any(j.get('status') == 'done' and not j.get('live', True)
                  for j in expert_team.list_jobs(t['id'])))

        # —— P1 并行：3 成员演练，结果保序、job 隔离 ——
        c = expert_team.create_agent({'name': f'{tag}商务2', 'role': '商务组'}, user)
        created_agents.append(c['id'])
        t3 = expert_team.create_team({'name': f'{tag}三人团', 'host_id': h2['id'],
                                      'member_ids': [a['id'], b['id'], c['id']]}, user)
        created_teams.append(t3['id'])
        out3 = expert_team.run_team_sync(t3['id'], '并行演练', user, dry_run=True)
        check('P1 三成员并行全回', out3.get('ok') and len(out3.get('results') or []) == 3)
        check('P1 结果按编制保序',
              [r.get('member_id') for r in out3['results']] == [a['id'], b['id'], c['id']])
        check('P1 并发上限 3', expert_team.MAX_PARALLEL == 3)

        # —— P1 重试与失败回叫（mock run_session，不碰真模型） ——
        import app.ph_bridge as _ph
        real_run = _ph.run_session
        calls = {'n': 0}

        def _fail_once(prompt, **kw):
            calls['n'] += 1
            if calls['n'] == 1:
                return {'ok': False, 'reason': '模型侧抖动', 'model_error': True}
            if kw.get('on_session'):
                kw['on_session']('sess-retry-1')
            return {'ok': True, 'answer': '{"result": "重派后完成"}',
                    'session_id': 'sess-retry-1', 'model': 'mock'}
        _ph.run_session = _fail_once
        try:
            r1 = expert_team._dispatch_one(t, a, '重试演练', progress=None, dry_run=False)
        finally:
            _ph.run_session = real_run
        check('P1 失败自动重派一次后成功', r1.get('ok') and calls['n'] == 2, str(r1)[:120])

        def _always_fail(prompt, **kw):
            return {'ok': False, 'reason': '通道全挂', 'model_error': True}
        _ph.run_session = _always_fail
        try:
            from app import tasks as _tasks
            p = _tasks.Progress('expert_team', '重试耗尽演练',
                                [('dispatch', '派工', 8), ('synthesize', '总结', 2)])
            r2 = expert_team._dispatch_one(t, a, '必败演练', progress=p, dry_run=False)
        finally:
            _ph.run_session = real_run
        check('P1 重试耗尽记失败不抛', (not r2.get('ok')) and '通道全挂' in r2.get('reason', ''))
        check('P1 失败回叫进主持人 think',
              any(x.get('label') == '主持人' and '缺口' in x.get('text', '')
                  for x in p.thoughts))

        # —— P1 会话号隔离：成员会话只进 member_sessions，cancel 杀不到 ——
        def _ok_session(prompt, **kw):
            if kw.get('on_session'):
                kw['on_session']('sess-member-9')
            return {'ok': True, 'answer': '{"result": "好"}',
                    'session_id': 'sess-member-9', 'model': 'mock'}
        _ph.run_session = _ok_session
        try:
            p3 = _tasks.Progress('expert_team', '会话隔离演练',
                                 [('dispatch', '派工', 8), ('synthesize', '总结', 2)])
            # 合成也 mock（否则走真模型）：只验会话号隔离，不验合成文案
            import app.ai_helper as _ai
            real_chat = _ai.chat_complete_any
            _ai.chat_complete_any = lambda *a, **k: '【主持人总结·mock】无缺口，可收工。'
            try:
                out_iso = expert_team.run_team_sync(t['id'], '隔离演练', user,
                                                    progress=p3, dry_run=False)
            finally:
                _ai.chat_complete_any = real_chat
        finally:
            _ph.run_session = real_run
        check('P1 成员会话跑通且被记住',
              out_iso.get('ok') and len(p3.meta.get('member_sessions') or []) == 2,
              str(p3.meta)[:160])
        check('P1 meta.session_id 保持为空（cancel 杀不到成员）',
              not (p3.meta.get('session_id') or ''))

        # —— P1 停止只停主持人：已取消则不再派工 ——
        p4 = _tasks.Progress('expert_team', '停止演练',
                             [('dispatch', '派工', 8), ('synthesize', '总结', 2)])
        p4.cancel_requested = True
        out_stop = expert_team.run_team_sync(t['id'], '停止演练', user,
                                             progress=p4, dry_run=True)
        check('P1 取消后成员全 skipped',
              (not out_stop.get('ok')) and all(x.get('skipped') for x in out_stop['results']))
        check('P1 取消后总结指出缺口', '需追派' in out_stop.get('summary', ''))

        # —— P2 分享：别家只能看见 shared ——
        other = {'id': 2, 'group_id': 999, 'role': 'admin', 'username': 'other'}
        sh = expert_team.create_agent({'name': f'{tag}共享', 'role': '顾问',
                                       'is_shared': 1}, user)
        created_agents.append(sh['id'])
        check('P2 别家看得见 shared 专家',
              any(x['id'] == sh['id'] for x in expert_team.list_agents(other)))
        check('P2 别家看不见未分享专家',
              all(x['id'] != a['id'] for x in expert_team.list_agents(other)))
        try:
            expert_team.update_agent(a['id'], {'role': 'hack'}, other)
            check('P2 别家不能改我方专家', False)
        except PermissionError:
            check('P2 别家不能改我方专家', True)

        # —— 优化1：合成喂成员正文（mock chat，只验输入拼装） ——
        import app.ai_helper as _ai2
        real_chat2 = _ai2.chat_complete_any
        captured = {}

        def _cap(system, user, **kw):
            captured['user'] = user
            return 'MOCK总结'

        _ai2.chat_complete_any = _cap
        try:
            big = '结论甲' + 'x' * 5000
            s = expert_team.synthesize(
                t, '综合', [{'ok': True, 'member': '商务', 'answer': big},
                            {'ok': False, 'member': '技术', 'reason': '挂了'}])
        finally:
            _ai2.chat_complete_any = real_chat2
        check('优化1 合成喂成员正文', '结论甲' in captured.get('user', '') and s == 'MOCK总结')
        check('优化1 超长截断', '…（已截断）' in captured.get('user', ''))
        check('优化1 总量封顶 8000',
              len(captured.get('user', '')) <= 8000 + 600, str(len(captured.get('user', ''))))
        check('优化1 失败成员无正文区', captured.get('user', '').count('【') == 1)

        # —— 优化3a：prefer_slot 点名优先（mock 最底层 chat_complete） ——
        from app import database as _db
        _db.set_setting('ai_base_url', 'http://s1.local/v1')
        _db.set_setting('ai_model', 'model-one')
        _db.set_setting('ai_api_key', 'k1')
        _db.set_setting('ai_base_url_2', 'http://s2.local/v1')
        _db.set_setting('ai_model_2', 'model-two')
        _db.set_setting('ai_api_key2', 'k2')
        _db.set_setting('ai_api_key_2', 'k2')
        _ai2._LAST_GOOD_SLOT[0] = None
        real_cc = _ai2.chat_complete
        tried = []
        _ai2.chat_complete = lambda system, user, **kw: tried.append(kw.get('model')) or '好'
        try:
            _ai2.chat_complete_any('s', 'u', retries=1, prefer_slot=2)
            first_two = tried[0]
            tried.clear()
            _ai2._LAST_GOOD_SLOT[0] = None
            _ai2.chat_complete_any('s', 'u', retries=1, prefer_slot=99)
            first_missing = tried[0]
        finally:
            _ai2.chat_complete = real_cc
        check('优化3a prefer_slot 点名槽位优先', first_two == 'model-two', str(first_two))
        check('优化3a 幽灵槽位忽略走原序', first_missing == 'model-one', str(first_missing))

        # —— 优化3b：ask_sync 透传成员 model_slot ——
        expert_team.update_agent(b['id'], {'model_slot': 2}, user)
        got_kw = {}
        _ai2.chat_complete_any = lambda system, user, **kw: got_kw.update(kw) or '行'
        try:
            expert_team.ask_sync(b['id'], '在吗？', user, dry_run=False)
        finally:
            _ai2.chat_complete_any = real_chat2
        check('优化3b ask_sync 透传 model_slot', got_kw.get('prefer_slot') == 2, str(got_kw))

        # —— 优化4：单成员重派（后台 dry_run，轮询等收尾） ——
        import time as _time
        r_out = expert_team.launch_retry(t['id'], a['id'], '重派演练', user, dry_run=True)
        check('优化4 重派任务已发起', bool(r_out.get('task_id')))
        snap = {}
        for _ in range(50):
            _time.sleep(0.2)
            snap = _tasks.get(r_out['task_id']) or {}
            if not snap.get('running'):
                break
        check('优化4 重派后台完成', snap.get('result', {}).get('ok') is True,
              str(snap.get('result'))[:160])
        try:
            expert_team.launch_retry(t['id'], 999999, '编外演练', user, dry_run=True)
            check('优化4 编外成员拒绝', False)
        except ValueError as e:
            check('优化4 编外成员拒绝', 'TEAM_MEMBER_INVALID' in str(e))

        # —— 欠账#1：附件进任务书 ——
        mt3 = expert_team.rewrite_for_member('干活', a, '项目X', rules='',
                                            attachments=[{'path': '/d/招标文件.pdf', 'note': '只读第三章'},
                                                         '/d/清单.xlsx', '', 123])
        check('#1 附件列进任务书', '/d/招标文件.pdf' in mt3 and '只读第三章' in mt3
              and '/d/清单.xlsx' in mt3 and '输入材料' in mt3)
        norm = expert_team._clean_attachments(
            ['', None, 123, {'path': '  /x ', 'note': 'n'}] + [f'/f{i}' for i in range(20)])
        check('#1 附件归一化（去空/去非法/≤10）',
              len(norm) == 10 and norm[0] == {'path': '/x', 'note': 'n'}
              and norm[1] == {'path': '/f0', 'note': ''})
        out_att = expert_team.run_team_sync(t['id'], '附件演练', user, dry_run=True,
                                            attachments=[{'path': '/d/招标文件.pdf'}])
        check('#1 附件透传跑团', out_att.get('ok') and out_att.get('dispatched') == 2)

        # —— 欠账#7a：@强制指派（纯函数） ——
        ms2 = [{'id': 1, 'name': '商务组'}, {'id': 2, 'name': '技术组'}]
        check('#7a @点中只派给他',
              [m['id'] for m in expert_team.filter_by_mentions(ms2, '请 @商务组 出报价')] == [1])
        check('#7a @短名双向命中',
              [m['id'] for m in expert_team.filter_by_mentions(ms2, '请 @商务 出报价')] == [1])
        check('#7a 无命中全派', len(expert_team.filter_by_mentions(ms2, '请 @法务 看看')) == 2)
        check('#7a 无@全派', len(expert_team.filter_by_mentions(ms2, '大家都看看')) == 2)
        out_at = expert_team.run_team_sync(t['id'], f'请 @{a["name"]} 单独出', user, dry_run=True)
        check('#7a 整轮@只派一人', out_at.get('dispatched') == 1
              and out_at['results'][0]['member_id'] == a['id'])

        # —— 欠账#7b：嵌套校验（h3/nh/dh 都是没带过团的主持人，避免撞“一主持人一团”） ——
        nh = expert_team.create_agent({'name': f'{tag}裸主持', 'kind': 'team'}, user)
        created_agents.append(nh['id'])
        h3 = expert_team.create_agent({'name': f'{tag}主持人3', 'kind': 'team'}, user)
        created_agents.append(h3['id'])
        try:
            expert_team.create_team({'name': f'{tag}坏团', 'host_id': h3['id'],
                                     'member_ids': [nh['id'], b['id']]}, user)
            check('#7b 无团主持人不能入团', False)
        except ValueError as e:
            check('#7b 无团主持人不能入团', 'TEAM_MEMBER_INVALID' in str(e))
        try:
            expert_team.create_team({'name': f'{tag}重团', 'host_id': h['id'],
                                     'member_ids': [a['id'], b['id']]}, user)
            check('#7b 一主持人一团', False)
        except ValueError as e:
            check('#7b 一主持人一团', '只带一个团' in str(e))
        # 子团 S（成员全专家）→ 父团 P 挂子团主持人：合法
        sh = expert_team.create_agent({'name': f'{tag}子主持', 'kind': 'team'}, user)
        created_agents.extend([sh['id']])
        se1 = expert_team.create_agent({'name': f'{tag}子成员1', 'role': '甲'}, user)
        se2 = expert_team.create_agent({'name': f'{tag}子成员2', 'role': '乙'}, user)
        created_agents.extend([se1['id'], se2['id']])
        sub = expert_team.create_team({'name': f'{tag}子团', 'host_id': sh['id'],
                                       'member_ids': [se1['id'], se2['id']]}, user)
        created_teams.append(sub['id'])
        pt = expert_team.create_team({'name': f'{tag}父团', 'host_id': nh['id'],
                                      'member_ids': [sh['id'], a['id']]}, user)
        created_teams.append(pt['id'])
        check('#7b 嵌套建团合法', len(pt.get('member_ids') or []) == 2)
        out_nest = expert_team.run_team_sync(pt['id'], '嵌套演练', user, dry_run=True)
        check('#7b 嵌套演练全回', out_nest.get('ok'))
        check('#7b 子团答案是合成结论',
              any(r.get('nested') and '主持人总结' in r.get('answer', '')
                  for r in out_nest['results']))
        # 非扁平子团：父团已含子团主持人（非扁平），深团再挂父团主持人 = 太深
        dh = expert_team.create_agent({'name': f'{tag}深主持', 'kind': 'team'}, user)
        created_agents.append(dh['id'])
        try:
            expert_team.create_team({'name': f'{tag}深团', 'host_id': dh['id'],
                                     'member_ids': [nh['id'], se1['id']]}, user)
            check('#7b 非扁平子团拒绝', False)
        except ValueError as e:
            check('#7b 非扁平子团拒绝', 'TEAM_NEST_TOO_DEEP' in str(e))
        # 成环：把父团主持人塞进子团 → 改子团编制时判环（环先于扁平判定）
        try:
            expert_team.update_team(sub['id'], {'member_ids': [se1['id'], nh['id']]}, user)
            check('#7b 成环拒绝', False)
        except ValueError as e:
            check('#7b 成环拒绝', 'TEAM_CYCLE' in str(e))
        # 超深兜底：_depth=1 再派主持人 → 收敛成失败不掀桌
        r_deep = expert_team._dispatch_one(pt, {'id': sh['id'], 'name': sh['name'], 'kind': 'team'},
                                           '深演练', dry_run=True, _depth=1)
        check('#7b 超深收敛失败', (not r_deep.get('ok')) and 'TEAM_NEST_TOO_DEEP' in r_deep.get('reason', ''))

        # —— 欠账#5：model_slot 解绑 ——
        expert_team.update_agent(b['id'], {'model_slot': None}, user)
        check('#5 解绑后为 None', expert_team.get_agent(b['id'], user)['model_slot'] is None)

        # —— 欠账#6b：stale 判 interrupted ——
        with database.db() as conn:
            conn.execute(
                'INSERT INTO expert_jobs(job_id, team_id, host_id, member_id, member, status,'
                ' owner_group, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                ('stale-p0t', t['id'], h['id'], a['id'], a['name'], 'running', 0,
                 expert_team._BOOT - 100, expert_team._BOOT - 100))
        seen = [j for j in expert_team.list_jobs(t['id']) if j.get('job_id') == 'stale-p0t']
        check('#6 stale 标 interrupted', len(seen) == 1 and seen[0]['status'] == 'interrupted')
        with database.db() as conn:
            st = conn.execute("SELECT status FROM expert_jobs WHERE job_id='stale-p0t'").fetchone()
            conn.execute("DELETE FROM expert_jobs WHERE job_id='stale-p0t'")
        check('#6 中断写回库', st and st['status'] == 'interrupted')

        # —— 欠账#8：归档 ——
        out_arc = expert_team.run_team_sync(t['id'], '归档演练', user, dry_run=True, archive=True)
        check('#8 全成功归档', out_arc.get('archived_id'))
        arch = expert_team.list_archive(t['id'], user)
        check('#8 档案可查', any(x['goal'] == '归档演练' for x in arch))
        p5 = _tasks.Progress('expert_team', '归档反例', [('dispatch', '派工', 8)])
        p5.cancel_requested = True
        out_noarc = expert_team.run_team_sync(t['id'], '不归档演练', user, progress=p5,
                                              dry_run=True, archive=True)
        check('#8 失败不归档', out_noarc.get('archived_id') is None)

        # —— 欠账#9b：估时（专用新团：本团历史干净，均值断言不受别团干扰） ——
        et = expert_team.create_team({'name': f'{tag}估时团', 'host_id': h3['id'],
                                      'member_ids': [a['id'], b['id']]}, user)
        created_teams.append(et['id'])
        with database.db() as conn:
            for i in range(3):
                conn.execute(
                    'INSERT INTO expert_jobs(job_id, team_id, member_id, status, seconds,'
                    ' owner_group, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)',
                    (f'est-p0t-{i}', et['id'], a['id'], 'done', 100.0, 0,
                     expert_team._BOOT + 1, expert_team._BOOT + 1))
        est1 = expert_team.estimate(et['id'], user)
        check('#9 有历史用均值', est1['samples'] == 3 and est1['avg_seconds'] == 100.0)
        with database.db() as conn:
            conn.execute("DELETE FROM expert_jobs WHERE job_id LIKE 'est-p0t-%'")

        # —— 欠账#4：预置模板 ——
        check('#4 三套模板', len(expert_team.list_presets()) == 3)
        pt_team = expert_team.apply_preset('bid-review', user)
        created_teams.append(pt_team['id'])
        created_agents.append(pt_team['host_id'])
        created_agents.extend(pt_team['member_ids'])
        check('#4 一键建团', len(pt_team.get('member_ids') or []) == 3 and pt_team.get('rules'))
        try:
            expert_team.apply_preset('no-such', user)
            check('#4 幽灵模板拒绝', False)
        except FileNotFoundError:
            check('#4 幽灵模板拒绝', True)

        # —— 欠账#3：运行历史（重派 dry 任务已落 task_runs，用无归属口径查） ——
        runs = expert_team.list_runs(t['id'], None)
        check('#3 历史含重派任务', any(x.get('kind') == 'expert_retry' for x in runs))
        check('#3 历史带结论摘要', any(x.get('summary') for x in runs))
        try:
            expert_team.list_runs(t['id'], {'id': 9, 'group_id': 999, 'role': 'user'})
            check('#3 别家看不见', False)
        except FileNotFoundError:
            check('#3 别家看不见', True)
        # —— 审改闭环 ——
        from app import expert_autoreview as _ar
        check('审改 默认开', _ar.auto_enabled() is True)
        _ar.set_auto_enabled(False)
        check('审改 可关', _ar.auto_enabled() is False)
        check('审改 关了不发起', _ar.maybe_launch(12345, user).get('reason') == 'auto_review closed')
        _ar.set_auto_enabled(True)
        check('审改 可开', _ar.auto_enabled() is True)
        team_ar = _ar.ensure_review_team(user)
        created_teams.append(team_ar['id'])
        created_agents.append(team_ar['host_id'])
        created_agents.extend(team_ar['member_ids'])
        check('审改 常驻评审团（预置3成员）',
              len(team_ar.get('member_ids') or []) == 3 and team_ar.get('rules'))
        check('审改 复用不重建', _ar.ensure_review_team(user)['id'] == team_ar['id'])
        with database.db() as conn:
            cur = conn.execute(
                "INSERT INTO bid_tender_terms(group_id, status, project_name, buyer)"
                " VALUES(?,?,?,?)", (0, 'ok', f'{tag}项目', f'{tag}采购人'))
            artid = int(cur.lastrowid)
        goal = _ar.build_goal({'id': artid, 'project_name': 'P', 'project_no': 'N',
                               'buyer': 'B', 'status': 'ok'})
        check('审改 目标含缺口契约', 'gaps' in goal and 'must|score|field' in goal)
        gaps = _ar.collect_gaps([
            {'ok': True, 'member': '商务评审',
             'answer': '{"result": {"ok": false, "checked": 5, "gaps": ['
                       '{"kind": "must", "item": "保证金凭证", "evidence": "第3章"}]}, "evidence": {}}'},
            {'ok': True, 'member': '技术评审',
             'answer': '{"result": "{\\"ok\\": true, \\"gaps\\": [{\\"kind\\": \\"weird\\", '
                       '\\"item\\": \\"偏离表\\"}]}"}'},
            {'ok': True, 'member': '瞎说', 'answer': '今天天气不错'},
            {'ok': False, 'member': '掉线', 'reason': '挂了'}])
        check('审改 缺口收集（归一化+容错）',
              len(gaps) == 2 and gaps[0]['item'] == '保证金凭证'
              and gaps[1]['kind'] == 'score')
        check('审改 分册推断', _ar._infer_cat(gaps[0]) == '03' and _ar._infer_cat(gaps[1]) == '04')
        plan_ar = _ar._plan_for({'id': artid}, user)
        fx = _ar.apply_fixes({'id': artid}, plan_ar,
                             [{'kind': 'must', 'item': '保证金凭证', 'evidence': '第3章'},
                              {'kind': 'score', 'item': '系统等保测评报告', 'evidence': ''},
                              {'kind': 'field', 'item': '工期空白', 'evidence': ''}])
        check('审改 缺条目自动追加', len(fx['added']) == 2 and len(fx['leftover']) == 1)
        fx2 = _ar.apply_fixes({'id': artid}, plan_ar,
                              [{'kind': 'must', 'item': '保证金凭证', 'evidence': '第3章'}])
        check('审改 重名跳过不翻倍', fx2['added'] == [] and fx2['dup'] == ['保证金凭证'])
        out_ar = _ar.run_autoreview(
            artid, user, dry_run=True,
            review_gaps=[{'kind': 'must', 'item': '法人授权委托书', 'evidence': ''},
                         {'kind': 'field', 'item': '工期空白', 'evidence': ''}])
        check('审改 两轮封顶', out_ar['rounds'] == 2 and len(out_ar['added']) == 1)
        check('审改 字段空白进leftover', any(g['item'] == '工期空白' for g in out_ar['leftover'])
              and out_ar['ok'] is False)
        r_ar = _ar.launch(artid, user, dry_run=True)
        snap_ar = {}
        for _ in range(50):
            _time.sleep(0.2)
            snap_ar = _tasks.get(r_ar['task_id']) or {}
            if not snap_ar.get('running'):
                break
        check('审改 后台任务收尾', snap_ar.get('result', {}).get('ok') is True)
        with database.db() as conn:
            conn.execute('DELETE FROM bid_response_items WHERE plan_id=?',
                         (plan_ar['id'],))
            conn.execute('DELETE FROM bid_response_plans WHERE id=?', (plan_ar['id'],))
            conn.execute('DELETE FROM bid_tender_terms WHERE id=?', (artid,))
        import pathlib as _pl
        src = _pl.Path('app/api/experience_api.py').read_text(encoding='utf-8')
        check('审改 上传钩子存在', 'expert_autoreview' in src and 'maybe_launch' in src)
        from app.main import app
        paths = {r.path for r in app.routes if hasattr(r, 'path')}
        for p in ('/api/expert/agents', '/api/expert/teams',
                  '/api/expert/teams/{tid}/run', '/api/expert/teams/{tid}/members/retry',
                  '/api/expert/teams/{tid}/runs', '/api/expert/teams/{tid}/archive',
                  '/api/expert/teams/{tid}/estimate', '/api/expert/presets',
                  '/api/expert/auto_review', '/api/expert/autoreview/term/{term_id}',
                  '/api/expert/ask'):
            check(f'路由 {p}', any(str(p).replace('{tid}', '') in str(x) or x == p
                                   for x in paths), f'实有:{sorted(paths)[:5]}…'
                  if p not in str(paths) else '')
    finally:
        for tid in created_teams:
            try:
                expert_team.delete_team(tid, user)
            except Exception:
                pass
        for aid in created_agents:
            try:
                with database.db() as conn:
                    conn.execute('DELETE FROM expert_teams WHERE host_id=?', (aid,))
                expert_team.delete_agent(aid, user)
            except Exception:
                pass

    print(f'\n通过 {PASSED} / 失败 {FAILED}')
    return 1 if FAILED else 0


if __name__ == '__main__':
    sys.exit(main())
