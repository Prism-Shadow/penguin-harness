"""专家团框架 P0–P2：专家定义 + 团编制 + 同步问/异步派工（P1 起跨成员并行×3）。

设计见 `docs/专家团框架设计.md`。本模块只做三件事：
- 两表 CRUD（`expert_agents` / `expert_teams`，编制只存 JSON 数组）；
- 主持人任务书改写（纯函数，可单测）+ 成员任务书模板（含团准则注入）；
- 团任务执行：同步问（`ai_helper` 单次）+ 异步派工（每成员一次
  `ph_bridge.run_session`，跨成员并行、同一成员串行；合成走 `ai_helper` 短调用）。

执行面零新增：模型池、Harness 会话、进度/落库全复用现有模块。
`dry_run=True` 时不碰模型与 Harness，返回罐头输出，供验证脚本与无 key 环境用。

停止语义（P1）：取消只停主持人本轮——不再派新成员、在跑成员跑完照样回叫；
成员会话号记 `meta.member_sessions` 而**不是** `meta.session_id`，正是为了
`tasks.cancel` 不把成员会话一起中止（cancel 只杀 session_id 那一个）。
"""
from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger(__name__)

# P1 并发上限：Harness 模型池拥塞时空回复的教训（demo-gen 经验），派工并发卡 3
MAX_PARALLEL = 3

# 欠账#7：嵌套团最多 2 层（主持人→子团→专家）；子团在建团时就被要求是扁平的，
# 分派时再按 _depth 兜底，深了直接报错而不是递归到底。
MAX_NEST_DEPTH = 2

# 欠账#1：任务书附件上限（防任务书膨胀吃光上下文）
ATTACH_MAX = 10

# 欠账#6：进程启动时刻——读侧据此判定 stale 的 running 派工（updated_at 早于它即中断）
_BOOT = time.time()

EXPERT_STEPS = [('dispatch', '主持人派工给成员', 8), ('synthesize', '主持人收工总结', 2)]

HOST_SYSTEM = """你是{team}的主持人，只调度不亲自动手。
- 成员：{members}。专业工作必须派给成员，你只做改写任务书、派工、收工判定。
- 派工前先消化用户原话，改写成独立任务书（含背景/输入/输出格式/禁令），禁止原样转发。
- 一轮可并行派多人；@只代表优先级，不强制指派。
- 成员结果上墙后你做收工判定：够了就总结（不复述成员正文），不够就追派并说明缺什么。
- 用户新消息永远优先处理，即使成员还没回完。{rules}"""

MEMBER_TASK = """你是{member}（{role}）。
{team_rules}
## 背景
{background}

## 你的任务
{task}

## 输出要求
只输出一个 JSON 对象，不要解释、不要 markdown 代码块：
{{"result": "结论正文（逐条写全）", "evidence": {{"要点": "原文依据（≤120字）"}}}}
硬要求：逐条覆盖、不要编造没有的东西、拿不准就写"未提及"。"""

# 在途派工（进程内，重启即丢——与 Octop 第一版同口径；会话号另记任务 meta.member_sessions）
_JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()

# 同一成员串行：跨团同时派给同一专家时排队，不互撞
_MEMBER_LOCKS: dict[int, threading.Lock] = {}
_MEMBER_LOCKS_GUARD = threading.Lock()


def _member_lock(mid: int) -> threading.Lock:
    with _MEMBER_LOCKS_GUARD:
        return _MEMBER_LOCKS.setdefault(int(mid), threading.Lock())


class _SyncProgress:
    """把 Progress 的写操作串行化：并行派工时多个 worker 同时 think/log 也不会互撞。

    Progress 自身的 _touch 有节流 + 全异常兜底，多线程调也只是偶发写库冲突被吞掉；
    这里再加一把锁，保证同一时刻只有一个 worker 在写，过程流按派工顺序上墙。
    读操作（cancel_requested/id/meta）直接透传，不加锁。
    """

    def __init__(self, prog):
        self._prog = prog
        self._lock = threading.Lock()

    def __getattr__(self, name):
        return getattr(self._prog, name)

    def _call(self, name, *a, **k):
        with self._lock:
            return getattr(self._prog, name)(*a, **k)

    def log(self, msg):
        return self._call('log', msg)

    def think(self, msg, **k):
        return self._call('think', msg, **k)

    def start(self, key, detail=''):
        return self._call('start', key, detail)

    def done(self, key, detail=''):
        return self._call('done', key, detail)

    def skip(self, key, detail=''):
        return self._call('skip', key, detail)

    def remember_session(self, sid: str, member: str) -> None:
        """记成员 Harness 会话号：只进 `meta.member_sessions`，绝不碰 `meta.session_id`。

        Why：`tasks.cancel` 会中止 session_id 记的那个会话；团任务取消必须只停
        主持人、成员继续跑完回叫，所以成员会话号另起一个键，两边互不干扰。
        """
        with self._lock:
            try:
                from . import tasks as _tasks
                meta = dict(self._prog.meta or {})
                lst = list(meta.get('member_sessions') or [])
                lst.append({'member': str(member), 'session_id': str(sid)})
                self._prog.meta = {**meta, 'member_sessions': lst}
                _tasks._touch(self._prog, force=True)  # 同包内复用落库（note_session 会污染 session_id，不用它）
            except Exception:      # noqa: BLE001
                pass


# ---------------- 基础 ----------------

def _now() -> str:
    from .models import now_str
    return now_str()


def _gid(user: dict | None) -> int:
    from . import tenancy
    g = tenancy.group_of(user)
    return int(g) if g not in (None, '') else 0


def _is_cross(user: dict | None) -> bool:
    from . import tenancy
    try:
        return bool(tenancy.is_cross_group(user))
    except Exception:      # noqa: BLE001
        return False


def _loads_list(v, default=None):
    if isinstance(v, list):
        return v
    try:
        got = json.loads(v or '[]')
    except Exception:      # noqa: BLE001
        return default if default is not None else []
    return got if isinstance(got, list) else (default if default is not None else [])


def _decode_agent(row) -> dict:
    d = dict(row)
    d['id'] = int(d.get('id') or 0)
    d['skills'] = _loads_list(d.get('skills'))
    d['knowledge'] = _loads_list(d.get('knowledge'))
    return d


def _decode_team(row) -> dict:
    d = dict(row)
    d['id'] = int(d.get('id') or 0)
    d['host_id'] = int(d.get('host_id') or 0)
    d['member_ids'] = [int(x) for x in _loads_list(d.get('member_ids')) if str(x).isdigit()]
    return d


# ---------------- 专家 CRUD ----------------

def create_agent(data: dict, user: dict | None = None) -> dict:
    name = str(data.get('name') or '').strip()
    if not name:
        raise ValueError('专家名称不能为空')
    kind = str(data.get('kind') or 'expert').strip() or 'expert'
    if kind not in ('expert', 'team'):
        raise ValueError(f'kind 非法：{kind}（只收 expert/team）')
    from . import database
    with database.db() as conn:
        cur = conn.execute(
            'INSERT INTO expert_agents(name, kind, role, persona, system_prompt, skills, knowledge,'
            ' model_slot, owner_group, is_shared, created_at, updated_at)'
            ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            (name[:60], kind, str(data.get('role') or '')[:200],
             str(data.get('persona') or '')[:2000], str(data.get('system_prompt') or '')[:8000],
             json.dumps(_loads_list(data.get('skills')), ensure_ascii=False)[:4000],
             json.dumps(_loads_list(data.get('knowledge')), ensure_ascii=False)[:4000],
             data.get('model_slot'), _gid(user), 1 if data.get('is_shared') else 0,
             _now(), _now()))
        new_id = int(cur.lastrowid)
    # 提交后才能跨连接回读（with 块内未提交时新连接看不见，PG/sqlite 都一样）
    return get_agent(new_id, user, _cross_ok=True)


