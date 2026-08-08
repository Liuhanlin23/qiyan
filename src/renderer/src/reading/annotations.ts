// 标注数据原语（user_book_annotation 变更流 LWW 集合 + 墓碑，db/05）。
// 纯函数：db 与校准时间由门面传入（directory-convention §三「域模块内部纪律」）。
// 删除一律置墓碑传播；读路径滤 is_deleted=0；createdAt 只在 insert 时打，编辑一律不刷新。
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { userBookAnnotation } from '@/db/schema'
import type { AnnotationRecord } from './types'

const COLUMNS = {
  id: userBookAnnotation.annotationId,
  bookHash: userBookAnnotation.bookHash,
  cfi: userBookAnnotation.cfi,
  text: userBookAnnotation.text,
  color: userBookAnnotation.color,
  style: userBookAnnotation.style,
  note: userBookAnnotation.note,
  createdAt: userBookAnnotation.createdAt,
}

/** 一本书的全部标注（滤墓碑），按创建序。分组/排序由页面按 cfi 现算，这里只给稳定序。 */
export async function listAnnotations(db: Db, bookHash: string): Promise<AnnotationRecord[]> {
  const rows = await db
    .select(COLUMNS)
    .from(userBookAnnotation)
    .where(and(eq(userBookAnnotation.bookHash, bookHash), eq(userBookAnnotation.isDeleted, 0)))
    .orderBy(asc(userBookAnnotation.createdAt))
    .all()
  // color/style 在库里是 text 列，写入侧只接受枚举（AnnotationInput），读回来直接收窄。
  return rows as AnnotationRecord[]
}

/** 可改的字段：改色 / 改线型 / 编辑笔记，以及拖把手改范围（cfi + text 一起变）。 */
export type AnnotationPatch = Partial<
  Pick<AnnotationRecord, 'cfi' | 'text' | 'color' | 'style' | 'note'>
>

/**
 * 落一条标注。整条记录（含 id 与 createdAt）由调用方给全——页面要先把它挂上屏再落库，
 * 故 id/createdAt 在门面就已盖好（见 reading/index.ts 的 newAnnotation）；这里只补同步三件套。
 */
export async function addAnnotation(db: Db, a: AnnotationRecord, editTime: number): Promise<void> {
  await db
    .insert(userBookAnnotation)
    .values({ ...a, annotationId: a.id, editTime, isDeleted: 0, dirty: 1 })
    .run()
}

/**
 * 改一条标注：刷 editTime + dirty，**不动 createdAt**（列表显示的是创建日期，编辑笔记不该把它顶新）。
 * where 带 isDeleted=0：已删的行不因迟到的编辑复活。
 */
export async function updateAnnotation(
  db: Db,
  id: string,
  patch: AnnotationPatch,
  now: number,
): Promise<void> {
  await db
    .update(userBookAnnotation)
    .set({ ...patch, editTime: now, dirty: 1 })
    .where(and(eq(userBookAnnotation.annotationId, id), eq(userBookAnnotation.isDeleted, 0)))
    .run()
}

/** 删一条标注：置墓碑传播（同 books.removeBook 的幂等护栏，重复删不再推高 editTime）。 */
export async function removeAnnotation(db: Db, id: string, now: number): Promise<void> {
  await db
    .update(userBookAnnotation)
    .set({ isDeleted: 1, editTime: now, dirty: 1 })
    .where(and(eq(userBookAnnotation.annotationId, id), eq(userBookAnnotation.isDeleted, 0)))
    .run()
}
