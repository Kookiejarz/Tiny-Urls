import dotenv from 'dotenv';
import path from 'path';

// Load environment variables only in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

// Validate Supabase credentials
const validateConfig = () => {
  if (!process.env.SUPABASE_URL) {
    throw new Error('Missing SUPABASE_URL');
  }
  
  if (!process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_KEY');
  }

  // Validate key format (should be JWT token)
  if (!process.env.SUPABASE_SERVICE_KEY.startsWith('eyJ')) {
    throw new Error('Invalid SUPABASE_SERVICE_KEY format');
  }
};

validateConfig();

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  cors: {
    origin: process.env.VERCEL_URL 
      ? [`https://${process.env.VERCEL_URL}`, `https://short.liuu.org`, 'http://localhost:5173'] 
      : 'http://localhost:5173'
  }
};

// Log masked configuration (only in development)
if (process.env.NODE_ENV !== 'production') {
  console.log('Config loaded:', {
    ...config,
    supabase: {
      url: config.supabase.url,
      key: '***' + config.supabase.key?.slice(-4)
    }
  });
}

export default config;