def get_agent(aid: int, user: dict | None = None, *, _cross_ok: bool = False) -> dict | None:
    from . import database
    with database.db() as conn:
        row = conn.execute('SELECT * FROM expert_agents WHERE id=?', (int(aid),)).fetchone()
    if not row:
        return None
    d = _decode_agent(row)
    if not _cross_ok and not _visible_agent(d, user):
        return None
    return d


def _visible_agent(d: dict, user: dict | None) -> bool:
    if _is_cross(user):
        return True
    g = _gid(user)
    return int(d.get('owner_group') or 0) == g or int(d.get('is_shared') or 0) == 1


def list_agents(user: dict | None = None) -> list[dict]:
    from . import database
    with database.db() as conn:
        rows = conn.execute('SELECT * FROM expert_agents ORDER BY id').fetchall()
    return [d for d in (_decode_agent(r) for r in rows) if _visible_agent(d, user)]


def update_agent(aid: int, data: dict, user: dict | None = None) -> dict:
    got = get_agent(aid, user, _cross_ok=True)
    if not got:
        raise FileNotFoundError('专家不存在')
    _check_owner(got, user)
    fields = {}
    for k in ('name', 'role', 'persona', 'system_prompt'):
        if data.get(k) is not None:
            fields[k] = str(data[k])
    for k in ('skills', 'knowledge'):
        if data.get(k) is not None:
            fields[k] = json.dumps(_loads_list(data.get(k)), ensure_ascii=False)
    if 'model_slot' in data:
        # 欠账#5：按键存在判定——显式 null = 解绑槽位（`is not None` 会吞掉解绑意图）
        fields['model_slot'] = data['model_slot']
    if data.get('is_shared') is not None:
        fields['is_shared'] = 1 if data['is_shared'] else 0
    if 'name' in fields and not fields['name'].strip():
        raise ValueError('专家名称不能为空')
    if not fields:
        return get_agent(aid, user, _cross_ok=True)
    fields['updated_at'] = _now()
    from . import database
    with database.db() as conn:
        conn.execute(f"UPDATE expert_agents SET {','.join(f'{k}=?' for k in fields)} WHERE id=?",
                     (*fields.values(), int(aid)))
    return get_agent(aid, user, _cross_ok=True)


def delete_agent(aid: int, user: dict | None = None) -> dict:
    got = get_agent(aid, user, _cross_ok=True)
    if not got:
        raise FileNotFoundError('专家不存在')
    _check_owner(got, user)
    busy = [j for j in _snapshot_jobs() if int(j.get('member_id') or 0) == int(aid)
            or int(j.get('host_id') or 0) == int(aid)]
    if busy:
        raise RuntimeError('TEAM_MEMBER_BUSY：该专家有在途派工，先等它跑完')
    from . import database
    with database.db() as conn:
        # 仍在某团编制里 → 拒绝（先改团再删人，避免团里剩幽灵 id）
        rows = conn.execute('SELECT id, member_ids FROM expert_teams').fetchall()
        for r in rows:
            if int(aid) in [int(x) for x in _loads_list(r['member_ids']) if str(x).isdigit()]:
                raise RuntimeError(f'该专家仍在专家团 #{r["id"]} 的编制里，先把它移出再删')
            if int(r and 0) == 0 and False:  # 占位，保持分支可读
                pass
        conn.execute('DELETE FROM expert_teams WHERE host_id=?', (int(aid),))
        conn.execute('DELETE FROM expert_agents WHERE id=?', (int(aid),))
    return {'ok': True, 'id': int(aid)}


def _check_owner(d: dict, user: dict | None) -> None:
    if _is_cross(user):
        return
    if int(d.get('owner_group') or 0) != _gid(user):
        raise PermissionError('只能维护本公司的专家')


# ---------------- 团 CRUD ----------------

def _team_of_host(host_id: int, owner_group: int | None = None) -> dict | None:
    """找某主持人名下的团（嵌套用；owner_group 给定时只认同公司的团）。"""
    from . import database
    with database.db() as conn:
        rows = conn.execute('SELECT * FROM expert_teams WHERE host_id=?',
                            (int(host_id),)).fetchall()
    cands = [_decode_team(r) for r in rows]
    if owner_group is not None:
        cands = [d for d in cands if int(d.get('owner_group') or 0) == int(owner_group)]
    return cands[0] if cands else None


def _team_closure(tid: int, user: dict | None) -> set[int]:
    """从该团出发、经“成员是某团主持人”边能到达的所有团 id（含自己），判环用。"""
    seen: set[int] = set()
    stack = [int(tid)]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        t = get_team(cur, user)
        if not t:
            continue
        for mid in t.get('member_ids') or []:
            m = get_agent(int(mid), user, _cross_ok=True)
            if m and _visible_agent(m, user) and m.get('kind') == 'team':
                sub = _team_of_host(int(m['id']), _gid(user))
                if sub and int(sub['id']) not in seen:
                    stack.append(int(sub['id']))
    return seen


def _check_members(member_ids: list[int], user: dict | None,
                   parent_tid: int | None = None) -> list[dict]:
    if len(member_ids) < 2:
        raise ValueError('TEAM_MEMBERS_TOO_FEW：创建团队至少 2 个成员（不含主持人）')
    if len(set(member_ids)) != len(member_ids):
        raise ValueError('TEAM_MEMBER_INVALID：成员重复')
    got = []
    for mid in member_ids:
        d = get_agent(int(mid), user, _cross_ok=True)
        if not d or not _visible_agent(d, user):
            raise ValueError(f'TEAM_MEMBER_INVALID：成员 #{mid} 不存在或不可见'
                             '（只能用自己家的 + 分享给自己的）')
        if d.get('kind') == 'team':
            # 欠账#7 嵌套：成员可以是子团主持人，但子团必须扁平（只能挂专家）且不能成环。
            # 先判环再判扁平：成环的双方必然都已非扁平，扁平先判会把环误报成“太深”。
            sub = _team_of_host(int(d['id']), _gid(user))
            if not sub:
                raise ValueError(f'TEAM_MEMBER_INVALID：#{mid} 是主持人但名下没有同公司的团，不能入团')
            if parent_tid and int(parent_tid) in _team_closure(int(sub['id']), user):
                raise ValueError('TEAM_CYCLE：这样挂会形成环（A 含 B、B 含 A），拒绝')
            for smid in sub.get('member_ids') or []:
                sm = get_agent(int(smid), user, _cross_ok=True)
                if not sm or not _visible_agent(sm, user) or sm.get('kind') == 'team':
                    raise ValueError('TEAM_NEST_TOO_DEEP：子团必须扁平（只能挂专家），最多嵌 2 层')
        got.append(d)
    return got


