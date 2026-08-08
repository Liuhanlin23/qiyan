// 用户笔记（user_word_note 变更流 LWW 集合，db/04）。从纯缓存表升级为入流：本地写 + dirty + push。
// 清空 = 置墓碑（is_deleted=1）传播删除，不做物理 DELETE（否则删除传播不到别端）。editTime 由门面传入。
import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { dict, userWordNote } from '@/db/schema'
import type { LocalNote, NoteDetail } from './types'

/** 读某词笔记（墓碑行视同无笔记返回 null）。 */
export async function getNote(db: Db, dictId: number): Promise<string | null> {
  const row = await db
    .select({ note: userWordNote.note })
    .from(userWordNote)
    .where(and(eq(userWordNote.dictId, dictId), eq(userWordNote.isDeleted, 0)))
    .get()
  return row ? row.note : null
}

/** 全部未删笔记（按 dictId）。 */
export async function listNotes(db: Db): Promise<LocalNote[]> {
  return db
    .select({ dictId: userWordNote.dictId, note: userWordNote.note })
    .from(userWordNote)
    .where(eq(userWordNote.isDeleted, 0))
    .orderBy(userWordNote.dictId)
    .all()
}

/**
 * 富笔记列表（我的笔记页）：每条笔记 + 冗余 dict 内容（term / 音标 / 发音 URL / ec 供解析首条简义）+ edit_time（相对时间）。
 * LEFT JOIN dict（缺行 term/ec 为 null，页面占位）；按 edit_time 倒序（最近在前，页面另可再排）。
 */
export async function listNotesDetailed(db: Db): Promise<NoteDetail[]> {
  return db
    .select({
      dictId: userWordNote.dictId,
      note: userWordNote.note,
      editTime: userWordNote.editTime,
      term: dict.term,
      usPhonetic: dict.usPhonetic,
      ukPhonetic: dict.ukPhonetic,
      ukAudioUrl: dict.ukAudioUrl,
      usAudioUrl: dict.usAudioUrl,
      audioUrl: dict.audioUrl,
      ec: dict.ec,
    })
    .from(userWordNote)
    .leftJoin(dict, eq(dict.dictId, userWordNote.dictId))
    .where(eq(userWordNote.isDeleted, 0))
    .orderBy(desc(userWordNote.editTime))
    .all()
}

/** 写/改笔记：upsert + dirty=1 + 打 editTime（复活可能存在的墓碑行 → isDeleted=0）。 */
export async function setNote(db: Db, dictId: number, note: string, editTime: number): Promise<void> {
  const values = { dictId, note, editTime, isDeleted: 0, dirty: 1 }
  await db
    .insert(userWordNote)
    .values(values)
    .onConflictDoUpdate({
      target: userWordNote.dictId,
      set: { note, editTime, isDeleted: 0, dirty: 1 },
    })
    .run()
}

/**
 * 清空笔记 = 置墓碑（note 空串 + is_deleted=1 + dirty=1 + editTime）。无本地行则无操作（无可删除的笔记）。
 * where 带 isDeleted=0 幂等护栏（对照 removeWords）：对已墓碑行重复清空不再置 dirty / 推高 editTime，
 * 否则 useWordNote 对空输入每击键调一次 clearNote，会反复推高 editTime、LWW 下可能压过别端并发写。
 */
export async function clearNote(db: Db, dictId: number, editTime: number): Promise<void> {
  await db
    .update(userWordNote)
    .set({ note: '', isDeleted: 1, editTime, dirty: 1 })
    .where(and(eq(userWordNote.dictId, dictId), eq(userWordNote.isDeleted, 0)))
    .run()
}
