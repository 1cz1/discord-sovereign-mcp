# SPEC.md

Design specification for discord-sovereign-mcp (v0.1).

## 1. Goals

- Let any LLM (via MCP) administer and **create whole Discord servers** end-to-end: OAuth2
  bootstrap, guild CRUD, roles, channels, threads, members, moderation, messaging, and declarative
  server scaffolding.
- Make destructive operations safe-by-default: `dry_run` previews on every mutating tool and a
  **Sovereignty Guard** that blocks execution unless the client provably holds the top role.
- Fail loudly and helpfully: every failure is a structured, actionable message: never a raw
  stack trace.

## 2. Non-goals

- No websocket gateway, events, or real-time presence (REST-only).
- No Discord-specific rate-limit queuing beyond the REST SDK's built-in handling.
- No payment/billing, OAuth refresh-token rotation, or multi-tenant hosting.
- No persistence: state is whatever Discord itself stores; the server is stateless across
  restarts (except `.env` token persistence during OAuth bootstrap).

## 3. Architecture

```
MCP client (LLM app)
   │  stdio │  Streamable HTTP (POST /mcp, GET /health, GET /callback)
   ▼
src/index.ts ── McpServer
   │  installTools(registry)
   ▼
src/tools/*         46 RegisteredTools (zod-strict schemas, annotations, handle())
   │  ToolContext { client, control }
   ▼
src/services/*      controlService (sovereignty verdicts)
                    permissionService (bitfields, role colors, overwrite math)
                    scaffoldService (template -> plan -> steps)
                    oauthService (authorize/exchange/persist)
   ▼
src/client/*        discordClient (typed @discordjs/rest wrappers), errors (translator)
   │
   ▼
Discord REST API (api/v10)
```

Same flow with the guard surfaced explicitly:

```
┌────────────────────────────┐        ┌──────────────────────────────────────────┐
│  MCP client                │  MCP   │  discord-sovereign-mcp (Node 20+)          │
│  Claude Code / Codex /     │◄──────►│  stdio  or  Streamable HTTP (POST /mcp)    │
│  opencode / Cursor / ...   │        │                                           │
└────────────────────────────┘        │  registry ── 46 strict-zod tools           │
                                       │    │                                       │
                                       │    ▼                                       │
                                       │  guard() ── ControlService.assertControl  │
                                       │    │  owner? (user token)                  │
                                       │    │  #1 role? (bot token)                 │
                                       │    │  DISCORD_ALLOWED_GUILDS?               │
                                       │    ▼                                       │
                                       │  DiscordClient ── @discordjs/rest REST API │
                                       │  PermissionService (read-only auditor)     │
                                       │  ScaffoldService (template planner)        │
                                       │  OAuthService (user-token bootstrap)       │
                                       └──────────────────────────────────────────┘
```

### Module responsibilities

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Load config, authenticate (fail fast), wire transports, serve `/health` + `/callback`. |
| `src/config.ts` | Typed env parsing, validation, guild allowlist (`assertGuildAllowed`). |
| `src/constants.ts` | Server identity, shared bit constants, role color palette. |
| `src/client/discordClient.ts` | All REST calls; typed request/response via discord-api-types. |
| `src/client/errors.ts` | Translate REST/network errors into actionable `describeDiscordError` strings. |
| `src/services/controlService.ts` | `getVerdict` / `assertControl` / `elevateControl`; ladder sorting by position then id. |
| `src/services/permissionService.ts` | Bitfield parsing/serialization, named permissions, role colors, overwrite evaluation. |
| `src/services/scaffoldService.ts` | Templates -> validated plan -> ordered steps; parent wiring; overwrite resolution. |
| `src/services/oauthService.ts` | Authorization URL, code exchange, `/oauth2/@me`, `.env` token persistence. |
| `src/tools/*` | Tool definitions: name, title, description, zod schema, annotations, handler. |
| `src/tools/registry.ts` | `RegisteredTool` type, `ok`/`fail`, `installTools`, error-boundary wrapper. |
| `src/utils/format.ts` | `jsonSafe`: bigint-safe JSON serialization for `structuredContent`. |

## 4. Tool conventions

