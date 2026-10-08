import type { StateMachineDefinition } from '../state-machine/types.ts';
import { assertValidStateMachineDefinition } from '../state-machine/validation.ts';

export const STATE_MACHINE_CONFIGURATION_KEY = 'stateMachine';
const LEGACY_STATE_MACHINE_CONFIGURATION_KEY = 'activityMachine';

export function stateMachineDefinitionFromConfiguration(configuration: Record<string, unknown>): StateMachineDefinition {
  const definition = configuration[STATE_MACHINE_CONFIGURATION_KEY]
    ?? configuration[LEGACY_STATE_MACHINE_CONFIGURATION_KEY];
  assertValidStateMachineDefinition(definition, { requireActivityComplete: true });
  return definition;
}
