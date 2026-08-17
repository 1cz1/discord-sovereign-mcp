import { z } from 'zod';
import { ControlError } from '../services/controlService.js';
import { ok, fail, type RegisteredTool, type ToolContext, type ToolInput, type MCPResult } from './registry.js';
import { guildIdSchema, dryRunSchema } from './sharedSchemas.js';
import { jsonSafe } from '../utils/format.js';

interface AssertSovereigntyInput {
  guild_id: string;
}

const assertSovereigntySchema = z
  .object({
    guild_id: guildIdSchema,
  })
  .strict();

function ladderTable(verdict: import('../services/controlService.js').ControlVerdict): string {
  const rows = verdict.ladder.map(
    (r) => `- ${r.isClient ? '**' : ''}${r.isEveryone ? '@everyone' : `@${r.name}`}${r.isClient ? '** (client)' : ''} — pos ${r.position}`
  );
  return rows.length > 0 ? rows.join('\n') : '- (no roles)';
}

const assertSovereignty: RegisteredTool = {
  name: 'discord_assert_sovereignty',
  title: 'Assert sovereign control',
  description:
    'Reports whether the client can administer a guild: it owns the guild (user token) or holds the #1 (highest) role ' +
    'in the role hierarchy (bot token). Prints the full role ladder with positions and flags the client role. ' +
    'Read-only; run this first whenever an administrative action is denied.',
  inputSchema: assertSovereigntySchema,
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as AssertSovereigntyInput;
    try {
      const verdict = await ctx.control.getVerdict(p.guild_id);
      const text = [
        verdict.controlled
          ? `Sovereign control **granted** for guild \`${p.guild_id}\` (mode: ${verdict.mode}).`
          : `Sovereign control **denied** for guild \`${p.guild_id}\` (mode: ${verdict.mode}).`,
        verdict.note ?? '',
        verdict.remediation ?? '',
        '',
        '**Role ladder (highest → lowest):**',
        ladderTable(verdict),
      ]
        .filter((l) => l.length > 0)
        .join('\n');
      return ok(text, {
        guild_id: verdict.guildId,
        controlled: verdict.controlled,
        mode: verdict.mode,
        top_role: verdict.topRole,
        client_role: verdict.clientRole,
        ladder: jsonSafe(verdict.ladder),
        remediation: verdict.remediation,
      });
    } catch (err) {
      return fail(`Could not evaluate control: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

interface ElevateControlInput {
  guild_id: string;
  dry_run?: boolean;
}

const elevateControlSchema = z
  .object({
    guild_id: guildIdSchema,
    dry_run: dryRunSchema.describe('Preview what elevation would do without changing anything. Default true.'),
  })
  .strict();

const elevateControl: RegisteredTool = {
  name: 'discord_elevate_control',
  title: 'Elevate control to the #1 role',
  description:
    'Moves the client role to the top of the role hierarchy so the Sovereignty Guard permits administration. ' +
    'Honest and advisory: Discord only lets a role move above roles it already outranks, so this succeeds when the ' +
    'client role is close to the top and reports exactly what a human must do in Server Settings > Roles otherwise. ' +
    'Never fabricates success. Set dry_run=false to attempt the reorder.',
  inputSchema: elevateControlSchema,
  annotations: { destructiveHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as ElevateControlInput;
    const isDryRun = p.dry_run !== false;
    try {
      const verdict = await ctx.control.getVerdict(p.guild_id);
      if (isDryRun) {
        const text =
          verdict.mode === 'owner'
            ? 'The client owns this guild — elevation is unnecessary.'
            : verdict.controlled
              ? `Control already granted: the client's highest role "@${verdict.clientRole?.name}" is the #1 role.`
              : `Would move the client role "@${verdict.clientRole?.name}" (pos ${verdict.clientRole?.position}) ` +
                `to position ${verdict.topRole?.position} to match the top role "@${verdict.topRole?.name}". ` +
                'Discord enforces hierarchy: this only works if the client role already outranks every role above it.';
        return ok(text, {
          guild_id: p.guild_id,
          dry_run: true,
          would_elevate: verdict.mode !== 'owner' && !verdict.controlled,
          top_role: verdict.topRole,
          client_role: verdict.clientRole,
        });
      }
      const result = await ctx.control.elevateControl(p.guild_id);
      return ok(
        result.controlled
          ? `Control elevated: the client role "@${result.clientRole?.name}" now sits at position ${result.topRole?.position} (the #1 role).`
          : 'Elevation did not change the hierarchy — see the structured verdict for the current ladder.',
        {
          guild_id: p.guild_id,
          controlled: result.controlled,
          mode: result.mode,
          top_role: result.topRole,
          client_role: result.clientRole,
        }
      );
    } catch (err) {
      if (err instanceof ControlError) {
        return fail(`Elevation blocked: ${err.message}`);
      }
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
};

export const controlTools: RegisteredTool[] = [assertSovereignty, elevateControl];