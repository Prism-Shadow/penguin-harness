import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateStateMachineDefinition } from '../../src/state-machine/validation.ts';

describe('validateStateMachineDefinition', () => {
  it('rejects invocations attached to compound states that the runtime cannot execute', () => {
    const result = validateStateMachineDefinition({
      version: '1.1',
      id: 'compound-invoke',
      initial: 'scene',
      states: {
        scene: {
          initial: 'ready',
          invoke: { src: 'load' },
          states: { ready: {} },
        },
      },
    });

    assert.equal(result.valid, false);
    assert.ok(result.issues.some((entry) => entry.code === 'invoke.compound'));
  });

  it('rejects final leaves that bypass activity.complete in activity mode', () => {
    const result = validateStateMachineDefinition({
      version: '1.1',
      id: 'early-final',
      initial: 'scene',
      states: {
        scene: { type: 'final' },
        activity: { initial: 'complete', states: { complete: { type: 'final' } } },
      },
    }, { requireActivityComplete: true });

    assert.equal(result.valid, false);
    assert.ok(result.issues.some((entry) => entry.code === 'state.final.location'));
  });

  it('reports unknown targets, scenes, implementations, and missing terminal state', () => {
    const result = validateStateMachineDefinition({
      version: '1.0',
      id: 'broken',
      initial: 'scene-1',
      states: {
        'scene-1': {
          entry: 'renderScene',
          on: { NEXT: 'missing' },
        },
      },
    }, {
      implementationNames: new Set(),
      requireActivityComplete: true,
      sceneIds: ['scene-1', 'scene-2'],
    });
    assert.equal(result.valid, false);
    assert.deepEqual(new Set(result.issues.map((item) => item.code)), new Set([
      'transition.target.unknown',
      'implementation.missing',
      'scene.missing',
      'activity.complete',
    ]));
  });

  it('accepts guarded arrays for invoked outcomes', () => {
    const result = validateStateMachineDefinition({
      version: '1.0',
      id: 'valid',
      initial: 'scene-1',
      states: {
        'scene-1': {
          invoke: {
            src: 'evaluate',
            onDone: [
              { guard: 'complete', target: 'activity' },
              { target: 'scene-1' },
            ],
          },
        },
        activity: {
          initial: 'complete',
          states: { complete: { type: 'final' } },
        },
      },
    }, {
      implementationNames: new Set(['evaluate', 'complete']),
      requireActivityComplete: true,
      sceneIds: ['scene-1'],
    });
    assert.deepEqual(result, { issues: [], valid: true });
  });

  it('accepts v1.1 action and guard descriptors and validates their names', () => {
    const result = validateStateMachineDefinition({
      version: '1.1',
      id: 'event-driven',
      description: 'Observable activity behavior',
      metadata: { moduleId: 'example' },
      initial: 'scene-1',
      states: {
        'scene-1': {
          initial: 'awaiting-choice',
          states: {
            'awaiting-choice': {
              on: {
                'CHOICE.SELECTED': [
                  {
                    guard: { type: 'choice.isCorrect', params: { answer: 'A' } },
                    actions: { type: 'assessment.submit', params: { attempt: 1 } },
                    target: '#event-driven.activity.complete',
                  },
                  { target: 'incorrect-feedback' },
                ],
              },
            },
            'incorrect-feedback': {},
          },
        },
        activity: {
          initial: 'complete',
          states: { complete: { type: 'final' } },
        },
      },
    }, {
      implementationNames: new Set(['choice.isCorrect', 'assessment.submit']),
      requireActivityComplete: true,
      sceneIds: ['scene-1'],
    });

    assert.deepEqual(result, { issues: [], valid: true });
  });

  it('rejects unreachable branches after an unguarded fallback', () => {
    const result = validateStateMachineDefinition({
      version: '1.1',
      id: 'unreachable',
      initial: 'choosing',
      states: {
        choosing: {
          on: {
            CHOICE: [
              { target: 'fallback' },
              { guard: { type: 'isCorrect' }, target: 'complete' },
            ],
          },
        },
        fallback: {},
        complete: { type: 'final' },
      },
    });

    assert.equal(result.valid, false);
    assert.ok(result.issues.some((item) => item.code === 'transition.unreachable'));
  });

  it('validates watchdog delays, targets, and final-state placement', () => {
    const result = validateStateMachineDefinition({
      version: '1.1',
      id: 'watchdog',
      initial: 'waiting',
      states: {
        waiting: {
          after: {
            '30000': [{ guard: 'isRecoverable', target: 'recovery' }],
          },
        },
        recovery: {
          after: {
            notANumber: 'activity',
          },
        },
      },
    }, { implementationNames: new Set() });

    const codes = result.issues.map((item) => item.code);
    assert.ok(codes.includes('transition.target.unknown'), 'watchdog targets must resolve');
    assert.ok(codes.includes('after.delay'), 'non-numeric delays must be rejected');
    assert.ok(codes.includes('implementation.missing'), 'watchdog guards count as implementations');
  });

  it('rejects watchdogs on final states', () => {
    const result = validateStateMachineDefinition({
      version: '1.1',
      id: 'final-watchdog',
      initial: 'activity',
      states: {
        activity: {
          initial: 'complete',
          states: {
            complete: {
              type: 'final',
              after: { '1000': 'complete' },
            },
          },
        },
      },
    });

    assert.ok(result.issues.some((item) => item.code === 'state.final.children'));
  });
});

