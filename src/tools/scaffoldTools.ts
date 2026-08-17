import { z } from 'zod';
import { OverwriteType } from 'discord-api-types/v10';
import { ok, fail, type RegisteredTool, type ToolContext, type ToolInput, type MCPResult } from './registry.js';
import { guildIdSchema, dryRunSchema, reasonSchema } from './sharedSchemas.js';
import {
  buildScaffoldPlan,
  planToSteps,
  summarizePlan,
  ScaffoldError,
  type ScaffoldChannelType,
  type ScaffoldStep,
} from '../services/scaffoldService.js';
import { parseColor, permissionNamesToBits } from '../services/permissionService.js';
import { CHANNEL_TYPE_LABELS, DEFAULT_AUDIT_REASON } from '../constants.js';
import { describeDiscordError } from '../client/errors.js';

interface ScaffoldInput {
  guild_id: string;
  template?: string;
  dry_run?: boolean;
  reason?: string;
}

const scaffoldSchema = z
  .object({
    guild_id: guildIdSchema,
    template: z
      .enum(['minimal', 'community', 'gaming', 'support'])
      .optional()
      .describe('Server layout blueprint. Defaults to community.'),
    dry_run: dryRunSchema.describe('Preview the plan without changing anything. Default true.'),
    reason: reasonSchema.describe('Audit-log reason shown to Discord.'),
  })
  .strict();

const scaffoldServer: RegisteredTool = {
  name: 'discord_scaffold_server',
  title: 'Scaffold a server',
  description:
    'Builds a full server structure from a canonical template in one call: role ladder (Member lowest → Moderator → ' +
    'Administrator top), categories, channels (text, voice, announcement, forum) and permission overwrites. ' +
    'Roles are created lowest-first so each new role lands above the previous one. Sovereign control is asserted once ' +
    'before the first step; every step is executed individually and partial failures are reported honestly. ' +
    'Templates: minimal, community (default), gaming, support. Set dry_run=false to apply.',
  inputSchema: scaffoldSchema,
  annotations: { destructiveHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as ScaffoldInput;
    const template = p.template ?? 'community';
    const isDryRun = p.dry_run !== false;
    const reason = p.reason ?? DEFAULT_AUDIT_REASON;

    let plan;
    try {
      plan = buildScaffoldPlan(p.guild_id, template);
    } catch (err) {
      if (err instanceof ScaffoldError) return fail(err.message);
      throw err;
    }

    if (isDryRun) {
      return ok(summarizePlan(plan), {
        guild_id: p.guild_id,
        dry_run: true,
        template,
        step_count: planToSteps(plan).length,
        roles: plan.roles,
        channels: plan.channels,
        overwrites: plan.overwrites,
      });
    }

    try {
      await ctx.control.assertControl(p.guild_id);
    } catch (err) {
      return fail(`Scaffold blocked by the Sovereignty Guard: ${err instanceof Error ? err.message : String(err)}`);
    }

    const steps = planToSteps(plan);
    const createdRoleIds = new Map<string, string>();
    const createdChannelIds = new Map<string, string>();
    const channelTypes = new Map(plan.channels.map((c) => [c.name, c.type]));
    const completed: string[] = [];
    const failed: Record<string, string> = {};

    for (const step of steps) {
      try {
        await executeStep(ctx, step, p.guild_id, reason, createdRoleIds, createdChannelIds, channelTypes);
        completed.push(step.label);
      } catch (err) {
        const info = describeDiscordError(err);
        failed[step.label] = info.message;
      }
    }

    const summary = [
      `Scaffold of guild \`${p.guild_id}\` (template "${template}") complete: ${completed.length}/${steps.length} steps succeeded.`,
    ];
    const failedLabels = Object.keys(failed);
    if (failedLabels.length > 0) {
      summary.push('');
      summary.push(`**${failedLabels.length} step(s) failed:**`);
      for (const label of failedLabels) {
        summary.push(`- ${label}: ${failed[label]}`);
      }
      summary.push('Re-run the tool to retry; already-created resources are listed above so a partial failure can be reconciled manually.');
    }

    return ok(summary.join('\n'), {
      guild_id: p.guild_id,
      template,
      steps_total: steps.length,
      steps_completed: completed.length,
      steps_failed: Object.keys(failed).length,
      completed: completed,
      failed: failed,
      created_role_ids: Object.fromEntries(createdRoleIds),
      created_channel_ids: Object.fromEntries(createdChannelIds),
    });
  },
};

async function executeStep(
  ctx: ToolContext,
  step: ScaffoldStep,
  guildId: string,
  reason: string,
  roleIds: Map<string, string>,
  channelIds: Map<string, string>,
  channelTypes: Map<string, ScaffoldChannelType>
): Promise<void> {
  switch (step.kind) {
    case 'role': {
      const role = await ctx.client.createRole(
        guildId,
        {
          name: step.role.name,
          permissions: permissionNamesToBits(step.role.permissions).toString(),
          color: parseColor(step.role.color),
          hoist: step.role.hoist ?? false,
          mentionable: step.role.mentionable ?? false,
        },
        { reason }
      );
      roleIds.set(step.role.name, role.id);
      return;
    }
    case 'channel': {
      const parentId = step.parentName ? channelIds.get(`category|${step.parentName}`) : undefined;
      const channel = await ctx.client.createChannel(
        guildId,
        {
          name: step.channel.name,
          type: CHANNEL_TYPE_LABELS[step.channel.type]!,
          topic: step.channel.topic,
          parent_id: parentId,
        },
        { reason }
      );
      channelIds.set(`${step.channel.type}|${step.channel.name}`, channel.id);
      return;
    }
    case 'overwrite': {
      const targetType = channelTypes.get(step.overwrite.channel);
      const channelId = targetType ? channelIds.get(`${targetType}|${step.overwrite.channel}`) : undefined;
      if (!channelId) {
        throw new Error(`channel "${step.overwrite.channel}" was not created (see failed steps)`);
      }
      const roleId = step.overwrite.role === '@everyone' ? guildId : roleIds.get(step.overwrite.role);
      if (!roleId) {
        throw new Error(`role "${step.overwrite.role}" was not created (see failed steps)`);
      }
      const allow = step.overwrite.allow ?? [];
      const deny = step.overwrite.deny ?? [];
      if (allow.length === 0 && deny.length === 0) {
        throw new Error('overwrite must set at least one allow or deny permission');
      }
      await ctx.client.setPermissionOverwrite(
        channelId,
        roleId,
        {
          type: OverwriteType.Role,
          allow: permissionNamesToBits(allow).toString(),
          deny: permissionNamesToBits(deny).toString(),
        },
        { reason }
      );
      return;
    }
  }
}

export const scaffoldTools: RegisteredTool[] = [scaffoldServer];