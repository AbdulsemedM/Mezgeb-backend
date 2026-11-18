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

  it('DEV_ROUTES defaults to false and is allowed only in development', () => {
    expect(parseEnv(valid).DEV_ROUTES).toBe(false);
    expect(parseEnv({ ...valid, DEV_ROUTES: 'true' }).DEV_ROUTES).toBe(true);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production', DEV_ROUTES: 'true' })).toThrow(
      /DEV_ROUTES/,
    );
    expect(() => parseEnv({ ...valid, NODE_ENV: 'test', DEV_ROUTES: 'true' })).toThrow(
      /DEV_ROUTES/,
    );
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

  it('defaults to the console SMS gateway', () => {
    expect(parseEnv(valid).SMS_PROVIDER).toBe('console');
  });

  it('needs Coopbank credentials for SMS_PROVIDER=coopbank', () => {
    expect(() => parseEnv({ ...valid, SMS_PROVIDER: 'coopbank' })).toThrow(
      /COOPBANK_SMS_CLIENT_SECRET/,
    );
    const config = parseEnv({
      ...valid,
      SMS_PROVIDER: 'coopbank',
      COOPBANK_SMS_CLIENT_ID: 'id',
      COOPBANK_SMS_CLIENT_SECRET: 'secret',
    });
    expect(config.COOPBANK_SMS_SEND_URL).toMatch(/^https:\/\//);
  });

  it('refuses OTP_FIXED_CODE with real SMS', () => {
    expect(() =>
      parseEnv({
        ...valid,
        SMS_PROVIDER: 'coopbank',
        COOPBANK_SMS_CLIENT_ID: 'id',
        COOPBANK_SMS_CLIENT_SECRET: 'secret',
        OTP_FIXED_CODE: '654321',
      }),
    ).toThrow(/OTP_FIXED_CODE/);
  });

  it('needs Upstash settings for SMS_PROVIDER=queue', () => {
    expect(() => parseEnv({ ...valid, SMS_PROVIDER: 'queue' })).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
    const config = parseEnv({
      ...valid,
      SMS_PROVIDER: 'queue',
      UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    expect(config.SMS_QUEUE_KEY).toBe('mezgeb:sms');
  });
});
