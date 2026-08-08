/**
 * 全局外观主题：偏好三态 system / light / dark，落到 <html> 的 data-mode 属性上。
 *
 * 明暗真正的换色全由 CSS 承担（styles/system.css）：data-mode=dark 强制暗、
 * data-mode=light 强制亮、无该属性时由 `@media (prefers-color-scheme)` 跟随系统。
 * 故「跟随系统」= 移除属性即可，OS 切换实时生效，无需 JS 监听 matchMedia。
 */

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'qiyan.theme'

/** 读取持久化偏好；无记录（含首次启动）默认跟随系统。 */
export function readThemePreference(): ThemePreference {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** 写偏好到 <html>：system 移除 data-mode（交回 CSS 媒体查询），其余强制该模式。 */
export function applyThemePreference(pref: ThemePreference): void {
  const root = document.documentElement
  if (pref === 'system') delete root.dataset.mode
  else root.dataset.mode = pref
}

/** 持久化偏好；system 视为默认态，直接清除记录。 */
export function storeThemePreference(pref: ThemePreference): void {
  if (pref === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, pref)
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * 当前**实际**是不是深色（把三态偏好折算成明/暗二值）：data-mode 有值即以它为准，否则跟随系统。
 * CSS 不需要这个（换色全在样式层），但要把颜色交给非 CSS 的消费方时需要——如书页 iframe 里的
 * foliate 引擎，它不吃 CDS token，得由宿主明确告诉它此刻是明是暗。
 */
export function isDarkMode(): boolean {
  const mode = document.documentElement.dataset.mode
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia(DARK_QUERY).matches
}

/**
 * 订阅实际明暗变化，返回退订函数。两条来源都要收得到：
 * 用户改偏好（写 <html> 的 data-mode，见 applyThemePreference）与系统在「跟随系统」下切换。
 */
export function subscribeDarkMode(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
  const mq = window.matchMedia(DARK_QUERY)
  mq.addEventListener('change', onChange)
  return () => {
    observer.disconnect()
    mq.removeEventListener('change', onChange)
  }
}
