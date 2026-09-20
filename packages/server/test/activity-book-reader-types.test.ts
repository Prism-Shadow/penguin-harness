import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import templates from "../src/activities/waf-templates.json" with { type: "json" };
import { bookReaderTemplate } from "../src/activities/book-reader-template.js";
import { bookReaderControllerTemplate } from "../src/activities/book-reader-controller-template.js";
import { bookReaderViewTemplate } from "../src/activities/book-reader-view-template.js";
import { bookReaderAdapterTemplate } from "../src/activities/book-reader-adapter-template.js";
import { bookReaderEntryTemplate } from "../src/activities/book-reader-entry-template.js";

const AMBIENT_WAF_STATE_MACHINE = String.raw`
declare module 'waf-state-machine' {
    export interface StateMachineEvent {
        readonly type: string;
        readonly [key: string]: unknown;
    }
    export type StateMachineParams = Readonly<Record<string, unknown>>;
    export interface ActivitySceneMetadata {
        readonly id: string;
        readonly description: string;
        readonly imageKeys: readonly string[];
        readonly videoKeys: readonly string[];
        readonly animationKeys: readonly string[];
        readonly audioKeys: readonly string[];
    }
    export interface SceneInteractable {
        dispose(): void;
    }
    export interface ActivityPubSub {
        publish(event: string, payload?: unknown): void;
        subscribe(event: string, listener: () => void): unknown;
    }
    export interface ActivityContext extends Record<string, unknown> {
        _activityPaused: boolean;
        activityState: unknown;
        assets: Record<string, unknown>;
        configuration: Record<string, unknown>;
        hydrateSelectedAssets: (keys: readonly string[]) => Promise<void>;
        pubSub: ActivityPubSub;
        root: HTMLElement;
        sceneCatalog: { scene(sceneId: string): ActivitySceneMetadata };
        theme: Record<string, unknown>;
        user: unknown;
        activeStage: ActivitySceneMetadata | null;
        activeStageId: string;
        activityFinished: boolean;
        backgroundAssetKey: string | null;
        hydratedAssetKeys: Record<string, boolean>;
        hydratingAssetKeys: Record<string, Promise<void>>;
        sceneElement: HTMLElement | null;
        sceneInteractables: SceneInteractable[];
        stageState: Record<string, Record<string, unknown>>;
    }
    export interface StateMachineActor<TContext extends object> {
        getSnapshot(): unknown;
        send(event: unknown): unknown;
        start(options?: { state?: string }): unknown;
        stop(): unknown;
        subscribe(subscriber: (snapshot: unknown) => void): () => void;
    }
    export interface StateMachineRuntime<TContext extends object> {
        getSnapshot(): unknown;
        setInteractive(interactive: boolean): void;
        send(event: unknown): unknown;
        readonly interactables: {
            register(element: Element, descriptor: unknown): unknown;
            list(): readonly unknown[];
            clear(): void;
        };
    }
    export interface StateMachineEffectArguments<TContext extends object> {
        readonly context: TContext;
        readonly event: { readonly type: string; readonly [key: string]: unknown };
        readonly send: (event: unknown) => unknown;
        readonly state: string;
        readonly onCancel: (cancel: () => void) => void;
        readonly signal: AbortSignal;
    }
    export type StateMachineAction<TContext extends object> = (
        argumentsValue: StateMachineEffectArguments<TContext>,
        params: StateMachineParams,
    ) => unknown | Promise<unknown>;
    export type StateMachineGuard<TContext extends object> = (
        argumentsValue: { readonly event: StateMachineEvent; readonly context: TContext },
        params: StateMachineParams,
    ) => boolean;
    export interface StateMachineImplementations<TContext extends object> {
        readonly actions?: Readonly<Record<string, StateMachineAction<TContext>>>;
        readonly guards?: Readonly<Record<string, StateMachineGuard<TContext>>>;
        readonly services?: Readonly<Record<string, (argumentsValue: StateMachineEffectArguments<TContext>) => unknown>>;
    }
    export function recordActivityMedia(
        data: unknown,
        kind: 'audio' | 'video' | 'animation',
        key: string,
        status: string,
        details?: { message: string },
    ): void;
    export function bootstrapStateMachine<TData extends ActivityContext>(
        options: {
            readonly rootId: string;
            readonly beforeHydrate?: (argumentsValue: { data: TData; stateMachine: StateMachineActor<TData> }) => void | Promise<void>;
            readonly createImplementations: (data: TData, runtime: StateMachineRuntime<TData>) => StateMachineImplementations<TData>;
            readonly getDefinition?: (configuration: Record<string, unknown>) => unknown | Promise<unknown>;
            readonly prerequisites?: readonly string[];
            readonly sceneIds?: readonly string[];
        },
    ): void;
}
`;

