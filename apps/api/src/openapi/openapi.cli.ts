import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildOpenApi } from './openapi.js';

/** `pnpm --filter @mezgeb/api openapi`: writes docs/api/openapi.json (committed; CI checks it). */
const out = process.argv[2] ?? '../../docs/api/openapi.json';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`wrote ${out}`);
