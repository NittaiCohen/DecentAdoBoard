import type { Iteration } from "../types";

export function findCurrentIterationPath(
  iterations: Iteration[],
  currentDate = new Date(),
): string | undefined {
  const currentTimestamp = currentDate.toISOString();

  return iterations.find(
    (iteration) =>
      iteration.start_date !== null &&
      iteration.finish_date !== null &&
      iteration.start_date <= currentTimestamp &&
      currentTimestamp <= iteration.finish_date,
  )?.path;
}
