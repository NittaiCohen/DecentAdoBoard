import { isNil } from "lodash-es";

/** Group items by a key function, returning a Map from key to array of items. */
export function mapBy<K, V>(items: Iterable<V>, keyFn: (item: V) => K): Map<K, V[]> {
  const groups = new Map<K, V[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

/** Return an item's ancestors, starting with its direct parent. */
export function getAncestors<T>(
  item: T | null | undefined,
  getParent: (item: T) => T | null | undefined,
): T[] {
  const ancestors: T[] = [];
  const visitedItems = new Set<T>();

  for (
    let currentItem = isNil(item) ? undefined : getParent(item);
    !isNil(currentItem) && !visitedItems.has(currentItem);
    currentItem = getParent(currentItem)
  ) {
    visitedItems.add(currentItem);
    ancestors.push(currentItem);
  }

  return ancestors;
}
