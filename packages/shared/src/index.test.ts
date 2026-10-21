import { describe, expect, it } from 'vitest';
import { SANTIM_PER_BIRR } from './index.js';

describe('@mezgeb/shared', () => {
  it('exposes the santim constant', () => {
    expect(SANTIM_PER_BIRR).toBe(100);
  });
});
