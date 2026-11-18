# Mezgeb SMS relay

Coopbank's SMS API only answers callers on the bank's allowlist; Vercel is not on it (ADR-018).
The API (`SMS_PROVIDER=queue`) pushes each SMS onto an Upstash Redis list; this relay, running on
a bank server, takes them off and sends them through Coopbank. It only makes outbound HTTPS
calls, so the server needs no open port.

One file, no dependencies, Node 22+.

## Install (no root needed)

```sh
mkdir -p ~/.local ~/mezgeb-sms-relay
curl -fsSL https://nodejs.org/dist/v22.22.2/node-v22.22.2-linux-x64.tar.xz | tar -xJ -C ~/.local
ln -sfn ~/.local/node-v22.22.2-linux-x64 ~/.local/node
# copy relay.mjs and relay.env (from relay.env.example) into ~/mezgeb-sms-relay
chmod 600 ~/mezgeb-sms-relay/relay.env
```

Keep it running with cron: every minute, start it unless it is already running (the lock file
makes a second copy exit at once). This also starts it after a reboot.

```cron
* * * * * cd $HOME/mezgeb-sms-relay && flock -n relay.lock $HOME/.local/node/bin/node --env-file=relay.env relay.mjs >> relay.log 2>&1
```

## Operate

- Logs: `tail -f ~/mezgeb-sms-relay/relay.log` (one line per SMS, phone masked).
- Stop: `pkill -f 'node --env-file=relay.env relay.mjs'`; cron
  starts it again within a minute (remove the crontab line to stop it for good).
- Messages that failed three times: `LRANGE mezgeb:sms:failed 0 -1` in the Upstash console.
- Waiting: `LLEN mezgeb:sms`.
