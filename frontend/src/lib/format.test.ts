import { describe, expect, it } from 'vitest';
import { count, fmtAgo, fmtDistance, fmtDuration, fmtNum, fmtPct, fmtSigned, fmtSpeed, fmtTime } from './format';

describe('format', () => {
  it('never prints NaN, undefined or null', () => {
    for (const f of [fmtSpeed, fmtNum, fmtDistance, fmtDuration, fmtPct]) {
      expect(f(null)).toBe('–');
      expect(f(undefined)).toBe('–');
      expect(f(Number.NaN)).toBe('–');
    }
  });

  it('formats durations the way people say them', () => {
    expect(fmtDuration(42)).toBe('42 s');
    expect(fmtDuration(6 * 60 + 10)).toBe('6 min');
    expect(fmtDuration(65 * 60)).toBe('1 h 05 min');
    expect(fmtDuration(120 * 60)).toBe('2 h');
    expect(fmtDuration(-5)).toBe('0 s');
  });

  it('formats distances in metres then kilometres', () => {
    expect(fmtDistance(845)).toBe('850 m');
    expect(fmtDistance(2830)).toBe('2.8 km');
  });

  it('signs changes with a real minus sign and no "+0"', () => {
    expect(fmtSigned(4.4)).toBe('+4');
    expect(fmtSigned(-6.2)).toBe('−6');
    expect(fmtSigned(0.2)).toBe('0');
    expect(fmtSigned(-1.25, 1)).toBe('−1.3');
  });

  it('drops decimals on large numbers only', () => {
    expect(fmtNum(12.44)).toBe('12.4');
    expect(fmtNum(1180)).toBe('1,180');
  });

  it('pluralises', () => {
    expect(count(1, 'vehicle')).toBe('1 vehicle');
    expect(count(412, 'vehicle')).toBe('412 vehicles');
    expect(count(0, 'incident')).toBe('0 incidents');
  });

  it('shows Bengaluru time', () => {
    expect(fmtTime('2026-11-28T04:45:30Z')).toBe('10:15:30');
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-11-28T10:00:00Z');
    expect(fmtAgo('2026-11-28T09:59:58Z', now)).toBe('just now');
    expect(fmtAgo('2026-11-28T09:59:30Z', now)).toBe('30 s ago');
    expect(fmtAgo('2026-11-28T09:55:00Z', now)).toBe('5 min ago');
  });
});
