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
 * Used by both `npm run oauth` (scripts/oauth-bootstrap.ts) and
 * `npx discord-sovereign-mcp --oauth` (src/index.ts).
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import {
  buildAuthorizationUrl,
  exchangeCode,
  fetchCurrentAuthorization,
  oauthSuccessHtml,
  persistTokenToEnv,
} from '../services/oauthService.js';
import { buildOAuthConfig } from '../config.js';

function die(message: string): never {
  console.error(`\n❌ ${message}`);
  console.error('Create an application at https://discord.com/developers/applications, then set the OAuth2 env vars in .env (see .env.example).');
  process.exit(1);
}

/**
 * Runs the one-shot OAuth2 bootstrap. Prints the authorization URL, opens the
 * browser (unless --no-open/--print-url-only), waits for the callback, exchanges
 * the code, and persists the user token into .env. Calls process.exit on
 * completion; returns the exit code otherwise.
 */
export function runOAuthBootstrap(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const cfg = buildOAuthConfig(env);
  const args = new Set(argv);
  const printUrlOnly = args.has('--print-url-only');

  let url: string;
  try {
    url = buildAuthorizationUrl(cfg);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }

  if (printUrlOnly) {
    console.log(url);
    return Promise.resolve(0);
  }

  console.log('\n[discord-sovereign-mcp] OAuth2 bootstrap');
  console.log(`  redirect_uri : ${cfg.redirectUri}`);
  console.log(`  listening    : http://localhost:${cfg.port}/callback`);
  console.log(`  authorize at : ${url}\n`);

  if (!args.has('--no-open')) {
    const opener: { cmd: string; args: string[] } =
      process.platform === 'win32'
        ? { cmd: 'cmd', args: ['/c', 'start', '', url] }
        : process.platform === 'darwin'
          ? { cmd: 'open', args: [url] }
          : { cmd: 'xdg-open', args: [url] };
    try {
      spawn(opener.cmd, opener.args, { stdio: 'ignore', detached: true }).unref();
    } catch {
      console.log('Open the URL above in your browser to continue.');
    }
  }

  return new Promise<number>((resolve) => {
    const server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${cfg.port}`);
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404).end('Not found');
        return;
      }

      const error = reqUrl.searchParams.get('error');
      if (error) {
        res.writeHead(400).end(`<h2>Authorization failed: ${error}</h2>`);
        console.error(`\n❌ Discord returned error: ${error}`);
        resolve(1);
        return;
      }

      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400).end('<h2>Missing authorization code</h2>');
        console.error('\n❌ No code in callback URL.');
        resolve(1);
        return;
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
            oauthSuccessHtml(
              username,
              'You can close this tab. Restart the MCP server to pick up the user token.'
            )
          );
        server.close(() => resolve(0));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n❌ Token exchange failed: ${message}`);
        res.writeHead(500).end(`<h2>Token exchange failed</h2><p>${message}</p>`);
        resolve(1);
      }
    });

    server.listen(cfg.port, '127.0.0.1', () => {
      console.log(`Waiting for the callback at http://localhost:${cfg.port}/callback ...`);
    });
  });
}