/**
 * 当前这本书的标注 / 书签 store —— 阅读器一簇「标注列表 / 笔记本 / 书签」共享的那份数据。
 *
 * **真源是 sqlite**（`@/reading` 门面的 user_book_annotation / user_book_bookmark），本模块是当前书的
 * 内存镜像 + 订阅通道：开书 `loadBookData(bookHash)` 拉当书数据，关书 `clearBookData()` 清空——阅读器一次
 * 只开一本书，故 store 不按 bookHash 分片，只记「现在装的是哪本」用于丢弃过期加载。
 *
 * 写入是**先改镜像再落库**：笔记编辑器每敲一个字就写一次，等一趟 IPC 回来再上屏会卡手。
 * 落库按提交顺序串行（`chain`），故「新建 → 紧接着改色」不会因为并发而把 update 跑到 insert 前面。
 * 落库失败一律出声：报 toast + 从库重新拉一次，把镜像拽回与库一致。
 *
 * 同步读（`getAnnotation` / `findAnnotationByCfi`）供事件回调取最新值；响应式读经 `useSyncExternalStore`。
 */
import { useSyncExternalStore } from 'react'
import { toast } from '@/lib/toast'
import * as reading from '@/reading'
import type { AnnotationRecord, BookmarkRecord } from '@/reading'

let bookHash = ''
let annotations: AnnotationRecord[] = []
let bookmarks: BookmarkRecord[] = []

const listeners = new Set<() => void>()
function emit(): void {
  for (const l of listeners) l()
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

// ── 开书 / 关书 ──────────────────────────────────────────────────────────────
/** 从库读一遍并整体替换镜像。换书或卸载后到达的结果会被丢弃。**调用方负责串行化**（见下）。 */
async function readIntoMirror(hash: string): Promise<void> {
  const [a, b] = await Promise.all([reading.listAnnotations(hash), reading.listBookmarks(hash)])
  if (bookHash !== hash) return
  annotations = a
  bookmarks = b
  emit()
}

/**
 * 装载某本书的标注与书签（开书时调一次）。
 *
 * 排进落库队列（与写共用一条 `chain`）而不是直接读：写是「先改镜像、再经 chain 落库」，加载与写并发时
 * 快照可能读在那条写落库之前，整体替换镜像就把刚划的高亮从列表里吞了（记录其实已存，下次开书才回来）。
 */
export function loadBookData(hash: string): Promise<void> {
  bookHash = hash
  const task = chain.then(() => readIntoMirror(hash))
  // 队列不因这次加载失败而断（失败交给调用方：开书路径已有 toast + 放行）。
  chain = task.catch(() => {})
  return task
}

/** 关书：清空镜像（下一本书的加载从零开始，不会闪现上一本的标注）。 */
export function clearBookData(): void {
  bookHash = ''
  annotations = []
  bookmarks = []
  emit()
}

// ── 落库队列 ────────────────────────────────────────────────────────────────
let chain: Promise<unknown> = Promise.resolve()

/** 串行提交一次写；失败即出声并从库重拉，把镜像与库拽回一致。 */
function persist(op: () => Promise<void>, what: string): void {
  chain = chain
    .then(op)
    .catch(async (e) => {
      console.error(`[reading] ${what}失败：`, e)
      toast.error(`${what}失败，已恢复到上次保存的状态`)
      // 直接读、不走 loadBookData：此刻正跑在 chain 上，再排队等的就是自己（死锁）。
      const hash = bookHash
      if (hash) await readIntoMirror(hash)
    })
}

// ── 响应式读（面板订阅）──────────────────────────────────────────────────────
export function useAnnotations(): AnnotationRecord[] {
  return useSyncExternalStore(subscribe, () => annotations)
}
export function useBookmarks(): BookmarkRecord[] {
  return useSyncExternalStore(subscribe, () => bookmarks)
}

// ── 同步读（事件回调取最新值）────────────────────────────────────────────────
export function getAnnotation(id: string): AnnotationRecord | undefined {
  return annotations.find((a) => a.id === id)
}
export function findAnnotationByCfi(cfi: string): AnnotationRecord | undefined {
  return annotations.find((a) => a.cfi === cfi)
}
// ── 写入（每次替换数组引用以满足 useSyncExternalStore 的快照稳定性）────────────

/** 新落一条标注（id 与 createdAt 由域门面盖）。返回落成的记录，调用方据它画高亮。 */
export function createAnnotation(
  input: Omit<AnnotationRecord, 'id' | 'bookHash' | 'createdAt'>,
): AnnotationRecord {
  const rec = reading.newAnnotation({ ...input, bookHash })
  annotations = [...annotations, rec]
  emit()
  persist(() => reading.addAnnotation(rec), '保存标注')
  return rec
}

export function updateAnnotation(id: string, patch: reading.AnnotationPatch): void {
  annotations = annotations.map((a) => (a.id === id ? { ...a, ...patch } : a))
  emit()
  persist(() => reading.updateAnnotation(id, patch), '保存标注')
}

export function removeAnnotation(id: string): void {
  annotations = annotations.filter((a) => a.id !== id)
  emit()
  persist(() => reading.removeAnnotation(id), '删除标注')
}

/** 新加一条书签。返回落成的记录。 */
export function createBookmark(
  input: Omit<BookmarkRecord, 'id' | 'bookHash' | 'createdAt'>,
): BookmarkRecord {
  const rec = reading.newBookmark({ ...input, bookHash })
  bookmarks = [...bookmarks, rec]
  emit()
  persist(() => reading.addBookmark(rec), '保存书签')
  return rec
}

export function renameBookmark(id: string, title: string): void {
  bookmarks = bookmarks.map((b) => (b.id === id ? { ...b, title } : b))
  emit()
  persist(() => reading.renameBookmark(id, title), '书签改名')
}

export function removeBookmark(id: string): void {
  bookmarks = bookmarks.filter((b) => b.id !== id)
  emit()
  persist(() => reading.removeBookmark(id), '删除书签')
}
