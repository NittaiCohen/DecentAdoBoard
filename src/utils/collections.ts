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
