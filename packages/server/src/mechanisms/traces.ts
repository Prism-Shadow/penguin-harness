/**
 * The traces mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  SessionCategory,
  AgentTracesResponse,
  HistoryMessage,
  SessionContextParts,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceFileInfo,
  TraceImportResponse,
  TracePosition,
} from "../api/types.js";
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
  ForkTraceResult,
  MessagesPageRequest,
  MessagesPageResult,
} from "../services/trace-service.js";
import type { MessageCursor } from "../services/message-window.js";

/** TraceIndexStore: the mechanism TraceIndexRepo implements. */
@Interface()
export abstract class TraceIndexStore {
  abstract upsertFile(row: TraceFileRow): void;
  abstract updateFileSize(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
    sizeBytes: number,
  ): void;
  abstract getPageStats(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
  ): string | null;
  abstract setPageStats(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
    sizeBytes: number,
    pageStats: string,
  ): void;
  abstract deleteFile(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
  ): void;
  abstract listFilesByAgent(projectId: string, agentId: string): TraceFileRow[];
  abstract listFilesBySession(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): TraceFileRow[];
  abstract findAgentBySession(projectId: string, sessionId: string): string | null;
  abstract upsertSession(row: TraceSessionRow): void;
  abstract getSession(sessionId: string): TraceSessionRow | null;
  abstract listSessionsByAgent(projectId: string, agentId: string): TraceSessionRow[];
  abstract deleteBySession(sessionId: string): void;
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
}

/** TraceIndex: the mechanism TraceIndexService implements. */
@Interface()
export abstract class TraceIndex {
  abstract readonly counters: { gateStats: number; dirScans: number; headReads: number };
  abstract reconcileAgent(
    projectId: string,
    agentId: string,
    opts?: { force?: boolean },
  ): Promise<void>;
  abstract reconcileProject(projectId: string, opts?: { force?: boolean }): Promise<void>;
  abstract registerImportedFile(args: {
    projectId: string;
    agentId: string;
    sessionId: string;
    fileIndex: number;
    date: string;
    sizeBytes: number;
    records: OmniMessage[];
  }): void;
  abstract removeSession(projectId: string, agentId: string, sessionId: string): void;
  abstract removeAgent(projectId: string, agentId: string): void;
  abstract removeProject(projectId: string): void;
}

/** Traces: the mechanism TraceService implements. */
@Interface()
export abstract class Traces {
  abstract observeShardRead?: ((path: string) => void) | undefined;
  abstract deleteSessionTraces(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<void>;
  abstract readMessages(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<HistoryMessage[]>;
  abstract readMessagesPage(
    projectId: string,
    agentId: string,
    sessionId: string,
    req: MessagesPageRequest,
  ): Promise<MessagesPageResult>;
  abstract forkSessionTrace(
    projectId: string,
    agentId: string,
    sourceSessionId: string,
    position: TracePosition,
  ): Promise<ForkTraceResult>;
  abstract contextBreakdown(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<SessionContextParts>;
  abstract listTraceFiles(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<TraceFileInfo[]>;
  abstract readEvents(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
    offset: number,
    limit: number,
  ): Promise<TraceEventsResponse>;
  abstract analyze(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<TraceAnalysisResponse>;
  abstract agentTraces(
    projectId: string,
    agentId: string,
    paging: { offset: number; limit: number } | null,
    opts?: { category?: SessionCategory },
  ): Promise<AgentTracesResponse>;
  abstract readFileRaw(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<Buffer<ArrayBufferLike>>;
  abstract importTraceFile(
    projectId: string,
    agentId: string,
    content: string,
  ): Promise<TraceImportResponse>;
}
