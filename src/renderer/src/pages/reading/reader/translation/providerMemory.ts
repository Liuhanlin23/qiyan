/**
 * 句子翻译引擎的上次选择记忆（Google / Azure）。
 *
 * 属**设备级工具记忆**（归属与读写防御见 [lib/deviceMemory.ts](../../../../lib/deviceMemory.ts)）：
 * 落 localStorage、不进 `user_setting`、不同步——哪家引擎当下更通更多取决于这台机器所处的网络，
 * 不是该跟着账号走的偏好。认不得的值退回 google。
 */
import { defineDeviceMemory } from '@/lib/deviceMemory'

/** 翻译引擎（值对齐跨进程契约 `TranslateRequest['provider']`，漂移即在 bridge 调用处报错）。 */
export type TranslationProvider = TranslateRequest['provider']

const PROVIDERS: TranslationProvider[] = ['google', 'azure']

const memory = defineDeviceMemory<TranslationProvider>(
  'qiyan.reading.translationProvider',
  'google',
  (raw) => (PROVIDERS.includes(raw as TranslationProvider) ? (raw as TranslationProvider) : 'google'),
)

export const readTranslationProvider = memory.read
export const storeTranslationProvider = memory.store
