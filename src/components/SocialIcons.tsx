import { motion } from 'framer-motion';
import { FaGithub, FaInstagram, FaLink } from 'react-icons/fa';

interface SocialIconsProps {
  darkMode: boolean;
}

export function SocialIcons({ darkMode }: SocialIconsProps) {
  const socialLinks = [
    {
      icon: FaGithub,
      href: 'https://github.com/Kookiejarz/Tiny-Urls/',
      label: 'GitHub'
    },
    {
      icon: FaInstagram,
      href: 'https://www.instagram.com/kennethhhliu/',
      label: 'Instagram' // Fixed typo in 'Instagram'
    }
  ];

  return (
    <motion.div 
      className="fixed top-4 right-4 flex items-center space-x-4 z-50" // Changed right-4 to left-16
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
    >
      {socialLinks.map(({ icon: Icon, href, label }) => (
        <motion.a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`p-2 rounded-full ${
            darkMode 
              ? 'bg-gray-800 text-gray-200 hover:bg-gray-700' 
              : 'bg-white/80 text-gray-800 hover:bg-white'
          } transition-colors`}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          title={label}
        >
          <Icon size={20} />
        </motion.a>
      ))}
    </motion.div>
  );
}