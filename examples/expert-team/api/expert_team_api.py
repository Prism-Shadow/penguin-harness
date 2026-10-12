"""专家团 API（P0）。

权限：读走登录（`require_api`，路由级挂）；写/运行走 `require_admin`
（生成类操作只有管理员，见出件口径——派工会调模型/Harness，与出件同级）。
归属：只看本公司（超管跨公司），分享来的专家可见可派工、不可改。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .. import auth, expert_team

router = APIRouter(prefix='/api/expert', tags=['expert'])


class AgentIn(BaseModel):
    name: str | None = None
    kind: str | None = 'expert'
    role: str | None = None
    persona: str | None = None
    system_prompt: str | None = None
    skills: list | None = None
    knowledge: list | None = None
    model_slot: int | None = None
    is_shared: int | None = None


class TeamIn(BaseModel):
    name: str | None = None
    host_id: int | None = None
    member_ids: list | None = None
    rules: str | None = None


class RunIn(BaseModel):
    goal: str = ''
    context: str = ''
    workspace: str = '/root/penguin'
    dry_run: int | None = 0
    attachments: list | None = None
    archive: int | None = 0


class AskIn(BaseModel):
    member_id: int = 0
    question: str = ''
    context: str = ''
    dry_run: int | None = 0


class RetryIn(BaseModel):
    member_id: int = 0
    goal: str = ''
    context: str = ''
    workspace: str = '/root/penguin'
    dry_run: int | None = 0
    attachments: list | None = None
    archive: int | None = 0


def _http(e: Exception) -> HTTPException:
    s = str(e)
    if isinstance(e, FileNotFoundError):
        return HTTPException(404, s)
    if isinstance(e, PermissionError):
        return HTTPException(403, s)
    if s.startswith('TEAM_MEMBER_BUSY'):
        return HTTPException(409, s)
    if s.startswith('TEAM_'):
        return HTTPException(400, s)
    if '在跑' in s:
        return HTTPException(409, s)
    return HTTPException(400, s[:300])


# ---------------- 专家 ----------------
@router.get('/agents')
def list_agents(user: dict = Depends(auth.require_api)):
    return {'agents': expert_team.list_agents(user)}


@router.post('/agents')
def create_agent(payload: AgentIn, user: dict = Depends(auth.require_admin)):
    try:
        return expert_team.create_agent(payload.model_dump(exclude_none=True), user)
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.get('/agents/{aid}')
def get_agent(aid: int, user: dict = Depends(auth.require_api)):
    d = expert_team.get_agent(aid, user)
    if not d:
        raise HTTPException(404, '专家不存在')
    return d


@router.patch('/agents/{aid}')
def update_agent(aid: int, payload: AgentIn, user: dict = Depends(auth.require_admin)):
    try:
        data = payload.model_dump(exclude_none=True)
        # 欠账#5：model_slot 显式 null 要透过去解绑（exclude_none 会把它吞掉）
        if 'model_slot' in payload.model_fields_set and payload.model_slot is None:
            data['model_slot'] = None
        return expert_team.update_agent(aid, data, user)
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.delete('/agents/{aid}')
def delete_agent(aid: int, user: dict = Depends(auth.require_admin)):
    try:
        return expert_team.delete_agent(aid, user)
    except Exception as e:      # noqa: BLE001
        raise _http(e)


# ---------------- 团 ----------------
@router.get('/teams')
def list_teams(user: dict = Depends(auth.require_api)):
    return {'teams': expert_team.list_teams(user)}


@router.post('/teams')
def create_team(payload: TeamIn, user: dict = Depends(auth.require_admin)):
    try:
        return expert_team.create_team(payload.model_dump(exclude_none=True), user)
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.get('/teams/{tid}')
def get_team(tid: int, user: dict = Depends(auth.require_api)):
    d = expert_team.get_team(tid, user)
    if not d:
        raise HTTPException(404, '团队不存在')
    d['members'] = [expert_team.get_agent(mid, user) or {'id': mid, 'missing': True}
                    for mid in d['member_ids']]
    return d


@router.patch('/teams/{tid}')
def update_team(tid: int, payload: TeamIn, user: dict = Depends(auth.require_admin)):
    try:
        return expert_team.update_team(tid, payload.model_dump(exclude_none=True), user)
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.delete('/teams/{tid}')
def delete_team(tid: int, user: dict = Depends(auth.require_admin)):
    try:
        return expert_team.delete_team(tid, user)
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.get('/teams/{tid}/jobs')
def team_jobs(tid: int, user: dict = Depends(auth.require_api)):
    if not expert_team.get_team(tid, user):
        raise HTTPException(404, '团队不存在')
    return {'jobs': expert_team.list_jobs(int(tid))}


@router.get('/teams/{tid}/runs')
def team_runs(tid: int, limit: int = 10, user: dict = Depends(auth.require_api)):
    """欠账#3：该团过往开团/重派（结论摘要随行，不用再翻任务中心）。"""
    try:
        return {'runs': expert_team.list_runs(int(tid), user, limit=max(1, min(int(limit), 50)))}
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.get('/teams/{tid}/archive')
def team_archive(tid: int, limit: int = 10, user: dict = Depends(auth.require_api)):
    """欠账#8：团队档案（全成功的结论归档，本公司可见）。"""
    try:
        return {'items': expert_team.list_archive(int(tid), user, limit=max(1, min(int(limit), 50)))}
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.get('/teams/{tid}/estimate')
def team_estimate(tid: int, user: dict = Depends(auth.require_api)):
    """欠账#9：开团预估（人数×单成员历史均用时）。"""
    try:
        return expert_team.estimate(int(tid), user)
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.get('/presets')
def presets(user: dict = Depends(auth.require_api)):
    """欠账#4：预置模板列表。"""
    return {'presets': expert_team.list_presets()}


