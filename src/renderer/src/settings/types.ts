// 用户设置装配后的读出视图：跨域用户偏好（sync.md §2 / docs/db/01-user.md）。本地表是键级 KV（每项一个键），
// 本接口是 getSettings 按键注册表装配后的结果。命名一律 camelCase；键与默认值见 settings/defaults.ts 注册表。
// 现有学习偏好七项 + 阅读两项，后续新增阅读 / TTS 偏好同样走这里（reading.*/tts.* 键，同一集合）。

// ────────────────── 设置（user_setting，键级 KV） ──────────────────

export interface Settings {
  newPerDay: number
  reviewsPerDay: number
  newReviewMix: 'mix' | 'newFirst' | 'reviewFirst'
  newCardOrder: 'random' | 'joinTime'
  meaningSource: 'concise' | 'collins'
  accent: 'us' | 'uk'
  autoPlayAudio: 0 | 1
  /** 正文字号 px（首版 UI 只给四挡，值域 14–28 是为将来换控件留的余量）。 */
  readingFontSize: number
  readingFontFamily: 'serif' | 'sans'
}
