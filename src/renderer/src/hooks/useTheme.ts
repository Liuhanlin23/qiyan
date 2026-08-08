import { useState, useSyncExternalStore } from 'react'
import {
  applyThemePreference,
  isDarkMode,
  readThemePreference,
  storeThemePreference,
  subscribeDarkMode,
  type ThemePreference,
} from '@/lib/theme'

/**
 * 外观主题偏好的读写：返回 [偏好, 设置]，setter 写穿到 <html> 与 localStorage。
 * 启动时的初次应用见 main.tsx（本 hook 只在挂载点接管后续切换）。
 */
export function useTheme(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(readThemePreference)

  const set = (next: ThemePreference): void => {
    setPref(next)
    applyThemePreference(next)
    storeThemePreference(next)
  }

  return [pref, set]
}

/**
 * 当前实际是不是深色（三态偏好折算后的二值，随偏好改动与系统切换实时更新）。
 * 给必须拿到明暗二值的非 CSS 消费方用（如把书页配色喂进 foliate 引擎）；纯样式一律交给 CDS token 自动切。
 */
export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribeDarkMode, isDarkMode)
}
