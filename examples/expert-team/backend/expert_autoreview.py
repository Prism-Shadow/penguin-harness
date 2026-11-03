"""审改闭环：新标书入库后自动开评审团，缺口自动改，两轮封顶。

方向（用户 2026-10-12）：专家团不做前端展示，只做后台能力——后续功能（这里是
标书上传流水线）自动调用。页面上的开团/重派按钮是过渡形态，已拆除，保留 API
供自动化与脚本调用。

触发：`experience_api._upload_work` 收尾 → `maybe_launch(term_id, user)`。
  开关 `expert_auto_review`（默认开）；检查+起任务都是同步轻活（毫秒级），
  真正的评审跑在 `kind='expert_autoreview'` 后台任务里；任何失败只记日志，
  绝不掐断上传任务。

一轮 = 评审 + 改：
  审：bid-review 团（按公司常驻，首次自动按预置建）照 REVIEW 目标审要点表 vs 原文，
      缺口 = 评审结论 JSON + `score_item_gaps` 定性对账；
  改（只动确定性的）：无清单→rules 生成；缺条目→`add_item` 去重追加；
      要点表空白字段→记 leftover（不动原文抽取，不重跑 Harness 深析）。
有改动才复检第二轮；仍有缺口 → leftover 进日志，不再循环。
"""
from __future__ import annotations

import json
import logging

log = logging.getLogger(__name__)

SETTING_KEY = 'expert_auto_review'
MAX_ROUNDS = 2
REVIEW_KIND = 'expert_autoreview'

REVIEW_STEPS = [('review', '评审团审标书', 6), ('fix', '缺口自动改', 3),
                ('recheck', '复检', 3)]

REVIEW_GOAL = """请对这份标书做“要点表相对原文”的漏项评审。

## 项目
- 项目名称：{project_name}
- 项目编号：{project_no}
- 采购人：{buyer}
- 要点表 #{term_id}（{term_status}）

## 要点表摘要（供对照，不要只依赖它，结论以原文为准）
{term_block}

## 你的任务
对照招标文件原文，逐条核对：★实质性条款（缺即废标）、▲评分项（每个得分点一条）、
资格证明文件、保证金凭证，是否在要点表里都有、无错位。

## 输出要求
成员的 result 必须是 JSON 对象（不要只写散文）：
{{"ok": true/false, "checked": 核对过的条款数,
  "gaps": [{{"kind": "must|score|field", "item": "缺/错的条目名（≤40字）",
             "evidence": "原文依据（≤120字）"}}]}}
没有缺口就报 {{"ok": true, "checked": N, "gaps": []}}；拿不准的不列。"""


def auto_enabled() -> bool:
    """总开关（默认开）：关了之后上传不再自动评审，已有任务不受影响。"""
    try:
        from . import database
        return (database.get_setting(SETTING_KEY, '1') or '1').strip() != '0'
    except Exception:      # noqa: BLE001
        return True


def set_auto_enabled(on: bool) -> dict:
    from . import database
    database.set_setting(SETTING_KEY, '1' if on else '0')
    return {'auto_review': bool(on)}


def ensure_review_team(user: dict | None = None) -> dict:
    """本公司的常驻评审团：有就复用（按预置名找），没有就按 bid-review 预置建一个。"""
    from . import expert_team
    for t in expert_team.list_teams(user):
        if t.get('name') == expert_team.EXPERT_PRESETS['bid-review']['name']:
            return t
    return expert_team.apply_preset('bid-review', user)


def build_goal(term: dict) -> str:
    from . import responses
    return REVIEW_GOAL.format(
        project_name=term.get('project_name') or '（未提取）',
        project_no=term.get('project_no') or '（未提取）',
        buyer=term.get('buyer') or '（未提取）',
        term_id=term.get('id'), term_status=term.get('status') or '',
        term_block=responses._term_block(term))


def _extract_json_obj(text: str):
    """从成员回答里抠 JSON（成员输出是 {"result": ..., "evidence": ...}，result 里再包缺口）。"""
    try:
        from . import ph_bridge
        return ph_bridge._extract_json(text)
    except Exception:      # noqa: BLE001
        pass
    try:
        t = (text or '').strip()
        if t.startswith('```'):
            t = t.split('\n', 1)[-1]
            if t.endswith('```'):
                t = t[:-3]
        return json.loads(t[t.find('{'):t.rfind('}') + 1])
    except Exception:      # noqa: BLE001
        return None


