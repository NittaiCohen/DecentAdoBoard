export const BOARD_NODE_TYPES = {
  workItem: "workItem",
  sprintDivider: "sprintDivider",
  parentGroup: "parentGroup",
  dragGhost: "dragGhost",
} as const;

export type BoardNodeType = (typeof BOARD_NODE_TYPES)[keyof typeof BOARD_NODE_TYPES];

export function isBoardNodeType(value: string | undefined): value is BoardNodeType {
  return Object.values(BOARD_NODE_TYPES).some((nodeType) => nodeType === value);
}
