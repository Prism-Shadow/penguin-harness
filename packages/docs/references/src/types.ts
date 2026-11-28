export type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "tag"; tag: string; text: string };

export interface ParsedDoc {
  doc: string[];
  docBlocks: DocBlock[];
}

export interface MemberItem {
  name: string;
  kind: "method" | "property";
  sig: string;
  doc: string[];
  docBlocks: DocBlock[];
  line: number;
}

export interface ParamItem {
  name: string;
  optional: boolean;
  type: string;
  defaultVal: string;
}

export interface UnionVariant {
  type: string;
  doc: string[];
  docBlocks: DocBlock[];
}

export type KernelExportKind = "decorator" | "function" | "class" | "interface" | "type_alias";

export interface KernelExport {
  name: string;
  slug: string;
  isTypeOnly: boolean;
  kind: KernelExportKind;
  sourceFile: string;
  file: string;
  line: number;
  importStmt: string;
  sig: string;
  doc: string[];
  docBlocks: DocBlock[];
  params: ParamItem[];
  returnType: string;
  members: MemberItem[];
  variants: UnionVariant[];
}

export type AreaKind = "server" | "cli" | "core" | "library" | "plugin" | "web" | "package";

export interface UseField {
  field: string;
  type: string;
  from: string | null;
  raw: string;
}

export interface ProvideField {
  field: string;
  type: string;
  raw: string;
}

export interface BindField {
  field: string;
  id: string;
  type: string;
  raw: string;
}

export interface NodeBase {
  name: string;
  slug: string;
  kind: "module" | "component";
  pkg: string;
  pkgSub: string;
  area: AreaKind;
  file: string;
  line: number;
  doc: string[];
  docBlocks: DocBlock[];
  children: string[];
  exports: string[];
  contributes: Record<string, unknown>;
  context: string | null;
  uses: UseField[];
  provides: ProvideField[];
  binds: BindField[];
  implements: string[];
  methods: MemberItem[];
  rawDecl: string;
  parents: ModuleRecord[];
}

export interface ResolvedChild {
  kind: "module" | "component" | "external";
  name: string;
  target: ModuleRecord | ComponentRecord | null;
  viaSlot?: string;
}

export interface ModuleRecord extends NodeBase {
  kind: "module";
  isRoot?: boolean;
  resolvedChildren: ResolvedChild[];
}

export interface ComponentRecord extends NodeBase {
  kind: "component";
  primaryParent: ModuleRecord | null;
  href: string;
}

export interface IfaceRecord {
  name: string;
  slug: string;
  pkg: string;
  pkgSub: string;
  area: AreaKind;
  file: string;
  line: number;
  doc: string[];
  docBlocks: DocBlock[];
  members: MemberItem[];
  rawDecl: string;
}

export interface SlotContributor {
  name: string;
  kind: "module" | "component";
  href: string;
  count: number;
  entries: unknown[];
  file: string;
  line: number;
}

export interface SlotRecord {
  key: string;
  slotsIface: string | null;
  prop: string;
  host: string;
  hostHref: string | null;
  pkg: string;
  area: AreaKind;
  file: string;
  line: number;
  data: string;
  code: string | null;
  doc: string[];
  docBlocks: DocBlock[];
  contributors: SlotContributor[];
}

export interface HttpEntry {
  id: string;
  prefix: string;
  auth: string;
  order: string | number;
  origin: string;
}

export interface HttpEndpoint {
  method: string;
  path: string;
  line: number;
  file?: string;
  mountPrefix?: string;
  auth?: string;
  entryId?: string;
}

export interface HttpContribRecord {
  cls: string;
  slug: string;
  kind: "module" | "component";
  nodeHref: string;
  pkg: string;
  file: string;
  line: number;
  doc: string[];
  docBlocks: DocBlock[];
  binds: BindField[];
  entries: HttpEntry[];
  endpoints: HttpEndpoint[];
}

export interface CliOption {
  flag: string;
  desc: string;
  required?: boolean;
  command?: string;
}

export interface CliCommandRecord {
  name: string;
  slug: string;
  id: string;
  slot: string;
  cls: string | null;
  nodeHref: string | null;
  pkg: string;
  file: string;
  line: number;
  brief: string;
  briefZh: string;
  doc: string[];
  docBlocks: DocBlock[];
  subcommands: string[];
  options: CliOption[];
}

export interface ExtractedData {
  repo: string;
  git: { sha: string; date: string; subject: string };
  modules: ModuleRecord[];
  components: ComponentRecord[];
  ifaces: IfaceRecord[];
  kernel: { exports: KernelExport[] };
  slots: SlotRecord[];
  httpContribs: HttpContribRecord[];
  cliCommands: CliCommandRecord[];
}

export interface VerifiedSample {
  key: string;
  doc: string;
  code: string;
  html: string;
  testFile: string;
  line: number;
  title?: string;
  assertions?: number;
  verified: boolean;
  error: string | null;
}

export interface VerifiedSamplesFile {
  generatedAt: string;
  gitSha?: string;
  sourceHash?: string;
  allPassed?: boolean;
  samples: Record<string, VerifiedSample>;
}
