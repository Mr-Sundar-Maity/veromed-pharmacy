import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import {
  applyTheme,
  getNextTheme,
  getStoredTheme,
  type ThemeMode,
} from '../lib/theme';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
    return getStoredTheme();
  });

  useEffect(() => {
    const syncFromDom = () => {
      const isDark = document.documentElement.classList.contains('dark');
      setTheme(isDark ? 'dark' : 'light');
    };
    window.addEventListener('veromed-theme-change', syncFromDom);
    return () => {
      window.removeEventListener('veromed-theme-change', syncFromDom);
    };
  }, []);

  function handleToggle() {
    const next = getNextTheme(theme);
    applyTheme(next);
    setTheme(next);
    window.dispatchEvent(new CustomEvent('veromed-theme-change'));
  }

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${className}`}
    >
      {isDark ? (
        <>
          <Sun className="w-3.5 h-3.5 text-amber-400" />
          <span>Light</span>
        </>
      ) : (
        <>
          <Moon className="w-3.5 h-3.5 text-slate-600" />
          <span>Dark</span>
        </>
      )}
    </button>
  );
};
