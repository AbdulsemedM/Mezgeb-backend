import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuid.js';

describe('uuidv7', () => {
  it('has the v7 version and RFC variant', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const ms = Date.UTC(2026, 9, 21, 8, 0, 0, 123);
    const id = uuidv7(ms);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ms);
  });

  it('sorts by creation time', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a < b).toBe(true);
  });

  it('is unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(5)));
    expect(ids.size).toBe(1000);
  });
});
