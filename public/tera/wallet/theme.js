// Shared Theme Manager for Web Client
// Options: 'system' (default) | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'tera_theme';

export function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') {
      return value;
    }
  } catch {
    // Fallback if storage access is restricted
  }
  return 'system';
}

export function setStoredTheme(theme) {
  try {
    if (theme === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Ignore write failures in sandbox
  }
}

export function getEffectiveTheme(themeSetting, isSystemDark) {
  if (themeSetting === 'dark') return 'dark';
  if (themeSetting === 'light') return 'light';
  return isSystemDark ? 'dark' : 'light';
}

export class ThemeManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || THEME_STORAGE_KEY;
    this.listeners = new Set();
    this.mediaQuery = options.mediaQuery || (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);
    
    this.currentSetting = getStoredTheme();
    
    this.handleSystemChange = (e) => {
      if (this.currentSetting === 'system') {
        this.notify(this.getEffective());
      }
    };

    if (this.mediaQuery && this.mediaQuery.addEventListener) {
      this.mediaQuery.addEventListener('change', this.handleSystemChange);
    } else if (this.mediaQuery && this.mediaQuery.addListener) {
      this.mediaQuery.addListener(this.handleSystemChange);
    }
  }

  getSetting() {
    return this.currentSetting;
  }

  setSetting(newSetting) {
    if (newSetting !== 'system' && newSetting !== 'light' && newSetting !== 'dark') {
      throw new Error(`Invalid theme setting: ${newSetting}`);
    }
    this.currentSetting = newSetting;
    setStoredTheme(newSetting);
    this.notify(this.getEffective());
  }

  getEffective() {
    const isSystemDark = this.mediaQuery ? Boolean(this.mediaQuery.matches) : false;
    return getEffectiveTheme(this.currentSetting, isSystemDark);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(effectiveTheme) {
    for (const listener of this.listeners) {
      try {
        listener(effectiveTheme, this.currentSetting);
      } catch (err) {
        console.error('Theme listener error:', err);
      }
    }
  }

  applyToDocument(doc = document) {
    if (!doc || !doc.documentElement) return;
    const effective = this.getEffective();
    if (effective === 'dark') {
      doc.documentElement.classList.add('dark');
      doc.documentElement.setAttribute('data-theme', 'dark');
    } else {
      doc.documentElement.classList.remove('dark');
      doc.documentElement.setAttribute('data-theme', 'light');
    }
  }

  destroy() {
    if (this.mediaQuery && this.mediaQuery.removeEventListener) {
      this.mediaQuery.removeEventListener('change', this.handleSystemChange);
    } else if (this.mediaQuery && this.mediaQuery.removeListener) {
      this.mediaQuery.removeListener(this.handleSystemChange);
    }
    this.listeners.clear();
  }
}
