/**
 * The traces mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { SessionCategory } from "../api/types.js";
import type { TraceFileRow, TraceSessionRow } from "../db/repos/trace-index.js";
import type {
  AbortPayload,
  ApprovalDecisionPayload,
  CompactionBeginPayload,
  CompactionEndPayload,
  ImageUrlPayload,
  InlineDataPayload,
  InlineThinkingPayload,
  McpConnectBeginPayload,
  McpConnectEndPayload,
  OmniMessage,
  OmniPayload,
  PartialTextPayload,
  PartialThinkingPayload,
  PartialToolCallOutputPayload,
  PartialToolCallPayload,
  RequestBeginPayload,
  RequestEndPayload,
  SessionMetaPayload,
  SubagentPayload,
  TextPayload,
  ThinkingPayload,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolCallPayload,
  ToolListReadyPayload,
} from "@prismshadow/penguin-core";
import type {
  AgentTracesResponse,
  HistoryMessage,
  SessionContextParts,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceFileInfo,
  TraceImportResponse,
  TracePosition,
} from "../api/types.js";
import type {
  ForkTraceResult,
  MessagesPageRequest,
  MessagesPageResult,
} from "../services/trace-service.js";
import type { MessageCursor } from "../services/message-window.js";

/** TraceIndexStore: the mechanism TraceIndexRepo implements. */
export abstract class TraceIndexStore extends Interface<{
  upsertFile(row: TraceFileRow): void;
  updateFileSize(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
    sizeBytes: number,
  ): void;
  getPageStats(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
  ): string | null;
  setPageStats(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
    sizeBytes: number,
    pageStats: string,
  ): void;
  deleteFile(projectId: string, agentId: string, sessionId: string, fileIndex: number): void;
  listFilesByAgent(projectId: string, agentId: string): TraceFileRow[];
  listFilesBySession(projectId: string, agentId: string, sessionId: string): TraceFileRow[];
  findAgentBySession(projectId: string, sessionId: string): string | null;
  upsertSession(row: TraceSessionRow): void;
  getSession(sessionId: string): TraceSessionRow | null;
  listSessionsByAgent(projectId: string, agentId: string): TraceSessionRow[];
  deleteBySession(sessionId: string): void;
  deleteByAgent(projectId: string, agentId: string): void;
  deleteByProject(projectId: string): void;
}>() {}

/** TraceIndex: the mechanism TraceIndexService implements. */
export abstract class TraceIndex extends Interface<{
  readonly counters: { gateStats: number; dirScans: number; headReads: number };
  reconcileAgent(projectId: string, agentId: string, opts?: { force?: boolean }): Promise<void>;
  reconcileProject(projectId: string, opts?: { force?: boolean }): Promise<void>;
  registerImportedFile(args: {
    projectId: string;
    agentId: string;
    sessionId: string;
    fileIndex: number;
    date: string;
    sizeBytes: number;
    records: OmniMessage[];
  }): void;
  removeSession(projectId: string, agentId: string, sessionId: string): void;
  removeAgent(projectId: string, agentId: string): void;
  removeProject(projectId: string): void;
}>() {}

/** Traces: the mechanism TraceService implements. */
export abstract class Traces extends Interface<{
  observeShardRead?: ((path: string) => void) | undefined;
  deleteSessionTraces(projectId: string, agentId: string, sessionId: string): Promise<void>;
  readMessages(projectId: string, agentId: string, sessionId: string): Promise<HistoryMessage[]>;
  readMessagesPage(
    projectId: string,
    agentId: string,
    sessionId: string,
    req: MessagesPageRequest,
  ): Promise<MessagesPageResult>;
  forkSessionTrace(
    projectId: string,
    agentId: string,
    sourceSessionId: string,
    position: TracePosition,
  ): Promise<ForkTraceResult>;
  contextBreakdown(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<SessionContextParts>;
  listTraceFiles(projectId: string, agentId: string, sessionId: string): Promise<TraceFileInfo[]>;
  readEvents(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
    offset: number,
    limit: number,
  ): Promise<TraceEventsResponse>;
  analyze(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<TraceAnalysisResponse>;
  agentTraces(
    projectId: string,
    agentId: string,
    paging: { offset: number; limit: number } | null,
    opts?: { category?: SessionCategory },
  ): Promise<AgentTracesResponse>;
  readFileRaw(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<Buffer<ArrayBufferLike>>;
  importTraceFile(
    projectId: string,
    agentId: string,
    content: string,
  ): Promise<TraceImportResponse>;
}>() {}
