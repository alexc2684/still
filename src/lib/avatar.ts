export const AVATAR_KEYS = ['leaf','moon','sun','waves','mountain','flower'] as const;
export type AvatarKey = typeof AVATAR_KEYS[number];
export function validAvatarKey(value: unknown): value is AvatarKey { return typeof value === 'string' && (AVATAR_KEYS as readonly string[]).includes(value); }
