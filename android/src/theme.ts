import { useEffect, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeSetting = 'system' | 'light' | 'dark';
export const MOBILE_THEME_KEY = 'tera_theme';

export async function getStoredMobileTheme(): Promise<ThemeSetting> {
  try {
    const val = await AsyncStorage.getItem(MOBILE_THEME_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val;
    }
  } catch {
    // Ignore storage read error
  }
  return 'system';
}

export async function setStoredMobileTheme(setting: ThemeSetting): Promise<void> {
  try {
    if (setting === 'system') {
      await AsyncStorage.removeItem(MOBILE_THEME_KEY);
    } else {
      await AsyncStorage.setItem(MOBILE_THEME_KEY, setting);
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
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(Appearance.getColorScheme());

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
