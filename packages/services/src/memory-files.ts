import type { JsonFiles } from './platform.js';

/**
 * JsonFiles kept in memory. `persist` is called after every change with the
 * document name and its new JSON text (or null when removed), so a platform
 * can write it through to durable storage.
 */
export function memoryFiles(initial: Record<string, string> = {}, persist?: (name: string, json: string | null) => void): JsonFiles {
  const docs = new Map<string, string>(Object.entries(initial));
  return {
    read: <T>(name: string): T | null => {
      for (const candidate of [name, `${name}.bak`]) {
        const text = docs.get(candidate);
        if (text === undefined) continue;
        try {
          return JSON.parse(text) as T;
        } catch {
          // fall through to the backup
        }
      }
      return null;
    },
    write: (name, value, options) => {
      const json = JSON.stringify(value, null, 2);
      const previous = docs.get(name);
      if (options?.backup && previous !== undefined) {
        docs.set(`${name}.bak`, previous);
        persist?.(`${name}.bak`, previous);
      }
      docs.set(name, json);
      persist?.(name, json);
    },
    list: (dir, suffix) => [...docs.keys()].filter((k) => k.startsWith(`${dir}/`) && k.endsWith(suffix) && !k.slice(dir.length + 1).includes('/')).sort(),
    remove: (name) => {
      for (const n of [name, `${name}.bak`]) {
        if (docs.delete(n)) persist?.(n, null);
      }
    },
  };
}