/** The replacements scaffoldModule performs, applied so bare token expressions compile. */
const REPLACEMENTS: Record<string, string> = {
  __ROOT_ID__: "'activity-test'",
  __MODULE_ID__: "'test'",
  __DEFAULT_LANGUAGE_CODE__: "'en-US'",
  __ASSESSMENT_IMPORT__: "",
  __ASSESSMENT_RUNTIME_INITIALIZATION__: "",
  __ACTIVITY_ACTIONS__: "            presentScene,",
};

function generatedBookSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const [name, source] of Object.entries(templates)) {
    if (!/\.(ts|d\.ts)$/.test(name) || name === "src/runtime/assessment.ts") continue;
    sources.set(
      path.resolve(name),
      source.replace(/__[A-Z_]+__/g, (token) => REPLACEMENTS[token] ?? token),
    );
  }
  sources.set(path.resolve("src/index.ts"), bookReaderEntryTemplate);
  sources.set(path.resolve("src/book-reader/model.ts"), bookReaderTemplate);
  sources.set(path.resolve("src/book-reader/controller.ts"), bookReaderControllerTemplate);
  sources.set(path.resolve("src/book-reader/view.ts"), bookReaderViewTemplate);
  sources.set(path.resolve("src/book-reader/adapter.ts"), bookReaderAdapterTemplate);
  sources.set(path.resolve("src/waf-state-machine.d.ts"), AMBIENT_WAF_STATE_MACHINE);
  return sources;
}

it("typechecks the complete generated book module with strict TypeScript", () => {
  const sources = generatedBookSources();
  const roots = ["src/index.ts", "src/waf-state-machine.d.ts", "src/runtime/waf-globals.d.ts"].map(
    (name) => path.resolve(name),
  );
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const virtualDirectories = new Set<string>();
  for (const file of sources.keys()) {
    for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
      virtualDirectories.add(dir);
    }
  }
  host.fileExists = (name) => sources.has(path.resolve(name)) || fileExists(name);
  host.directoryExists = (name) =>
    virtualDirectories.has(path.resolve(name)) || (directoryExists?.(name) ?? true);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    sources.has(path.resolve(name))
      ? ts.createSourceFile(name, sources.get(path.resolve(name))!, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram(roots, options, host);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => {
      const file = diagnostic.file?.fileName;
      // Only report on generated sources, not on the ambient stubs' own fidelity.
      return !file || sources.has(path.resolve(file));
    })
    .map((diagnostic) => {
      const line =
        diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
          : 0;
      return `${path.basename(diagnostic.file?.fileName ?? "?")}:${line} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    });
  expect(errors).toEqual([]);
});

it("typechecks the generated reader model and controller together with strict TypeScript", () => {
  const sources = new Map([
    [path.resolve("model.ts"), bookReaderTemplate],
    [path.resolve("controller.ts"), bookReaderControllerTemplate],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => sources.has(path.resolve(name)) || fileExists(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    sources.has(path.resolve(name))
      ? ts.createSourceFile(name, sources.get(path.resolve(name))!, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([...sources.keys()], options, host);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  expect(errors).toEqual([]);
});
