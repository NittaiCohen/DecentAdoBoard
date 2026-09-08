import type { WorkItemTypeState } from "../types";

export interface StateOption {
  name: string;
  color?: string;
}

export function getOrderedStateOptions(
  stateDefinitions: WorkItemTypeState[],
  allowedStateNames?: string[],
): StateOption[] {
  if (allowedStateNames === undefined) {
    return stateDefinitions.map((stateDefinition) => ({
      name: stateDefinition.name,
      color: stateDefinition.color,
    }));
  }

  const allowedNames = new Set(allowedStateNames);
  const options: StateOption[] = stateDefinitions
    .filter((stateDefinition) => allowedNames.has(stateDefinition.name))
    .map((stateDefinition) => ({
      name: stateDefinition.name,
      color: stateDefinition.color,
    }));

  const definitionNames = new Set(options.map((option) => option.name));
  for (const stateName of allowedStateNames) {
    if (!definitionNames.has(stateName)) {
      options.push({ name: stateName });
    }
  }

  return options;
}
