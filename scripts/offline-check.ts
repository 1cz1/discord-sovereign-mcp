/**
 * Offline registry invariants for discord-sovereign-mcp.
 * No Discord token, no network: validates the tool surface itself.
 * Run via `npm run eval` (offline mode) or directly: npx tsx scripts/offline-check.ts
 */
import { tools } from '../src/tools/index.js';
import { z } from 'zod';

let failures = 0;
const pass = (label: string, detail = ''): void => {
  console.log(`  PASS  ${label}${detail ? `: ${detail}` : ''}`);
};
const fail = (label: string, detail: string): void => {
  failures += 1;
  console.error(`  FAIL  ${label}: ${detail}`);
};

console.log('[offline-check] tool registry invariants');

if (!Array.isArray(tools) || tools.length === 0) {
  fail('tools export', 'empty or missing');
} else {
  pass('tools exported', `${tools.length} tools`);

  const names = new Set<string>();
  const titles = new Set<string>();
  const snakeCase = /^[a-z][a-z0-9_]*$/;
  const duplicateNames = tools.filter((t) => names.has(t.name) || !names.add(t.name));
  const duplicateTitles = tools.filter((t) => titles.has(t.title) || !titles.add(t.title));

  if (tools.length === 46) pass('tool count', '46');
  else fail('tool count', `expected 46, got ${tools.length}`);

  if (duplicateNames.length === 0) pass('unique names');
  else fail('unique names', duplicateNames.map((t) => t.name).join(', '));

  if (duplicateTitles.length === 0) pass('unique titles');
  else fail('unique titles', duplicateTitles.map((t) => t.title).join(', '));

  const badNames = tools.filter((t) => !snakeCase.test(t.name) || t.name.length > 64 || !t.name.startsWith('discord_'));
  if (badNames.length === 0) pass('naming conventions', 'snake_case, discord_-prefixed, <= 64 chars');
  else fail('naming conventions', badNames.map((t) => t.name).join(', '));

  const noDescription = tools.filter((t) => !t.description || t.description.length < 20);
  if (noDescription.length === 0) pass('descriptions', 'prose descriptions present');
  else fail('descriptions', noDescription.map((t) => t.name).join(', '));

  const noSchema = tools.filter((t) => !(t.inputSchema instanceof z.ZodObject));
  if (noSchema.length === 0) pass('input schemas', 'all zod strict objects');
  else fail('input schemas', noSchema.map((t) => t.name).join(', '));

  const notStrict = tools.filter((t) => !(t.inputSchema instanceof z.ZodObject) || t.inputSchema._def.unknownKeys !== 'strict');
  if (notStrict.length === 0) pass('strict schemas', 'unknown keys rejected');
  else fail('strict schemas', notStrict.map((t) => t.name).join(', '));

  const destructive = tools.filter((t) => t.annotations?.destructiveHint);
  const readOnly = tools.filter((t) => t.annotations?.readOnlyHint);
  pass('annotations', `${destructive.length} destructive, ${readOnly.length} read-only`);

  const hasDryRun = (t: (typeof tools)[number]): boolean => {
    const schema = t.inputSchema as z.ZodObject<z.ZodRawShape>;
    return 'dry_run' in schema.shape;
  };
  const destructiveWithoutDryRun = destructive.filter((t) => !hasDryRun(t));
  if (destructiveWithoutDryRun.length === 0) pass('destructive tools guard', `all ${destructive.length} destructive tools have a dry_run flag`);
  else fail('destructive tools guard', destructiveWithoutDryRun.map((t) => t.name).join(', '));

  const guardFirst = tools.filter((t) => t.name.startsWith('discord_'));
  if (guardFirst.length === tools.length) pass('service prefix', 'all tools discord_-prefixed');
}

console.log(failures === 0 ? '\n[offline-check] ALL PASS' : `\n[offline-check] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);