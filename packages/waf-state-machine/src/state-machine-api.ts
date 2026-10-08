export { createStateMachine } from './state-machine/xstate-adapter.ts';
export {
  createInteractableRegistry,
} from './state-machine/interactable-registry.ts';
export type {
  ArmedInteractable,
  RegisteredInteractable,
  StateMachineInteractableDescriptor,
  StateMachineInteractableInputType,
  StateMachineInteractableRegistrar,
  StateMachineInteractableRegistry,
} from './state-machine/interactable-registry.ts';
export {
  ACTIVITY_SCENES_CONFIGURATION_KEY,
  sceneCatalogFromConfiguration,
} from './activity/scene-catalog.ts';
export type {
  ActivitySceneCatalog,
  ActivitySceneMetadata,
} from './activity/scene-catalog.ts';
export {
  assertValidStateMachineDefinition,
  StateMachineDefinitionError,
  validateStateMachineDefinition,
} from './state-machine/validation.ts';
export type {
  StateMachineActor,
  StateMachineDefinition,
  StateMachineImplementations,
  CreateStateMachineOptions,
  StateMachineAction,
  StateMachineArguments,
  StateMachineEffectArguments,
  StateMachineEvent,
  StateMachineGuard,
  StateMachineInvokeDefinition,
  StateMachineImplementationReference,
  StateMachineService,
  StateMachineServiceArguments,
  StateMachineSnapshot,
  StateMachineStateDefinition,
  StateMachineStatus,
  StateMachineTransition,
  StateMachineTransitionDefinition,
  StateMachineValidationIssue,
  StateMachineValidationOptions,
  StateMachineValidationResult,
  NamedImplementation,
  StartStateMachineOptions,
} from './state-machine/types.ts';
