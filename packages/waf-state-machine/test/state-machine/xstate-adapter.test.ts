import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createStateMachine } from '../../src/state-machine/xstate-adapter.ts';
import { createEffectScopeRegistry } from '../../src/state-machine/effect-scope-registry.ts';
import { createInteractableRegistry } from '../../src/state-machine/interactable-registry.ts';
import type { StateMachineDefinition } from '../../src/state-machine/types.ts';

interface TestContext {
  attempts: number;
}

const definition: StateMachineDefinition<TestContext> = {
  version: '1.0',
  id: 'test-state-machine',
  initial: 'scene-1',
  context: { attempts: 0 },
  states: {
    'scene-1': {
      initial: 'prompting',
      states: {
        prompting: { on: { ANSWER: 'evaluating' } },
        evaluating: {
          invoke: {
            src: 'evaluate',
            onDone: [
              { guard: 'isCorrect', target: '#test-state-machine.activity' },
              { actions: 'incrementAttempts', target: 'prompting' },
            ],
          },
        },
      },
    },
    activity: {
      initial: 'complete',
      states: { complete: { type: 'final' } },
    },
  },
};

describe('createStateMachine', () => {
  it('advances through after watchdogs when no event arrives', async () => {
    const actor = createStateMachine({
      version: '1.1',
      id: 'watchdog-actor',
      initial: 'waiting',
      states: {
        waiting: {
          after: { '20': 'done' },
        },
        done: { type: 'final' },
      },
    });

    const snapshots: string[] = [];
    actor.subscribe((snapshot) => snapshots.push(snapshot.value));
    actor.start();

    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(actor.getSnapshot().status, 'done');
    assert.equal(snapshots[snapshots.length - 1], 'done');
  });

  it('runs every cleanup before rethrowing the first cleanup failure', () => {
    const registry = createEffectScopeRegistry();
    const firstScope = registry.open('working');
    const secondScope = registry.open('working');
    const failure = new Error('first cleanup failed');
    const calls: string[] = [];

    firstScope.onCancel(() => {
      calls.push('first');
      throw failure;
    });
    firstScope.onCancel(() => { calls.push('second'); });
    secondScope.onCancel(() => { calls.push('third'); });

    assert.throws(() => registry.cancel(['working']), failure);
    assert.deepEqual(calls, ['first', 'second', 'third']);
    assert.equal(firstScope.signal.aborted, true);
    assert.equal(secondScope.signal.aborted, true);
  });

  it('cancels every owner before rethrowing the first cleanup failure', () => {
    const registry = createEffectScopeRegistry();
    const parentScope = registry.open('parent');
    const childScope = registry.open('parent.child');
    const failure = new Error('parent cleanup failed');
    const calls: string[] = [];

    parentScope.onCancel(() => {
      calls.push('parent');
      throw failure;
    });
    childScope.onCancel(() => { calls.push('child'); });

    assert.throws(() => registry.cancel(['parent', 'parent.child']), failure);
    assert.deepEqual(calls, ['parent', 'child']);
    assert.equal(parentScope.signal.aborted, true);
    assert.equal(childScope.signal.aborted, true);
  });

  it('selects guarded invoke transitions and loops deterministically', async () => {
    let correct = false;
    const actor = createStateMachine(definition, {
      actions: {
        incrementAttempts({ context }) {
          context.attempts += 1;
        },
      },
      guards: { isCorrect: () => correct },
      services: { evaluate: async () => ({ correct }) },
    });

    actor.start();
    actor.send('ANSWER');
    await Promise.resolve();
    assert.equal(actor.getSnapshot().value, 'scene-1.prompting');
    assert.equal(actor.getSnapshot().context.attempts, 1);

    correct = true;
    actor.send('ANSWER');
    await Promise.resolve();
    assert.deepEqual(actor.getSnapshot(), {
      context: { attempts: 1 },
      status: 'done',
      value: 'activity.complete',
    });
  });

  it('cancels invoked work and suppresses stale completion', async () => {
    let resolveInvocation: (() => void) | undefined;
    let cancelled = false;
    const actor = createStateMachine({
      version: '1.0',
      id: 'cancel-state-machine',
      initial: 'working',
      states: {
        working: {
          invoke: { src: 'work', onDone: 'complete' },
          on: { CANCEL: 'cancelled' },
        },
        complete: { type: 'final' },
        cancelled: { type: 'final' },
      },
    }, {
      services: {
        work({ onCancel }) {
          onCancel(() => { cancelled = true; });
          return new Promise<void>((resolve) => { resolveInvocation = resolve; });
        },
      },
    });

    actor.start();
    actor.send('CANCEL');
    resolveInvocation?.();
    await Promise.resolve();
    assert.equal(cancelled, true);
    assert.equal(actor.getSnapshot().value, 'cancelled');
  });

  it('aborts state-owned actions and runs their cleanup when the state exits', async () => {
    let signal: AbortSignal | undefined;
    let actionState = '';
    let cleanedUp = false;
    const actor = createStateMachine({
      version: '1.1',
      id: 'action-cancellation',
      initial: 'working',
      states: {
        working: {
          entry: 'startWork',
          on: { SKIP: 'complete' },
        },
        complete: { type: 'final' },
      },
    }, {
      actions: {
        startWork({ onCancel, signal: actionSignal, state }) {
          signal = actionSignal;
          actionState = state;
          onCancel(() => { cleanedUp = true; });
          return new Promise(() => {});
        },
      },
    });

    actor.start();
    actor.send('SKIP');

    assert.equal(actionState, 'working');
    assert.equal(signal?.aborted, true);
    assert.equal(cleanedUp, true);
    assert.equal(actor.getSnapshot().value, 'complete');
  });

  it('immediately cleans up registrations added after an action was cancelled', async () => {
    let registerLateCleanup: ((cleanup: () => void) => void) | undefined;
    let cleanedUp = false;
    const actor = createStateMachine({
      version: '1.1',
      id: 'late-action-cleanup',
      initial: 'working',
      states: {
        working: { entry: 'startWork', on: { SKIP: 'complete' } },
        complete: { type: 'final' },
      },
    }, {
      actions: {
        startWork({ onCancel }) {
          registerLateCleanup = onCancel;
        },
      },
    });

    actor.start();
    actor.send('SKIP');
    registerLateCleanup?.(() => { cleanedUp = true; });

    assert.equal(cleanedUp, true);
  });

  it('owns interactables registered after an action awaits', async () => {
    let continueAction: (() => void) | undefined;
    const interactables = createInteractableRegistry();
    const element = {
      id: 'choice-a',
      setAttribute(): void {},
      removeAttribute(): void {},
    } as unknown as Element;
    const actor = createStateMachine({
      version: '1.1',
      id: 'async-interactable-cleanup',
      initial: 'working',
      states: {
        working: { entry: 'armChoice', on: { SKIP: 'complete' } },
        complete: { type: 'final' },
      },
    }, {
      actions: {
        async armChoice({ interactables: scopedInteractables }) {
          await new Promise<void>((resolve) => { continueAction = resolve; });
          scopedInteractables?.register(element, { id: 'choice-a', inputType: 'CLICK' });
        },
      },
    }, { interactables });

    actor.start();
    continueAction?.();
    await Promise.resolve();
    assert.equal(interactables.list().length, 1);

    actor.send('SKIP');

    assert.deepEqual(interactables.list(), []);
  });

  it('owns asynchronous transition actions by the destination state', () => {
    let cancelled = false;
    const actor = createStateMachine({
      version: '1.1',
      id: 'transition-action-cancellation',
      initial: 'first',
      states: {
        first: { on: { GO: { actions: 'watch', target: 'second' } } },
        second: { on: { LEAVE: 'complete' } },
        complete: { type: 'final' },
      },
    }, {
      actions: {
        watch({ onCancel }) {
          onCancel(() => { cancelled = true; });
          return new Promise(() => {});
        },
      },
    });

    actor.start();
    actor.send('GO');
    actor.send('LEAVE');

    assert.equal(cancelled, true);
  });

  it('queues events sent from actions instead of transitioning reentrantly', () => {
    const actor = createStateMachine({
      version: '1.0',
      id: 'queue-state-machine',
      initial: 'first',
      states: {
        first: { on: { NEXT: { actions: 'queueFinish', target: 'second' } } },
        second: { on: { FINISH: 'complete' } },
        complete: { type: 'final' },
      },
    }, {
      actions: { queueFinish: ({ send }) => { send('FINISH'); } },
    });
    actor.start();
    actor.send('NEXT');
    assert.equal(actor.getSnapshot().value, 'complete');
  });

  it('passes WAF descriptor params to guards and actions', () => {
    const actor = createStateMachine({
      version: '1.1',
      id: 'descriptor-state-machine',
      initial: 'choosing',
      context: { attempts: 0 },
      states: {
        choosing: {
          on: {
            CHOICE: [
              {
                guard: { type: 'eventMatches', params: { expected: 'correct' } },
                actions: { type: 'recordAttempt', params: { amount: 2 } },
                target: 'complete',
              },
              { target: 'incorrect' },
            ],
          },
        },
        incorrect: {},
        complete: { type: 'final' },
      },
    }, {
      actions: {
        recordAttempt({ context }, params) {
          context.attempts += params.amount as number;
        },
      },
      guards: {
        eventMatches({ event }, params) {
          return event.choice === params.expected;
        },
      },
    });

    actor.start();
    actor.send({ type: 'CHOICE', choice: 'correct' });

    assert.deepEqual(actor.getSnapshot(), {
      context: { attempts: 2 },
      status: 'done',
      value: 'complete',
    });
  });

  it('finishes queued entry events after publishing each observable state', () => {
    const visited: string[] = [];
    const actor = createStateMachine({
      version: '1.1',
      id: 'event-driven-state-machine',
      initial: 'presenting',
      states: {
        presenting: {
          entry: { type: 'completeStep', params: { event: 'PRESENTATION.COMPLETED' } },
          on: { 'PRESENTATION.COMPLETED': 'awaiting-choice' },
        },
        'awaiting-choice': { on: { 'CHOICE.SELECTED': 'feedback' } },
        feedback: {
          entry: { type: 'completeStep', params: { event: 'FEEDBACK.COMPLETED' } },
          on: { 'FEEDBACK.COMPLETED': 'complete' },
        },
        complete: { type: 'final' },
      },
    }, {
      actions: {
        completeStep({ send }, params) {
          send(params.event as string);
        },
      },
    }, {
      onTransition(snapshot) {
        visited.push(snapshot.value);
      },
    });

    actor.start();
    assert.equal(actor.getSnapshot().value, 'awaiting-choice');
    actor.send('CHOICE.SELECTED');

    assert.deepEqual(visited, ['presenting', 'awaiting-choice', 'feedback', 'complete']);
  });

  it('runs hierarchical entry and exit actions in statechart order', () => {
    const calls: string[] = [];
    const actor = createStateMachine({
      version: '1.1',
      id: 'hierarchy-state-machine',
      initial: 'scene',
      states: {
        scene: {
          entry: 'enterScene',
          exit: 'exitScene',
          initial: 'presenting',
          states: {
            presenting: {
              entry: 'enterPresenting',
              exit: 'exitPresenting',
              on: { NEXT: '#hierarchy-state-machine.complete' },
            },
          },
        },
        complete: { type: 'final' },
      },
    }, {
      actions: {
        enterScene: () => { calls.push('enter-scene'); },
        enterPresenting: () => { calls.push('enter-presenting'); },
        exitPresenting: () => { calls.push('exit-presenting'); },
        exitScene: () => { calls.push('exit-scene'); },
      },
    });

    actor.start();
    actor.send('NEXT');

    assert.deepEqual(calls, [
      'enter-scene',
      'enter-presenting',
      'exit-presenting',
      'exit-scene',
    ]);
  });

  it('starts at an explicit nested preview state and runs its entry chain', () => {
    const calls: string[] = [];
    const actor = createStateMachine({
      version: '1.1',
      id: 'preview-state-machine',
      initial: 'scene',
      states: {
        scene: {
          entry: 'enterScene',
          initial: 'first',
          states: {
            first: {},
            second: { entry: 'enterSecond' },
          },
        },
      },
    }, {
      actions: {
        enterScene: () => { calls.push('scene'); },
        enterSecond: () => { calls.push('second'); },
      },
    });

    actor.start({ state: 'scene.second' });

    assert.equal(actor.getSnapshot().value, 'scene.second');
    assert.deepEqual(calls, ['scene', 'second']);
  });

  it('preserves public invoke completion event names and output', async () => {
    let observedEvent: { output?: unknown; type: string } | undefined;
    const actor = createStateMachine({
      version: '1.1',
      id: 'invoke-event-state-machine',
      initial: 'loading',
      states: {
        loading: {
          invoke: {
            id: 'load-content',
            src: 'loadContent',
            onDone: { guard: 'captureDone', target: 'complete' },
          },
        },
        complete: { type: 'final' },
      },
    }, {
      guards: {
        captureDone({ event }) {
          observedEvent = event;
          return true;
        },
      },
      services: {
        loadContent: async () => ({ loaded: true }),
      },
    });

    actor.start();
    await Promise.resolve();

    assert.deepEqual(observedEvent, {
      output: { loaded: true },
      type: 'done.invoke.load-content',
    });
    assert.equal(actor.getSnapshot().value, 'complete');
  });

  it('publishes targeted re-entry but not ignored, targetless, or stop events', () => {
    const visited: string[] = [];
    const actor = createStateMachine({
      version: '1.1',
      id: 'notification-state-machine',
      initial: 'working',
      states: {
        working: {
          on: {
            PING: { actions: 'recordPing' },
            RETRY: 'working',
          },
        },
      },
    }, {
      actions: { recordPing: () => undefined },
    }, {
      onTransition: ({ value }) => visited.push(value),
    });

    assert.deepEqual(actor.getSnapshot(), { context: {}, status: 'idle', value: '' });
    actor.start();
    actor.send('IGNORED');
    actor.send('PING');
    actor.send('RETRY');
    actor.stop();

    assert.deepEqual(visited, ['working', 'working']);
    assert.equal(actor.getSnapshot().status, 'stopped');
  });

  it('cancels each state action scope before that state exits', () => {
    const calls: string[] = [];
    const actor = createStateMachine({
      version: '1.1',
      id: 'scope-order-state-machine',
      initial: 'scene',
      states: {
        scene: {
          entry: 'watchScene',
          exit: 'exitScene',
          initial: 'working',
          states: {
            working: {
              entry: 'watchWorking',
              exit: 'exitWorking',
              on: { FINISH: '#scope-order-state-machine.complete' },
            },
          },
        },
        complete: { type: 'final' },
      },
    }, {
      actions: {
        watchScene({ onCancel }) {
          onCancel(() => calls.push('cancel-scene'));
        },
        watchWorking({ onCancel }) {
          onCancel(() => calls.push('cancel-working'));
        },
        exitWorking: () => calls.push('exit-working'),
        exitScene: () => calls.push('exit-scene'),
      },
    });

    actor.start();
    actor.send('FINISH');

    assert.deepEqual(calls, [
      'cancel-working',
      'exit-working',
      'cancel-scene',
      'exit-scene',
    ]);
  });

  it('reports an invoke error when no guarded error transition matches', async () => {
    const failure = new Error('load failed');
    let reported: unknown;
    const actor = createStateMachine({
      version: '1.1',
      id: 'invoke-error-state-machine',
      initial: 'loading',
      states: {
        loading: {
          invoke: {
            src: 'load',
            onError: { guard: 'canRecover', target: 'recovered' },
          },
        },
        recovered: { type: 'final' },
      },
    }, {
      guards: { canRecover: () => false },
      services: { load: () => Promise.reject(failure) },
    }, {
      onError: (error) => { reported = error; },
    });

    actor.start();
    await Promise.resolve();

    assert.equal(reported, failure);
    assert.deepEqual(actor.getSnapshot(), { context: {}, status: 'error', value: 'loading' });
  });

  it('logs an invoke error even when the state machine recovers through onError', async () => {
    const failure = new Error('load failed');
    const errors: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...argumentsValue: unknown[]): void => {
      errors.push(argumentsValue);
    };
    try {
      const actor = createStateMachine({
        version: '1.1',
        id: 'recovering-invoke-error-state-machine',
        initial: 'loading',
        states: {
          loading: {
            invoke: {
              src: 'load',
              onError: { target: 'recovered' },
            },
          },
          recovered: { type: 'final' },
        },
      }, {
        services: { load: () => Promise.reject(failure) },
      });

      actor.start();
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(actor.getSnapshot().value, 'recovered');
      assert.deepEqual(errors, [['State machine service failed.', failure]]);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
