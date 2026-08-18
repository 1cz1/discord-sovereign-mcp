/**
 * OAuth2 bootstrap wrapper: delegates to src/bootstrap/oauthBootstrap.ts so the
 * same flow is available from `npx discord-sovereign-mcp --oauth`.
 *
 * Usage:
 *   npm run oauth              # full flow (opens browser, waits for callback)
 *   npm run oauth -- --no-open # print the URL instead of opening the browser
 *   npm run oauth -- --print-url-only
 */
import { config as loadDotenv } from 'dotenv';
import { runOAuthBootstrap } from '../src/bootstrap/oauthBootstrap.js';

loadDotenv();

const exitCode = await runOAuthBootstrap(process.argv.slice(2), process.env);
process.exit(exitCode);