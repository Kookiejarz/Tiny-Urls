import { Link2, Loader2, Clock, Infinity, Calendar, Globe, Wifi, Hash, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrowserRouter, Routes, Route, useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { urlStorage, ExpirationOption } from './lib/db';
import { ensureHttps, normalizeUrl, generateShortPath } from './lib/utils';

function RedirectHandler() {
  const { shortPath } = useParams<{ shortPath: string }>();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const redirect = async () => {
      if (!shortPath) {
        setError('Invalid short URL');
        setIsLoading(false);
        return;
      }

      // Get the URL record from storage
      const urlRecord = await urlStorage.getUrl(shortPath);

      if (!urlRecord) {
        setError('URL not found or has expired');
        setIsLoading(false);
        return;
      }

      try {
        // Redirect to the original URL
        window.location.href = urlRecord.originalUrl;
      } catch (err) {
        console.error('Failed to redirect:', err);
        setError('Failed to process redirect');
        setIsLoading(false);
      }
    };

    redirect();
  }, [shortPath]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-900 flex items-center justify-center p-4">
        <div className="bg-white/80 backdrop-blur-lg rounded-2xl shadow-xl p-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Error</h1>
          <p className="text-gray-600">{error}</p>
          <Link to="/" className="mt-4 inline-block text-indigo-600 hover:text-indigo-700">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-900 flex items-center justify-center p-4">
        <div className="bg-white/80 backdrop-blur-lg rounded-2xl shadow-xl p-8">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
          <p className="mt-4 text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  return null;
}

