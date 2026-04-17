import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTheme, ThemeMode, AppTheme } from './tokens';

interface ThemeState {
  preference: 'system' | 'light' | 'dark';
  setPreference: (p: 'system' | 'light' | 'dark') => void;
}

export const useThemePreference = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    { name: 'theme-pref', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export function useAppTheme(): AppTheme {
  const system = useColorScheme();
  const preference = useThemePreference((s) => s.preference);
  const mode: ThemeMode = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  return getTheme(mode);
}
