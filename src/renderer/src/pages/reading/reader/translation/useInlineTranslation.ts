import { useEffect, useRef } from 'react'
import { translateBridge } from '@/platform'
import type { FoliateEngine } from '@/reading'
import type { TranslationProvider } from './providerMemory'
import { collectTextBlocks, lookAheadRange, TRANSLATION_CLASS } from './textBlocks'

/**
 * 对照翻译 —— 开启后把书页**当前可见段落**逐段译成中文、追加在原文下方（始终双语，绝不替换
 * 原文；学习场景要中英对照，故不搬 readest 那套隐藏/还原原文的机制）。
 *
 * 懒翻译（仿 readest useTextTranslation）：每章 iframe 各建一个 IntersectionObserver（在该 iframe 的
 * realm 里建，root 即其视口——分页模式下 off-page 列被 overflow:hidden 裁掉，天然不算可见），只翻可见
 * 段落 + 前后文预取；翻页由 IO 续、进新章由 `onLoad` 续、当前已渲染的章由 `contentDocuments` 开局铺一遍。
 * 译文经 main 转发的 `translateBridge` 取（英→中写死，绕 CORS），并发钳到 5、按「服务商+文本」缓存
 *（翻页回看 / 重进章不重复请求）。关闭即移除所有译文节点与标记。
 *
 * 失败即停（translation.md §对照翻译）：任一段翻译失败 → 终止本轮后续调度并上抛 `onFail`，**不自动重试**。
 * 宿主收到即关开关（按钮不再亮着骗人）+ 提示；关开关等于走正常 teardown，译文节点随之清掉。
 * 重试交给用户：重开开关或切引擎，二者都让 effect 重跑，缓存仍在故已译段落不重复请求。
 *
 * 仅对可重排 EPUB 有意义——固定版式（PDF）无正文流，调用方以 `!engine.isFixedLayout` 决定是否传 `enabled`。
 */

/** 同时在途的翻译请求上限：Google/Azure 是灰色免费接口，不宜高并发，够铺满一屏即可。 */
const MAX_CONCURRENT = 5

/** 源段落「已处理」标记：防重复调度、翻页回看不再翻（失败的段落也保留，不自动重试）；关闭时连同译文节点一起清掉。 */
const SOURCE_MARK = 'data-qy-translated'

/** 一章 iframe 的翻译态：文档 + 有序正文块 + 观察器 + 当前可见块集合。 */
interface DocState {
  doc: Document
  blocks: HTMLElement[]
  observer: IntersectionObserver
  visible: Set<HTMLElement>
}

/** 造一枚追加在源段落末尾的中文译文块（`<font>` 不带段落语义，避免叠上 `<p>` 的外边距）。 */
function createTargetNode(doc: Document, text: string): HTMLElement {
  const font = doc.createElement('font')
  font.className = TRANSLATION_CLASS
  font.setAttribute('lang', 'zh-CN') // 提示浏览器用 CJK 字体渲染译文
  font.style.display = 'block'
  font.style.marginTop = '0.15em'
  font.style.opacity = '0.75' // 与原文拉开层次，不喧宾夺主
  font.textContent = text
  return font
}

/**
 * @param provider 翻译引擎（设备级记忆，由阅读器持有 —— 划词翻译框里切一次，这里的后续段落即改用新家；
 *   已翻好的段落不重翻，缓存按「引擎+文本」分键，切回去也不必再请求一遍）。
 * @param onFail 本轮翻译失败（一轮只回调一次）：宿主据此关开关并提示。
 */