function URLShortenerForm() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [shortenedUrl, setShortenedUrl] = useState<string | null>(null);
  const [expiration, setExpiration] = useState<ExpirationOption>('7d');

  // Handle emergency purge on window close
  useEffect(() => {
    const handleBeforeUnload = () => {
      urlStorage.purgeAllUrls();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url) {
      toast.error('Please enter a URL');
      return;
    }

    try {
      setIsLoading(true);
        
      // Ensure URL is properly formatted
      const processedUrl = ensureHttps(url);
      const urlObj = new URL(processedUrl);

      // Basic domain validation
      if (!urlObj.hostname.includes('.')) {
        toast.error('Invalid domain name');
        return;
      }

      // Normalize the URL for comparison
      const normalizedUrl = normalizeUrl(processedUrl);

      // Check if URL already exists in database
      const db = await urlStorage.getDb();
      const tx = db.transaction('urls', 'readonly');
      const store = tx.objectStore('urls');
      let cursor = await store.openCursor();

      while (cursor) {
        if (normalizeUrl(cursor.value.originalUrl) === normalizedUrl) {
          // URL already exists, return existing short URL
          const existingShortUrl = `${window.location.origin}/${cursor.value.shortPath}`;
          setShortenedUrl(existingShortUrl);
          toast.success('Found existing shortened URL!');
          return;
        }
        cursor = await cursor.continue();
      }

      // If URL doesn't exist, create new short URL
      let shortPath = generateShortPath();
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        const exists = await urlStorage.urlExists(shortPath);
          
        if (!exists) {
          await urlStorage.saveUrl(processedUrl, shortPath, expiration);
          const newShortUrl = `${window.location.origin}/${shortPath}`;
          setShortenedUrl(newShortUrl);
          toast.success('URL shortened successfully!');
          return;
        }

        shortPath = generateShortPath();
        attempts++;
      }

      throw new Error('Could not generate unique short path');
    } catch (error) {
      console.error('Error shortening URL:', error);
      if (error instanceof TypeError) {
        toast.error('Invalid URL format. Please enter a valid URL.');
      } else {
        toast.error('Failed to shorten URL. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (shortenedUrl) {
      try {
        await navigator.clipboard.writeText(shortenedUrl);
        toast.success('Copied to clipboard!');
      } catch (err) {
        toast.error('Failed to copy to clipboard');
      }
    }
  };

  const expirationOptions = [
    { value: '12h', label: '12 Hours', icon: Clock },
    { value: '7d', label: '7 Days', icon: Calendar },
    { value: 'forever', label: 'Forever', icon: Infinity },
  ] as const;

  // Update the floating elements configuration with safer values
  const floatingElements = [
    { icon: Globe, delay: 0, duration: 4, x: 150, y: 100 },
    { icon: Wifi, delay: 0.5, duration: 5, x: 100, y: 150 },
    { icon: Hash, delay: 1, duration: 4.5, x: 200, y: 100 },
    { icon: Mail, delay: 1.5, duration: 5.5, x: 150, y: 200 },
    { icon: Link2, delay: 2, duration: 4.2, x: 200, y: 150 },
    { icon: Globe, delay: 2.5, duration: 5.2, x: 100, y: 100 },
    { icon: Hash, delay: 3, duration: 4.8, x: 150, y: 200 },
    { icon: Wifi, delay: 3.5, duration: 5, x: 200, y: 150 }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Floating Background Elements */}
      {floatingElements.map((element, index) => (
        <FloatingElement key={index} {...element} />
      ))}

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-white/80 backdrop-blur-lg rounded-2xl shadow-xl p-8 border border-white/20">
          <motion.div 
            className="flex items-center justify-center mb-8"
            animate={{ 
              rotate: [0, 360],
              scale: [1, 1.1, 1]
            }}
            transition={{ 
              duration: 20,
              repeat: Infinity,
              repeatType: "loop",
              ease: "linear"
            }}
          >
            <Link2 className="w-12 h-12 text-indigo-600" />
          </motion.div>

          <motion.h1 
            className="text-3xl font-bold text-center text-gray-800 mb-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            URL Shortener
          </motion.h1>

          <motion.p 
            className="text-center text-gray-600 mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            Paste your long URL below to create a shorter link
          </motion.p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
            >
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter your URL here"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white/90"
                disabled={isLoading}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 }}
              className="grid grid-cols-3 gap-2"
            >
              {expirationOptions.map(({ value, label, icon: Icon }) => (
                <motion.button
                  key={value}
                  type="button"
                  onClick={() => setExpiration(value)}
                  className={`flex items-center justify-center p-3 rounded-lg transition-colors ${
                    expiration === value
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-white/80 text-gray-600 hover:bg-gray-100'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  <span className="text-sm">{label}</span>
                </motion.button>
              ))}
            </motion.div>

            <motion.button
              type="submit"
              disabled={isLoading}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Shortening...
                </>
              ) : (
                'Shorten URL'
              )}
            </motion.button>
          </form>

          <AnimatePresence>
            {shortenedUrl && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-8"
              >
                <div className="p-4 bg-white/80 backdrop-blur-sm rounded-lg">
                  <p className="text-sm font-medium text-gray-700 mb-2">Shortened URL:</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shortenedUrl}
                      className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
                    />
                    <motion.button
                      onClick={copyToClipboard}
                      className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors text-sm font-medium"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Copy
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <Toaster position="top-center" />
    </div>
  );
}

// Update the FloatingElement component with improved animation
function FloatingElement({ 
  icon: Icon, 
  delay, 
  duration, 
  x, 
  y 
}: { 
  icon: Icon; 
  delay: number; 
  duration: number; 
  x: number; 
  y: number; 
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 0, y: 0 }}
      animate={{ 
        opacity: [0, 0.3, 0],
        x: [0, x, 0],
        y: [0, y, 0]
      }}
      transition={{ 
        delay,
        duration,
        repeat: Infinity,
        repeatDelay: 0.5,
        ease: "easeInOut"
      }}
      className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 text-indigo-400/30"
    >
      <Icon size={48} />
    </motion.div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<URLShortenerForm />} />
        <Route path=":shortPath" element={<RedirectHandler />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;