def create_team(data: dict, user: dict | None = None) -> dict:
    name = str(data.get('name') or '').strip()
    if not name:
        raise ValueError('团队名称不能为空')
    host = get_agent(int(data.get('host_id') or 0), user, _cross_ok=True)
    if not host:
        raise ValueError('TEAM_MEMBER_INVALID：主持人不存在')
    _check_owner(host, user)
    if host.get('kind') != 'team':
        raise ValueError('TEAM_MEMBER_INVALID：主持人必须是 kind=team 的专家')
    if _team_of_host(int(host['id']), _gid(user)):
        # 一个主持人只带一个团：否则子团按主持人解析会出现多义（_team_of_host 取首行不确定）
        raise ValueError('TEAM_MEMBER_INVALID：该主持人已主持一个团，一个主持人只带一个团')
    member_ids = [int(x) for x in _loads_list(data.get('member_ids')) if str(x).isdigit()]
    if int(host['id']) in member_ids:
        raise ValueError('TEAM_MEMBER_INVALID：主持人不能同时是成员')
    _check_members(member_ids, user)
    from . import database
    with database.db() as conn:
        cur = conn.execute(
            'INSERT INTO expert_teams(name, host_id, member_ids, rules, owner_group, created_at, updated_at)'
            ' VALUES(?,?,?,?,?,?,?)',
            (name[:60], int(host['id']), json.dumps(member_ids, ensure_ascii=False),
             str(data.get('rules') or '')[:8000], _gid(user), _now(), _now()))
        new_id = int(cur.lastrowid)
    return get_team(new_id, user, _cross_ok=True)


def get_team(tid: int, user: dict | None = None, *, _cross_ok: bool = False) -> dict | None:
    from . import database
    with database.db() as conn:
        row = conn.execute('SELECT * FROM expert_teams WHERE id=?', (int(tid),)).fetchone()
    if not row:
        return None
    d = _decode_team(row)
    if not _cross_ok and not _visible_team(d, user):
        return None
    return d


def _visible_team(d: dict, user: dict | None) -> bool:
    if _is_cross(user):
        return True
    return int(d.get('owner_group') or 0) == _gid(user)


def list_teams(user: dict | None = None) -> list[dict]:
    from . import database
    with database.db() as conn:
        rows = conn.execute('SELECT * FROM expert_teams ORDER BY id').fetchall()
    out = []
    for r in rows:
        d = _decode_team(r)
        if not _visible_team(d, user):
            continue
        d['members'] = [get_agent(mid, user, _cross_ok=True) or {'id': mid, 'missing': True}
                        for mid in d['member_ids']]
        out.append(d)
    return out


def update_team(tid: int, data: dict, user: dict | None = None) -> dict:
    got = get_team(tid, user, _cross_ok=True)
    if not got:
        raise FileNotFoundError('团队不存在')
    if not _visible_team(got, user):
        raise PermissionError('只能维护本公司的团队')
    from . import database
    fields = {}
    if data.get('name') is not None:
        if not str(data['name']).strip():
            raise ValueError('团队名称不能为空')
        fields['name'] = str(data['name'])[:60]
    if data.get('rules') is not None:
        fields['rules'] = str(data['rules'])[:8000]
    if data.get('member_ids') is not None:
        member_ids = [int(x) for x in _loads_list(data.get('member_ids')) if str(x).isdigit()]
        if int(got['host_id']) in member_ids:
            raise ValueError('TEAM_MEMBER_INVALID：主持人不能同时是成员')
        _check_members(member_ids, user, parent_tid=int(tid))
        busy_ids = {int(j.get('member_id') or 0) for j in _snapshot_jobs()
                    if int(j.get('team_id') or 0) == int(tid)}
        kicked = [m for m in got['member_ids'] if m not in member_ids and m in busy_ids]
        if kicked:
            raise RuntimeError(f'TEAM_MEMBER_BUSY：成员 #{kicked[0]} 有在途派工，不能移出')
        fields['member_ids'] = json.dumps(member_ids, ensure_ascii=False)
    if not fields:
        return get_team(tid, user, _cross_ok=True)
    fields['updated_at'] = _now()
    with database.db() as conn:
        conn.execute(f"UPDATE expert_teams SET {','.join(f'{k}=?' for k in fields)} WHERE id=?",
                     (*fields.values(), int(tid)))
    return get_team(tid, user, _cross_ok=True)


def delete_team(tid: int, user: dict | None = None) -> dict:
    got = get_team(tid, user, _cross_ok=True)
    if not got:
        raise FileNotFoundError('团队不存在')
    if not _visible_team(got, user):
        raise PermissionError('只能维护本公司的团队')
    if any(int(j.get('team_id') or 0) == int(tid) for j in _snapshot_jobs()):
        raise RuntimeError('TEAM_MEMBER_BUSY：该团有在途派工，先等它跑完')
    from . import database
    with database.db() as conn:
        conn.execute('DELETE FROM expert_teams WHERE id=?', (int(tid),))
    return {'ok': True, 'id': int(tid)}


# ---------------- 改写与装配（纯函数） ----------------

def host_system(team: dict, members: list[dict]) -> str:
    names = '、'.join(str(m.get('name') or m.get('id')) for m in members) or '（暂无成员）'
    rules = str(team.get('rules') or '').strip()
    rules_line = f'\n- 本团准则：{rules}' if rules else ''
    return HOST_SYSTEM.format(team=str(team.get('name') or '专家团'), members=names,
                              rules=rules_line)


def rewrite_for_member(goal: str, member: dict, context: str = '', rules: str = '',
                         attachments: list | None = None) -> str:
    """主持人改写：用户原话 → 给该成员的独立任务书。纯拼装，不调模型（P0）。

    rules：团准则（P2 起注入，成员照团的规矩办事）。
    attachments：欠账#1 输入材料 [{path, note}]，原样列进任务书“输入材料”一节，
    成员按绝对路径自取（读不到就在结论里写“未提及”，不许编）。
    """
    background = (str(context or '').strip() or '（无额外上下文，按通用口径做）')
    r = str(rules or '').strip()
    team_rules = f'## 团准则\n{r}\n' if r else ''
    atts = _clean_attachments(attachments)
    if atts:
        lines = '\n'.join(f"- `{a['path']}`" + (f"（{a['note']}）" if a['note'] else '')
                          for a in atts)
        team_rules += (f'## 输入材料\n以下文件与本任务相关，请先读再作答；'
                       f'读不到的在结论里写“未提及”，不许编造：\n{lines}\n')
    return MEMBER_TASK.format(member=str(member.get('name') or ''),
                              role=str(member.get('role') or '成员'),
                              team_rules=team_rules,
                              background=background,
                              task=str(goal or '').strip())


def _clean_attachments(items) -> list[dict]:
    """欠账#1：附件归一化——str 或 {path, note}，空路径/非法项丢弃，有效项超限截断。"""
    out = []
    for it in items or []:
        if len(out) >= ATTACH_MAX:
            break
        if isinstance(it, str):
            path, note = it.strip(), ''
        elif isinstance(it, dict):
            path, note = str(it.get('path') or '').strip(), str(it.get('note') or '').strip()
        else:
            continue
        if not path:
            continue
        out.append({'path': path[:500], 'note': note[:200]})
    return out


