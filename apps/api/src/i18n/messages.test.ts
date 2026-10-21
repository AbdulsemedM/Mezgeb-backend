import { describe, expect, it } from 'vitest';
import { t } from './messages.js';

describe('t', () => {
  it.each(['am', 'om', 'en'] as const)(
    'renders sms.otp in %s with every placeholder filled',
    (lang) => {
      const text = t('sms.otp', lang, { code: '123456', minutes: 5 });
      expect(text).toContain('123456');
      expect(text).toContain('5');
      expect(text).not.toMatch(/\{\w+\}/);
    },
  );

  it('leaves unknown placeholders visible rather than blank', () => {
    expect(t('sms.otp', 'en', { code: '1' })).toContain('{minutes}');
  });
});
