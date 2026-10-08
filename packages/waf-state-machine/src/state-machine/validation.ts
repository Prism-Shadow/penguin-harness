import type {
  StateMachineDefinition,
  StateMachineStateDefinition,
  StateMachineTransition,
  StateMachineTransitionDefinition,
  StateMachineValidationIssue,
  StateMachineValidationOptions,
  StateMachineValidationResult,
} from './types.ts';

interface NodeEntry {
  readonly parentPath: string;
  readonly state: StateMachineStateDefinition;
}

export class StateMachineDefinitionError extends Error {
  readonly issues: readonly StateMachineValidationIssue[];

  constructor(issues: readonly StateMachineValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'StateMachineDefinitionError';
    this.issues = issues;
  }
}

function issue(code: string, path: string, message: string): StateMachineValidationIssue {
  return { code, message, path };
}

function transitions(value: StateMachineTransition | readonly StateMachineTransition[] | undefined): readonly StateMachineTransition[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value as StateMachineTransition];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateStateMachineDefinition(
  value: unknown,
  options: StateMachineValidationOptions = {},
): StateMachineValidationResult {
  const issues: StateMachineValidationIssue[] = [];
  if (!isRecord(value)) {
    return { valid: false, issues: [issue('definition.type', '', 'State machine definition must be an object.')] };
  }
  if (value.version !== '1.0' && value.version !== '1.1') {
    issues.push(issue('definition.version', 'version', 'State machine version must be "1.0" or "1.1".'));
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    issues.push(issue('definition.id', 'id', 'State machine id must be a non-empty string.'));
  }
  if (typeof value.initial !== 'string' || value.initial.length === 0) {
    issues.push(issue('definition.initial', 'initial', 'State machine initial state must be a non-empty string.'));
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    issues.push(issue('definition.description', 'description', 'State machine description must be a string.'));
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    issues.push(issue('definition.metadata', 'metadata', 'State machine metadata must be an object.'));
  }
  if (!isRecord(value.states) || Object.keys(value.states).length === 0) {
    issues.push(issue('definition.states', 'states', 'State machine states must be a non-empty object.'));
    return { valid: false, issues };
  }

  const definition = value as unknown as StateMachineDefinition;
  const nodes = new Map<string, NodeEntry>();
  const implementationReferences = new Set<string>();
  const transitionReferences: Array<{ sourcePath: string; target: string; path: string }> = [];

  const inspectImplementation = (reference: unknown, path: string): void => {
    if (typeof reference === 'string') {
      if (reference.length === 0) {
        issues.push(issue('implementation.type', path, `Implementation at ${path} must name a non-empty type.`));
      } else {
        implementationReferences.add(reference);
      }
      return;
    }
    if (!isRecord(reference)) {
      issues.push(issue('implementation.type', path, `Implementation at ${path} must be a string or descriptor object.`));
      return;
    }
    if (typeof reference.type !== 'string' || reference.type.length === 0) {
      issues.push(issue('implementation.type', `${path}.type`, `Implementation at ${path} must name a non-empty type.`));
    } else {
      implementationReferences.add(reference.type);
    }
    if (reference.params !== undefined && !isRecord(reference.params)) {
      issues.push(issue('implementation.params', `${path}.params`, `Implementation params at ${path} must be an object.`));
    }
  };

  const inspectImplementations = (value: unknown, path: string): void => {
    const references = Array.isArray(value) ? value : [value];
    if (references.length === 0) {
      issues.push(issue('implementation.empty', path, `Implementation list at ${path} must not be empty.`));
      return;
    }
    references.forEach((reference, index) => inspectImplementation(reference, Array.isArray(value) ? `${path}.${index}` : path));
  };

  const inspectTransition = (transition: StateMachineTransition, sourcePath: string, path: string): void => {
    if (typeof transition === 'string') {
      transitionReferences.push({ sourcePath, target: transition, path });
      return;
    }
    if (!isRecord(transition)) {
      issues.push(issue('transition.type', path, `Transition at ${path} must be a string or object.`));
      return;
    }
    const definitionTransition = transition as StateMachineTransitionDefinition;
    if (definitionTransition.target !== undefined) {
      if (typeof definitionTransition.target !== 'string' || definitionTransition.target.length === 0) {
        issues.push(issue('transition.target', `${path}.target`, `Transition target at ${path} must be a non-empty string.`));
      } else {
        transitionReferences.push({ sourcePath, target: definitionTransition.target, path: `${path}.target` });
      }
    }
    if (definitionTransition.guard !== undefined) {
      inspectImplementation(definitionTransition.guard, `${path}.guard`);
    }
    if (definitionTransition.actions !== undefined) {
      inspectImplementations(definitionTransition.actions, `${path}.actions`);
    }
  };

  const inspectTransitions = (
    value: StateMachineTransition | readonly StateMachineTransition[] | undefined,
    sourcePath: string,
    path: string,
  ): void => {
    const entries = transitions(value);
    if (Array.isArray(value) && entries.length === 0) {
      issues.push(issue('transition.empty', path, `Transition list at ${path} must not be empty.`));
    }
    let fallbackIndex = -1;
    entries.forEach((transition, index) => {
      inspectTransition(transition, sourcePath, `${path}.${index}`);
      const guarded = isRecord(transition) && transition.guard !== undefined;
      if (!guarded && fallbackIndex === -1) {
        fallbackIndex = index;
      } else if (fallbackIndex !== -1) {
        issues.push(issue(
          'transition.unreachable',
          `${path}.${index}`,
          `Transition at ${path}.${index} is unreachable because an unguarded fallback appears first.`,
        ));
      }
    });
  };

  const visit = (stateMap: Readonly<Record<string, StateMachineStateDefinition>>, parentPath: string): void => {
    for (const [name, stateValue] of Object.entries(stateMap)) {
      const path = parentPath ? `${parentPath}.${name}` : name;
      if (!isRecord(stateValue)) {
        issues.push(issue('state.type', path, `State "${path}" must be an object.`));
        continue;
      }
      const state = stateValue as StateMachineStateDefinition;
      nodes.set(path, { parentPath, state });
      if (state.description !== undefined && typeof state.description !== 'string') {
        issues.push(issue('state.description', `${path}.description`, `State "${path}" description must be a string.`));
      }
      if (state.type !== undefined && !['atomic', 'compound', 'final'].includes(state.type)) {
        issues.push(issue('state.kind', `${path}.type`, `State "${path}" has unsupported type "${state.type}".`));
      }
      if (state.entry !== undefined) {
        inspectImplementations(state.entry, `${path}.entry`);
      }
      if (state.exit !== undefined) {
        inspectImplementations(state.exit, `${path}.exit`);
      }
      if (state.initial !== undefined) {
        if (!state.states || !(state.initial in state.states)) {
          issues.push(issue('state.initial', `${path}.initial`, `State "${path}" has unknown initial child "${state.initial}".`));
        }
      }
      if (state.states && state.initial === undefined) {
        issues.push(issue('state.initial.required', `${path}.initial`, `Compound state "${path}" must define its initial child.`));
      }
      if (state.type === 'atomic' && state.states) {
        issues.push(issue('state.atomic.children', `${path}.states`, `Atomic state "${path}" cannot define child states.`));
      }
      if (state.type === 'final' && (state.initial || state.states || state.invoke || state.on || state.after)) {
        issues.push(issue('state.final.children', path, `Final state "${path}" cannot define child states, invocation, watchdogs, or transitions.`));
      }
      if (options.requireActivityComplete && state.type === 'final' && path !== 'activity.complete') {
        issues.push(issue(
          'state.final.location',
          `${path}.type`,
          `Only "activity.complete" may be final in a state machine; "${path}" would terminate early.`,
        ));
      }
      if (state.invoke) {
        if (state.states) {
          issues.push(issue(
            'invoke.compound',
            `${path}.invoke`,
            `Compound state "${path}" cannot invoke work; place the invocation on an active leaf state.`,
          ));
        }
        if (typeof state.invoke.src !== 'string' || state.invoke.src.length === 0) {
          issues.push(issue('invoke.src', `${path}.invoke.src`, `State "${path}" must name its invoked operation.`));
        } else {
          implementationReferences.add(state.invoke.src);
        }
        for (const [outcome, outcomeValue] of [['onDone', state.invoke.onDone], ['onError', state.invoke.onError]] as const) {
          inspectTransitions(outcomeValue, path, `${path}.invoke.${outcome}`);
        }
      }
      for (const [eventType, eventTransitions] of Object.entries(state.on ?? {})) {
        if (eventType.length === 0) {
          issues.push(issue('event.type', `${path}.on`, `State "${path}" event names must not be empty.`));
        }
        inspectTransitions(eventTransitions, path, `${path}.on.${eventType}`);
      }
      for (const [delay, delayTransitions] of Object.entries(state.after ?? {})) {
        if (!/^\d+$/.test(delay) || Number(delay) <= 0) {
          issues.push(issue(
            'after.delay',
            `${path}.after.${delay}`,
            `Watchdog delay at "${path}.after.${delay}" must be a positive integer number of milliseconds.`,
          ));
        }
        inspectTransitions(delayTransitions, path, `${path}.after.${delay}`);
      }
      if (state.states) {
        visit(state.states, path);
      }
    }
  };

  visit(definition.states, '');

  if (!(definition.initial in definition.states)) {
    issues.push(issue('definition.initial.target', 'initial', `Initial state "${definition.initial}" does not exist.`));
  }

  const prefix = `#${definition.id}.`;
  for (const reference of transitionReferences) {
    const source = nodes.get(reference.sourcePath);
    let resolved = reference.target;
    if (resolved.startsWith(prefix)) {
      resolved = resolved.slice(prefix.length);
    } else if (resolved.startsWith('#')) {
      resolved = '';
    } else if (!nodes.has(resolved)) {
      resolved = source?.parentPath ? `${source.parentPath}.${resolved}` : resolved;
    }
    if (!nodes.has(resolved)) {
      issues.push(issue('transition.target.unknown', reference.path, `Transition target "${reference.target}" does not exist.`));
    }
  }

  if (options.implementationNames) {
    for (const name of implementationReferences) {
      if (!options.implementationNames.has(name)) {
        issues.push(issue('implementation.missing', name, `State machine implementation "${name}" is not registered.`));
      }
    }
  }

  if (options.sceneIds) {
    for (const sceneId of options.sceneIds) {
      if (!(sceneId in definition.states)) {
        issues.push(issue('scene.missing', `states.${sceneId}`, `The state machine does not define scene state "${sceneId}".`));
      }
    }
  }

  if (options.requireActivityComplete) {
    const complete = nodes.get('activity.complete');
    if (!complete || complete.state.type !== 'final') {
      issues.push(issue('activity.complete', 'states.activity.states.complete', 'The state machine must define activity.complete as a final state.'));
    }
  }

  return { valid: issues.length === 0, issues };
}

export function assertValidStateMachineDefinition(
  value: unknown,
  options: StateMachineValidationOptions = {},
): asserts value is StateMachineDefinition {
  const result = validateStateMachineDefinition(value, options);
  if (!result.valid) {
    throw new StateMachineDefinitionError(result.issues);
  }
}
