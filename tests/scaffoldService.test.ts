import { describe, expect, it } from 'vitest';
import {
  buildScaffoldPlan,
  planToSteps,
  summarizePlan,
  validateScaffoldPlan,
  ScaffoldError,
  SCAFFOLD_TEMPLATES,
  type PlanChannel,
  type PlanOverwrite,
  type PlanRole,
} from '../src/services/scaffoldService.js';

const GUILD = '111111111111111111';

describe('buildScaffoldPlan', () => {
  it('exposes the four canonical templates', () => {
    expect(SCAFFOLD_TEMPLATES).toEqual(['minimal', 'community', 'gaming', 'support']);
  });

  it('rejects unknown templates', () => {
    expect(() => buildScaffoldPlan(GUILD, 'nonsense')).toThrow(ScaffoldError);
    expect(() => buildScaffoldPlan(GUILD, 'nonsense')).toThrow(/Unknown template/);
  });

  it('rejects unknown permission names in role definitions', () => {
    const good = buildScaffoldPlan(GUILD, 'minimal');
    const badRoles: PlanRole[] = [{ ...good.roles[0]!, permissions: [...good.roles[0]!.permissions, 'FakePermission'] }];
    expect(() => validateScaffoldPlan(badRoles, [], [])).toThrow(ScaffoldError);
    expect(() => validateScaffoldPlan(badRoles, [], [])).toThrow(/Unknown permission/i);
  });

  it('allows the same channel name across different types (category + text "general")', () => {
    const channels: PlanChannel[] = [
      { name: 'general', type: 'category' },
      { name: 'general', type: 'text' },
    ];
    expect(() => validateScaffoldPlan([], channels, [])).not.toThrow();
    const dup: PlanChannel[] = [
      { name: 'general', type: 'text' },
      { name: 'general', type: 'text' },
    ];
    expect(() => validateScaffoldPlan([], dup, [])).toThrow(/Duplicate channel name/);
  });

  it('rejects overwrites referencing unknown channels or roles', () => {
    const channels: PlanChannel[] = [{ name: 'staff', type: 'text' }];
    const roles: PlanRole[] = [{ name: 'Moderator', permissions: ['ViewChannel'], color: 'blue' }];
    const badChannel: PlanOverwrite[] = [{ channel: 'nope', role: '@everyone', deny: ['ViewChannel'] }];
    const badRole: PlanOverwrite[] = [{ channel: 'staff', role: 'Ghost', deny: ['ViewChannel'] }];
    expect(() => validateScaffoldPlan(roles, channels, badChannel)).toThrow(/unknown channel/i);
    expect(() => validateScaffoldPlan(roles, channels, badRole)).toThrow(/unknown role/i);
  });

  it('every template passes its own validation', () => {
    for (const t of SCAFFOLD_TEMPLATES) {
      const plan = buildScaffoldPlan(GUILD, t);
      expect(plan.roles.length).toBeGreaterThan(0);
      expect(plan.channels.length).toBeGreaterThan(0);
      // Administrator must be the highest role (created last).
      expect(plan.roles[plan.roles.length - 1]!.name).toBe('Administrator');
      // Roles are ordered lowest-first so each new role lands above the previous.
      expect(plan.roles[0]!.name).toBe('Member');
    }
  });

  it('community template defines the staff overwrites', () => {
    const plan = buildScaffoldPlan(GUILD, 'community');
    expect(plan.overwrites.length).toBeGreaterThan(0);
    for (const ow of plan.overwrites) {
      expect(ow.channel).toBe('staff');
      expect(ow.role === '@everyone' || plan.roles.some((r) => r.name === ow.role)).toBe(true);
    }
  });
});

describe('planToSteps ordering', () => {
  it('emits roles first (ladder order), then categories, channels, overwrites', () => {
    const plan = buildScaffoldPlan(GUILD, 'community');
    const steps = planToSteps(plan);
    const kinds = steps.map((s) => s.kind);
    const firstRole = kinds.indexOf('role');
    const firstChannel = kinds.indexOf('channel');
    const firstOverwrite = kinds.indexOf('overwrite');
    expect(firstRole).toBe(0);
    expect(firstOverwrite).toBeGreaterThan(firstChannel);
    expect(firstChannel).toBeGreaterThan(firstRole);

    const categoryLabels = steps
      .filter((s) => s.kind === 'channel' && s.channel.type === 'category')
      .map((s) => s.label);
    const channelLabels = steps
      .filter((s) => s.kind === 'channel' && s.channel.type !== 'category')
      .map((s) => s.label);
    // Every category is created before the first non-category channel.
    const firstNonCategory = kinds.indexOf('channel') + channelLabels.length - channelLabels.length;
    expect(categoryLabels.length).toBeGreaterThan(0);
    expect(firstNonCategory).toBeLessThan(firstOverwrite);
    // Channel steps: category labels come before any text/voice step label.
    const flat = steps.filter((s) => s.kind === 'channel');
    const lastCategoryIdx = flat.map((s) => (s.channel.type === 'category' ? 1 : 0)).lastIndexOf(1);
    const firstChildIdx = flat.map((s) => (s.channel.type === 'category' ? 1 : 0)).indexOf(0);
    expect(lastCategoryIdx).toBeLessThan(firstChildIdx);
  });

  it('attaches parent categories to child channels', () => {
    const plan = buildScaffoldPlan(GUILD, 'community');
    const steps = planToSteps(plan);
    const general = steps.find((s) => s.kind === 'channel' && s.channel.name === 'general');
    expect(general).toBeDefined();
    expect(general!.kind === 'channel' ? general.parentName : undefined).toBe('community');
  });
});

describe('summarizePlan', () => {
  it('renders a readable preview mentioning dry_run', () => {
    const plan = buildScaffoldPlan(GUILD, 'minimal');
    const text = summarizePlan(plan);
    expect(text).toContain('Template "minimal"');
    expect(text).toContain('@Administrator');
    expect(text).toContain('dry_run: false');
  });
});
