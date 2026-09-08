import type { Iteration } from "../types";

/** Return the iteration whose dates contain the current time. */
export function getCurrentIterationPath(
  iterations: Iteration[],
  currentTime = new Date(),
): string | null {
  const currentTimestamp = currentTime.toISOString();
  return (
    iterations.find(
      (iteration) =>
        iteration.start_date !== null &&
        iteration.finish_date !== null &&
        iteration.start_date <= currentTimestamp &&
        currentTimestamp <= iteration.finish_date,
    )?.path ?? null
  );
}
