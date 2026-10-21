import { readFileSync } from 'node:fs';

/** Test-only helper: loads `packages/shared/test-vectors/<name>.json`. */
export function loadVectors<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../test-vectors/${name}.json`, import.meta.url), 'utf8'),
  ) as T;
}
