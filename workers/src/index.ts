import { createClient } from '@supabase/supabase-js';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://short.liuu.org',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'POST' && url.pathname === '/api/urls/shorten') {
        const { originalUrl, shortPath, expiration } = await request.json();

        if (!originalUrl || !shortPath) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields' }), 
            { 
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            }
          );
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

        if (error) throw error;

        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/urls/')) {
        const shortPath = url.pathname.split('/').pop();
        
        const { data, error } = await supabase
          .from('urls')
          .select()
          .eq('short_path', shortPath)
          .single();

        if (error || !data) {
          return new Response(
            JSON.stringify({ error: 'URL not found' }), 
            { 
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            }
          );
        }

        // Check expiration
        if (data.expires_at && new Date() > new Date(data.expires_at)) {
          await supabase
            .from('urls')
            .delete()
            .eq('short_path', shortPath);

          return new Response(
            JSON.stringify({ error: 'URL has expired' }), 
            { 
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            }
          );
        }

        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      return new Response(
        JSON.stringify({ error: 'Method not allowed' }), 
        { 
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }), 
        { 
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
  },
};