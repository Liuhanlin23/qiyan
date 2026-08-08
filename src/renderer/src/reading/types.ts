// 阅读域对外类型（type-only 引用可越层直取本文件，directory-convention §三）。
// 引擎相关类型仍住 engine/foliateEngine.ts，由门面 re-export；这里只放数据侧领域类型。

/**
 * 书架一本书（user_book 行，db/05）。isDeleted 一并给出：导入流程要三分「无行 / 活行 / 墓碑行」——
 * 无行才是真新书，墓碑行走复活，活行提示「已在书架」。
 * 不含文件路径：路径由 bookHash + format 完全决定（`<userData>/books/<hash>/book.<format>`），
 * 文件在不在本机由 booksBridge.stat 运行时判定，不落列。
 */
export interface BookRecord {
  bookHash: string
  title: string
  author: string
  format: string
  /** 加入书架时间（校准 epoch ms）：无进度时的兜底排序键；改书名不刷新。 */
  importedAt: number
  isDeleted: number
  /** 全书阅读比例 0–1；null=没读过（无进度行）。 */
  fraction: number | null
  /** 最后阅读时间（校准 epoch ms）；null=没读过。书架排序优先用它，缺则退 importedAt。 */
  lastReadAt: number | null
}

/**
 * 书架一行的展示形态 = 库里的元数据 + 「书文件在不在本机」的**运行时判定**（不设状态列，
 * 文件系统才是真源）。元数据入变更流而书文件不入（已拍板不做文件同步），故长期存在：
 * 别端导入的书只同步来元数据、文件要在本机重新导入 —— 即 `hasFile === false` 的**幽灵书**。
 */
export interface ShelfBook extends BookRecord {
  /** false = 幽灵书（文件不在本机：别端导入未在本机重导，或被用户手删）：不可进阅读器。 */
  hasFile: boolean
  /**
   * 封面图 URL（自定义协议，直接喂 `<img src>`）；null = 本机没有封面文件，走文字书封。
   * 同 hasFile 是运行时 stat 出来的，不落列——EPUB 本就可能没封面，幽灵书更是连文件都没有。
   */
  coverUrl: string | null
}

/** 荧光笔预设色（严格枚举，不学 readest 的「枚举 | 任意 hex」弱类型）。 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red'

/** 高亮线型：整段填充 / 下划线 / 波浪线。 */
export type HighlightStyle = 'fill' | 'underline' | 'wavy'

/**
 * 一条标注（user_book_annotation 行，db/05）：高亮的原文片段 + 色/线型，可选附一段 markdown 笔记。
 * **笔记不是独立模型**——`note` 非空即算一条笔记，笔记本面板就是 `note != ''` 的过滤视图。
 * 无 `chapterLabel`：按章分组的标签由 `cfi` → 当前 TOC 现算。
 * 无页码：页码是排版投影，列表里那句「p N」由 `cfi` 对当前分页表现算（db/05「页码不落库」）。
 */
export interface AnnotationRecord {
  /** 客户端 UUID（列名 annotation_id）；标注/书签在页面层共用 `.id` 这一形状，故此处不带表名前缀。 */
  id: string
  bookHash: string
  /** 高亮区间 CFI：跳回原文的依据，引擎 overlay 的 key，也是排序 /「当前位置」判定的唯一依据。 */
  cfi: string
  text: string
  color: HighlightColor
  style: HighlightStyle
  /** markdown；空串=纯高亮。 */
  note: string
  /** 创建时间（校准 epoch ms）；**编辑不刷新**。 */
  createdAt: number
}

/** 一条书签（user_book_bookmark 行，db/05）：定位 + 可改名的定位文字标题。 */
export interface BookmarkRecord {
  id: string
  bookHash: string
  cfi: string
  /** 定位文字（默认取章名，可就地改名）。 */
  title: string
  createdAt: number
}

/**
 * 一段连续阅读片段（user_reading_event 行，db/05）：append-only，行不可变、无 edit_time 无墓碑。
 * 自然键 `(bookHash, startTime)`；日时长 / 单书总时长 / 连续天数等聚合全部 SQL 派生，不落库。
 */
export interface ReadingEventRecord {
  bookHash: string
  /** 片段开始时间（校准 epoch ms，秒级精度——计时内核按秒计）。 */
  startTime: number
  /** 片段时长毫秒，恒在 [3000, 120000]（采集参数钳制）。 */
  durationMs: number
  /** 片段结束时的全书比例 0–1（「进度随时间」类统计的原料）。 */
  fraction: number
}

/** 阅读进度（user_book_progress 行，db/05）：每书一行，无墓碑。 */
export interface ProgressRecord {
  bookHash: string
  /** 当前阅读位置 CFI。 */
  location: string
  fraction: number
  lastReadAt: number
}
