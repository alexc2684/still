import { neon } from '@neondatabase/serverless';

type Query = (text: string, params?: unknown[]) => Promise<any[]>;

export function sql(isolation?: 'Serializable'): any {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = neon(url);
  if (isolation) return async (text: string, params: unknown[] = []) => {
    const [rows] = await client.transaction([client.query(text, params)], { isolationLevel: isolation });
    return rows;
  };
  const query = client.query.bind(client) as unknown as Query;
  return query;
}
