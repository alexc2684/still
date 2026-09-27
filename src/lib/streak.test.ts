import { describe,it,expect } from 'vitest'; import { streakFromDates } from './streak';
describe('streakFromDates',()=>{it('counts consecutive days ending today',()=>expect(streakFromDates(['2026-09-26','2026-09-25','2026-09-23'],'2026-09-26')).toBe(2));it('returns zero when today is missed',()=>expect(streakFromDates(['2026-09-25'],'2026-09-26')).toBe(0));});
