import { Link2, Loader2, Clock, Infinity, Calendar, Globe, Wifi, Hash, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrowserRouter, Routes, Route, useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { ensureHttps, normalizeUrl, generateShortPath } from './lib/utils';
import { useDarkMode } from './lib/hooks/useDarkMode';
import { DarkModeToggle } from './components/DarkModeToggle';
import { SocialIcons } from './components/SocialIcons';
import { shortenUrl, getUrl } from './lib/api';

function RedirectHandler() {
  const { shortPath } = useParams<{ shortPath: string }>();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { darkMode } = useDarkMode();

  useEffect(() => {
    const redirect = async () => {
      if (!shortPath) return;

      try {
        const urlRecord = await getUrl(shortPath);
        if (!urlRecord) {
          setError('URL not found or has expired');
          return;
        }

        window.location.href = urlRecord.original_url;
      } catch (error) {
        setError('Failed to redirect');
      } finally {
        setIsLoading(false);
      }
    };

    redirect();
  }, [shortPath]);

  if (error) {
    return (
      <div className={`min-h-screen ${
        darkMode 
          ? 'bg-gradient-to-br from-gray-900 to-indigo-900' 
          : 'bg-gradient-to-br from-blue-600 to-indigo-900'
      } flex items-center justify-center p-4`}>
        <div className={`${
          darkMode 
            ? 'bg-gray-800/80 text-white' 
            : 'bg-white/80 text-gray-900'
        } backdrop-blur-lg rounded-2xl shadow-xl p-8`}>
          <h1 className="text-2xl font-bold mb-2">Error</h1>
          <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{error}</p>
          <Link to="/" className="mt-4 inline-block text-indigo-400 hover:text-indigo-300">
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
  const { darkMode, toggleDarkMode } = useDarkMode();

  // Remove the emergency purge useEffect since we're not using IndexedDB anymore

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url) {
      toast.error('Please enter a URL');
      return;
    }

    try {
      setIsLoading(true);
        
      // Ensure URL is properly formatted
      const processedUrl = ensureHttps(url.trim());
      
      // Validate URL format
      let urlObj: URL;
      try {
        urlObj = new URL(processedUrl);
      } catch (err) {
        toast.error('Invalid URL format. Please include protocol (http:// or https://)');
        return;
      }

      // Basic domain validation
      if (!urlObj.hostname.includes('.') || urlObj.hostname === '.') {
        toast.error('Invalid domain name');
        return;
      }

      // Validate TLD (top-level domain)
      const tld = urlObj.hostname.split('.').pop();
      if (!tld || tld.length < 2) {
        toast.error('Invalid domain: missing or invalid TLD');
        return;
      }

      // Generate short path and create URL
      const shortPath = generateShortPath();
      const result = await shortenUrl(processedUrl, shortPath, expiration);
      
      const newShortUrl = `${window.location.origin}/${result.short_path}`;
      setShortenedUrl(newShortUrl);
      setUrl(''); // Clear the input
      toast.success('URL shortened successfully!');
    } catch (error) {
      console.error('Error shortening URL:', error);
      toast.error('Failed to shorten URL. Please try again.');
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

  // Auto copy when URL is generated
  useEffect(() => {
    if (shortenedUrl) {
      copyToClipboard();
    }
  }, [shortenedUrl]);

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
    <div className={`min-h-screen transition-colors duration-300 ${
      darkMode 
        ? 'bg-gradient-to-br from-gray-900 to-indigo-900 text-white' 
        : 'bg-gradient-to-br from-blue-600 to-indigo-900 text-gray-900'
    } flex items-center justify-center p-4 relative overflow-hidden`}>
      {/* Add Social Icons */}
      <SocialIcons darkMode={darkMode} />
      
      {/* Move Dark Mode Toggle to left side */}
      <div className="fixed top-4 left-4">
        <DarkModeToggle darkMode={darkMode} onChange={toggleDarkMode} />
      </div>
      
      {/* Floating Background Elements */}
      {floatingElements.map((element, index) => (
        <FloatingElement key={index} {...element} />
      ))}

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className={`${
          darkMode 
            ? 'bg-gray-800/80 border-gray-700/20 text-white' 
            : 'bg-white/80 border-white/20 text-gray-900'
        } backdrop-blur-lg rounded-2xl shadow-xl p-8 border transition-colors duration-300`}>
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
            className={`text-3xl font-bold text-center mb-2 ${
              darkMode ? 'text-white' : 'text-gray-800'
            }`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            URL Shortener
          </motion.h1>
          <motion.p 
            className={`text-center mb-8 ${
              darkMode ? 'text-gray-300' : 'text-gray-600'
            }`}
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
                className={`w-full px-4 py-3 rounded-lg border ${
                  darkMode 
                    ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                    : 'bg-white/90 border-gray-300 text-gray-900 placeholder-gray-500'
                } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent`}
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
                      ? darkMode
                        ? 'bg-indigo-600 text-white'
                        : 'bg-indigo-100 text-indigo-700'
                      : darkMode
                        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        : 'bg-white/80 text-gray-600 hover:bg-gray-100'
                  }`}
                  whileTap={{ scale: 0.98 }}
                  whileHover={{ scale: 1.02 }}
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
                initial={{ opacity: 0, height: 0, y: 20 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -20 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="mt-8"
              >
                <div className={`p-4 ${
                  darkMode 
                    ? 'bg-gray-700/80 text-white' 
                    : 'bg-white/80 text-gray-700'
                } backdrop-blur-sm rounded-lg transition-colors duration-300`}>
                  <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm font-medium mb-2"
                  >
                    Shortened URL copied to clipboard!
                  </motion.p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shortenedUrl}
                      className={`flex-1 px-3 py-2 ${
                        darkMode 
                          ? 'bg-gray-600 border-gray-500 text-white' 
                          : 'bg-white border-gray-300 text-gray-900'
                      } border rounded-lg text-sm transition-colors duration-300`}
                    />
                    <motion.button
                      onClick={copyToClipboard}
                      className={`px-4 py-2 ${
                        darkMode 
                          ? 'bg-indigo-500 text-white hover:bg-indigo-600' 
                          : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                      } rounded-lg transition-colors text-sm font-medium`}
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.05 }}
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

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className={`fixed bottom-4 text-sm ${
          darkMode ? 'text-gray-400' : 'text-white/70'
        }`}
      >
        © {new Date().getFullYear()}{' '}
        <a 
          href="https://www.liuu.org/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="hover:text-indigo-400 transition-colors"
        >
          Kenneth Liu
        </a>
        . All rights reserved.
      </motion.div>

      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: darkMode ? '#374151' : '#fff',
            color: darkMode ? '#fff' : '#374151',
          },
        }}
      />
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
      animate={{ opacity: 0.3, x: [0, x, 0], y: [0, y, 0] }}
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