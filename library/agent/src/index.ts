/**
 * The agent domain as a library package: the AgentConfig and Memory mechanisms and their
 * services (the Web App's Agent config, vault, skills/schedules prompt templates and Memory
 * tabs), the Agent package import/export/zip caps, the avatar plumbing and the API vocabulary.
 * One package, no server dependencies — the server imports these; nothing here imports the
 * server.
 */
export { AgentConfig, Memory } from "./contract.js";
export type { AgentPaths } from "./ports.js";
export {
  STATE_FILE,
  TMP_SUFFIX,
  isTempName,
  VAULT_BASENAME,
  isGitName,
  isLeftOut,
  isGitEntry,
} from "./agent-vocab.js";
export { AgentConfigService, maskApiKey } from "./agent-config-service.js";
export { MemoryService } from "./memory-service.js";
export {
  MAX_MEMORY_ARCHIVE_FILES,
  memoryTooLarge,
  zipMemoryArchive,
  parseMemoryArchive,
} from "./memory-archive.js";
export type { ImportedMemory, MemoryImportSet, MemoryNameRules } from "./memory-archive.js";
export {
  MAX_IMPORT_FILES,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_IMPORT_NAME_BYTES,
  parseTransferDocument,
} from "./memory-transfer-document.js";
export { exportAgent } from "./agent-export.js";
export type { AgentExportDeps } from "./agent-export.js";
export {
  MAX_PACKAGE_BYTES,
  MAX_UNPACKED_BYTES,
  MAX_ENTRIES,
  isAgentImport,
  isZip,
  zipTopDirectory,
  unpackAgentZip,
  readPackageTraces,
} from "./agent-zip.js";
export { agentAvatarRev, readAgentAvatar, writeAgentAvatar } from "./agent-avatar.js";
export {
  avatarFileRev,
  readAvatarFile,
  writeAvatarFile,
  parseAvatarDataUrl,
} from "./avatar-file.js";
export type { AvatarImage, StoredAvatar } from "./avatar-file.js";
export { AVATAR_MAX_CHARS } from "./types.js";
export type {
  VaultEntryInfo,
  VaultResponse,
  VaultEntryUpdate,
  VaultUpdateRequest,
  AgentModelConfigDto,
  AgentCompactionConfigDto,
  AgentMemoryConfigDto,
  AgentVaultConfigDto,
  AgentSkillsConfigDto,
  AgentSchedulesConfigDto,
  AgentHooksConfigDto,
  AgentConfigDto,
  AgentConfigResponse,
  AgentKernelUpdateResponse,
  AgentConfigUpdateRequest,
  AgentConfigView,
  MemoryScopeInfo,
  MemoryFolderFile,
  MemoryFileInfo,
  MemoryOverviewResponse,
  MemoryFilesResponse,
  MemoryFileResponse,
  MemoryTransferFile,
  MemoryScopeExport,
  MemoryImportMode,
  MemoryImportRequest,
  MemoryImportResponse,
  AgentArchiveQuery,
} from "./types.js";
