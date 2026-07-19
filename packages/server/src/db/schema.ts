/**
 * SQLite table-creation SQL.
 *
 * SQLite stores only indexes and aggregates: users / login sessions / Project authorization /
 * Agent & Session indexes / usage summaries / error records / UI preferences. Agent State,
 * Trace, and Workspace still follow the local directory-based storage rules.
 * Product not yet released: no migration branches — everything is CREATE IF NOT EXISTS, formed once.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  user_id             TEXT PRIMARY KEY,            -- 语义 id 即登录名：^[a-z][a-z0-9_-]{1,31}$
  password_hash       TEXT NOT NULL,               -- scrypt$N$r$p$salt$hash(base64)
  is_admin            INTEGER NOT NULL DEFAULT 0,  -- 内置 admin（启动时种子）为 1
  password_is_initial INTEGER NOT NULL DEFAULT 0,  -- 1=初始密码（种子/管理员设置）；本人改密后清 0
  created_at          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,               -- sha256(token) hex；cookie 只存原始 token
  user_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL                   -- 7 天滑动续期（剩余 <6 天则续满）
);
CREATE TABLE IF NOT EXISTS projects (
  project_id    TEXT PRIMARY KEY,            -- 目录名即 id；显示名在 project_config.toml
  owner_user_id TEXT NOT NULL REFERENCES users(user_id),
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (  -- 仅 member 授权关系；owner 不入此表
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS agents (           -- 索引；name/description 在 system_config.yaml
  project_id TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, agent_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  provider      TEXT NOT NULL,                     -- 会话模型的厂商分组（与 model_id 成对构成模型引用）
  model_id      TEXT NOT NULL,                     -- 上游模型 id（原样发给 AgentHub；禁止 <provider>/<id> 拼接）
  workspace     TEXT NOT NULL,
  approval_mode TEXT NOT NULL DEFAULT 'allow-all',   -- allow-all|deny-all|read-only|always-ask
  title         TEXT,                                -- 首次对话后由模型自动生成；NULL=未生成（前端显示「新对话」）
  archived_at   TEXT,                                -- 归档时刻；NULL=未归档（默认展示；归档后收进「已归档」）
  source        TEXT,                                -- 会话来源：NULL=用户创建 | schedule（定时任务）| subagent（子会话）
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                TEXT NOT NULL,
  date              TEXT NOT NULL,            -- 本地日期 yyyy-mm-dd（聚合键，与 Trace 日期目录同口径）
  project_id        TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  session_id        TEXT NOT NULL,            -- 顶层 Session（子会话消耗计入所属主 Session）
  origin_session_id TEXT,                     -- 直接来源子 Session（origin 链末项）；NULL=主会话
  provider          TEXT NOT NULL,            -- 厂商分组：与 model_id 成对构成归因键，聚合一律 GROUP BY provider, model_id
  model_id          TEXT NOT NULL,            -- 上游模型 id（与 provider 成对；同名 model_id 跨厂商分开聚合）
  cache_read        INTEGER NOT NULL,
  cache_write       INTEGER NOT NULL,
  output            INTEGER NOT NULL,
  total             INTEGER NOT NULL,         -- 取 token_usage.request（每 Request 一条）
  status            TEXT NOT NULL DEFAULT 'completed'  -- 请求结局：completed=成功（含 token）；其余=失败（0 token，供成功率）
);                                            -- 成本不落库：查询时按当前 pricing 实时折算
CREATE INDEX IF NOT EXISTS idx_usage_project_date ON usage_records(project_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_records(session_id);
CREATE TABLE IF NOT EXISTS error_records (     -- 服务端异常捕获（统计中心「异常」）
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  date       TEXT NOT NULL,            -- 本地日期 yyyy-mm-dd（与 usage_records 同口径）
  project_id TEXT,                     -- 可空：登录/注册、进程级异常没有 Project 上下文
  agent_id   TEXT,
  session_id TEXT,
  source     TEXT NOT NULL,            -- http | session | usage | title | subagent | process | llm | environment | schedule
  kind       TEXT NOT NULL,            -- expected（HttpError，业务 4xx）| unexpected（500/运行时）
  code       TEXT NOT NULL,            -- HttpError.code / internal / session_run_failed / ...
  status     INTEGER,                  -- HTTP 状态码；非 HTTP 来源为 NULL
  message    TEXT NOT NULL             -- 截断 500 字符（不存堆栈：堆栈只进日志）
);
CREATE INDEX IF NOT EXISTS idx_error_project_date ON error_records(project_id, date);
CREATE TABLE IF NOT EXISTS schedule_state (    -- 定时任务运行状态（文件是声明式意图，系统不写回）
  project_id      TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  name            TEXT NOT NULL,               -- 文件名（去 .toml）即标识
  creator_user_id TEXT,                        -- 创建者（API 创建时记；手编文件对账登记回退 Project owner）
  start_at_ms     INTEGER NOT NULL,            -- 定义身份：start_at 变更视为新任务实例，重置触发状态
  def_hash        TEXT NOT NULL,               -- 文件内容指纹：变更即清除失效标记（文件修改后重新生效）
  last_slot_ms    INTEGER,                     -- 已消化的最近应触发时刻（触发或跳过都推进；重启不重复触发）
  last_fired_at   TEXT,                        -- 最近实际发送时刻（展示用）
  fired_once      INTEGER NOT NULL DEFAULT 0,  -- 一次性任务已触发
  missed          INTEGER NOT NULL DEFAULT 0,  -- 一次性任务已错过（启动/登记对账标记，错过不补）
  invalid_reason  TEXT,                        -- 失效原因（如绑定 Session 已删除）；NULL 即正常
  PRIMARY KEY (project_id, agent_id, name)
);
CREATE TABLE IF NOT EXISTS ui_prefs (
  user_id    TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  prefs_json TEXT NOT NULL                    -- {theme?, lastProjectId?, ...} 自由 JSON
);
`;
