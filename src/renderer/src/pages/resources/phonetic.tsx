import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui'

/**
 * 音标内容：顶部「元音 / 辅音」+「英音 / 美音」分段，下面按分类白卡网格铺音素。
 * 每张卡两个播放入口：上半播音标单音、下半播例词整词，同一时刻只响一个。
 * 音素表与音频来自 public/phonetic/<accent>/：英音 44 音素、美音 39 音素，两套标注体系原样呈现。
 * 两套音频出处不同，底部按当前音标体系署名对应站点（外链交系统浏览器，见 main/window.ts）。
 */

type Accent = 'uk' | 'us'

/** public 下的音源目录名，与 index.json 的 accent 字段一致。 */
const ACCENT_DIR: Record<Accent, string> = { uk: 'british', us: 'american' }

interface Phoneme {
  index: number
  group: string
  ipa: string
  word: string
  soundAudio: string
  wordAudio: string
}

interface PhoneticIndex {
  total: number
  /** 音频出处站点，署名用（英美两套各有其源）。 */
  source: string
  groups: { id: string; label: string }[]
  items: Phoneme[]
}

/** 元音由哪些分组构成：决定「元音 / 辅音」分段各显示哪几组。 */
const VOWEL_GROUPS = new Set(['monophthong', 'diphthong'])

export function PhoneticsContent(): React.JSX.Element {
  const [group, setGroup] = useState<'vowel' | 'consonant'>('vowel')
  const [accent, setAccent] = useState<Accent>('uk')
  const [data, setData] = useState<PhoneticIndex | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 必须是相对路径：prod 的 renderer 从 file:// 加载（main/window.ts），前导 `/` 会解析到
  // 盘符根（file:///D:/phonetic/…）而非应用资源目录，fetch 直接 reject「Failed to fetch」。
  // dev 的 http://localhost 与 prod 的 file:// 下 HashRouter 都只动 hash 不动 path，相对解析两端皆准。
  const base = `./phonetic/${ACCENT_DIR[accent]}`

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    fetch(`${base}/index.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PhoneticIndex) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [base])

  const groups = data?.groups.filter((g) => VOWEL_GROUPS.has(g.id) === (group === 'vowel')) ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup value={group} onValueChange={(v) => v && setGroup(v as typeof group)}>
          <ToggleGroupItem value="vowel">元音</ToggleGroupItem>
          <ToggleGroupItem value="consonant">辅音</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup value={accent} onValueChange={(v) => v && setAccent(v as Accent)}>
          <ToggleGroupItem value="uk">英音</ToggleGroupItem>
          <ToggleGroupItem value="us">美音</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {error ? (
        <p className="py-8 text-center text-sm text-text-muted">音标数据加载失败（{error}）</p>
      ) : !data ? (
        <PhonemeGridSkeleton />
      ) : (
        groups.map((g) => (
          <section key={g.id} className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold text-text-muted">{g.label}</h3>
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,112px),112px))]">
              {data.items
                .filter((p) => p.group === g.id)
                .map((p) => (
                  <PhonemeTile key={p.index} phoneme={p} base={base} />
                ))}
            </div>
          </section>
        ))
      )}

      {data && (
        <p className="text-xs text-text-muted">
          资源来源：
          <a
            href={data.source}
            target="_blank"
            rel="noreferrer"
            className="rounded-md text-text-accent transition hover:underline can-focus"
          >
            {data.source}
          </a>
        </p>
      )}
    </div>
  )
}

/** 加载态：铺一屏与真实卡片等高的脉冲占位。 */
function PhonemeGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,112px),112px))]">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-card bg-bg-300" />
      ))}
    </div>
  )
}

/**
 * 单个音素方卡：音标符号与例词上下居中，各自独立可点并单独播放。
 * 悬停放大符号提示可点，播放中转橙高亮；播放失败静默复位（音频缺失不应打断浏览）。
 */
function PhonemeTile({ phoneme, base }: { phoneme: Phoneme; base: string }): React.JSX.Element {
  const [playing, setPlaying] = useState<'sound' | 'word' | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => () => audioRef.current?.pause(), [])

  const play = useCallback(
    (kind: 'sound' | 'word', file: string) => {
      audioRef.current?.pause()
      const audio = new Audio(`${base}/${file}`)
      audioRef.current = audio
      setPlaying(kind)
      const reset = (): void => setPlaying((p) => (p === kind ? null : p))
      audio.onended = reset
      audio.onerror = reset
      void audio.play().catch(reset)
    },
    [base]
  )

  return (
    <div className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-card bg-surface-1 shadow-card-ring">
      <button
        type="button"
        aria-label={`播放音标 ${phoneme.ipa}`}
        onClick={() => play('sound', phoneme.soundAudio)}
        className={cn(
          'cursor-pointer rounded-lg px-3 text-4xl font-semibold leading-none transition hover:scale-110 can-focus',
          playing === 'sound' ? 'text-text-accent' : 'text-text-primary hover:text-text-accent'
        )}
      >
        {phoneme.ipa}
      </button>
      <button
        type="button"
        aria-label={`播放例词 ${phoneme.word}`}
        onClick={() => play('word', phoneme.wordAudio)}
        className={cn(
          'cursor-pointer rounded-md px-2 py-0.5 text-base transition can-focus',
          playing === 'word' ? 'text-text-accent' : 'text-text-primary hover:text-text-accent'
        )}
      >
        {phoneme.word}
      </button>
    </div>
  )
}