def filter_by_mentions(members: list[dict], goal: str) -> list[dict]:
    """欠账#7：`@成员名` 强制指派——goal 里 @ 到谁就只派给谁，无命中则全派。

    匹配口径：@ 后一段文本与成员名双向包含即中（“@商务组”命中“商务组”，
    “@商务”也命中“商务组”）；纯函数，可单测。
    """
    import re
    tokens = [t.strip() for t in re.findall(r'@([^\s@,，；;]+)', str(goal or '')) if t.strip()]
    if not tokens:
        return members
    hit = [m for m in members
           if any(t in str(m.get('name') or '') or str(m.get('name') or '') in t
                  for t in tokens)]
    return hit or members


def member_system(member: dict) -> str:
    """成员 system 拼装（P2）：人格/角色 + 挂载的 skill 名 + 知识范围声明。

    skill 与知识库的**内容**不由这里展开（出件时由各调用方按需取用，
    与 `ph_bridge.bid_skill_block` 的用法一致：读 skill 是为了用它的条目规范）；
    这里只声明「你有哪些牌」，避免每次同步问都背全文。
    """
    parts = [str(member.get('system_prompt') or '').strip()]
    if member.get('role'):
        parts.insert(0, f"你是{member['role']}。")
    if member.get('persona'):
        parts.append(f"风格：{member['persona']}")
    skills = [str(x) for x in (member.get('skills') or []) if str(x).strip()]
    if skills:
        parts.append('可用技能（用到时按技能规范办事）：' + '、'.join(skills[:20]))
    knows = [str(x) for x in (member.get('knowledge') or []) if str(x).strip()]
    if knows:
        parts.append('知识范围（优先按这些口径作答）：' + '、'.join(knows[:20]))
    return '\n'.join(x for x in parts if x)


# ---------------- 协作执行 ----------------

def _snapshot_jobs() -> list[dict]:
    with _LOCK:
        return list(_JOBS.values())


def list_jobs(team_id: int | None = None, history: int = 50) -> list[dict]:
    """在途（内存）+ 历史（落盘）合并：运行中在前。

    欠账#6：库里 `running` 但 `updated_at` 早于本进程启动时刻的，是上辈子没收尾的——
    读侧原地标 `interrupted`（成员 Harness 会话可能还活着，但编排侧已不再等它）。
    """
    mem = _snapshot_jobs()
    if team_id not in (None, ''):
        mem = [j for j in mem if int(j.get('team_id') or 0) == int(team_id)]
    out = [dict(j, live=True) for j in mem]
    try:
        from . import database
        with database.db() as conn:
            if team_id not in (None, ''):
                rows = conn.execute(
                    'SELECT * FROM expert_jobs WHERE team_id=? ORDER BY id DESC LIMIT ?',
                    (int(team_id), int(history))).fetchall()
            else:
                rows = conn.execute(
                    'SELECT * FROM expert_jobs ORDER BY id DESC LIMIT ?',
                    (int(history),)).fetchall()
        mem_ids = {str(j.get('job_id') or '') for j in mem}
        stale: list[str] = []
        for r in rows:
            d = dict(r)
            if str(d.get('job_id') or '') in mem_ids:
                continue
            if d.get('status') == 'running' and float(d.get('updated_at') or 0) < _BOOT:
                d['status'] = 'interrupted'
                stale.append(str(d.get('job_id') or ''))
            d['live'] = False
            d['started_at'] = d.get('created_at')
            out.append(d)
        if stale:
            try:
                with database.db() as conn:
                    for jid in stale:
                        conn.execute("UPDATE expert_jobs SET status='interrupted',"
                                     ' updated_at=? WHERE job_id=?', (time.time(), jid))
            except Exception:      # noqa: BLE001
                pass
    except Exception as e:      # noqa: BLE001
        log.warning('派工历史读取失败：%s', str(e)[:120])
    return out


def ask_sync(member_id: int, question: str, user: dict | None = None, *,
             context: str = '', dry_run: bool = False) -> dict:
    """同步问：阻塞等一次结果（短问用；不开 Harness 会话）。"""
    member = get_agent(int(member_id), user, _cross_ok=True)
    if not member or not _visible_agent(member, user):
        raise ValueError('成员不存在或不可见')
    if dry_run:
        return {'ok': True, 'member_id': int(member_id), 'member': member.get('name'),
                'answer': f"[{member.get('name')} 同步回复·演练] {str(question)[:120]}",
                'dry_run': True}
    from . import ai_helper
    system = member_system(member) or '你是团队里的专业成员，简明回答。'
    # 成员绑了 model_slot 就优先试那个槽位（失败照旧回退，不改变池子）；
    # Harness 派工走另一套模型池，不受 slot 影响（页面上有说明）。
    answer = ai_helper.chat_complete_any(system, f'{context}\n\n{question}' if context else question,
                                         prefer_slot=member.get('model_slot'))
    return {'ok': True, 'member_id': int(member_id), 'member': member.get('name'), 'answer': answer}


def _job_insert(job: dict, owner_group: int) -> None:
    """欠账#6：派工起手先落盘（内存 _JOBS 重启即丢，这里留痕供历史/估时用）。失败只记日志，不断派工。"""
    try:
        from . import database
        with database.db() as conn:
            conn.execute(
                'INSERT OR IGNORE INTO expert_jobs(job_id, team_id, host_id, member_id, member,'
                ' status, owner_group, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                (job['job_id'], job['team_id'], job['host_id'], job['member_id'],
                 str(job.get('member') or ''), 'running', int(owner_group or 0),
                 job.get('started_at') or time.time(), time.time()))
    except Exception as e:      # noqa: BLE001
        log.warning('派工落盘失败：%s', str(e)[:120])


def _job_update(job_id: str, **fields) -> None:
    try:
        from . import database
        cols = {k: v for k, v in fields.items()
                if k in ('status', 'session_id', 'model', 'chars', 'seconds', 'error')}
        if not cols:
            return
        cols['updated_at'] = time.time()
        with database.db() as conn:
            conn.execute(f"UPDATE expert_jobs SET {','.join(f'{k}=?' for k in cols)}"
                         ' WHERE job_id=?', (*cols.values(), job_id))
    except Exception as e:      # noqa: BLE001
        log.warning('派工更新失败：%s', str(e)[:120])


def _cancelled(progress) -> bool:
    try:
        return bool(getattr(progress, 'cancel_requested', False))
    except Exception:      # noqa: BLE001
        return False


def _dispatch_one(team: dict, member: dict, goal: str, *, context: str = '',
                  workspace: str = '/root/penguin', timeout: int = 900,
                  progress=None, dry_run: bool = False, retries: int = 1,
                  attachments: list | None = None, _depth: int = 0) -> dict:
    """派给一位成员并等回叫。同一成员串行（锁），失败自动重试 `retries` 次后走失败回叫。

    欠账#7：成员是子团主持人时转派子团（`_depth` 兜底，超深直接报错）。
    """
    if progress is not None and not isinstance(progress, _SyncProgress):
        progress = _SyncProgress(progress)
    with _member_lock(int(member['id'])):
        return _dispatch_one_locked(team, member, goal, context=context,
                                    workspace=workspace, timeout=timeout,
                                    progress=progress, dry_run=dry_run, retries=retries,
                                    attachments=attachments, _depth=_depth)