@router.post('/presets/{key}/apply')
def apply_preset(key: str, user: dict = Depends(auth.require_admin)):
    """欠账#4：一键按模板建团。"""
    try:
        return expert_team.apply_preset(key, user)
    except Exception as e:      # noqa: BLE001
        raise _http(e)


# ---------------- 运行 ----------------
@router.post('/teams/{tid}/run')
def run_team(tid: int, payload: RunIn, user: dict = Depends(auth.require_admin)):
    if not str(payload.goal or '').strip():
        raise HTTPException(400, 'goal 不能为空')
    try:
        return expert_team.launch_team(int(tid), str(payload.goal), user,
                                       context=str(payload.context or ''),
                                       workspace=str(payload.workspace or '/root/penguin'),
                                       dry_run=bool(payload.dry_run),
                                       attachments=payload.attachments,
                                       archive=bool(payload.archive))
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.post('/teams/{tid}/members/retry')
def retry_member(tid: int, payload: RetryIn, user: dict = Depends(auth.require_admin)):
    """单成员重派：失败成员单独追派一次，不必整团重开（结果进任务中心）。"""
    if not str(payload.goal or '').strip():
        raise HTTPException(400, 'goal 不能为空')
    try:
        return expert_team.launch_retry(int(tid), int(payload.member_id), str(payload.goal), user,
                                        context=str(payload.context or ''),
                                        workspace=str(payload.workspace or '/root/penguin'),
                                        dry_run=bool(payload.dry_run),
                                        attachments=payload.attachments,
                                        archive=bool(payload.archive))
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.post('/ask')
def ask_member(payload: AskIn, user: dict = Depends(auth.require_admin)):
    if not str(payload.question or '').strip():
        raise HTTPException(400, 'question 不能为空')
    try:
        return expert_team.ask_sync(int(payload.member_id), str(payload.question), user,
                                    context=str(payload.context or ''),
                                    dry_run=bool(payload.dry_run))
    except Exception as e:      # noqa: BLE001
        raise _http(e)


@router.get('/ping')
def ping(user: dict = Depends(auth.require_api)):
    return {'ok': True}


class AutoReviewIn(BaseModel):
    on: int | None = 1


@router.get('/auto_review')
def auto_review_status(user: dict = Depends(auth.require_api)):
    """审改闭环总开关状态（默认开；专家团无前端页面，开关只走接口）。"""
    from .. import expert_autoreview as _auto
    return {'auto_review': _auto.auto_enabled()}


@router.put('/auto_review')
def set_auto_review(payload: AutoReviewIn, user: dict = Depends(auth.require_admin)):
    from .. import expert_autoreview as _auto
    return _auto.set_auto_enabled(bool(payload.on))


@router.post('/autoreview/term/{term_id}')
def trigger_autoreview(term_id: int, dry_run: int = 0,
                       user: dict = Depends(auth.require_admin)):
    """手动触发某要点的审改闭环（上传钩子没跑上时补跑）。"""
    from .. import expert_autoreview as _auto
    try:
        return _auto.launch(int(term_id), user, dry_run=bool(dry_run))
    except Exception as e:      # noqa: BLE001
        raise _http(e)
