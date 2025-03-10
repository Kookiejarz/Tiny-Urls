import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import config from './config';
import urlRoutes from './routes/urls';
import { getExpirationTime } from './utils';

const app = express();

// Create Supabase client
const supabase = createClient(config.supabase.url!, config.supabase.key!, {
  auth: { persistSession: false }
});

// Configure CORS
app.use(cors({
  origin: ['https://short.liuu.org', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS']
}));

app.use(express.json());

// Add request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api/urls', urlRoutes);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

const router = express.Router();

router.post('/shorten', async (req: Request, res: Response) => {
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

router.get('/:shortPath', async (req: Request, res: Response) => {
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