def _dispatch_one_locked(team: dict, member: dict, goal: str, *, context: str = '',
                         workspace: str = '/root/penguin', timeout: int = 900,
                         progress=None, dry_run: bool = False, retries: int = 1,
                         attachments: list | None = None, _depth: int = 0) -> dict:
    if _cancelled(progress):
        # 主持人已停止：不再派工（在跑的成员不受影响，跑完照样回叫——见 run_team_sync）
        return {'ok': False, 'skipped': True, 'job_id': '', 'member_id': int(member['id']),
                'member': member.get('name'), 'reason': '主持人已停止，不再派工',
                'dry_run': bool(dry_run)}
    if (member.get('kind') or 'expert') == 'team':
        # 子团转派自带 job 记账；这里的异常（超深/子团没了）收敛成该成员的失败，
        # 不掀翻整轮——与普通成员失败同口径。
        try:
            return _dispatch_subteam(team, member, goal, context=context, workspace=workspace,
                                     timeout=timeout, progress=progress, dry_run=dry_run,
                                     retries=retries, attachments=attachments, _depth=_depth)
        except Exception as e:      # noqa: BLE001
            return {'ok': False, 'job_id': '', 'member_id': int(member['id']),
                    'member': member.get('name'), 'reason': str(e)[:200],
                    'dry_run': bool(dry_run)}
    job_id = uuid.uuid4().hex[:12]
    job = {'job_id': job_id, 'team_id': int(team['id']), 'host_id': int(team.get('host_id') or 0),
           'member_id': int(member['id']), 'member': member.get('name'),
           'status': 'running', 'started_at': time.time()}
    with _LOCK:
        _JOBS[job_id] = job
    _job_insert(job, int(team.get('owner_group') or 0))
    try:
        prompt = rewrite_for_member(goal, member, context,
                                    rules=str(team.get('rules') or ''),
                                    attachments=attachments)
        if progress is not None:
            try:
                progress.log(f"已请 {member.get('name')} 处理，请稍候…")
            except Exception:      # noqa: BLE001
                pass
        if dry_run:
            answer = (f"[{member.get('name')} 派工回复·演练] 收到任务书 {len(prompt)} 字，"
                      f'结论：{{"result": "按 {member.get("role") or "分工"}口径完成", '
                      f'"evidence": {{"目标": "{str(goal)[:40]}"}}}}')
            session_id, model = '', 'dry_run'
        else:
            from . import ph_bridge
            holder: dict = {}

            def _on_session(sid: str) -> None:
                holder['sid'] = sid
                job['session_id'] = sid
                if progress is not None and hasattr(progress, 'remember_session'):
                    progress.remember_session(sid, str(member.get('name')))

            def _on_step(line: dict) -> None:
                if progress is not None:
                    try:
                        progress.think(line.get('text', ''), kind=line.get('kind', 'think'),
                                       label=line.get('label') or str(member.get('name')))
                    except Exception:      # noqa: BLE001
                        pass
            answer, session_id, model = '', '', ''
            attempt = 0
            while True:
                attempt += 1
                res = ph_bridge.run_session(prompt, workspace=workspace, timeout=timeout,
                                            progress=progress.log if progress else None,
                                            on_session=_on_session, on_step=_on_step)
                if res.get('ok'):
                    session_id = holder.get('sid') or res.get('session_id') or ''
                    model = res.get('model') or ''
                    answer = str(res.get('answer') or '')
                    break
                # run_session 内部已按模型池换过一轮；这里再给整步一次重跑机会，重跑完即止
                if attempt > int(retries):
                    raise RuntimeError(str(res.get('reason') or '成员会话失败')[:200])
                if progress is not None:
                    try:
                        progress.think(f"{member.get('name')} 第{attempt}次派工失败"
                                        f"（{str(res.get('reason') or '')[:100]}），主持人自动重派一次",
                                        kind='retry', label='主持人')
                    except Exception:      # noqa: BLE001
                        pass
        job.update(status='done', session_id=job.get('session_id') or session_id,
                   model=model, chars=len(answer),
                   seconds=round(time.time() - job['started_at'], 1))
        _job_update(job_id, status='done', session_id=job.get('session_id') or session_id,
                    model=model, chars=len(answer),
                    seconds=round(time.time() - job['started_at'], 1))
        if progress is not None:
            try:
                progress.think(answer[:1200], kind='ok', label=str(member.get('name')))
            except Exception:      # noqa: BLE001
                pass
        return {'ok': True, 'job_id': job_id, 'member_id': int(member['id']),
                'member': member.get('name'), 'answer': answer,
                'session_id': job.get('session_id') or '', 'model': model,
                'dry_run': bool(dry_run)}
    except Exception as e:      # noqa: BLE001
        # 失败回叫：主持人记一笔缺口（含换谁/怎么追派由 synthesize 定），任务继续收口不断线
        job.update(status='failed', error=str(e)[:200],
                   seconds=round(time.time() - job['started_at'], 1))
        _job_update(job_id, status='failed', error=str(e)[:200],
                    seconds=round(time.time() - job['started_at'], 1))
        if progress is not None:
            try:
                progress.think(f"{member.get('name')} 派工失败，已记入缺口待追派：{str(e)[:160]}",
                               kind='warn', label='主持人')
            except Exception:      # noqa: BLE001
                pass
        return {'ok': False, 'job_id': job_id, 'member_id': int(member['id']),
                'member': member.get('name'), 'reason': str(e)[:200],
                'dry_run': bool(dry_run)}
    finally:
        with _LOCK:
            _JOBS.pop(job_id, None)


