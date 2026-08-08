// 同步协议的线上 wire 契约（renderer↔server，经 api/sync.ts 收发）。机制与语义见 docs/feature/sync/sync.md。
// 九集合（形态 A′）：words / notes / settings / books / progress / annotations / bookmarks（LWW）
// + reviewLogs / readingEvents（append-only），共享同一号池与单游标。
// 加集合 = 给 SyncChanges 加字段 + 动手改 engine（Anki 式显式编排，非注册表，sync.md §3.5）。
// 时间字段一律 epoch ms；数值精度与 DDL 对齐（wire 为 JSON number）。协议不设自身版本头（sync.md §1）。

/** words 集合行（LWW，自然键 dictId）：三同步字段 + joinTime + FSRS 九字段（sync.md §3.1）。pull 出行 syncVer 有值，push 上行忽略。 */
export interface WordRow {
  syncVer: number
  editTime: number
  isDeleted: 0 | 1
  dictId: number
  /** 加入序基准 epoch ms（随行整覆盖同步；insert/复活时打，评分不动，db/04）。 */
  joinTime: number
  due: number | null
  stability: number
  difficulty: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: 0 | 1 | 2 | 3 | 4 // 4=Mastered 自定义态
  lastReview: number | null
}

/** notes 集合行（LWW，自然键 dictId）。墓碑行 note 可为空串。 */
export interface NoteRow {
  syncVer: number
  editTime: number
  isDeleted: 0 | 1
  dictId: number
  note: string
}

/** settings 集合行（LWW，自然键 settingKey，无墓碑）。value 为 JSON 编码标量文本，服务端不解释。 */
export interface SettingsRow {
  syncVer: number
  editTime: number
  settingKey: string
  value: string
}

/** reviewLogs 集合行（append-only：仅 syncVer，无 editTime 无墓碑）。自然键 (dictId, reviewTime)。 */
export interface ReviewLogRow {
  syncVer: number
  dictId: number
  reviewTime: number
  rating: 1 | 2 | 3
  durationMs: number
  preState: 0 | 1 | 2 | 3
  preStability: number
  preDifficulty: number
}

// ────────────────── 阅读五集合（db/05）：fraction（progress / readingEvents）为 [0,1] 小数，server 侧
// decimal(9,8)；页码不入 wire——它是排版投影，由 cfi 对当前分页表现算（db/05「页码不落库」）──────────────────

/** books 集合行（LWW，自然键 bookHash，有墓碑）。墓碑 = 删书：拉到后删本机 books/<hash>/ 目录与书架条目。 */
export interface BookRow {
  syncVer: number
  editTime: number
  isDeleted: 0 | 1
  /** 书文件部分 MD5（32 位小写 hex），内容寻址身份。 */
  bookHash: string
  title: string
  author: string
  /** epub / pdf / mobi 等，决定本机文件扩展名。 */
  format: string
  /** 加入书架时间 epoch ms（随行整覆盖同步；改书名不刷新，同 joinTime 解耦）。 */
  importedAt: number
}

/** progress 集合行（LWW，自然键 bookHash，**无墓碑**——进度不可删，同 settings）。 */
export interface ProgressRow {
  syncVer: number
  editTime: number
  bookHash: string
  /** 当前阅读位置 CFI。 */
  location: string
  fraction: number
  /** 最后阅读时间 epoch ms：书架「最近阅读」排序键，独立于 editTime。 */
  lastReadAt: number
}

/** annotations 集合行（LWW，自然键 annotationId = 客户端 UUID，有墓碑）。note 非空即笔记。 */
export interface AnnotationRow {
  syncVer: number
  editTime: number
  isDeleted: 0 | 1
  annotationId: string
  bookHash: string
  cfi: string
  text: string
  /** 严格枚举 yellow/green/blue/red（服务端 push 守卫同款校验）。 */
  color: string
  /** 严格枚举 fill/underline/wavy。 */
  style: string
  note: string
  /** 创建时间 epoch ms（随行整覆盖同步；编辑不刷新）。 */
  createdAt: number
}

/** bookmarks 集合行（LWW，自然键 bookmarkId = 客户端 UUID，有墓碑）。 */
export interface BookmarkRow {
  syncVer: number
  editTime: number
  isDeleted: 0 | 1
  bookmarkId: string
  bookHash: string
  cfi: string
  title: string
  createdAt: number
}

/** readingEvents 集合行（append-only：仅 syncVer，无 editTime 无墓碑）。自然键 (bookHash, startTime)。 */
export interface ReadingEventRow {
  syncVer: number
  bookHash: string
  startTime: number
  /** 片段时长毫秒，恒在 [3000, 120000]（服务端守卫同款值域）。 */
  durationMs: number
  fraction: number
}

/**
 * 九集合信封（sync.md §3.1）：命名字段而非通用容器；未来加集合 = 加字段、协议不破坏。
 * pull 出参 changes、push 入参 changes、push 出参 rejected 共用
 *（rejected 只来自七个 LWW 集合，两个 append-only 集合 reviewLogs / readingEvents 恒空/缺）。
 * 各字段可缺省：server 可能省略空集合的 key，消费方一律 `?? []`。
 */
export interface SyncChanges {
  words?: WordRow[]
  notes?: NoteRow[]
  settings?: SettingsRow[]
  reviewLogs?: ReviewLogRow[]
  books?: BookRow[]
  progress?: ProgressRow[]
  annotations?: AnnotationRow[]
  bookmarks?: BookmarkRow[]
  readingEvents?: ReadingEventRow[]
}

export interface SyncPullRequest {
  /** 客户端游标：请求 sync_ver 严格大于该值的行。新库/重灌传 0。 */
  since: number
  /** 单页行数上限；服务端 clamp 到 [1,500]。 */
  limit: number
}

export interface SyncPullResponse {
  changes: SyncChanges
  /** 下一页游标（本页纳入的最大 sync_ver）；客户端据此推进本地 last_sync_ver。空页 = since。 */
  nextSince: number
  /** 是否已到末页（合并候选总数 < limit）；false 则继续循环 pull。 */
  done: boolean
  /** 服务端当前时钟（epoch ms），客户端据此维护时钟偏移。 */
  serverTimeMs: number
}

export interface SyncPushRequest {
  /** 仅含本地脏行，按集合分组；行的 syncVer 恒 0，服务端发号。 */
  changes: SyncChanges
}

export interface SyncPushResponse {
  /** 本批服务端分配到的最大 sync_ver（诊断用）。 */
  maxAssignedVer: number
  /** 被拒（LWW 输/非法）的行，携带服务端当前值供就地收敛（只来自七个 LWW 集合）。 */
  rejected: SyncChanges
  /**
   * 本批因数据非法被服务端跳过入库的行总数（九集合合计，sync.md §3.3）。
   * >0 = 有本地脏行触发服务端形状守卫（NOT NULL/枚举/范围/键值形状）、已跳过不入库；其 dirty 由 compare-and-clear 清掉不再重推。
   * 客户端据此 fail loudly（toast + console.error）。老服务端可能缺省 → 消费方 `?? 0`。
   */
  skippedInvalid?: number
  serverTimeMs: number
}
