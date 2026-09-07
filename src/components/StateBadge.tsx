import { DEFAULT_STATE_BADGE, STATE_BADGES } from "../utils/workItemColors";

interface StateBadgeProps {
  state: string;
  className?: string;
}

export default function StateBadge({ state, className = "" }: StateBadgeProps) {
  const stateClass = STATE_BADGES[state] ?? DEFAULT_STATE_BADGE;

  return (
    <span className={`rounded px-1 py-0.5 text-[10px] ${stateClass} ${className}`}>{state}</span>
  );
}
