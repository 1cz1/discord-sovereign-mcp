#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { config as loadDotenv } from 'dotenv';
import type { Server as HttpServer } from 'node:http';
import { loadConfig, ConfigError } from './config.js';
import { DiscordClient } from './client/discordClient.js';
import { ControlService } from './services/controlService.js';
import {
  exchangeCode,
  fetchCurrentAuthorization,
  oauthSuccessHtml,
  persistTokenToEnv,
  OAuthError,
} from './services/oauthService.js';
import { installTools, type ToolContext } from './tools/registry.js';
import { tools } from './tools/index.js';
import { SERVER_NAME, VERSION } from './constants.js';
import { describeDiscordError } from './client/errors.js';
import { runOAuthBootstrap } from './bootstrap/oauthBootstrap.js';
import { runInstaller } from './bootstrap/installCli.js';

loadDotenv();

let httpServer: HttpServer | null = null;
let httpTransports: StreamableHTTPServerTransport[] = [];
let mcpServer: McpServer | null = null;
let shuttingDown = false;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (httpServer) {
      await Promise.allSettled(httpTransports.map((t) => t.close()));
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    } else if (mcpServer) {
      await mcpServer.close();
    }
  } catch {
    // best-effort shutdown; never mask the exit code
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--install') || argv.includes('-i')) {
    const exitCode = await runInstaller(argv, process.env);
    process.exit(exitCode);
  }
  if (argv.includes('--oauth') || argv.includes('-o')) {
    const exitCode = await runOAuthBootstrap(argv, process.env);
    process.exit(exitCode);
  }

  const config = loadConfig();

  const client = new DiscordClient({ token: config.token, tokenType: config.tokenType });
  let identity;
  try {
    identity = await client.init();
  } catch (err) {
    const info = describeDiscordError(err);
    console.error(
      `Failed to authenticate with Discord: ${info.message}\n` +
        'Check DISCORD_TOKEN. If you are using an OAuth2/user token, re-run `npm run oauth` (or `npx discord-sovereign-mcp --oauth`).'
    );
    process.exit(1);
  }

  const ctx: ToolContext = {
    client,
    control: new ControlService(client, config.allowedGuilds),
  };

  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  mcpServer = server;
  installTools(server, ctx, tools);

  console.error(
    `[discord-sovereign-mcp] authenticated as ${identity.username} (${identity.bot ? 'bot' : 'user'} mode), ` +
      `${tools.length} tools registered, transport=${config.transport}`
  );

  if (config.transport === 'http') {
    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => {
      res.json({ ok: true, name: SERVER_NAME, version: VERSION, tools: tools.length });
    });

    app.get('/callback', async (req, res) => {
      const code = req.query.code;
      const error = req.query.error;
      if (error) {
        res.status(400).send(`OAuth authorization failed: ${String(error)}`);
        return;
      }
      if (typeof code !== 'string' || code.length === 0) {
        res.status(400).send('Missing authorization code. Start over with discord_oauth_login.');
        return;
      }
      try {
        const token = await exchangeCode(config.oauth, code);
        const identity = await fetchCurrentAuthorization(token.access_token);
        persistTokenToEnv('.env', token.access_token);
        const username = identity.user ? identity.user.username : 'user';
        console.error(
          `[discord-sovereign-mcp] OAuth2 bootstrap complete for ${username}: token persisted to .env`
        );
        res.status(200).type('text/html').send(
          oauthSuccessHtml(
            username,
            'The user token was written to <code>.env</code>. Restart the server (TRANSPORT=http) to ' +
              'authenticate with the user token.'
          )
        );
      } catch (err) {
        const message = err instanceof OAuthError ? err.message : String(err);
        console.error(`[discord-sovereign-mcp] OAuth callback failed: ${message}`);
        res.status(500).send(`Token exchange failed: ${message}`);
      }
    });

    app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport({});
      httpTransports.push(transport);
      res.on('close', () => {
        const i = httpTransports.indexOf(transport);
        if (i >= 0) httpTransports.splice(i, 1);
        transport.close().catch((err) => {
          console.error(`[discord-sovereign-mcp] transport close failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });

    httpServer = app.listen(config.httpPort, config.httpHost, () => {
      console.error(
        `[discord-sovereign-mcp] HTTP server listening on http://${config.httpHost}:${config.httpPort} (POST /mcp, GET /health)`
      );
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
  } else {
    console.error('Fatal error:', err);
  }
  process.exit(1);
});