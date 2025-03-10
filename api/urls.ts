import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  {
    auth: { persistSession: false }
  }
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Log request details for debugging
  console.log('Request:', {
    method: req.method,
    url: req.url,
    body: req.body
  });

  try {
    if (req.method === 'POST' && req.url?.includes('/shorten')) {
      const { originalUrl, shortPath, expiration } = req.body;

      if (!originalUrl || !shortPath) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { data, error } = await supabase
        .from('urls')
        .insert({
          original_url: originalUrl,
          short_path: shortPath,
          expires_at: expiration
        })
        .select()
        .single();

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}