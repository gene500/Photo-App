/** Removes every key that starts with `prefix`. Keys are collected first because removing while iterating shifts the indexes. */
export function removeKeysWithPrefix(s: Storage, prefix: string): void {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  for (const k of keys) s.removeItem(k);
}
