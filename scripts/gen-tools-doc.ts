/**
 * Generates TOOLS.md from the live tool registry.
 *   npx tsx scripts/gen-tools-doc.ts
 */
import { writeFileSync } from 'node:fs';
import { tools } from '../src/tools/index.js';
import { z } from 'zod';

const badge = (t: (typeof tools)[number]): string[] => {
  const b: string[] = [];
  if (t.annotations?.readOnlyHint) b.push('read-only');
  if (t.annotations?.destructiveHint) b.push('destructive');
  if (t.annotations?.idempotentHint) b.push('idempotent');
  if (t.annotations?.openWorldHint) b.push('open-world');
  return b;
};

const typeOf = (schema: z.ZodTypeAny): string => {
  const t = schema._def.typeName as string;
  const inner = (): z.ZodTypeAny => (schema._def as { innerType: z.ZodTypeAny }).innerType;
  const map: Record<string, () => string> = {
    ZodString: () => 'string',
    ZodNumber: () => 'number',
    ZodBigInt: () => 'bigint (string)',
    ZodBoolean: () => 'boolean',
    ZodEnum: () => `enum(${((schema._def as { values?: readonly string[] }).values ?? []).join(' | ')})`,
    ZodNativeEnum: () => 'enum',
    ZodOptional: () => `optional ${typeOf(inner())}`,
    ZodDefault: () => `optional ${typeOf(inner())}`,
    ZodArray: () => `array<${typeOf((schema._def as { type: z.ZodTypeAny }).type)}>`,
    ZodObject: () => 'object',
    ZodRecord: () => 'map',
    ZodUnion: () => 'union',
    ZodLiteral: () => 'literal',
  };
  return map[t]?.() ?? t;
};

const lines: string[] = [];
lines.push('# TOOLS.md');
lines.push('');
lines.push(`Auto-generated from the tool registry: ${tools.length} tools. Regenerate with ` +
  '`npx tsx scripts/gen-tools-doc.ts`.');
lines.push('');
lines.push('Every tool is `discord_`-prefixed, snake_case, and schema-strict (unknown keys are rejected). ' +
  'Destructive tools take a `dry_run` flag (default `true`) and, when `dry_run: false`, first assert ' +
  'Sovereign Control (`discord_assert_sovereignty` / `discord_elevate_control`).');
lines.push('');

const groups = new Map<string, typeof tools>();
for (const t of tools) {
  const group = t.name.replace(/^discord_([a-z]+)_.*$/, '$1');
  const list = groups.get(group) ?? [];
  list.push(t);
  groups.set(group, list);
}

for (const [group, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`## ${group} tools`);
  lines.push('');
  for (const t of list) {
    const badges = badge(t);
    lines.push(`### ${t.name}`);
    lines.push('');
    lines.push(badges.length ? `_${badges.join(', ')}_  \n` : '');
    lines.push(`${t.description}`);
    lines.push('');
    const shape = (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    const keys = Object.keys(shape);
    if (keys.length > 0) {
      lines.push('| Parameter | Type | Description |');
      lines.push('| --- | --- | --- |');
      for (const key of keys) {
        const field = shape[key];
        const desc = field?.description ?? '';
        const required = field instanceof z.ZodDefault || field instanceof z.ZodOptional ? '' : '**required** ';
        lines.push(`| \`${key}\` | ${typeOf(field)} | ${required}${desc} |`);
      }
      lines.push('');
    }
  }
}

writeFileSync('TOOLS.md', lines.join('\n'), 'utf8');
console.log(`Wrote TOOLS.md (${tools.length} tools, ${groups.size} groups).`);