import { readFile } from 'node:fs/promises'; import { sql } from '../src/lib/db';
try { process.loadEnvFile('.env.local'); } catch {}
void (async()=>{ const text=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'); for (const statement of text.split(';').map(x=>x.trim()).filter(Boolean)) await sql()(statement); console.log('migrated'); })();
