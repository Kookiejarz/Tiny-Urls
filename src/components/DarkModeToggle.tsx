import { Sun, Moon } from 'lucide-react';
import { motion } from 'framer-motion';

interface DarkModeToggleProps {
  darkMode: boolean;
  onChange: () => void;
}

export function DarkModeToggle({ darkMode, onChange }: DarkModeToggleProps) {
  return (
    <motion.button
      onClick={onChange}
      className={`fixed top-4 left-17 p-2 rounded-full ${
        darkMode ? 'bg-gray-800 text-yellow-400' : 'bg-white text-gray-800'
      } shadow-lg`}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
    >
      {darkMode ? <Sun size={20} /> : <Moon size={20} />}
    </motion.button>
  );
}