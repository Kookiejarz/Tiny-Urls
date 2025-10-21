import React, { useState } from 'react';
import { Link2, Loader2, Clock, Calendar, Globe, Wifi, Hash, Mail } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { urlStorage, type ExpirationOption } from './lib/db';

// Replace the existing generateShortPath function
function generateShortPath() {
  // Generate exactly 4 characters as required by the backend
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  console.log(`Generated short path: ${result} (length: ${result.length})`);
  return result;
}

function ensureHttps(url: string): string {
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

function FloatingElement({ icon: Icon, delay, duration, x, y }: { 
  icon: typeof Link2;
  delay: number;
  duration: number;
  x: number;
  y: number;
}) {
  return (
    <motion.div
      className="absolute text-indigo-400/30"
      initial={{ x, y, scale: 0.5 }}
      animate={{
        x: [x, x + 100, x],
        y: [y, y - 100, y],
        rotate: 360,
        scale: [0.5, 1.2, 0.5]
      }}
      transition={{
        duration,
        delay,
        repeatType: "reverse",
        ease: "easeInOut"
      }}
    >
      <Icon size={48} />
    </motion.div>
  );
}

function App() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [shortenedUrl, setShortenedUrl] = useState<string | null>(null);
  const [expiration, setExpiration] = useState<ExpirationOption>('7d');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url) {
      toast.error('Please enter a URL');
      return;
    }

    const processedUrl = ensureHttps(url);

    try {
      setIsLoading(true);
      
      const shortPath = generateShortPath();
      const data = await urlStorage.saveUrl(processedUrl, shortPath, expiration);

      const returnedPath = data.shortPath as string;

      if (data.isExisting) {
        toast.success('Using existing shortened URL');
      } else {
        toast.success('URL shortened successfully!');
      }

      // Use the path returned by the server
      setShortenedUrl(urlStorage.getShortUrl(returnedPath));
      
    } catch (error) {
      toast.error('Failed to shorten URL. Please try again.');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (shortenedUrl) {
      try {
        navigator.clipboard.writeText(shortenedUrl);
        toast.success('URL copied to clipboard!');
      } catch (err) {
        console.error('Error copying to clipboard:', err);
        toast.error('Failed to copy URL. Try selecting and copying manually.');
        
        // Select the text as fallback
        const input = document.querySelector('input[value="' + shortenedUrl + '"]') as HTMLInputElement;
        if (input) {
          input.select();
          toast.success('URL selected. Press Ctrl+C to copy.');
        }
      }
    }
  };

  const expirationOptions = [
    { value: '12h', label: '12 Hours', icon: Clock },
    { value: '7d', label: '7 Days', icon: Calendar },
    { value: '180d', label: '180 Days', icon: Calendar },
  ] as const;

  const floatingElements = [
    { icon: Globe, delay: 0, duration: 15, x: -150, y: 150 },
    { icon: Wifi, delay: 2, duration: 12, x: 150, y: -150 },
    { icon: Hash, delay: 4, duration: 18, x: 250, y: 250 },
    { icon: Mail, delay: 1, duration: 14, x: -250, y: -200 },
    { icon: Link2, delay: 3, duration: 16, x: 200, y: 0 },
    { icon: Globe, delay: 5, duration: 13, x: -200, y: 0 },
    { icon: Hash, delay: 2.5, duration: 17, x: 0, y: 200 },
    { icon: Wifi, delay: 3.5, duration: 15, x: 0, y: -200 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Floating Background Elements */}
      {floatingElements.map((element, index) => (
        <FloatingElement key={index} {...element} />
      ))}
      
      <motion.div 
        className="w-full max-w-md relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl p-6 sm:p-8 border border-white/20">
          <motion.div 
            className="flex items-center justify-center mb-6"
            animate={{ 
              rotate: 360,
              scale: [1, 1.1, 1]
            }}
            transition={{ 
              rotate: {
                duration: 20,
                repeat: Infinity,
                ease: "linear"
              },
              scale: {
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }
            }}
          >
            <Link2 className="w-12 h-12 text-indigo-600" />
          </motion.div>
          
          <motion.h1 
            className="text-2xl sm:text-3xl font-bold text-center text-gray-800 mb-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            URL Shortener
          </motion.h1>
          
          <motion.p 
            className="text-center text-gray-600 mb-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            Create short, memorable links in seconds
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
                placeholder="https://example.com/your-long-url"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white/90"
                disabled={isLoading}
              />
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 }}
              className="grid grid-cols-2 sm:grid-cols-3 gap-2"
            >
              {expirationOptions.map(({ value, label, icon: Icon }) => (
                <motion.button
                  key={value}
                  type="button"
                  onClick={() => setExpiration(value)}
                  className={`flex items-center justify-center p-2 sm:p-3 rounded-lg transition-colors ${
                    expiration === value
                      ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-200'
                      : 'bg-white/80 text-gray-600 hover:bg-gray-100'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Icon className="w-4 h-4 mr-1 sm:mr-2" />
                  <span className="text-xs sm:text-sm">{label}</span>
                </motion.button>
              ))}
            </motion.div>

            <motion.button
              type="submit"
              disabled={isLoading || !url}
              className={`w-full py-3 rounded-lg transition-all flex items-center justify-center
                ${url ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}
              `}
              whileHover={url ? { scale: 1.02 } : {}}
              whileTap={url ? { scale: 0.98 } : {}}
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
                'Shorten URL!'
              )}
            </motion.button>
          </form>

          <AnimatePresence>
            {shortenedUrl && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-6"
              >
                <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg">
                  <p className="text-sm font-medium text-indigo-700 mb-2">Your shortened URL:</p>
                  <div className="flex items-center gap-2">
                    <input 
                      type="text"
                      value={shortenedUrl}
                      readOnly
                      className="flex-1 px-3 py-2 bg-white border border-indigo-200 rounded-lg text-sm font-medium"
                      id="shortened-url-input"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <motion.button
                      onClick={handleCopy}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium flex items-center"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Copy
                    </motion.button>
                  </div>
                  
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-3 text-center"
                  >
                    <a 
                      href={shortenedUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-indigo-600 hover:text-indigo-800 underline flex items-center justify-center"
                    >
                      <Globe className="w-4 h-4 mr-1" /> Open in new tab
                    </a>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ delay: 1 }}
            className="mt-6 text-center text-xs text-black/50"
          >
            Share links that work across any device
          </motion.div>
        </div>
      </motion.div>
      <Toaster 
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#4338CA',
            color: '#fff',
          },
          success: {
            iconTheme: {
              primary: '#fff',
              secondary: '#4338CA',
            },
          },
        }} 
      />
    </div>
  );
}

export default App;
