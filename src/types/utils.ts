/*
    Takes type T and makes the specified properties required and non-nullable.

    e.g:
    interface Task {
        id: number;
        parent_id: number | null;
        description?: string;
    }

    type TaskWithParent = RequiredSome<Task, "parent_id">;
    const task: TaskWithParent = {
        // id: number
        // parent_id: number (no longer nullable)
        // description: still optional
    }
*/
export type RequiredSome<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: NonNullable<T[P]>;
};

export interface Point {
  x: number;
  y: number;
}
