/**
 * How a module's components reach the module's dependencies. The module tree is not exposed to
 * React: a module binds what it needs into its own root component in `setup()` (`provide`), and
 * every component under that root reads it with the module's `useDeps()`. A module's UI enters
 * the app only through a component it binds (a page, a section, a panel, a layer), so each of
 * its components renders under one of its roots, and none can reach past its module.
 */
import { createContext, useContext } from "react";
import type { ComponentType } from "react";

export function createDeps<D>() {
  const Ctx = createContext<D | null>(null);
  return {
    /** Wraps a module's root component so everything under it can read the module's deps. */
    provide<P extends object>(deps: D, Root: ComponentType<P>): ComponentType<P> {
      return function ModuleRoot(props: P) {
        return (
          <Ctx.Provider value={deps}>
            <Root {...props} />
          </Ctx.Provider>
        );
      };
    },
    useDeps(): D {
      const deps = useContext(Ctx);
      if (deps === null) throw new Error("rendered outside its module's root component");
      return deps;
    },
  };
}