def _dispatch_subteam(team: dict, member: dict, goal: str, *, context: str = '',
                      workspace: str = '/root/penguin', timeout: int = 900,
                      progress=None, dry_run: bool = False, retries: int = 1,
                      attachments: list | None = None, _depth: int = 0) -> dict:
    """欠账#7：成员是子团主持人→转派子团：逐个派给子团成员，再由子团口径合成一份答案。

    子团成员在建团时已验过“同公司+全专家+无环”，这里只做存在性复核；
    `_depth` 兜底（顶层 0，子团成员层 1），再深直接报错。
    """
    if int(_depth) >= MAX_NEST_DEPTH - 1:
        raise RuntimeError('TEAM_NEST_TOO_DEEP：最多嵌 2 层')
    sub = _team_of_host(int(member['id']), int(team.get('owner_group') or 0))
    if not sub:
        raise ValueError('TEAM_MEMBER_INVALID：子团不存在（主持人名下无同公司的团）')
    subs = []
    for smid in sub.get('member_ids') or []:
        sm = get_agent(int(smid), None, _cross_ok=True)
        if not sm:
            raise ValueError(f'TEAM_MEMBER_INVALID：子团成员 #{smid} 不存在')
        subs.append(sm)
    pseudo = {'id': int(sub['id']), 'host_id': int(member['id']),
              'name': f"{team.get('name') or ''}/{member.get('name') or ''}",
              'rules': sub.get('rules') or '', 'owner_group': team.get('owner_group') or 0}
    job_id = uuid.uuid4().hex[:12]
    job = {'job_id': job_id, 'team_id': int(team['id']), 'host_id': int(team.get('host_id') or 0),
           'member_id': int(member['id']), 'member': f"{member.get('name')}（子团）",
           'status': 'running', 'started_at': time.time()}
    with _LOCK:
        _JOBS[job_id] = job
    _job_insert(job, int(team.get('owner_group') or 0))
    try:
        if progress is not None:
            try:
                progress.log(f"已请子团 {member.get('name')} 处理（{len(subs)} 位成员），请稍候…")
            except Exception:      # noqa: BLE001
                pass
        # 子团内串行（规模小，且成员锁本来也会串行同人；这里保证子团口径按序收口）
        results = [_dispatch_one(pseudo, sm, goal, context=context, workspace=workspace,
                                 timeout=timeout, progress=progress, dry_run=dry_run,
                                 retries=retries, attachments=attachments,
                                 _depth=int(_depth) + 1) for sm in subs]
        summary = synthesize(pseudo, goal, results, dry_run=dry_run)
        if progress is not None:
            try:
                progress.think(summary[:1200], kind='ok', label=f"{member.get('name')}（子团）")
            except Exception:      # noqa: BLE001
                pass
        job.update(status='done', chars=len(summary),
                   seconds=round(time.time() - job['started_at'], 1))
        _job_update(job_id, status='done', chars=len(summary),
                    seconds=round(time.time() - job['started_at'], 1))
        if not all(r.get('ok') for r in results):
            return {'ok': False, 'job_id': job_id, 'member_id': int(member['id']),
                    'member': member.get('name'), 'nested': True, 'sub_results': results,
                    'reason': f"子团部分失败：{summary[:160]}",
                    'dry_run': bool(dry_run)}
        return {'ok': True, 'job_id': job_id, 'member_id': int(member['id']),
                'member': member.get('name'), 'nested': True, 'sub_results': results,
                'answer': summary, 'session_id': '', 'model': 'subteam',
                'dry_run': bool(dry_run)}
    except Exception as e:      # noqa: BLE001
        job.update(status='failed', error=str(e)[:200],
                   seconds=round(time.time() - job['started_at'], 1))
        _job_update(job_id, status='failed', error=str(e)[:200],
                    seconds=round(time.time() - job['started_at'], 1))
        if progress is not None:
            try:
                progress.think(f"子团 {member.get('name')} 派工失败，已记入缺口：{str(e)[:160]}",
                               kind='warn', label='主持人')
            except Exception:      # noqa: BLE001
                pass
        return {'ok': False, 'job_id': job_id, 'member_id': int(member['id']),
                'member': member.get('name'), 'nested': True, 'reason': str(e)[:200],
                'dry_run': bool(dry_run)}
    finally:
        with _LOCK:
            _JOBS.pop(job_id, None)


# 合成输入上限：成员正文每人最多这么多字，总量另有天花板（防长文吃光 max_tokens）
SYN_PER_MEMBER = 2000
SYN_TOTAL = 8000


def synthesize(team: dict, goal: str, results: list[dict], *, dry_run: bool = False,
               per_member: int = SYN_PER_MEMBER, total: int = SYN_TOTAL) -> str:
    """主持人收工总结：够了就总结（不复述成员正文），不够就指出缺口。

    优化 1（2026-10-12）：合成输入不再只是“✅/✗”简报——每位成功成员的正文
    按 `per_member` 截断、`total` 封顶后一起喂给模型，主持人能基于实质内容
    下结论，而不是只数人头。失败/skipped 成员只给原因行（没有正文可喂）。
    """
    oks = [r for r in results if r.get('ok')]
    fails = [r for r in results if not r.get('ok')]
    brief = '\n'.join(f"- {r.get('member')}：{'✅' if r.get('ok') else '✗ ' + str(r.get('reason') or '')[:80]}"
                      for r in results)
    if dry_run:
        head = f"【主持人总结·演练】{team.get('name')}：{len(oks)}/{len(results)} 位成员已回复。"
        tail = (f" 缺口：{', '.join(str(r.get('member')) for r in fails)} 需追派。" if fails
                else " 无缺口，可收工。")
        return head + f'\n{brief}' + tail
    from . import ai_helper
    system = ('你是专家团主持人。基于各成员的结论正文做收工判定与总结：'
              '先综合各成员结论给出最终结论（≤500字，逐条写清），再列缺口/追派清单；'
              '不要复述成员正文的证据细节，只引用结论。')
    excerpts, used = [], 0
    for r in oks:
        text = str(r.get('answer') or '').strip()
        if not text or used >= total:
            continue
        cut = text[:max(0, min(int(per_member), total - used))]
        used += len(cut)
        tail = '…（已截断）' if len(text) > len(cut) else ''
        excerpts.append(f"【{r.get('member')}】\n{cut}{tail}")
    user_text = (f"目标：{goal}\n成员结果：\n{brief}\n\n"
                 + ('成员结论正文：\n' + '\n\n'.join(excerpts) + '\n\n' if excerpts else '')
                 + '请判定是否收工：够了就给综合结论，不够就列追派清单。')
    return ai_helper.chat_complete_any(system, user_text, max_tokens=1500)


def run_team_sync(team_id: int, goal: str, user: dict | None = None, *,
                  context: str = '', workspace: str = '/root/penguin', timeout: int = 900,
                  progress=None, dry_run: bool = False,
                  attachments: list | None = None, archive: bool = False) -> dict:
    """团任务（P1 起跨成员并行×MAX_PARALLEL，同一成员串行）：派工 → 主持人总结。

    停止语义：取消只停主持人本轮——开工前已取消的成员记 skipped；在跑的成员
    不会被中止，跑完照样回叫并参与总结。调用方负责套后台任务。

    欠账#1 attachments：输入材料透传给每位成员的任务书。
    欠账#7：goal 里 `@成员名` 只派给被点中的人，无命中则全派。
    欠账#8 archive=True 且全员回复时，把结论归档进团队档案（失败不归档）。
    """
    team = get_team(int(team_id), user)
    if not team:
        raise FileNotFoundError('团队不存在')
    members = []
    for mid in team['member_ids']:
        m = get_agent(int(mid), user, _cross_ok=True)
        if not m or not _visible_agent(m, user):
            raise ValueError(f'TEAM_MEMBER_INVALID：成员 #{mid} 不存在或不可见')
        members.append(m)
    members = filter_by_mentions(members, goal)
    atts = _clean_attachments(attachments)
    wp = _SyncProgress(progress) if progress is not None else None
    if wp is not None:
        try:
            wp.start('dispatch', f'主持人派工给 {len(members)} 位成员…')
        except Exception:      # noqa: BLE001
            pass
    with ThreadPoolExecutor(max_workers=max(1, min(MAX_PARALLEL, len(members) or 1)),
                            thread_name_prefix='expert-dispatch') as ex:
        # map 保序：results[i] 对应 members[i]，总结与界面都按编制顺序展示
        results = list(ex.map(lambda m: _dispatch_one(
            team, m, goal, context=context, workspace=workspace,
            timeout=timeout, progress=wp, dry_run=dry_run,
            attachments=atts), members))
    if wp is not None:
        try:
            wp.done('dispatch', f'{sum(1 for r in results if r.get("ok"))}/{len(results)} 位已回复')
            wp.start('synthesize', '主持人收工总结…')
        except Exception:      # noqa: BLE001
            pass
    summary = synthesize(team, goal, results, dry_run=dry_run)
    archived_id = None
    if archive and results and all(r.get('ok') for r in results):
        try:
            archived_id = archive_run(int(team_id), goal, summary, results, user)
        except Exception as e:      # noqa: BLE001
            log.warning('归档失败：%s', str(e)[:120])
    if wp is not None:
        try:
            wp.done('synthesize', summary[:160])
            # 总结走 think（不止 log）：任务收尾的 result 白名单没有 summary，
            # think 进 thoughts 才能留在历史里，运行历史页靠它展示结论。
            wp.think(f'【主持人总结】{summary[:1000]}', kind='ok', label='主持人总结')
        except Exception:      # noqa: BLE001
            pass
    return {'ok': all(r.get('ok') for r in results), 'team_id': int(team_id),
            'team': team.get('name'), 'goal': goal, 'results': results,
            'summary': summary, 'dry_run': bool(dry_run),
            'dispatched': len(members), 'archived_id': archived_id}


