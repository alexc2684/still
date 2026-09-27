import { neon } from '@neondatabase/serverless';

type Query = (text: string, params?: unknown[]) => Promise<any[]>;

export function sql(): any {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = neon(url);
  const query = client.query.bind(client) as unknown as Query;
  return query;
}
