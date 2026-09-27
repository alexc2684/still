import { cookies, headers } from 'next/headers';
import { sql } from './db';
import { tokenHash } from './security';
const COOKIE=process.env.SESSION_COOKIE_NAME||'still_session';
export async function requireUser() { const t=(await cookies()).get(COOKIE)?.value; if(!t) throw new Response('Unauthorized',{status:401}); const rows=await sql()(`SELECT u.id,u.email,u.name,u.timezone,u.weekly_target FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,[tokenHash(t)]); if(!rows[0])throw new Response('Unauthorized',{status:401}); return rows[0] as {id:string;email:string;name:string;timezone:string;weekly_target:number}; }
export async function originGuard() { const origin=(await headers()).get('origin'); if(origin){ const host=(await headers()).get('host'); try { if(!host||new URL(origin).host!==host)throw new Response('Bad origin',{status:403}); } catch(e) { if(e instanceof Response) throw e; throw new Response('Bad origin',{status:403}); } } }
export const json=(data:unknown,status=200)=>Response.json(data,{status});