def launch_team(team_id: int, goal: str, user: dict | None = None, *,
                context: str = '', workspace: str = '/root/penguin', timeout: int = 900,
                dry_run: bool = False, attachments: list | None = None,
                archive: bool = False) -> dict:
    """团任务（后台版）：进任务中心，kind='expert_team'。停止只停主持人本轮（成员会话不杀）。"""
    from . import tasks as _tasks
    team = get_team(int(team_id), user)
    if not team:
        raise FileNotFoundError('团队不存在')

    def fn(p):
        return run_team_sync(int(team_id), goal, user, context=context, workspace=workspace,
                             timeout=timeout, progress=p, dry_run=dry_run,
                             attachments=attachments, archive=archive)
    try:
        out = _tasks.start('expert_team', f"专家团 {team.get('name')}：{str(goal)[:40]}",
                           EXPERT_STEPS, fn, key=f'expert-team-{team_id}',
                           meta={'kind': 'expert_team', 'team_id': int(team_id), 'goal': goal,
                                 'dry_run': bool(dry_run), 'archive': bool(archive)},
                           units=len(team.get('member_ids') or []), unit_name='位成员')
    except RuntimeError as e:
        raise RuntimeError(f'已有团任务在跑（{str(e)[:80]}）')
    return {'ok': True, 'task_id': out.get('task_id'), 'title': out.get('title')}


RETRY_STEPS = [('dispatch', '主持人重派该成员', 8), ('synthesize', '重派小结', 2)]


def launch_retry(team_id: int, member_id: int, goal: str, user: dict | None = None, *,
                 context: str = '', workspace: str = '/root/penguin', timeout: int = 900,
                 dry_run: bool = False, attachments: list | None = None,
                 archive: bool = False) -> dict:
    """单成员重派（优化 4，后台版）：整团重开太贵，失败成员单独追派一次。

    结果进任务中心（kind='expert_retry'），与原团任务互不干扰；
    同一成员同时只重派一个（key 判重），成员锁照样串行。
    """
    from . import tasks as _tasks
    team = get_team(int(team_id), user)
    if not team:
        raise FileNotFoundError('团队不存在')
    if int(member_id) not in [int(x) for x in (team.get('member_ids') or [])]:
        raise ValueError('TEAM_MEMBER_INVALID：该成员不在本团编制里')
    member = get_agent(int(member_id), user, _cross_ok=True)
    if not member or not _visible_agent(member, user):
        raise ValueError('TEAM_MEMBER_INVALID：成员不存在或不可见')

    def fn(p):
        wp = _SyncProgress(p)
        wp.start('dispatch', f"主持人重派 {member.get('name')}…")
        res = _dispatch_one(team, member, goal, context=context, workspace=workspace,
                            timeout=timeout, progress=wp, dry_run=dry_run,
                            attachments=_clean_attachments(attachments))
        wp.done('dispatch', '已回复' if res.get('ok') else f"仍失败：{res.get('reason') or ''}"[:120])
        wp.start('synthesize', '重派小结…')
        summary = synthesize(team, goal, [res], dry_run=dry_run)
        if archive and res.get('ok'):
            try:
                archive_run(int(team_id), goal, summary, [res], user)
            except Exception as e:      # noqa: BLE001
                log.warning('归档失败：%s', str(e)[:120])
        wp.done('synthesize', summary[:160])
        wp.think(f'【重派小结】{summary[:1000]}', kind='ok', label='重派小结')
        return {'ok': res.get('ok'), 'member_id': int(member['id']), 'result': res,
                'summary': summary, 'dry_run': bool(dry_run)}
    try:
        out = _tasks.start('expert_retry', f"重派 {team.get('name')}/{member.get('name')}：{str(goal)[:30]}",
                           RETRY_STEPS, fn, key=f'expert-retry-{team_id}-{member_id}',
                           meta={'kind': 'expert_retry', 'team_id': int(team_id),
                                 'member_id': int(member_id), 'goal': goal,
                                 'dry_run': bool(dry_run)},
                           units=1, unit_name='位成员')
    except RuntimeError as e:
        raise RuntimeError(f'该成员的重派任务在跑（{str(e)[:80]}）')
    return {'ok': True, 'task_id': out.get('task_id'), 'title': out.get('title')}


# ---------------- 欠账#8：团队档案 ----------------

def archive_run(team_id: int, goal: str, summary: str, results: list[dict],
                user: dict | None = None) -> int:
    """把一次全成功的团结论归档进团队档案（按公司隔离）。

    为什么不写共享的 bid_experience：那张表没有公司隔离列，写进去就跨公司可见；
    团队档案只给本公司看，要进共享池请走经验库的人工录入。
    """
    from . import database
    brief = [{'member': str(r.get('member') or ''), 'ok': bool(r.get('ok')),
              'answer': str(r.get('answer') or '')[:1000]} for r in (results or [])]
    with database.db() as conn:
        cur = conn.execute(
            'INSERT INTO expert_run_archive(team_id, goal, summary, brief, owner_group, created_at)'
            ' VALUES(?,?,?,?,?,?)',
            (int(team_id), str(goal or '')[:2000], str(summary or '')[:8000],
             json.dumps(brief, ensure_ascii=False)[:20000], _gid(user), _now()))
        return int(cur.lastrowid)


def list_archive(team_id: int, user: dict | None = None, limit: int = 10) -> list[dict]:
    team = get_team(int(team_id), user)
    if not team:
        raise FileNotFoundError('团队不存在')
    from . import database
    with database.db() as conn:
        rows = conn.execute(
            'SELECT * FROM expert_run_archive WHERE team_id=? ORDER BY id DESC LIMIT ?',
            (int(team_id), int(limit))).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d['brief'] = json.loads(d.get('brief') or '[]')
        except Exception:      # noqa: BLE001
            d['brief'] = []
        out.append(d)
    return out


# ---------------- 欠账#3：运行历史 ----------------