def collect_gaps(member_results: list[dict]) -> list[dict]:
    """从成员回执里收缺口：result（dict 或 JSON 字符串）里的 gaps 数组；解析失败的忽略。"""
    gaps = []
    for r in member_results or []:
        if not r.get('ok'):
            continue
        data = _extract_json_obj(str(r.get('answer') or ''))
        if not isinstance(data, dict):
            continue
        res = data.get('result', data)
        if isinstance(res, str):
            try:
                res = json.loads(res)
            except Exception:      # noqa: BLE001
                continue
        if not isinstance(res, dict):
            continue
        for g in res.get('gaps') or []:
            if not isinstance(g, dict) or not str(g.get('item') or '').strip():
                continue
            kind = str(g.get('kind') or '').strip().lower()
            gaps.append({'kind': kind if kind in ('must', 'score', 'field') else 'score',
                         'item': str(g['item']).strip()[:40],
                         'evidence': str(g.get('evidence') or '').strip()[:120],
                         'from': str(r.get('member') or '')})
    return gaps


def _infer_cat(gap: dict) -> str:
    """缺口→分册：00 编制说明不用（自动追加只进 01–04）。"""
    text = str(gap.get('item') or '') + str(gap.get('evidence') or '')
    if any(k in text for k in ('资格', '证书', '授权', '社保', '业绩', '证明文件')):
        return '02'
    if any(k in text for k in ('报价', '价格', '清单报价', '分项报价', '最高限价')):
        return '01'
    if any(k in text for k in ('付款', '工期', '保证金', '有效期', '商务', '售后', '质保')):
        return '03'
    return '04'


def apply_fixes(term: dict, plan: dict, gaps: list[dict]) -> dict:
    """缺口→改：缺条目去重追加；字段空白只记 leftover（不动抽取）。

    返回 {'added': [条目名], 'dup': [已有的], 'leftover': [gap]}。
    """
    from . import responses
    added, dup, leftover = [], [], []
    if not gaps:
        return {'added': added, 'dup': dup, 'leftover': leftover}
    # 条目名必须读库（传入的 plan 字典是旧快照，看不见上一轮刚加的——否则复检轮会重复追加）
    try:
        names = [str(i.get('name') or '') for i in responses.get_items(int(plan['id']))]
    except Exception:      # noqa: BLE001
        names = [str(i.get('name') or '') for i in (plan.get('items') or [])]
    for g in gaps:
        if g.get('kind') == 'field':
            leftover.append(g)
            continue
        name = str(g.get('item') or '').strip()
        if not name:
            continue
        if any(responses._is_dup_name(name, [n]) for n in names if n):
            dup.append(name)
            continue
        try:
            it = responses.add_item(int(plan['id']), {
                'cat': _infer_cat(g),
                'name': name[:40],
                'basis': str(g.get('evidence') or '')[:60] or '审改闭环评审发现',
                'kind': 'self',
                'required': 'must' if g.get('kind') == 'must' else 'score',
                'note': '审改闭环自动追加（评审缺口）'})
            names.append(name)
            added.append(str(it.get('name') or name))
        except Exception as e:      # noqa: BLE001
            log.warning('追加条目失败 %s: %s', name[:40], str(e)[:120])
            leftover.append({**g, 'fix_error': str(e)[:120]})
    return {'added': added, 'dup': dup, 'leftover': leftover}


def _machine_gaps(term: dict) -> list[dict]:
    """定性对账缺口：评分项原文总分 vs 逐条解析——对不上是“分值悬空”，自动建不出条目，记 leftover 让人/模型回原文补。"""
    from . import responses
    out = []
    try:
        for g in responses.score_item_gaps(term):
            out.append({'kind': 'score', 'item': f"{g.get('label')}评分对账缺口",
                        'evidence': str(g.get('short') or '')[:120], 'from': 'machine',
                        'unfixable': True})
    except Exception as e:      # noqa: BLE001
        log.warning('评分对账失败：%s', str(e)[:120])
    return out


