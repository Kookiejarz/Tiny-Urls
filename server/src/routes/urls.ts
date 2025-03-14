import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import config from '../config';
import { getExpirationTime } from '../utils';

const router = Router();

// Create Supabase client
const supabase = createClient(config.supabase.url!, config.supabase.key!, {
  auth: { persistSession: false }
});

router.post('/shorten', async (req, res) => {
  try {
    const { originalUrl, shortPath, expiration } = req.body;
    
    if (!originalUrl || !shortPath) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('Creating URL:', { originalUrl, shortPath, expiration });

    const { data, error } = await supabase
      .from('urls')
      .insert({
        original_url: originalUrl,
        short_path: shortPath,
        expires_at: getExpirationTime(expiration)
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Database error', details: error.message });
    }

    console.log('Created URL:', data);
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to create shortened URL' });
  }
});

router.get('/:shortPath', async (req, res) => {
  try {
    const { shortPath } = req.params;
    const { data, error } = await supabase
      .from('urls')
      .select()
      .eq('short_path', shortPath)
      .single();

    if (error) {
      console.error('Database error:', error);
      return res.status(404).json({ error: 'URL not found' });
    }

    if (!data) {
      return res.status(404).json({ error: 'URL not found' });
    }

    if (data.expires_at && new Date() > new Date(data.expires_at)) {
      await supabase
        .from('urls')
        .delete()
        .eq('short_path', shortPath);
      return res.status(404).json({ error: 'URL has expired' });
    }

    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;