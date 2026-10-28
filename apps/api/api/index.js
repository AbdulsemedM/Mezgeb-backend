// ADR-017: Vercel's function entry. `pnpm build` writes dist/ before Vercel bundles this file.
export { default } from '../dist/serverless.js';
