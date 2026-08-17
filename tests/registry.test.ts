import { describe, expect, it } from 'vitest';
import { ok, fail } from '../src/tools/registry.js';
import { jsonSafe } from '../src/utils/format.js';

describe('ok/fail result helpers', () => {
  it('ok builds text content without isError', () => {
    const result = ok('done');
    expect(result.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(result.isError).toBeUndefined();
  });

  it('fail marks isError and prefixes the message', () => {
    const result = fail('boom');
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('boom');
  });

  it('serializes structuredContent through jsonSafe', () => {
    const result = ok('done', { id: 42n, nested: { list: [1n, 'x'] } });
    expect(result.structuredContent).toEqual({ id: '42', nested: { list: ['1', 'x'] } });
  });
});

describe('jsonSafe', () => {
  it('converts bigint to decimal strings recursively', () => {
    expect(jsonSafe({ a: 5n, b: [1n, { c: 2n }] })).toEqual({ a: '5', b: ['1', { c: '2' }] });
  });

  it('passes primitives through', () => {
    expect(jsonSafe('str')).toBe('str');
    expect(jsonSafe(1)).toBe(1);
    expect(jsonSafe(null)).toBeNull();
  });
});