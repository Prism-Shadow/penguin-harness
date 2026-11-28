import type { Root } from "hast";

export interface JsDocTagEntry {
  tag: string;
  name?: string;
  markdown: string;
}

export interface ParsedDoc {
  markdown: string;
  summary: string;
  tags: JsDocTagEntry[];
}

export interface ParamItem {
  name: string;
  optional: boolean;
  rest?: boolean;
  type: string;
  defaultVal: string;
}

export interface MemberItem {
  name: string;
  kind: "method" | "property";
  sig: string;
  params: ParamItem[];
  returnType: string;
  doc: ParsedDoc;
  line: number;
}

export interface UnionVariant {
  type: string;
  doc: ParsedDoc;
}

export interface UseField {
  field: string;
  type: string;
  typeRefs: string[];
  from: string | null;
  raw: string;
}

export interface ProvideField {
  field: string;
  type: string;
  typeRefs: string[];
  raw: string;
}

export interface BindField {
  field: string;
  id: string;
  type: string;
  typeRefs: string[];
  raw: string;
}

export type AreaKind = "server" | "cli" | "core" | "library" | "plugin" | "web" | "package";

export interface NodeBase {
  name: string;
  slug: string;
  pkg: string;
  pkgSub: string;
  area: AreaKind;
  file: string;
  line: number;
  doc: ParsedDoc;
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
  doc: ParsedDoc;
  members: MemberItem[];
  rawDecl: string;
}

export type KernelExportKind = "decorator" | "function" | "class" | "interface" | "type_alias";

export interface ExpandedOptionsInfo {
  paramName: string;
  defaultVal: string;
  typeName: string;
  typeSlug: string;
  members: MemberItem[];
}

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
  doc: ParsedDoc;
  params: ParamItem[];
  returnType: string;
  members: MemberItem[];
  variants: UnionVariant[];
  expandedOptions: ExpandedOptionsInfo | null;
  references: string[];
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
  doc: ParsedDoc;
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
  doc: ParsedDoc;
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
  doc: ParsedDoc;
  subcommands: string[];
  options: CliOption[];
}

export interface ExtractedData {
  repo: string;
  git: { sha: string; date: string; shortDate: string; subject: string };
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
  hast?: Root;
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
