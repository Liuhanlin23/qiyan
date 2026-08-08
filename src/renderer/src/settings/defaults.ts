// 用户设置键注册表：客户端唯一常量源（single source of truth）。每个 Settings 属性 → 其 wire 键、默认值、校验器。
// 键为 <域>.<驼峰名>，是 wire 契约：上线后改名 = 数据迁移，故一次定死；value 为 JSON 编码标量文本。
// 读路径（settings/settings.ts）按本表装配：缺键补默认、坏值回退默认；加设置项 = 在此注册一个键，服务端零改动。
import type { Settings } from './types'

/** 单个设置项：wire 键 + 默认值 + 校验器（JSON.parse 后判类型/枚举/值域）。 */
export interface SettingSpec {
  /** wire 自然键 <域>.<驼峰名>。 */
  key: string
  /** 缺行或坏值时回退的默认值。 */
  default: unknown
  /** JSON.parse 后的值是否合法；不合法 → 读路径回退默认 + 大声提示。 */
  validate: (v: unknown) => boolean
}

/** 保住定义处的逐键类型检查（default 与 validate 都收敛到 T），对外擦除为松类型 SettingSpec。 */
function spec<T>(key: string, def: T, validate: (v: unknown) => v is T): SettingSpec {
  return { key, default: def, validate }
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** 正文字号值域：UI 首版只给四挡（14/16/20/24），校验按整数 14–28 收口，将来换连续控件免数据迁移。 */
const READING_FONT_SIZE = { min: 14, max: 28 }

export const SETTINGS_REGISTRY: Record<keyof Settings, SettingSpec> = {
  newPerDay: spec<Settings['newPerDay']>('wordbook.newPerDay', 20, isNonNegInt),
  reviewsPerDay: spec<Settings['reviewsPerDay']>('wordbook.reviewsPerDay', 50, isNonNegInt),
  newReviewMix: spec<Settings['newReviewMix']>(
    'wordbook.newReviewMix',
    'mix',
    (v): v is Settings['newReviewMix'] => v === 'mix' || v === 'newFirst' || v === 'reviewFirst',
  ),
  newCardOrder: spec<Settings['newCardOrder']>(
    'wordbook.newCardOrder',
    'random',
    (v): v is Settings['newCardOrder'] => v === 'random' || v === 'joinTime',
  ),
  meaningSource: spec<Settings['meaningSource']>(
    'wordcard.meaningSource',
    'concise',
    (v): v is Settings['meaningSource'] => v === 'concise' || v === 'collins',
  ),
  accent: spec<Settings['accent']>(
    'wordcard.accent',
    'us',
    (v): v is Settings['accent'] => v === 'us' || v === 'uk',
  ),
  autoPlayAudio: spec<Settings['autoPlayAudio']>(
    'wordbook.autoPlayAudio',
    1,
    (v): v is Settings['autoPlayAudio'] => v === 0 || v === 1,
  ),
  readingFontSize: spec<Settings['readingFontSize']>(
    'reading.fontSize',
    16,
    (v): v is Settings['readingFontSize'] =>
      typeof v === 'number' &&
      Number.isInteger(v) &&
      v >= READING_FONT_SIZE.min &&
      v <= READING_FONT_SIZE.max,
  ),
  readingFontFamily: spec<Settings['readingFontFamily']>(
    'reading.fontFamily',
    'serif',
    (v): v is Settings['readingFontFamily'] => v === 'serif' || v === 'sans',
  ),
}

/** 全默认视图（由注册表派生，缺行时的回退整体）。 */
export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
  Object.entries(SETTINGS_REGISTRY).map(([prop, s]) => [prop, s.default]),
) as unknown as Settings
