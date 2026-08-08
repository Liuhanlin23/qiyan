/**
 * 阅读器的 UI 数据类型 —— 正文排版参数。
 *
 * 正文渲染与目录走真 foliate 引擎、标注 / 书签走本地库，两者都经 `@/reading` 门面拿类型
 *（`AnnotationRecord` / `BookmarkRecord` / `HighlightColor` / `HighlightStyle`），不在此重复建模。
 *
 * 排版参数分两半（docs/feature/reading/settings.md）：
 * **字号 / 字体族**是用户设置，落 `user_setting` 随账号同步，唯一入口是全局设置弹窗的「阅读」分区
 *（读写走 `@/settings` 门面）；**其余项**首版固定为一套默认值，见 `constants.ts` 的 `getFixedTypography`。
 * 书页明暗不在这里——它跟随 App 全局主题（`lib/theme.ts`），阅读器没有独立主题。
 */

// ─────────────────────────── 正文排版 ───────────────────────────

/** 正文字体族：衬线 / 无衬线。 */
export type FontFamily = 'serif' | 'sans'

/** 正文分栏：单栏 / 双栏（宽屏时自动上限 2 栏，对齐 foliate 默认）。 */
export type ColumnMode = 'single' | 'double'

/** 首版固定、不开放配置的排版项（真源 `constants.ts`，值取 CDS `--reading-*` token）。 */
export interface FixedTypography {
  /** 行高倍数。 */
  lineHeight: number
  /** 正文最大行宽 px（映射 foliate max-inline-size）。 */
  maxWidth: number
  /** 段落是否两端对齐。 */
  justify: boolean
  /** 段间距 px。 */
  paragraphSpacing: number
  /** 书页四周页边距 px（映射 foliate margin-*）。 */
  marginPx: number
  /** 英文行尾自动断词（hyphenation）。 */
  hyphenate: boolean
  /** 单栏 / 双栏（映射 foliate max-column-count）。 */
  columns: ColumnMode
}

/** 喂给引擎的整套正文排版：用户可调的两项 + 首版固定的其余项。 */
export interface ReaderAppearance extends FixedTypography {
  family: FontFamily
  /** 正文字号 px。 */
  fontSize: number
}