def run_autoreview(term_id: int, user: dict | None = None, *,
                   dry_run: bool = False, review_gaps: list | None = None,
                   progress=None) -> dict:
    """跑一轮审改闭环（同步；调用方负责套后台）。`review_gaps` 非空时跳过真评审（单测缝）。

    返回 {'ok', 'rounds', 'added', 'leftover', 'team_id', 'summary'}。
    ok 的含义：没有未处理的缺口（改完且复检通过，或本就无缺口）。
    """
    from . import expert_team, responses, tender_terms
    term = tender_terms.get_term(int(term_id))
    if not term:
        raise FileNotFoundError('要点表不存在')
    team = ensure_review_team(user)
    doc_path = ''
    try:
        if term.get('doc_id'):
            doc_path = tender_terms._doc_abs_path(term['doc_id']) or ''
    except Exception:      # noqa: BLE001
        pass
    atts = [{'path': doc_path, 'note': '招标文件原文，结论以它为准'}] if doc_path else []
    goal = build_goal(term)
    context = f"要点表 #{term.get('id')}（状态 {term.get('status') or ''}）的漏项评审"
    summary = {'term_id': int(term_id), 'team_id': int(team['id']), 'rounds': 0,
               'added': [], 'leftover': [], 'ok': True}
    sto = progress.log if progress else None

    def _review_round() -> list[dict]:
        if review_gaps is not None:
            return list(review_gaps)
        out = expert_team.run_team_sync(int(team['id']), goal, user, context=context,
                                        workspace='/root/penguin', progress=progress,
                                        dry_run=dry_run, attachments=atts)
        gaps = collect_gaps(out.get('results') or [])
        if sto:
            sto(f"评审结论：{len(gaps)} 条缺口（{out.get('summary') or ''}"[:200] + '）')
        return gaps

    for rnd in range(1, MAX_ROUNDS + 1):
        if progress:
            try:
                progress.start('review' if rnd == 1 else 'recheck',
                               f'第{rnd}轮评审…')
            except Exception:      # noqa: BLE001
                pass
        gaps = _review_round() + (_machine_gaps(term) if rnd == 1 else [])
        # 定性缺口不可自动改：只进 leftover，不计入“改动”（不触发复检）
        fixable = [g for g in gaps if not g.get('unfixable')]
        summary['rounds'] = rnd
        if not fixable:
            summary['leftover'] = gaps
            summary['ok'] = not gaps
            break
        if progress:
            try:
                progress.start('fix', f'自动改 {len(fixable)} 条缺口…')
            except Exception:      # noqa: BLE001
                pass
        plan = _plan_for(term, user)
        fixed = apply_fixes(term, plan, fixable)
        summary['added'].extend(fixed['added'])
        summary['leftover'] = fixed['leftover'] + [g for g in gaps if g.get('unfixable')]
        if sto:
            sto(f"自动改：新增 {len(fixed['added'])} 条，重复跳过 {len(fixed['dup'])} 条，"
                f"留待人工 {len(summary['leftover'])} 条")
        if not fixed['added']:
            break
        if progress:
            try:
                progress.done('fix', f"新增 {len(fixed['added'])} 条")
            except Exception:      # noqa: BLE001
                pass
    else:
        pass
    summary['ok'] = not summary['leftover']
    if progress:
        try:
            progress.done('recheck' if summary['rounds'] > 1 else 'review',
                          '无缺口' if summary['ok'] else f"剩余 {len(summary['leftover'])} 条待人工")
        except Exception:      # noqa: BLE001
            pass
    return summary


def _plan_for(term: dict, user: dict | None) -> dict:
    """该要点的清单计划：有就复用，没有就 rules 建一份（确定性，不调模型）。"""
    from . import responses
    from . import tenancy
    gid = tenancy.group_of(user)
    plan = responses.plan_for_term(int(term['id']), gid)
    if plan:
        return plan
    r = responses.generate(int(term['id']), mode='rules', group_id=gid)
    plan = responses.plan_for_term(int(term['id']), gid)
    if not plan:
        raise RuntimeError(f"清单生成失败：{str(r)[:160]}")
    return plan


def launch(term_id: int, user: dict | None = None, *, dry_run: bool = False) -> dict:
    """另起后台任务跑审改闭环（任务中心 kind='expert_autoreview'，可按 term 定位）。"""
    from . import tasks as _tasks

    def fn(p):
        return run_autoreview(int(term_id), user, dry_run=dry_run, progress=p)
    try:
        out = _tasks.start('expert_autoreview', f'审改闭环：要点表 #{int(term_id)}',
                           REVIEW_STEPS, fn, key=f'expert-autoreview-{int(term_id)}',
                           meta={'kind': REVIEW_KIND, 'term_id': int(term_id),
                                 'dry_run': bool(dry_run)},
                           units=1, unit_name='份标书')
    except RuntimeError as e:
        raise RuntimeError(f'该标书的评审在跑（{str(e)[:80]}）')
    return {'ok': True, 'task_id': out.get('task_id'), 'title': out.get('title')}


def maybe_launch(term_id: int, user: dict | None = None) -> dict:
    """上传收尾调用：开关开着就起任务，关着/起失败都只返回原因，绝不抛。"""
    try:
        if not auto_enabled():
            return {'ok': False, 'reason': 'auto_review closed'}
        return launch(int(term_id), user)
    except Exception as e:      # noqa: BLE001
        log.warning('自动评审发起失败 term=%s: %s', term_id, str(e)[:160])
        return {'ok': False, 'reason': str(e)[:160]}
