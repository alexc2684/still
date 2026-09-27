import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);
export async function hashPassword(password:string) { const salt=randomBytes(16).toString('hex'); const key=await scrypt(password,salt,64) as Buffer; return `scrypt$${salt}$${key.toString('hex')}`; }
export async function verifyPassword(password:string, encoded:string) { const [,salt,hex]=encoded.split('$'); if(!salt||!hex)return false; const key=await scrypt(password,salt,64) as Buffer; const stored=Buffer.from(hex,'hex'); return stored.length===key.length&&timingSafeEqual(stored,key); }
export function token() { return randomBytes(32).toString('base64url'); }
export function tokenHash(t:string) { return createHash('sha256').update(t).digest('hex'); }
