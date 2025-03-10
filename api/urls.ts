import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { config } from '../server/src/config';
import { getExpirationTime } from '../server/src/utils';

const supabase = createClient(config.supabase.url!, config.supabase.key!, {
  auth: { persistSession: false }
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      const { originalUrl, shortPath, expiration } = req.body;

      const { data, error } = await supabase
        .from('urls')
        .insert({
          original_url: originalUrl,
          short_path: shortPath,
          expires_at: getExpirationTime(expiration)
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'GET') {
      const shortPath = req.query.shortPath as string;
      const { data, error } = await supabase
        .from('urls')
        .select()
        .eq('short_path', shortPath)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'URL not found' });
      }

      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}