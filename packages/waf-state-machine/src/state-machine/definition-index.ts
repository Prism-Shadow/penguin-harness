import type {
  StateMachineDefinition,
  StateMachineStateDefinition,
} from './types.ts';

export interface DefinitionNode {
  readonly parentPath: string;
  readonly path: string;
  readonly state: StateMachineStateDefinition;
}

export interface DefinitionIndex {
  has(path: string): boolean;
  initialLeaf(path: string): string;
  node(path: string): DefinitionNode;
  normalizeTarget(target: string, source: DefinitionNode): string;
  pathChain(path: string): readonly string[];
}

export function createDefinitionIndex(
  definition: StateMachineDefinition,
): DefinitionIndex {
  const nodes = new Map<string, DefinitionNode>();

  function visit(
    states: Readonly<Record<string, StateMachineStateDefinition>>,
    parentPath: string,
  ): void {
    for (const [key, state] of Object.entries(states)) {
      const path = parentPath ? `${parentPath}.${key}` : key;
      nodes.set(path, { parentPath, path, state });
      if (state.states) {
        visit(state.states, path);
      }
    }
  }

  visit(definition.states, '');
  function node(path: string): DefinitionNode {
    const selected = nodes.get(path);
    if (!selected) {
      throw new Error(`Unknown state machine state "${path}".`);
    }
    return selected;
  }

  return Object.freeze({
    has(path: string): boolean {
      return nodes.has(path);
    },
    initialLeaf(path: string): string {
      let selected = node(path);
      while (selected.state.initial) {
        selected = node(`${selected.path}.${selected.state.initial}`);
      }
      return selected.path;
    },
    node,
    normalizeTarget(target: string, source: DefinitionNode): string {
      const absolutePrefix = `#${definition.id}.`;
      if (target.startsWith(absolutePrefix)) {
        return target.slice(absolutePrefix.length);
      }
      if (target.startsWith('#')) {
        throw new Error(`Transition target belongs to another state machine: ${target}`);
      }
      if (nodes.has(target)) {
        return target;
      }
      return source.parentPath ? `${source.parentPath}.${target}` : target;
    },
    pathChain(path: string): readonly string[] {
      const chain: string[] = [];
      let cursor = path;
      while (cursor) {
        chain.unshift(cursor);
        cursor = node(cursor).parentPath;
      }
      return chain;
    },
  });
}
