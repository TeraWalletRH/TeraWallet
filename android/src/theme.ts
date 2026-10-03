import { useEffect, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';

export type ThemeSetting = 'system' | 'light' | 'dark';
export const MOBILE_THEME_KEY = 'tera_theme';

const memoryThemeStorage: Record<string, string> = {};

export async function getStoredMobileTheme(): Promise<ThemeSetting> {
  try {
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(MOBILE_THEME_KEY);
      if (val === 'light' || val === 'dark' || val === 'system') {
        return val;
      }
    } else {
      const val = memoryThemeStorage[MOBILE_THEME_KEY];
      if (val === 'light' || val === 'dark' || val === 'system') {
        return val;
      }
    }
  } catch {
    // Ignore storage read error
  }
  return 'system';
}

export async function setStoredMobileTheme(setting: ThemeSetting): Promise<void> {
  try {
    if (setting === 'system') {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(MOBILE_THEME_KEY);
      }
      delete memoryThemeStorage[MOBILE_THEME_KEY];
    } else {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MOBILE_THEME_KEY, setting);
      }
      memoryThemeStorage[MOBILE_THEME_KEY] = setting;
    }
  } catch {
    // Ignore storage write error
  }
}

export function resolveEffectiveColorScheme(
  setting: ThemeSetting,
  systemScheme: ColorSchemeName,
): 'light' | 'dark' {
  if (setting === 'dark') return 'dark';
  if (setting === 'light') return 'light';
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function useAppTheme() {
  const [setting, setSettingState] = useState<ThemeSetting>('system');
  // getColorScheme() can return null/undefined (e.g. before the OS has
  // reported one); ColorSchemeName itself doesn't include either, so this
  // falls back to 'light' for that brief window rather than widening the
  // type everywhere it's used.
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(
    Appearance.getColorScheme() ?? 'light',
  );

  useEffect(() => {
    getStoredMobileTheme().then(setSettingState);

    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });

    return () => subscription.remove();
  }, []);

  const updateSetting = async (newSetting: ThemeSetting) => {
    setSettingState(newSetting);
    await setStoredMobileTheme(newSetting);
  };

  const effectiveTheme = resolveEffectiveColorScheme(setting, systemScheme);

  return {
    setting,
    effectiveTheme,
    updateSetting,
  };
}
