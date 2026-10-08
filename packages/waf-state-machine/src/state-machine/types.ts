export type StateMachineEvent = Readonly<{
  type: string;
  [key: string]: unknown;
}>;

export type StateMachineStatus = 'idle' | 'running' | 'done' | 'error' | 'stopped';

export type StateMachineParams = Readonly<Record<string, unknown>>;

export interface StateMachineImplementationDescriptor {
  readonly type: string;
  readonly params?: StateMachineParams;
}

export type StateMachineImplementationReference = string | StateMachineImplementationDescriptor;

export interface StateMachineSnapshot<TContext extends object = Record<string, unknown>> {
  readonly context: TContext;
  readonly status: StateMachineStatus;
  readonly value: string;
}

export type NamedImplementation =
  | StateMachineImplementationReference
  | readonly StateMachineImplementationReference[];

export interface StateMachineTransitionDefinition {
  readonly target?: string;
  readonly guard?: StateMachineImplementationReference;
  readonly actions?: NamedImplementation;
}

export type StateMachineTransition = string | StateMachineTransitionDefinition;

export interface StateMachineInvokeDefinition {
  readonly id?: string;
  readonly src: string;
  readonly onDone?: StateMachineTransition | readonly StateMachineTransition[];
  readonly onError?: StateMachineTransition | readonly StateMachineTransition[];
}

export interface StateMachineStateDefinition {
  readonly description?: string;
  readonly type?: 'atomic' | 'compound' | 'final';
  readonly initial?: string;
  readonly states?: Readonly<Record<string, StateMachineStateDefinition>>;
  readonly entry?: NamedImplementation;
  readonly exit?: NamedImplementation;
  /** Watchdog transitions keyed by positive-integer millisecond delays. */
  readonly after?: Readonly<Record<string, StateMachineTransition | readonly StateMachineTransition[]>>;
  readonly invoke?: StateMachineInvokeDefinition;
  readonly on?: Readonly<Record<string, StateMachineTransition | readonly StateMachineTransition[]>>;
}

export interface StateMachineDefinition<TContext extends object = Record<string, unknown>> {
  readonly $schema?: string;
  readonly version: '1.0' | '1.1';
  readonly id: string;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly initial: string;
  readonly context?: Partial<TContext>;
  readonly states: Readonly<Record<string, StateMachineStateDefinition>>;
}

export interface StateMachineArguments<TContext extends object, TEvent extends StateMachineEvent = StateMachineEvent> {
  readonly context: TContext;
  readonly event: TEvent;
  readonly send: (event: StateMachineEvent | string) => StateMachineSnapshot<TContext>;
  readonly state: string;
}

export interface StateMachineEffectArguments<TContext extends object> extends StateMachineArguments<TContext> {
  readonly interactables?: import('./interactable-registry.ts').StateMachineInteractableRegistrar;
  readonly onCancel: (cancel: () => void) => void;
  readonly signal: AbortSignal;
}

export interface StateMachineServiceArguments<TContext extends object> extends StateMachineEffectArguments<TContext> {}

export type StateMachineAction<TContext extends object> = (
  argumentsValue: StateMachineEffectArguments<TContext>,
  params: StateMachineParams,
) => unknown | Promise<unknown>;
export type StateMachineGuard<TContext extends object> = (
  argumentsValue: StateMachineArguments<TContext>,
  params: StateMachineParams,
) => boolean;
export type StateMachineService<TContext extends object> = (
  argumentsValue: StateMachineServiceArguments<TContext>,
) => unknown | Promise<unknown>;

export interface StateMachineImplementations<TContext extends object> {
  readonly actions?: Readonly<Record<string, StateMachineAction<TContext>>>;
  readonly guards?: Readonly<Record<string, StateMachineGuard<TContext>>>;
  readonly services?: Readonly<Record<string, StateMachineService<TContext>>>;
}

export interface CreateStateMachineOptions<TContext extends object> {
  readonly context?: Partial<TContext>;
  readonly interactables?: import('./interactable-registry.ts').StateMachineInteractableRegistry;
  readonly onError?: (error: unknown, snapshot: StateMachineSnapshot<TContext>) => void;
  readonly onTransition?: (snapshot: StateMachineSnapshot<TContext>) => void;
}

export interface StartStateMachineOptions {
  readonly state?: string;
}

export interface StateMachineActor<TContext extends object> {
  getSnapshot(): StateMachineSnapshot<TContext>;
  send(event: StateMachineEvent | string): StateMachineSnapshot<TContext>;
  start(options?: StartStateMachineOptions): StateMachineSnapshot<TContext>;
  stop(): StateMachineSnapshot<TContext>;
  subscribe(subscriber: (snapshot: StateMachineSnapshot<TContext>) => void): () => void;
}

export interface StateMachineValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface StateMachineValidationOptions {
  readonly implementationNames?: ReadonlySet<string>;
  readonly requireActivityComplete?: boolean;
  readonly sceneIds?: readonly string[];
}

export interface StateMachineValidationResult {
  readonly issues: readonly StateMachineValidationIssue[];
  readonly valid: boolean;
}