1. **Naming**: `discord_<verb>_<noun>`, snake_case, ≤ 64 chars, unique across the registry.
2. **Schemas**: `z.object({...}).strict()`: unknown keys are rejected. Shared fragments live in
   `src/tools/sharedSchemas.ts` (snowflake IDs, color, reason, dry_run).
3. **Annotations**: `readOnlyHint` on pure reads; `destructiveHint` on every mutator; `idempotentHint`
   where the API is naturally idempotent (role adds/removes).
4. **Guarding**: destructive tools with `dry_run: false` must `await ctx.control.assertControl(guildId)`
   **before** the first mutating call. `dry_run: true` returns the exact payload that would be sent,
   touching nothing.
5. **Results**: `ok(text, structured?)` / `fail(text, structured?)`: never throw from a handler;
   the registry wraps any escape in a translated error. `structuredContent` is bigint-safe JSON.
6. **Audit**: mutating tools accept `reason` and stamp it as the audit-log reason (fallback
   `AUDIT_REASON` env).

## 5. Sovereignty Guard

Verdict computation (`controlService.getVerdict`):

- `mode: 'owner'` when the client is the guild owner (user tokens) -> controlled.
- `mode: 'role'` otherwise: controlled iff the client's highest role equals the guild's #1 role
  by **position** (ties broken by role ID), and the guild has more than one role.

Elevation (`elevateControl`) moves the client role to the top role's position and re-verifies; a
failed reorder throws a message explaining that a human must drag the role above the roles it
could not outrank (Discord forbids moving a role above its own superiors).

## 6. Scaffolding pipeline

`discord_scaffold_server`:

1. **Template lookup**: `minimal` \| `community` \| `mod` \| `social` (or an inline `plan`).
2. **Validation** (`validateScaffoldPlan`): role permissions must parse; channel names unique per
   type (`type|name` key, since Discord allows same names across types); overwrites must reference
   existing roles/channels.
3. **Plan**: roles lowest-position-first, then categories, then channels (with `parent_id` from
   the nearest preceding category), then overwrites (`@everyone` resolved to the guild id).
4. **Guard-once**: `assertControl` before step 1 when `dry_run: false`.
5. **Per-step isolation**: each step is try/caught; result reports
   `{ steps_total, steps_completed, steps_failed, completed, failed, created_role_ids, created_channel_ids }`
   so partial scaffolds can be reconciled manually.
6. **Idempotency**: names are checked before create; already-present resources are reported
   instead of duplicated.

## 7. Error taxonomy

| Class | Example | Handling |
| --- | --- | --- |
| `ConfigError` | bad `TRANSPORT`, missing token | startup abort with fix instructions |
| `ControlError` | client below #1 role | `discord_assert_sovereignty` guidance + ladder |
| `OAuthError` | missing client id, exchange failure | actionable OAuth fix instructions |
| Discord API error | 403 Missing Permissions, 429 rate limit | translated message via `describeDiscordError` |
| Unknown zod key | typo in params | schema rejection listing the offending key |

## 8. Testing strategy

- **Unit (vitest, 56 tests)**: permissions (bitfield round-trips, color parsing, overwrite math),
  control (verdicts, elevation, remediation), scaffold (validation, ordering, parent wiring,
  dedupe), OAuth (URLs, persistence), registry (inventory, conventions), tools (dry-run vs apply,
  guard denial, structured content).
- **Offline eval** (`npm run eval`): registry invariants: count, naming, uniqueness, strict
  schemas, annotations, destructive/dry_run coverage.
- **Live eval** (`npm run eval -- --live`): spawns `dist/`, performs the MCP handshake, lists
  tools over the protocol, and runs a read-only scenario battery against the configured token.
- **Typecheck**: `tsc --noEmit` with `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.

## 9. Transport matrix

| Transport | Endpoint | Use |
| --- | --- | --- |
| stdio | none | Desktop MCP clients (Claude Desktop, etc.) |
| http | `POST /mcp` | Streamable HTTP sessions |
| http | `GET /health` | Liveness: `{ ok, name, version, tools }` |
| http | `GET /callback` | OAuth2 authorization-code landing page |