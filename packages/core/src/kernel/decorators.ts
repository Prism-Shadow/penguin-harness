/**
 * The class form's decorators: `@Module` / `@Component` on a class, `@Use` / `@Provide` /
 * `@Bind` on its fields. What they record is read back by `moduleDefOf` (module.ts) when
 * the class joins a tree.
 *
 * They record it ON THE CLASS, under `Symbol.for` keys, not in a map private to this
 * module. A plugin bundles its own copy of this file (it compiles against the SDK and
 * ships self-contained), so the copy that decorated a plugin's class is never the copy
 * the host reads it with; a property on the class is the same property from either side.
 * Nothing here imports anything, so a bundle that wants only the decorators gets only
 * the decorators.
 */
import type { JsonObject } from "./json.js";
import type { ContextDecl } from "./manifest.js";

/** An interface handle: an abstract class whose instance type is the interface (see markers.ts Interface). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IfaceClass<T = any> = abstract new (...args: never[]) => T;
/** A module class: decorated with @Module; instantiated once per App; `create` is the module's create. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModuleClass = abstract new (...args: any[]) => object;

/**
 * The static half a module class declares in its decorator. Requirements and provisions
 * are FIELDS (`@Use`, `@Provide`), where their types already are; what is left here is
 * the name, the contributions (pure data), the parked context and the child classes.
 */
export interface ModuleMeta {
  readonly contributes?: Readonly<
    Record<string, ReadonlyArray<{ readonly id: string } & JsonObject>>
  >;
  readonly context?: ContextDecl;
  readonly children?: ReadonlyArray<ModuleClass>;
  /** Interfaces this module forwards from its children — what the subtree offers outside. */
  readonly exports?: ReadonlyArray<IfaceClass>;
}

/** What a @Component declares: a module's meta minus children — a component exports itself. */
export type ComponentMeta = Omit<ModuleMeta, "children">;
export type Meta = ModuleMeta & { readonly name: string; readonly kind: "module" | "component" };

export interface ClassFields {
  /** field → the module wired to provide it, by class or by name (undefined = any visible provider). */
  use: Map<string, ModuleClass | string | undefined>;
  provide: Set<string>;
  /** field → contribution id. */
  bind: Map<string, string>;
}

const META = Symbol.for("@prismshadow/penguin-core/kernel:meta");
const FIELDS = Symbol.for("@prismshadow/penguin-core/kernel:fields");

/** The meta a class was decorated with, or undefined for an undecorated class. */
export function metaOf(cls: ModuleClass): Meta | undefined {
  // Own property only: a subclass of a module class is not that module.
  return Object.hasOwn(cls, META) ? (cls as unknown as Record<symbol, Meta>)[META] : undefined;
}

export function fieldsOf(cls: ModuleClass): ClassFields {
  const holder = cls as unknown as Record<symbol, ClassFields | undefined>;
  if (!Object.hasOwn(cls, FIELDS)) {
    const f: ClassFields = { use: new Map(), provide: new Set(), bind: new Map() };
    Object.defineProperty(cls, FIELDS, { value: f, enumerable: false });
    return f;
  }
  return holder[FIELDS]!;
}

function setMeta(cls: ModuleClass, meta: Meta): void {
  Object.defineProperty(cls, META, { value: meta, enumerable: false, configurable: true });
}

/**
 * A node's name is the class's DECLARED name — the one the generator read off the source
 * into the table — and it arrives here as the decorator context's `name`, which both
 * lowerings emit as a string literal. `target.name` would be the same word until a
 * minifier renamed the binding; a string literal it cannot touch. So the name the table
 * carries and the name the class boots under cannot disagree, whatever the bundle went
 * through.
 */
function nodeName(context: ClassDecoratorContext): string {
  const name = context.name;
  if (typeof name !== "string" || name === "") {
    throw new Error("a @Module / @Component class must be a named class declaration");
  }
  return name;
}

/**
 * Registers a class as a module. `create(ctx, context)` runs once per App; the class's
 * `@Use` fields are injected before it, its `@Provide` fields are read after it, its
 * `@Bind` fields are the code halves of its contributions, and `park()` (optional)
 * parks its state.
 */
export function Module(meta: ModuleMeta = {}) {
  return (target: ModuleClass, context: ClassDecoratorContext): void => {
    setMeta(target, { ...meta, name: nodeName(context), kind: "module" });
  };
}

/**
 * Registers a class as a COMPONENT: a module that exports itself. The instance is the
 * provision, named in a consumer by its own class (`@Use() auth!: AuthService`), and its
 * interface is its public surface as the generator projects it. `@Use` fields are injected
 * before the optional `create(ctx, context)`; `@Bind` fields and `park()` work as on a
 * module. A class whose inputs no interface provides (a computed closure, a path) is built
 * by a @Module instead, which is what "exports others" means.
 */
export function Component(meta: ComponentMeta = {}) {
  return (target: ModuleClass, context: ClassDecoratorContext): void => {
    setMeta(target, { ...meta, name: nodeName(context), kind: "component" });
  };
}

/**
 * A requirement: `@Use(SessionsModule) readonly runner!: ScheduleTaskRunner;` — the field's
 * type is the interface, the decorator's argument the module wired to provide it (absent =
 * whichever visible module structurally satisfies it, if exactly one does). A plugin, which
 * has no host class at runtime, names that module: `@Use("TerminalModule")`. Injected before
 * `create`. The interface key comes from the generated table, which reads the annotation.
 */
export function Use(from?: ModuleClass | string) {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const name = String(context.name);
    context.addInitializer(function (this: unknown) {
      fieldsOf((this as object).constructor as ModuleClass).use.set(name, from);
    });
  };
}

/** A provision: `@Provide() settings!: Settings;` — assigned in `create`, read after it; unassigned = boot error. */
export function Provide() {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const name = String(context.name);
    context.addInitializer(function (this: unknown) {
      fieldsOf((this as object).constructor as ModuleClass).provide.add(name);
    });
  };
}

/** The code half of one contribution: `@Bind("agents.routes") routes!: Hono;` — assigned in `create`. */
export function Bind(id: string) {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const name = String(context.name);
    context.addInitializer(function (this: unknown) {
      fieldsOf((this as object).constructor as ModuleClass).bind.set(name, id);
    });
  };
}

/**
 * Constructs a component OUTSIDE a tree — a script or a test that wants the class with
 * its fields supplied by hand. The fields are assigned as the booter would inject them;
 * nothing is checked, and `create()` is not called.
 */
export function wire<T extends object>(
  cls: new () => T,
  // `any`, so a callback supplied here is contextually typed rather than an implicit any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: Record<string, any>,
): T {
  return Object.assign(new cls(), fields);
}
