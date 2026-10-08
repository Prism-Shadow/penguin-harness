import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindInteractableRegistrationContext,
  createInteractableRegistry,
} from '../../src/state-machine/interactable-registry.ts';

function fakeElement(id = 'choice-apple'): Element {
  const attributes = new Map<string, string>();
  return {
    id,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => attributes.delete(name),
    hasAttribute: (name: string) => attributes.has(name),
  } as unknown as Element;
}

describe('createInteractableRegistry', () => {
  it('registers, lists, and disposes armed interactables with DOM annotations', () => {
    const registry = createInteractableRegistry();
    const element = fakeElement();

    const registered = registry.register(element, {
      id: 'choice-apple',
      inputType: 'SELECT_CLICK',
      event: 'CHOICE.SELECTED',
      params: { choiceId: 'apple', isCorrect: true },
    });

    assert.deepEqual(registry.list(), [
      {
        id: 'choice-apple',
        inputType: 'SELECT_CLICK',
        event: 'CHOICE.SELECTED',
        params: { choiceId: 'apple', isCorrect: true },
      },
    ]);
    assert.equal(element.getAttribute('data-interactable-id'), 'choice-apple');
    assert.equal(element.getAttribute('data-interactable-input-type'), 'SELECT_CLICK');

    registered.dispose();

    assert.deepEqual(registry.list(), []);
    assert.equal(element.getAttribute('data-interactable-id'), null);
    assert.equal(element.getAttribute('data-interactable-input-type'), null);
  });

  it('publishes registry changes until unsubscribed', () => {
    const registry = createInteractableRegistry();
    const snapshots: Array<readonly { readonly id: string }[]> = [];
    const unsubscribe = registry.subscribe((interactables) => snapshots.push(interactables));

    const first = registry.register(fakeElement('choice-a'), {
      id: 'choice-a',
      inputType: 'CLICK',
    });
    registry.register(fakeElement('choice-b'), {
      id: 'choice-b',
      inputType: 'SELECT',
    });
    first.dispose();
    registry.clear();
    unsubscribe();
    registry.register(fakeElement('choice-c'), {
      id: 'choice-c',
      inputType: 'DRAG',
    });

    assert.deepEqual(snapshots.map((snapshot) => snapshot.map(({ id }) => ({ id }))), [
      [{ id: 'choice-a' }],
      [{ id: 'choice-a' }, { id: 'choice-b' }],
      [{ id: 'choice-b' }],
      [],
    ]);
  });

  it('rejects duplicate armed ids and malformed descriptors', () => {
    const registry = createInteractableRegistry();
    registry.register(fakeElement(), { id: 'hotspot', inputType: 'CLICK' });

    assert.throws(
      () => registry.register(fakeElement(), { id: 'hotspot', inputType: 'CLICK' }),
      /already armed/,
    );
    assert.throws(
      () => registry.register(fakeElement(), { id: 'bad', inputType: 'TAP' as never }),
      /inputType must be one of/,
    );
    assert.throws(
      () => registry.register(fakeElement(), { id: '', inputType: 'CLICK' }),
      /non-empty id/,
    );
  });

  it('disposes automatically through the bound registration context', () => {
    const registry = createInteractableRegistry();
    const cancellations: Array<() => void> = [];
    bindInteractableRegistrationContext(registry, () => ({
      onCancel: (callback) => cancellations.push(callback),
    }));

    const element = fakeElement();
    registry.register(element, { id: 'choice-b', inputType: 'CLICK' });
    assert.equal(registry.list().length, 1);

    cancellations.splice(0).forEach((callback) => callback());

    assert.deepEqual(registry.list(), []);
    assert.equal(element.getAttribute('data-interactable-id'), null);
  });

  it('does not remove annotations from a newer registration', () => {
    const registry = createInteractableRegistry();
    const element = fakeElement();
    const staleRegistration = registry.register(element, {
      id: 'choice-apple',
      inputType: 'CLICK',
    });

    registry.clear();
    registry.register(element, {
      id: 'choice-apple',
      inputType: 'SELECT_CLICK',
    });
    staleRegistration.dispose();

    assert.equal(element.getAttribute('data-interactable-id'), 'choice-apple');
    assert.equal(element.getAttribute('data-interactable-input-type'), 'SELECT_CLICK');
    assert.equal(registry.list().length, 1);
  });
});
