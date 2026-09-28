import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sql } from '../src/lib/db';

export function splitSqlStatements(text: string): string[] {
  const statements: string[] = []
  let current = ''
  let dollarQuoted = false
  let quote: 'single' | 'double' | null = null
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith('$$', i) && !quote) { dollarQuoted = !dollarQuoted; current += '$$'; i += 1; continue }
    const character = text[i]
    if (quote === 'single' && character === "'" && text[i + 1] === "'") { current += "''"; i += 1; continue }
    if (character === "'" && !dollarQuoted && quote !== 'double') quote = quote === 'single' ? null : 'single'
    else if (character === '"' && !dollarQuoted && quote !== 'single') quote = quote === 'double' ? null : 'double'
    if (character === ';' && !dollarQuoted && !quote) {
      if (current.trim()) statements.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }
  if (current.trim()) statements.push(current.trim())
  return statements.filter(Boolean)
}

export async function runMigration(text: string, query: (statement: string) => Promise<unknown>): Promise<number> {
  const statements = splitSqlStatements(text)
  for (const statement of statements) await query(statement)
  return statements.length
}

export async function main(read: (path: URL, encoding: 'utf8') => Promise<string> = readFile as unknown as (path: URL, encoding: 'utf8') => Promise<string>, queryFactory: () => (statement: string) => Promise<unknown> = () => sql()) {
  try { process.loadEnvFile('.env.local') } catch {}
  const text = await read(new URL('../db/schema.sql', import.meta.url), 'utf8')
  const count = await runMigration(text, statement => queryFactory()(statement))
  console.log(`migrated ${count} statements`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
