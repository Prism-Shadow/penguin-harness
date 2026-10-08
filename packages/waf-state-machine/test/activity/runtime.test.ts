import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ActivityContext,
  WafActivityData,
} from '../../src/index.ts';
import { createActivityState } from '../../src/activity/activity-state.ts';
import { createActivityInspection } from '../../src/activity/inspection.ts';
import {
  stateMachineDefinitionFromConfiguration,
  STATE_MACHINE_CONFIGURATION_KEY,
} from '../../src/activity/state-machine-configuration.ts';
import { createInteractableRegistry } from '../../src/state-machine/interactable-registry.ts';

function fakeElement(id: string): Element {
  const attributes = new Map<string, string>();
  return {
    id,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  } as unknown as Element;
}

function rootElement(): HTMLElement {
  const target = new EventTarget() as EventTarget & { dataset: DOMStringMap };
  target.dataset = {} as DOMStringMap;
  return target as unknown as HTMLElement;
}

describe('public activity context types', () => {
  it('keeps WafActivityData compatible with ActivityContext', () => {
    const context = {} as ActivityContext;
    const legacyContext: WafActivityData = context;

    assert.equal(legacyContext, context);
  });
});

describe('stateMachineDefinitionFromConfiguration', () => {
  const definition = {
    id: 'test',
    initial: 'activity',
    states: {
      activity: {
        initial: 'complete',
        states: { complete: { type: 'final' } },
      },
    },
    version: '1.1' as const,
  };

  it('uses the preferred stateMachine configuration key', () => {
    assert.equal(STATE_MACHINE_CONFIGURATION_KEY, 'stateMachine');
    assert.equal(stateMachineDefinitionFromConfiguration({ stateMachine: definition }), definition);
  });

  it('supports the legacy activityMachine configuration key', () => {
    assert.equal(stateMachineDefinitionFromConfiguration({ activityMachine: definition }), definition);
  });
});

describe('createActivityInspection', () => {
  it('returns live interactables and isolated state machine definitions', () => {
    const activityState = createActivityState(rootElement(), 'activity.initializing');
    const interactables = createInteractableRegistry();
    const definition = {
      id: 'test',
      initial: 'activity',
      states: {
        activity: {
          initial: 'complete',
          states: { complete: { type: 'final' as const } },
        },
      },
      version: '1.1' as const,
    };
    const inspection = createActivityInspection(activityState, interactables, definition);

    assert.deepEqual(inspection.getCurrentState().interactables, []);
    assert.equal(inspection.getCursor(), 1);
    assert.equal(inspection.getHistory().length, 1);
    assert.equal(inspection.getMediaCursor(), 0);
    assert.deepEqual(inspection.getMediaHistory(), []);
    assert.equal(inspection.getSnapshot().state, 'activity.initializing');
    const registered = interactables.register(fakeElement('continue'), {
      id: 'continue',
      inputType: 'CLICK',
      params: { destination: 'activity.complete' },
    });
    assert.deepEqual(inspection.getCurrentState().interactables, [{
      id: 'continue',
      inputType: 'CLICK',
      params: { destination: 'activity.complete' },
    }]);

    registered.dispose();
    assert.deepEqual(inspection.getCurrentState().interactables, []);

    const exposedDefinition = inspection.getStateMachineDefinition();
    const exposedStates = exposedDefinition.states.activity.states as Record<string, unknown>;
    exposedStates.injected = {};
    assert.deepEqual(Object.keys(definition.states.activity.states), ['complete']);
    assert.ok(Object.isFrozen(inspection));
  });
});
