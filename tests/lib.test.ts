import { describe, expect, it } from 'vitest';
import { currentStreak, dateInTimezone, streakFromDates } from '../src/lib/streak';
import { hashPassword, token, tokenHash, verifyPassword } from '../src/lib/security';

describe('security primitives', () => {
  it('round-trips passwords without storing plaintext and rejects wrong passwords', async () => {
    const encoded = await hashPassword('a strong meditation passphrase');
    expect(encoded).toMatch(/^scrypt\$[^$]+\$[0-9a-f]+$/);
    expect(encoded).not.toContain('a strong meditation passphrase');
    await expect(verifyPassword('a strong meditation passphrase', encoded)).resolves.toBe(true);
    await expect(verifyPassword('wrong passphrase', encoded)).resolves.toBe(false);
  });

  it('creates opaque tokens whose hashes are deterministic and different from the token', () => {
    const first = token();
    const second = token();
    expect(first).not.toBe(second);
    expect(tokenHash(first)).toHaveLength(64);
    expect(tokenHash(first)).toBe(tokenHash(first));
    expect(tokenHash(first)).not.toBe(first);
  });
});

describe('practice dates and streaks', () => {
  it('counts consecutive practice dates ending on the user local date', () => {
    expect(streakFromDates(['2026-03-08', '2026-03-07', '2026-03-06'], '2026-03-08')).toBe(3);
    expect(streakFromDates(['2026-03-08', '2026-03-06'], '2026-03-08')).toBe(1);
    expect(streakFromDates([], '2026-03-08')).toBe(0);
  });

  it('preserves an active streak through the current local day before today\'s practice', () => {
    expect(currentStreak(['2026-03-07', '2026-03-06'], '2026-03-08')).toBe(2);
    expect(currentStreak(['2026-03-07', '2026-03-06', '2026-03-06'], '2026-03-08')).toBe(2);
    expect(currentStreak(['2026-03-06'], '2026-03-08')).toBe(0);
  });

  it('formats dates in the user timezone across a daylight saving boundary', () => {
    // 06:30Z is 01:30 EST before the spring-forward transition; 07:30Z is 03:30 EDT after it.
    expect(dateInTimezone(new Date('2026-03-08T06:30:00Z'), 'America/New_York')).toBe('2026-03-08');
    expect(dateInTimezone(new Date('2026-03-08T07:30:00Z'), 'America/New_York')).toBe('2026-03-08');
  });
});
