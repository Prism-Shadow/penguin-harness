import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createActivityState } from '../../src/activity/activity-state.ts';

function rootElement(): HTMLElement {
  const target = new EventTarget() as EventTarget & { dataset: DOMStringMap };
  target.dataset = {} as DOMStringMap;
  return target as unknown as HTMLElement;
}

describe('createActivityState', () => {
  it('publishes semantic state snapshots for the browser harness', async () => {
    const root = rootElement();
    const observer = createActivityState(root, 'activity.initializing');
    const waiting = observer.waitForState('scene-1.awaiting-selection');
    observer.enter('scene-1.awaiting-selection', { interactive: true, privateValue: { hidden: true } });
    const record = await waiting;
    assert.equal(record.state, 'scene-1.awaiting-selection');
    assert.deepEqual(record.details, { interactive: true });
    assert.deepEqual(observer.getSnapshot(), {
      index: 2,
      interactive: true,
      phase: 'awaiting-selection',
      sceneId: 'scene-1',
      state: 'scene-1.awaiting-selection',
    });
  });

  it('records media against the active state', () => {
    const observer = createActivityState(rootElement(), 'scene-1.playing');
    observer.recordMedia('video', 'opening', 'started');
    assert.equal(observer.getMediaHistory()[0]?.state, 'scene-1.playing');
  });

  it('isolates observer failures from state and media updates', () => {
    const observer = createActivityState(rootElement(), 'scene-1.playing');
    const observerErrors: unknown[][] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => {
      observerErrors.push(args);
    };
    try {
      observer.subscribe(() => {
        throw new Error('state observer failed');
      });
      observer.subscribeMedia(() => {
        throw new Error('media observer failed');
      });

      assert.equal(observer.enter('scene-1.awaiting-selection').index, 2);
      assert.equal(observer.recordMedia('audio', 'narration', 'started').index, 1);
    } finally {
      console.error = consoleError;
    }

    assert.equal(observerErrors.length, 2);
    assert.equal(observer.getSnapshot().state, 'scene-1.awaiting-selection');
    assert.equal(observer.getMediaHistory().length, 1);
  });

  it('rejects numbered phase names', () => {
    assert.throws(() => createActivityState(rootElement(), 'scene-1.state-1'), /semantic/);
  });
});
