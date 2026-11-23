export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'veromed_theme_v1';

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

export function getNextTheme(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark';
}

export function getStoredTheme(): ThemeMode {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 'light';
    }
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
  } catch {
    // Ignore storage access errors
  }
  return 'light';
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.toggle('dark', mode === 'dark');
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage write errors
  }
}