def list_runs(team_id: int, user: dict | None = None, limit: int = 10) -> list[dict]:
    """该团在任务中心的过往开团/重派（读 task_runs，不新开表）。

    结论摘要从历史 thoughts 里捞（收尾 result 白名单没有 summary，总结走的是 think，
    见 run_team_sync）。可见性与任务中心同口径：超管看全部，其余只看自己发起的。
    """
    team = get_team(int(team_id), user)
    if not team:
        raise FileNotFoundError('团队不存在')
    from . import database, tenancy
    cross = tenancy.is_super_user(user)
    try:
        my_uid = tenancy.user_id_of(user)
    except Exception:      # noqa: BLE001
        my_uid = None
    with database.db() as conn:
        rows = conn.execute(
            "SELECT task_id, title, status, percent, started_at, finished_at, seconds,"
            " result, error, meta, user_id FROM task_runs"
            " WHERE kind IN ('expert_team','expert_retry') ORDER BY id DESC LIMIT 200").fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r['meta'] or '{}')
        except Exception:      # noqa: BLE001
            continue
        if int(meta.get('team_id') or 0) != int(team_id):
            continue
        row_uid = r['user_id'] if r['user_id'] not in (None, '') else None
        if not cross and row_uid != my_uid:
            continue
        try:
            res = json.loads(r['result'] or '{}')
        except Exception:      # noqa: BLE001
            res = {}
        summary = ''
        for th in (res.get('thoughts') or [])[::-1]:
            if th.get('label') in ('主持人总结', '重派小结'):
                summary = str(th.get('text') or '')[:300]
                break
        out.append({'task_id': r['task_id'], 'kind': meta.get('kind'), 'title': r['title'],
                    'status': r['status'], 'percent': r['percent'],
                    'started_at': r['started_at'], 'finished_at': r['finished_at'],
                    'seconds': r['seconds'], 'ok': res.get('ok'), 'summary': summary,
                    'error': (r['error'] or '')[:160]})
        if len(out) >= int(limit):
            break
    return out


# ---------------- 欠账#9：成本台账与估时 ----------------

# 无历史时的先验：单成员一次派工约 5 分钟（Harness 会话分钟级，取整）
EST_PRIOR_SECONDS = 300


def estimate(team_id: int, user: dict | None = None) -> dict:
    """开团预估：人数 × 单成员历史均用时（本团≥3 样本用本团，否则全局，否则先验 300s）。"""
    team = get_team(int(team_id), user)
    if not team:
        raise FileNotFoundError('团队不存在')
    n = len(team.get('member_ids') or [])
    avg, samples = float(EST_PRIOR_SECONDS), 0
    try:
        from . import database
        with database.db() as conn:
            row = conn.execute(
                "SELECT AVG(seconds) a, COUNT(*) c FROM expert_jobs"
                " WHERE team_id=? AND status='done' AND seconds>0",
                (int(team_id),)).fetchone()
            if row and int(row['c'] or 0) >= 3:
                avg, samples = float(row['a'] or EST_PRIOR_SECONDS), int(row['c'])
            else:
                row = conn.execute(
                    "SELECT AVG(seconds) a, COUNT(*) c FROM expert_jobs"
                    " WHERE status='done' AND seconds>0").fetchone()
                if row and int(row['c'] or 0) > 0:
                    avg, samples = float(row['a'] or EST_PRIOR_SECONDS), int(row['c'])
    except Exception as e:      # noqa: BLE001
        log.warning('估时读取失败：%s', str(e)[:120])
    return {'team_id': int(team_id), 'members': n, 'avg_seconds': round(avg, 1),
            'samples': samples, 'est_seconds': round(avg * max(n, 1), 1)}


# ---------------- 欠账#4：预置模板 ----------------

EXPERT_PRESETS = {
    'bid-review': {
        'name': '投标评审团', 'desc': '开标前自查：资质→商务→技术逐条过，实质性条款一条不漏',
        'rules': '先资质后商务再技术；★▲条款逐条给结论并标注依据；拿不准写“未提及”，不许编',
        'host': {'name': '评审主持人', 'role': '开标前总把关', 'persona': '严谨、逐条核对、不放过模糊表述'},
        'members': [
            {'name': '资质评审', 'role': '资格证明与证书审查',
             'system_prompt': '只审资格：一般资格/特定资格/证明文件清单，缺一件即废标风险。'},
            {'name': '商务评审', 'role': '商务条款与保证金审查',
             'system_prompt': '只审商务：保证金/有效期/付款/工期/★商务条款，逐条给通过与否。'},
            {'name': '技术评审', 'role': '技术方案与偏离表审查',
             'system_prompt': '只审技术：方案覆盖/偏离表/▲评分项，每条给满足度与补救建议。'},
        ],
    },
    'quote-check': {
        'name': '报价审查组', 'desc': '报价前后自查：核算→比价→风险，防废标价',
        'rules': '先算清再比价最后看风险；所有金额保留计算过程；最高限价是红线',
        'host': {'name': '报价主持人', 'role': '报价总把关', 'persona': '较真、每个数字都要有出处'},
        'members': [
            {'name': '报价核算', 'role': '分项报价核算',
             'system_prompt': '只管算：分项/总价/折扣/税费，过程列清，尾差标出来。'},
            {'name': '竞品比价', 'role': '市场比价分析',
             'system_prompt': '只管比：同类项目价格区间、我方分位、有没有明显偏离。'},
        ],
    },
    'tech-draft': {
        'name': '技术起草组', 'desc': '技术方案分工起草：架构→实施→售后',
        'rules': '三部分口径统一（同一系统只用一个名）；每部分先列提纲再写正文；交接处互相留接口',
        'host': {'name': '起草主持人', 'role': '技术方案统稿', 'persona': '重结构、零容忍前后矛盾'},
        'members': [
            {'name': '方案架构', 'role': '总体架构与技术路线',
             'system_prompt': '只写架构：总体设计/技术路线/关键指标，名词全文统一。'},
            {'name': '实施计划', 'role': '施工组织与进度计划',
             'system_prompt': '只写实施：组织/进度/里程碑/风险预案，时间可落地。'},
            {'name': '售后培训', 'role': '售后与培训方案',
             'system_prompt': '只写售后：质保/响应/巡检/培训，分级写清时限。'},
        ],
    },
}


def list_presets() -> list[dict]:
    return [{'key': k, 'name': v['name'], 'desc': v['desc'],
             'members': [m['name'] for m in v['members']]} for k, v in EXPERT_PRESETS.items()]


def apply_preset(key: str, user: dict | None = None) -> dict:
    """欠账#4：一键按模板建团（主持人+成员+团，走同一套校验）。"""
    p = EXPERT_PRESETS.get(str(key or ''))
    if not p:
        raise FileNotFoundError(f'模板不存在：{key}')
    host = create_agent({'name': p['host']['name'], 'kind': 'team',
                         'role': p['host'].get('role', ''),
                         'persona': p['host'].get('persona', '')}, user)
    mids = []
    for m in p['members']:
        d = create_agent({'name': m['name'], 'kind': 'expert', 'role': m.get('role', ''),
                          'system_prompt': m.get('system_prompt', '')}, user)
        mids.append(int(d['id']))
    return create_team({'name': p['name'], 'host_id': int(host['id']),
                        'member_ids': mids, 'rules': p.get('rules', '')}, user)