export function useInlineTranslation(
  engine: FoliateEngine | null,
  enabled: boolean,
  provider: TranslationProvider,
  onFail: () => void,
): void {
  // enabled / provider 用 ref 取最新值：在途的异步翻译要读「此刻是否仍开着」，不能靠闭包里的旧值。
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const providerRef = useRef(provider)
  providerRef.current = provider
  // 回调同样走 ref：宿主没用 useCallback 包也不该让整轮翻译重来。
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail

  // 跨 effect 存活的翻译状态（缓存 / 队列 / 在途数 / 各章 doc 态）——开关反复切也不丢缓存。
  const cacheRef = useRef(new Map<string, string>())
  const queueRef = useRef<HTMLElement[]>([])
  const activeRef = useRef(0)
  const docsRef = useRef(new Map<Document, DocState>())

  useEffect(() => {
    if (!engine || !enabled) return

    const cache = cacheRef.current
    const queue = queueRef.current
    const docs = docsRef.current
    // 失败即停闸门：本轮（一次 effect 生命周期）内首次失败置位，之后不再调度新段落、不再回调。
    // 上抛 onFail 会关开关进而触发 teardown，但那要等一次 React 更新；闸门是同步的，先止住并发在途的其余请求。
    let halted = false

    const translateOne = async (el: HTMLElement): Promise<void> => {
      const text = el.textContent?.replace(/\s+/g, ' ').trim()
      if (!text) return
      el.setAttribute(SOURCE_MARK, '1') // 同步先占位：同一 tick 内不会被再次调度
      const key = `${providerRef.current}::${text}`
      try {
        let translated = cache.get(key)
        if (translated == null) {
          translated = await translateBridge.sentence({ text, provider: providerRef.current })
          cache.set(key, translated)
        }
        if (!enabledRef.current) return // 在途时被关掉：teardown 已清节点，别再补
        if (!translated || translated === text) return // 空 / 与原文相同（纯数字、已是中文）：无需追加
        if (el.querySelector(`.${TRANSLATION_CLASS}`)) return
        el.appendChild(createTargetNode(el.ownerDocument, translated))
      } catch (e) {
        console.warn('[reading] 段落翻译失败：', e)
        if (halted || !enabledRef.current) return // 已报过错 / 已被关掉：不再打扰
        halted = true
        queue.length = 0
        onFailRef.current()
      }
    }

    const drain = (): void => {
      while (activeRef.current < MAX_CONCURRENT && queue.length > 0) {
        const el = queue.shift()!
        if (el.getAttribute(SOURCE_MARK) || !enabledRef.current) continue
        activeRef.current++
        void translateOne(el).finally(() => {
          activeRef.current--
          drain()
        })
      }
    }

    const schedule = (el: HTMLElement | undefined): void => {
      if (!el || halted || !enabledRef.current) return
      if (el.classList.contains(TRANSLATION_CLASS) || el.getAttribute(SOURCE_MARK)) return
      if (queue.includes(el)) return
      queue.push(el)
      drain()
    }

    const scheduleVisible = (doc: Document): void => {
      const st = docs.get(doc)
      if (!st) return
      let first = st.blocks.length
      let last = -1
      for (const el of st.visible) {
        const i = st.blocks.indexOf(el)
        if (i < 0) continue
        if (i < first) first = i
        if (i > last) last = i
      }
      const range = lookAheadRange(st.blocks.length, first, last)
      if (!range) return
      for (let i = range.start; i <= range.end; i++) schedule(st.blocks[i])
    }

    // 清掉已被 foliate 卸载的章（iframe 没了→defaultView 为 null）：断观察、去登记，残留节点随 iframe 一同消失。
    const pruneDeadDocs = (): void => {
      for (const [doc, st] of docs) {
        if (!doc.defaultView) {
          st.observer.disconnect()
          docs.delete(doc)
        }
      }
    }

    const setupDoc = (doc: Document): void => {
      pruneDeadDocs()
      if (docs.has(doc) || !doc.body) return
      const IO = doc.defaultView?.IntersectionObserver
      if (!IO) return
      const blocks = collectTextBlocks(doc.body)
      if (blocks.length === 0) return
      const visible = new Set<HTMLElement>()
      const observer = new IO(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target as HTMLElement)
            else visible.delete(entry.target as HTMLElement)
          }
          scheduleVisible(doc)
        },
        { threshold: 0 },
      )
      blocks.forEach((b) => observer.observe(b))
      docs.set(doc, { doc, blocks, observer, visible })
    }

    // 开启当下：已渲染的章先铺一遍；之后进新章由 onLoad 续。
    engine.contentDocuments().forEach(setupDoc)
    const offLoad = engine.onLoad((d) => setupDoc(d.doc))
    // 兜底：极少数翻页若没触发 IO，relocate 后再按 IO 维护的可见集补一次调度（下一帧等 IO 先更新可见集）。
    const offRelocate = engine.onRelocate(() => {
      requestAnimationFrame(() => docs.forEach((_, doc) => scheduleVisible(doc)))
    })

    return () => {
      offLoad()
      offRelocate()
      for (const st of docs.values()) {
        st.observer.disconnect()
        st.doc.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((n) => n.remove())
        st.doc.querySelectorAll(`[${SOURCE_MARK}]`).forEach((n) => n.removeAttribute(SOURCE_MARK))
      }
      docs.clear()
      queue.length = 0
      activeRef.current = 0
    }
  }, [engine, enabled, provider])
}
