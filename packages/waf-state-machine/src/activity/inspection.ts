import type { ActivityStateObserver } from './activity-state.ts';
import type {
  ArmedInteractable,
  StateMachineInteractableRegistry,
} from '../state-machine/interactable-registry.ts';
import type { StateMachineDefinition } from '../state-machine/types.ts';

export interface ActivityInspection<TContext extends object = Record<string, unknown>> {
  getCursor: ActivityStateObserver['getCursor'];
  getCurrentState(): {
    readonly interactables: readonly ArmedInteractable[];
    readonly snapshot: ReturnType<ActivityStateObserver['getSnapshot']>;
  };
  getHistory: ActivityStateObserver['getHistory'];
  getMediaCursor: ActivityStateObserver['getMediaCursor'];
  getMediaHistory: ActivityStateObserver['getMediaHistory'];
  getSnapshot: ActivityStateObserver['getSnapshot'];
  getStateMachineDefinition(): StateMachineDefinition<TContext>;
  waitForMedia: ActivityStateObserver['waitForMedia'];
  waitForState: ActivityStateObserver['waitForState'];
  readonly version: 1;
}

export function createActivityInspection<TContext extends object>(
  activityState: ActivityStateObserver,
  interactables: StateMachineInteractableRegistry,
  definition: StateMachineDefinition<TContext>,
): ActivityInspection<TContext> {
  return Object.freeze({
    getCursor: activityState.getCursor,
    getCurrentState: () => ({
      interactables: structuredClone(interactables.list()),
      snapshot: activityState.getSnapshot(),
    }),
    getHistory: activityState.getHistory,
    getMediaCursor: activityState.getMediaCursor,
    getMediaHistory: activityState.getMediaHistory,
    getSnapshot: activityState.getSnapshot,
    getStateMachineDefinition: () => structuredClone(definition),
    waitForMedia: activityState.waitForMedia,
    waitForState: activityState.waitForState,
    version: 1,
  });
}
