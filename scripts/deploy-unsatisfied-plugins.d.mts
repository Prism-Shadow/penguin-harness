/**
 * Types for deploy-unsatisfied-plugins.mjs. The module is plain JavaScript because
 * scripts/deploy.mjs loads it directly; this lets the server's typechecked test import the
 * same functions the script uses.
 */
export interface UnsatisfiedPlugin {
  specifier: string;
  disabled: boolean;
  reason: string;
}
export declare const UNSATISFIED_PLUGINS_HEADER: string;
export declare const LEAVE_OUT: string;
export declare function refusedPlugins(status: number, text: string): UnsatisfiedPlugin[] | null;
export declare function leftOutPlugins(outcome: unknown): UnsatisfiedPlugin[];
export declare function pluginLines(
  plugins: readonly UnsatisfiedPlugin[],
  done?: boolean,
): string[];
export declare function refusalStep(interactive: boolean): "ask" | "needs-force";
export declare function saidYes(answer: unknown): boolean;
