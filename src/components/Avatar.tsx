'use client';
import { Flower2, Leaf, Mountain, Moon, Sun, Waves } from 'lucide-react';
import './avatar.css';
export const AVATAR_KEYS = ['leaf','moon','sun','waves','mountain','flower'] as const;
export type AvatarKey = typeof AVATAR_KEYS[number];
const icons = { leaf: Leaf, moon: Moon, sun: Sun, waves: Waves, mountain: Mountain, flower: Flower2 } as const;
type Props = { name: string; avatarKey?: string | null; size?: 'small'|'medium'|'large' };
export default function Avatar({ name, avatarKey, size='medium' }: Props) { const Icon = avatarKey && avatarKey in icons ? icons[avatarKey as keyof typeof icons] : null; const initials = name.split(/\s+/).map((x) => x[0]).join('').slice(0,2).toUpperCase(); return <span className={`still-avatar still-avatar-${size}`} aria-label={Icon ? `${name}'s avatar` : name}>{Icon ? <Icon size={size==='small'?14:size==='large'?28:18} strokeWidth={1.7} aria-hidden="true" /> : initials}</span>; }
