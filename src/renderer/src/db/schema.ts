// 每用户本地库的全部表结构（drizzle schema 是 schema 唯一真相）。
// migration 由 `npm run db:generate`（drizzle-kit）从本文件产出到 desktop/drizzle/、main 开库时 migrate 执行；
// 全部读写走 drizzle 查询构建器（经 sqlite-proxy 到 main 执行），无手写 DDL / 手写 SQL。
//
// 本地表**不是**服务端表的镜像（sync.md §2、db/04-user-word.md）：无 user_id 列（库即用户边界）、
// 无 sync_ver 列（唯一版本状态是 meta 单游标 last_sync_ver）、自然键直接做主键、dirty/edit_time/is_deleted
// 只在变更流表上、时间一律 INTEGER epoch ms。本地表间不建外键：库量小、协议只认自然键。
//
// 十二张表 = 框架 meta + 九集合变更流（user_word / user_word_note / user_setting / user_review_log
// + 阅读五表 user_book / user_book_progress / user_book_annotation / user_book_bookmark / user_reading_event，sync.md §2）
// + dict 词典缓存（只读镜像，非同步，cache/dict.md）+ lookup_history 查词历史（仅本机，feature/lookup）。
// 词书目录/词条列表不落库（在线浏览，cache/wordbook.md）。
import { sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** 框架级键值状态表：schema 版本、同步游标 last_sync_ver、服务端时钟偏移、词典水位线等（访问器见 db/meta.ts、dict/dict.ts）。 */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * 全局词库主表（变更流 LWW 集合，sync.md §2 words / db/04 user_word）。
 * 一行 = 词库里的一个词（成员资格 + 全局唯一一份 FSRS 学习状态）；选词加入即显式建行 state=0。
 * dirty 部分索引供 push 攒批只扫脏行；idx_uw_due 支撑复习队列/到期计数；idx_uw_state 支撑新词队列与四段计数。
 */
export const userWord = sqliteTable(
  'user_word',
  {
    dictId: integer('dict_id').primaryKey(),
    // FSRS 九字段（wordbook/scheduler 算好后落库；本表仅是落库通道）。
    due: integer('due'), // 下次复习时间 epoch ms（未学习为 null）
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    scheduledDays: real('scheduled_days').notNull().default(0),
    learningSteps: integer('learning_steps').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: integer('state').notNull().default(0), // 0-New 1-Learning 2-Review 3-Relearning 4-Mastered
    lastReview: integer('last_review'), // 上次复习时间 epoch ms
    // 加入序基准（db/04）：insert / 墓碑复活时打校准时间，评分/标熟永不触碰——从 editTime 解耦出的稳定加入序，
    // 新词队列 / 词表新词·标熟段 / 「全部」段一律按此排。editTime 仅 LWW 仲裁用（评分即被覆盖）。
    joinTime: integer('join_time').notNull().default(0),
    // 变更流三件套：editTime 为 LWW 仲裁时间（本地写即覆盖）。
    editTime: integer('edit_time').notNull().default(0),
    isDeleted: integer('is_deleted').notNull().default(0),
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [
    index('idx_uw_dirty').on(t.dirty).where(sql`dirty = 1`),
    index('idx_uw_due').on(t.due),
    index('idx_uw_state').on(t.state, t.joinTime),
  ],
)

/**
 * 用户笔记（变更流 LWW 集合，sync.md §2 notes / db/04 user_word_note）。
 * 按 dict_id 一份；清空 = 置墓碑（is_deleted=1）传播删除，不做物理 DELETE。墓碑行 note 可为空串。
 */
export const userWordNote = sqliteTable(
  'user_word_note',
  {
    dictId: integer('dict_id').primaryKey(),
    note: text('note').notNull(),
    editTime: integer('edit_time').notNull().default(0),
    isDeleted: integer('is_deleted').notNull().default(0),
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [index('idx_uwn_dirty').on(t.dirty).where(sql`dirty = 1`)],
)

/**
 * 用户设置（变更流 LWW 集合，键级 KV，sync.md §2 settings / db/01 user_setting）。
 * 每键一行 setting_key → value，与 user_word_note 同构（自然键从整数换成字符串）；无墓碑（设置不可删）。
 * value 为 JSON 编码标量文本，与 wire 同形；默认 = 无行（默认值只活在键注册表 settings/defaults.ts）。
 */
export const userSetting = sqliteTable(
  'user_setting',
  {
    settingKey: text('setting_key').primaryKey(), // 自然键直接做主键（库即用户，无 user_id）
    value: text('value').notNull(), // JSON 编码标量
    editTime: integer('edit_time').notNull().default(0),
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [index('idx_us_dirty').on(t.dirty).where(sql`dirty = 1`)],
)

/**
 * 复习日志（变更流 append-only 集合，sync.md §2 reviewLogs / db/04 user_review_log）。
 * 行不可变、永不修改删除；无 edit_time 无墓碑；自然键 (dict_id, review_time) 天然幂等去重。
 * 今日新学/复习/额度扣减全部从此表推导（pre_state=0 判新学）；idx_url_time 支撑今日窗口范围扫描。
 */
export const userReviewLog = sqliteTable(
  'user_review_log',
  {
    dictId: integer('dict_id').notNull(),
    reviewTime: integer('review_time').notNull(), // 评分时间 epoch ms
    rating: integer('rating').notNull(), // 1-again 2-hard 3-good
    durationMs: integer('duration_ms').notNull().default(0),
    preState: integer('pre_state').notNull(), // 复习前 FSRS state 快照
    preStability: real('pre_stability').notNull().default(0),
    preDifficulty: real('pre_difficulty').notNull().default(0),
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.dictId, t.reviewTime] }),
    index('idx_url_dirty').on(t.dirty).where(sql`dirty = 1`),
    index('idx_url_time').on(t.reviewTime),
  ],
)

/**
 * 书架元数据（变更流 LWW 集合 + 墓碑，db/05 user_book）。只有元数据入流，书文件不同步（已拍板不做）：
 * 元数据在、文件不在 = 幽灵书长期态，书架以「文件不在本机」态承接，重导同一文件即转正。
 * bookHash 即内容寻址身份：主键 + 文件目录名 + 跨端身份；路径恒为 <booksDir>/<hash>/book.<format>，封面 <hash>/cover.png。
 * 不存 fileName（同一 hash 在两端的本机文件名可不同，入流即互相覆盖把路径拼错）——导入即定名，路径由 hash + format 完全决定。
 * 文件在不在本机由运行时 stat 判定，不设状态列（状态列必与手删文件/同步中断漂移，文件系统才是真源）。
 * 文件不可变（改书名只动本表不碰文件）；删书 = 置墓碑 + 删本机文件，别端拉到墓碑同样删本机文件，阅读数据不连带。
 */
export const userBook = sqliteTable(
  'user_book',
  {
    bookHash: text('book_hash').primaryKey(), // 书文件部分 MD5（32 位小写 hex）
    title: text('title').notNull(), // 可编辑；导入时取 EPUB 元数据，缺失回退文件名
    author: text('author').notNull().default(''),
    format: text('format').notNull().default('epub'), // 决定 foliate 解析器与本机文件扩展名
    importedAt: integer('imported_at').notNull(), // 加入书架时间 epoch ms（无进度时的兜底排序键）；改书名不刷新
    editTime: integer('edit_time').notNull().default(0),
    isDeleted: integer('is_deleted').notNull().default(0),
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [index('idx_ub_dirty').on(t.dirty).where(sql`dirty = 1`)],
)

/**
 * 阅读进度（变更流 LWW 集合，无墓碑，db/05 user_book_progress）。每书一行；
 * lastReadAt 独立于 editTime（仲裁字段不做业务复用，join_time 解耦先例）。
 */
export const userBookProgress = sqliteTable(
  'user_book_progress',
  {
    bookHash: text('book_hash').primaryKey(),
    location: text('location').notNull(), // 当前位置 CFI
    fraction: real('fraction').notNull().default(0), // 全书比例 0-1
    lastReadAt: integer('last_read_at').notNull(), // 书架「最近阅读」排序键，epoch ms
    editTime: integer('edit_time').notNull().default(0),
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [index('idx_ubp_dirty').on(t.dirty).where(sql`dirty = 1`)],
)

/**
 * 阅读标注（变更流 LWW 集合 + 墓碑，db/05 user_book_annotation）。
 * note 非空即笔记（笔记本 = note != '' 过滤视图）；删除 = 置墓碑传播，读路径过滤 is_deleted=0。
 */
export const userBookAnnotation = sqliteTable(
  'user_book_annotation',
  {
    annotationId: text('annotation_id').primaryKey(), // 客户端 UUID（crypto.randomUUID）
    bookHash: text('book_hash').notNull(),
    cfi: text('cfi').notNull(), // 高亮区间 CFI（排序与「当前位置」判定按它现算）
    text: text('text').notNull(), // 高亮原文片段
    color: text('color').notNull(), // yellow / green / blue / red
    style: text('style').notNull(), // fill / underline / wavy
    note: text('note').notNull().default(''), // markdown；空串=纯高亮
    createdAt: integer('created_at').notNull(), // epoch ms；编辑不刷新
    editTime: integer('edit_time').notNull().default(0),
    isDeleted: integer('is_deleted').notNull().default(0),
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [
    index('idx_uba_book').on(t.bookHash), // 开书加载当前书标注
    index('idx_uba_dirty').on(t.dirty).where(sql`dirty = 1`),
  ],
)

/**
 * 阅读书签（变更流 LWW 集合 + 墓碑，db/05 user_book_bookmark）。与标注拆两表（字段交集仅 cfi + createdAt）。
 */
export const userBookBookmark = sqliteTable(
  'user_book_bookmark',
  {
    bookmarkId: text('bookmark_id').primaryKey(), // 客户端 UUID
    bookHash: text('book_hash').notNull(),
    cfi: text('cfi').notNull(),
    title: text('title').notNull(), // 定位文字（默认取章名，可就地改名）
    createdAt: integer('created_at').notNull(),
    editTime: integer('edit_time').notNull().default(0),
    isDeleted: integer('is_deleted').notNull().default(0),
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [
    index('idx_ubb_book').on(t.bookHash),
    index('idx_ubb_dirty').on(t.dirty).where(sql`dirty = 1`),
  ],
)

/**
 * 阅读事件（变更流 append-only 集合，db/05 user_reading_event）。一行 = 一段连续阅读片段；
 * 行不可变，无 edit_time 无墓碑；聚合（日时长/单书总时长/连续天数）全部 SQL 派生不落库。
 * 采集参数（抄 readest）：空闲 120s 截断、单事件上限 120s、下限 3s。idx_ure_time 支撑时间窗口扫描。
 */
export const userReadingEvent = sqliteTable(
  'user_reading_event',
  {
    bookHash: text('book_hash').notNull(),
    startTime: integer('start_time').notNull(), // 片段开始 epoch ms
    durationMs: integer('duration_ms').notNull(), // [3000, 120000]
    fraction: real('fraction').notNull().default(0), // 片段结束时全书比例
    dirty: integer('dirty').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bookHash, t.startTime] }),
    index('idx_ure_dirty').on(t.dirty).where(sql`dirty = 1`),
    index('idx_ure_time').on(t.startTime),
  ],
)

/**
 * 词典内容缓存（只读镜像，非同步，cache/dict.md §1）。列结构镜像 server dict，raw_json 不下发；
 * 无任何缓存元数据列（去掉旧 LRU 记账两列 —— 只增不删、无 LRU 无 TTL，读路径纯读无写放大）。
 */
export const dict = sqliteTable(
  'dict',
  {
    dictId: integer('dict_id').primaryKey(),
    term: text('term').notNull(), // BINARY collation 码点精确比较，对应 server 0900_bin
    termType: integer('term_type').notNull(),
    ukPhonetic: text('uk_phonetic'),
    usPhonetic: text('us_phonetic'),
    ukAudioUrl: text('uk_audio_url'),
    usAudioUrl: text('us_audio_url'),
    audioUrl: text('audio_url'),
    ec: text('ec'), // 以下为 server 各 JSON 节点，原样存文本
    collins: text('collins'),
    syno: text('syno'),
    relWord: text('rel_word'),
    phrs: text('phrs'),
    individual: text('individual'),
    exampleSentence: text('example_sentence'),
  },
  // 查词按 term 命中（cache/dict.md §2）。
  (t) => [uniqueIndex('idx_dict_term').on(t.term)],
)

/**
 * 查词历史（仅本机：不进同步协议、不上服务端，feature/lookup/lookup.md §4）。
 * term 为权威拼写（dict.term），主键天然同词去重；上限 200 / 裁剪由访问模块（lookup/history.ts）负责。
 * 只存 term 不引用 dict_id：点历史项走读穿，清过词典缓存也能在线回填。
 * explain 为查词命中当时的首条简义快照（供空态列表展示），由页面在记录时传入；清词典缓存不影响它。
 */
export const lookupHistory = sqliteTable('lookup_history', {
  term: text('term').primaryKey(), // 权威拼写，同词天然去重
  lookedUpAt: integer('looked_up_at').notNull(), // epoch ms，排序键
  explain: text('explain').notNull().default(''), // 命中当时首条简义快照（短语/无义为空串）
})

/**
 * 逃生舱清库用：本模块全部本地业务表（不含 meta；游标由引擎单独归零）。本地表间无外键，删除顺序无关。
 * forceReset = 推完脏行 → 清空九张变更流表 + dict 缓存 + 查词历史 → 游标 0 → 全量重拉 →（词库补缺自动重建缓存，sync.md §4）。
 * 注意：lookup_history 只在整库重置时清；「清空词典缓存」（dict/clearDictCache）不触碰它，两者独立（lookup.md §4）。
 * user_book 一并入名单：清空后全量重拉的元数据与本机书文件按 hash 自动重新对上（逃生舱只清库、不动 books/ 目录）。
 * 残留风险：已导入但未 push 成功的书，清库后元数据丢失、文件成孤儿——与其它集合「未 push 的脏行清库即丢」同性质，不开例外。
 */
export const LOCAL_TABLES: readonly SQLiteTable[] = [
  userWord,
  userWordNote,
  userSetting,
  userReviewLog,
  userBook,
  userBookProgress,
  userBookAnnotation,
  userBookBookmark,
  userReadingEvent,
  dict,
  lookupHistory,
]
