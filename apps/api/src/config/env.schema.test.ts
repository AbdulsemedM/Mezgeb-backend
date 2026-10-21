import { describe, expect, it } from 'vitest';
import { InvalidEnvError, parseEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  JWT_SECRET: 'j'.repeat(32),
  OTP_PEPPER: 'p'.repeat(32),
};

describe('parseEnv', () => {
  it('parses a valid env and applies defaults', () => {
    const config = parseEnv({ ...valid, PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('fails when DATABASE_URL is missing', () => {
    const rest: Record<string, string | undefined> = { ...valid, DATABASE_URL: undefined };
    expect(() => parseEnv(rest)).toThrow(InvalidEnvError);
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('fails on a short JWT_SECRET', () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('parses TRUST_PROXY as a boolean, default false', () => {
    expect(parseEnv(valid).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...valid, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
  });

  it('fails on a non-numeric PORT', () => {
    expect(() => parseEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('lists every invalid variable at once', () => {
    expect(() => parseEnv({})).toThrow(InvalidEnvError);
    try {
      parseEnv({});
    } catch (err) {
      expect((err as InvalidEnvError).issues.length).toBeGreaterThanOrEqual(5);
    }
  });
});
