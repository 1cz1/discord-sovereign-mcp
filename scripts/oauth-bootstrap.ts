/**
 * OAuth2 bootstrap for discord-sovereign-mcp.
 *
 * Runs a one-shot local flow:
 *   1. reads OAuth2 env vars from .env
 *   2. opens the Discord authorization URL in the browser
 *   3. listens on the configured redirect port for the callback
 *   4. exchanges the code for a user token and writes it into .env
 *      (DISCORD_TOKEN_TYPE=oauth2, DISCORD_TOKEN=<token>)
 *
 * Usage:
 *   npm run oauth              # full flow (opens browser, waits for callback)
 *   npm run oauth -- --no-open # print the URL instead of opening the browser
 *   npm run oauth -- --print-url-only
 */
import { config as loadDotenv } from 'dotenv';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { buildAuthorizationUrl, exchangeCode, fetchCurrentAuthorization, persistTokenToEnv } from '../src/services/oauthService.js';
import type { OAuthConfig } from '../src/config.js';

loadDotenv();

const ENV = process.env;
const redirectUri = ENV['DISCORD_OAUTH2_REDIRECT_URI'] ?? 'http://localhost:8788/callback';
const port = Number(ENV['DISCORD_OAUTH2_PORT'] ?? 8788);

const cfg: OAuthConfig = {
  clientId: ENV['DISCORD_OAUTH2_CLIENT_ID'] ?? '',
  clientSecret: ENV['DISCORD_OAUTH2_CLIENT_SECRET'] ?? '',
  redirectUri,
  port,
};

function die(message: string): never {
  console.error(`\n❌ ${message}`);
  console.error('Create an application at https://discord.com/developers/applications, then set the OAuth2 env vars in .env (see .env.example).');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const printUrlOnly = args.has('--print-url-only');

let url: string;
try {
  url = buildAuthorizationUrl(cfg);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}

if (printUrlOnly) {
  console.log(url);
  process.exit(0);
}

console.log('\n[discord-sovereign-mcp] OAuth2 bootstrap');
console.log(`  redirect_uri : ${cfg.redirectUri}`);
console.log(`  listening    : http://localhost:${port}/callback`);
console.log(`  authorize at : ${url}\n`);

if (!args.has('--no-open')) {
  const opener =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] :
    process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    console.log('Open the URL above in your browser to continue.');
  }
}

const server = createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (reqUrl.pathname !== '/callback') {
    res.writeHead(404).end('Not found');
    return;
  }

  const error = reqUrl.searchParams.get('error');
  if (error) {
    res.writeHead(400).end(`<h2>Authorization failed: ${error}</h2>`);
    console.error(`\n❌ Discord returned error: ${error}`);
    process.exit(1);
  }

  const code = reqUrl.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('<h2>Missing authorization code</h2>');
    console.error('\n❌ No code in callback URL.');
    process.exit(1);
  }

  try {
    const token = await exchangeCode(cfg, code);
    const identity = await fetchCurrentAuthorization(token.access_token);
    persistTokenToEnv('.env', token.access_token);
    const username = identity.user?.username ?? 'user';
    console.error(`\n✅ OAuth2 bootstrap complete for ${username}.`);
    console.error('   DISCORD_TOKEN and DISCORD_TOKEN_TYPE=oauth2 written to .env.');
    console.error('   Restart the server to authenticate with the user token (npm run dev or npm start).\n');
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(
        '<html><body style="font-family:sans-serif;padding:2rem">' +
          '<h2>Authorization successful</h2>' +
          `<p>Signed in as <strong>${username}</strong>.</p>` +
          '<p>You can close this tab. Restart the MCP server to pick up the user token.</p>' +
          '</body></html>'
      );
    server.close(() => process.exit(0));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Token exchange failed: ${message}`);
    res.writeHead(500).end(`<h2>Token exchange failed</h2><p>${message}</p>`);
    process.exit(1);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Waiting for the callback at http://localhost:${port}/callback ...`);
});