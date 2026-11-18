// Mezgeb SMS relay (ADR-018). Runs on a server inside Cooperative Bank of Oromia's allowlist.
// Takes SMS the API queued on an Upstash Redis list and sends them through the Coopbank SMS API.
//
// No dependencies; Node 22+. Settings come from the environment (see relay.env.example):
//   node --env-file=relay.env relay.mjs
//
// Queue: the API LPUSHes JSON `{id, to, text, created_at}` onto SMS_QUEUE_KEY. The relay moves one
// item at a time to `<key>:processing`, sends it, then removes it. Items left in processing by a
// crash go back to the queue at start (an SMS may then go out twice, never zero times). Items
// that keep failing go to `<key>:failed` (last 500 kept) for a person to look at.

const env = process.env;
const required = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'COOPBANK_SMS_CLIENT_ID',
  'COOPBANK_SMS_CLIENT_SECRET',
];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`relay: missing settings: ${missing.join(', ')}`);
  process.exit(1);
}

const QUEUE = env.SMS_QUEUE_KEY || 'mezgeb:sms';
const PROCESSING = `${QUEUE}:processing`;
const FAILED = `${QUEUE}:failed`;
const TOKEN_URL =
  env.COOPBANK_SMS_TOKEN_URL || 'https://controlplane-apim-uat.coopbankoromiasc.com/oauth2/token';
const SEND_URL =
  env.COOPBANK_SMS_SEND_URL ||
  'https://externalgateway-apim-uat.coopbankoromiasc.com/api/sms/1.0.0/send';
/** Drop messages older than this (an OTP is useless after 5 minutes). */
const MAX_AGE_MS = Number(env.SMS_MAX_AGE_S || 3600) * 1000;
/** How long one blocking wait on the queue lasts. */
const BLOCK_S = Number(env.BLOCK_S || 20);
/** Poll interval when the queue cannot block; Upstash's free tier counts every command. */
const POLL_MS = Number(env.POLL_MS || 10_000);
const SEND_ATTEMPTS = 3;

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`${sig}: stopping after the current message`);
    stopping = true;
  });
}

function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function mask(phone) {
  return typeof phone === 'string' && phone.length > 4 ? `****${phone.slice(-4)}` : '****';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Upstash Redis over REST ----

async function redis(cmd, timeoutMs = 10_000) {
  const res = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`redis ${cmd[0]}: HTTP ${res.status} ${json.error ?? ''}`);
  }
  return json.result;
}

/** Null when blocking commands are refused; then the relay polls. */
let canBlock = true;

async function take() {
  if (canBlock) {
    try {
      return await redis(
        ['BLMOVE', QUEUE, PROCESSING, 'RIGHT', 'LEFT', String(BLOCK_S)],
        (BLOCK_S + 10) * 1000,
      );
    } catch (err) {
      if (/unknown command|not supported|blocking/i.test(String(err.message))) {
        log(`blocking pop refused (${err.message}); polling every ${POLL_MS} ms`);
        canBlock = false;
      } else {
        throw err;
      }
    }
  }
  const item = await redis(['LMOVE', QUEUE, PROCESSING, 'RIGHT', 'LEFT']);
  if (item === null) await sleep(POLL_MS);
  return item;
}

async function recover() {
  let n = 0;
  while ((await redis(['LMOVE', PROCESSING, QUEUE, 'LEFT', 'RIGHT'])) !== null) n++;
  if (n) log(`recovered ${n} message(s) left in processing`);
}

// ---- Coopbank SMS API ----

let token = null; // { value, expiresAt }

async function accessToken() {
  if (token && Date.now() < token.expiresAt) return token.value;
  const basic = Buffer.from(
    `${env.COOPBANK_SMS_CLIENT_ID}:${env.COOPBANK_SMS_CLIENT_SECRET}`,
  ).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    // An HTML page from a firewall: reported below.
  }
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new Error(`token: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const ttl = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000;
  token = { value: json.access_token, expiresAt: Date.now() + Math.max(0, ttl - 60_000) };
  return token.value;
}

/** `+251912345678` → `0912345678`. */
function localPhone(e164) {
  const m = /^\+251(\d{9})$/.exec(e164);
  if (!m) throw new PermanentError(`not an Ethiopian E.164 number: ${mask(e164)}`);
  return `0${m[1]}`;
}

class PermanentError extends Error {}

async function sendOnce(to, text) {
  const body = JSON.stringify({ phone_number: localPhone(to), text });
  const post = async () =>
    fetch(SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await accessToken()}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  let res = await post();
  if (res.status === 401) {
    token = null;
    res = await post();
  }
  const answer = await res.text();
  let success;
  try {
    success = JSON.parse(answer).success;
  } catch {
    // Not JSON.
  }
  if (!res.ok || success === false) {
    throw new Error(`send: HTTP ${res.status} ${answer.slice(0, 200)}`);
  }
}

// ---- Main loop ----

async function handle(raw) {
  let item;
  try {
    item = JSON.parse(raw);
  } catch {
    log('dropped a message that is not JSON');
    return 'drop';
  }
  const age = Date.now() - Number(item.created_at);
  if (!(age < MAX_AGE_MS)) {
    log(`dropped ${item.id} to ${mask(item.to)}: ${Math.round(age / 1000)} s old`);
    return 'drop';
  }
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    try {
      await sendOnce(item.to, item.text);
      log(`sent ${item.id} to ${mask(item.to)} after ${Math.round(age / 1000)} s`);
      return 'sent';
    } catch (err) {
      log(`attempt ${attempt} for ${item.id} failed: ${err.message}`);
      if (err instanceof PermanentError) break;
      if (attempt < SEND_ATTEMPTS) await sleep(attempt * 3000);
    }
  }
  return 'failed';
}

async function main() {
  log(`relay started: queue ${QUEUE}, sending to ${new URL(SEND_URL).host}`);
  await recover();
  let backoff = 1000;
  while (!stopping) {
    try {
      const raw = await take();
      backoff = 1000;
      if (raw === null) continue;
      const outcome = await handle(raw);
      if (outcome === 'failed') {
        await redis(['LPUSH', FAILED, raw]);
        await redis(['LTRIM', FAILED, '0', '499']);
      }
      await redis(['LREM', PROCESSING, '1', raw]);
    } catch (err) {
      // Network trouble with Upstash: wait and try again, up to a minute apart.
      log(`queue error: ${err.message}; retrying in ${backoff / 1000} s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
  log('relay stopped');
}

main();
