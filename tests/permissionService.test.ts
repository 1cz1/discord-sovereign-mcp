import { describe, expect, it } from 'vitest';
import {
  permissionNamesToBits,
  bitsToPermissionNames,
  parseBitfield,
  isAdministrator,
  parseColor,
  formatColor,
  buildOverwriteBody,
  PermissionError,
  ALL_PERMISSION_NAMES,
} from '../src/services/permissionService.js';

describe('permissionNamesToBits', () => {
  it('converts names to a bitfield', () => {
    const bits = permissionNamesToBits(['ViewChannel', 'SendMessages', 'ManageRoles']);
    expect(bits).toBe((1n << 10n) | (1n << 11n) | (1n << 28n));
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(permissionNamesToBits(['  viewchannel ', 'SENDMESSAGES'])).toBe((1n << 10n) | (1n << 11n));
  });

  it('throws PermissionError on unknown names', () => {
    expect(() => permissionNamesToBits(['ViewChannel', 'NotAPermission'])).toThrow(PermissionError);
    expect(() => permissionNamesToBits(['NotAPermission'])).toThrow(/Unknown permission/);
  });

  it('returns 0n for an empty list', () => {
    expect(permissionNamesToBits([])).toBe(0n);
  });
});

describe('bitsToPermissionNames', () => {
  it('round-trips with permissionNamesToBits (as a set; bit order is canonical)', () => {
    const names = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AddReactions'];
    expect(bitsToPermissionNames(permissionNamesToBits(names)).sort()).toEqual([...names].sort());
  });

  it('covers every registered name exactly once', () => {
    const all = bitsToPermissionNames(permissionNamesToBits(ALL_PERMISSION_NAMES));
    expect(new Set(all).size).toBe(ALL_PERMISSION_NAMES.length);
    expect(all).toEqual(ALL_PERMISSION_NAMES);
  });

  it('returns an empty array for 0n', () => {
    expect(bitsToPermissionNames(0n)).toEqual([]);
  });
});

describe('parseBitfield', () => {
  it('accepts bigint, number and decimal string', () => {
    expect(parseBitfield(1024n)).toBe(1024n);
    expect(parseBitfield(1024)).toBe(1024n);
    expect(parseBitfield('1024')).toBe(1024n);
  });

it('accepts hex strings (0x prefix)', () => {
    expect(parseBitfield('0x1000')).toBe(4096n);
  });

  it('treats binary/octal-prefixed strings as permission names (radix prefixes unsupported)', () => {
    expect(() => parseBitfield('0b100')).toThrow(PermissionError);
    expect(() => parseBitfield('0o10')).toThrow(/Unknown permission/);
  });
});

describe('isAdministrator', () => {
  it('detects the Administrator flag', () => {
    expect(isAdministrator(permissionNamesToBits(['Administrator']))).toBe(true);
    expect(isAdministrator(permissionNamesToBits(['ViewChannel']))).toBe(false);
    expect(isAdministrator(0n)).toBe(false);
  });
});

describe('parseColor / formatColor', () => {
  it('maps palette names and default', () => {
    expect(parseColor('default')).toBe(0);
    expect(parseColor('blurple')).toBe(0x5865f2);
    expect(parseColor('red')).toBe(0xe74c3c);
  });

  it('parses #hex strings', () => {
    expect(parseColor('#abcdef')).toBe(0xabcdef);
    expect(parseColor('#FF0000')).toBe(0xff0000);
  });

  it('throws on unknown colors', () => {
    expect(() => parseColor('notacolor')).toThrow();
  });

  it('formats back to #hex', () => {
    expect(formatColor(0x5865f2)).toBe('#5865f2');
  });
});

describe('buildOverwriteBody', () => {
  it('builds allow/deny strings from names', () => {
    const body = buildOverwriteBody(['ViewChannel'], ['SendMessages']);
    expect(body.allow).toBe((1n << 10n).toString());
    expect(body.deny).toBe((1n << 11n).toString());
  });

  it('defaults to "0" for empty sides', () => {
    expect(buildOverwriteBody(undefined, undefined)).toEqual({ allow: '0', deny: '0' });
    expect(buildOverwriteBody(['ViewChannel'], undefined)).toEqual({
      allow: (1n << 10n).toString(),
      deny: '0',
    });
  });
});