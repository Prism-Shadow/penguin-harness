export interface EffectScope {
  readonly signal: AbortSignal;
  cancel(): void;
  onCancel(callback: () => void): void;
}

export interface EffectScopeRegistry {
  cancel(ownerPaths: readonly string[]): void;
  open(ownerPath: string): EffectScope;
}

interface MutableEffectScope extends EffectScope {
  readonly ownerPath: string;
}

function runCleanupCallbacks(callbacks: readonly (() => void)[]): void {
  let firstFailure: unknown;
  let hasFailure = false;

  callbacks.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      if (!hasFailure) {
        firstFailure = error;
        hasFailure = true;
      }
    }
  });

  if (hasFailure) {
    throw firstFailure;
  }
}

export function createEffectScopeRegistry(): EffectScopeRegistry {
  const scopesByOwner = new Map<string, MutableEffectScope[]>();

  function open(ownerPath: string): MutableEffectScope {
    const controller = new AbortController();
    const cancellations: Array<() => void> = [];
    let cancelled = false;
    const scope: MutableEffectScope = {
      ownerPath,
      signal: controller.signal,
      cancel(): void {
        if (cancelled) {
          return;
        }
        cancelled = true;
        controller.abort();
        runCleanupCallbacks(cancellations.splice(0));
      },
      onCancel(callback): void {
        if (cancelled) {
          callback();
          return;
        }
        cancellations.push(callback);
      },
    };
    if (ownerPath) {
      const ownerScopes = scopesByOwner.get(ownerPath) ?? [];
      ownerScopes.push(scope);
      scopesByOwner.set(ownerPath, ownerScopes);
    }
    return scope;
  }

  return Object.freeze({
    cancel(ownerPaths: readonly string[]): void {
      runCleanupCallbacks(ownerPaths.map((ownerPath) => () => {
        const scopes = scopesByOwner.get(ownerPath) ?? [];
        scopesByOwner.delete(ownerPath);
        runCleanupCallbacks(scopes.map((scope) => () => scope.cancel()));
      }));
    },
    open,
  });
}
