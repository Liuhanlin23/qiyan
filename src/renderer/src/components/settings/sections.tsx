import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Info,
  Library,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
  User,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useTheme } from '@/hooks/useTheme'
import type { ThemePreference } from '@/lib/theme'
import { readAuthEmail, signOut } from '@/session'
import { useSettings } from '@/hooks/useSettings'
import { updateSettings } from '@/settings'
import type { Settings } from '@/settings'
import { getSyncStatus, runRound } from '@/sync'

/**
 * 设置面板的分区内容（对应 iOS 词书 `Route.userSettings` 等全局学习偏好）。
 *
 * 视觉逐像素对齐 claude.ai 设置页（实测真站 DOM）：分区小标题 15px/600、
 * 行标题常规字重、行间极淡分隔线（alpha-1 = 5% 黑）、说明用 text-muted、控件右对齐。
 *
 * 五个分区：通用（外观 / 同步）、账户、单词本（学习计划与学习时的行为）、单词卡（卡面怎么呈现，
 * 单词本 / 查词 / 阅读三处的单词卡共用这一组）、阅读（正文排版）。
 * 学习偏好、单词卡与阅读排版都接 @/settings（乐观更新 + 写穿，同步回合带走）、同步分区接 @/sync 真状态；
 * 账户身份只展示邮箱（取真实登录态；产品无姓名/套餐入口）。
 * 边界：这里是阅读设置的**唯一入口**（阅读器内不再有就地「Aa」浮层）；被动记住的「上次行为」
 * （高亮线型 / 翻译引擎等设备级记忆）不进设置，见 lib/deviceMemory.ts。
 */

/** 未登录/读不到登录态时的邮箱兜底占位（与侧栏底部账户框同源）。 */
const FALLBACK_EMAIL = 'l318483867@outlook.com'

/** 一行设置：左标题+说明，右控件。行标题常规字重（同真站），多行由 `divide-y` 分隔。 */
function SettingRow({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-7 py-3">
      <div className="min-w-0">
        <div className="text-sm text-text-100">{title}</div>
        {desc && <div className="mt-0.5 text-[13px] leading-snug text-text-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** 分区外壳：15px/600 小标题 + 极淡分隔线的行列表（复刻真站 Profile/Preferences 组）。 */
function SectionShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-3 text-[15px] font-semibold leading-5 text-text-100">{title}</h3>
      <div className="divide-y divide-alpha-1">{children}</div>
    </section>
  )
}

/** 分区加载态：设置从本地库读回前的占位（读的是 sqlite，通常一帧即过）。 */
function SectionLoading({ title }: { title: string }): React.JSX.Element {
  return (
    <SectionShell title={title}>
      <p className="py-3 text-sm text-text-muted">加载中…</p>
    </SectionShell>
  )
}

/**
 * 接 @/settings 的分区草稿：读一次走 useSettings（挂载时取一次），改动乐观落草稿 + 写穿
 * （updateSettings 置 dirty，下一同步回合带走；离线可改、上线收敛）。
 * draft 为 null = 尚未读到，调用方渲染 SectionLoading。
 */
function useSettingsDraft(): [Settings | null, (p: Partial<Settings>) => void] {
  const loaded = useSettings()
  const [draft, setDraft] = useState<Settings | null>(null)
  useEffect(() => {
    if (loaded) setDraft(loaded)
  }, [loaded])

  const patch = (p: Partial<Settings>): void => {
    setDraft((d) => (d ? { ...d, ...p } : d))
    void updateSettings(p)
  }
  return [draft, patch]
}

/**
 * 账户：身份（头像 + 邮箱）+ 退出。/profile（我的）已并入此处。
 * 头像是全体用户共用的一张插画（产品无更换头像入口），底色恒定浅色以免深色下黑线糊掉。
 */
function AccountSection(): React.JSX.Element {
  const navigate = useNavigate()
  const email = readAuthEmail() ?? FALLBACK_EMAIL

  const handleSignOut = (): void => {
    // 须等 signOut 清完内存 token 再导航，否则 LoginRoute 守卫读到旧登录态会弹回主页（与 main.tsx 401 处理同一模式）。
    void signOut().finally(() => navigate('/login', { replace: true }))
  }

  return (
    <SectionShell title="账户">
      <div className="flex items-center gap-4 py-4">
        <UserAvatar className="size-12" />
        <div className="min-w-0 flex-1 truncate text-sm text-text-100">{email}</div>
      </div>
      <SettingRow title="退出登录" desc="">
        <Button variant="secondary" size="sm" onClick={handleSignOut}>
          退出登录
        </Button>
      </SettingRow>
    </SectionShell>
  )
}

/** 通用：外观主题 + 同步（同步为账户级偏好，故与外观同置于通用）。 */
function GeneralSection(): React.JSX.Element {
  return (
    <>
      <AppearanceSection />
      <SyncSection />
    </>
  )
}

/** 外观：三态分段控件（跟随系统 / 浅色 / 深色），写穿到全局 <html>。 */
function AppearanceSection(): React.JSX.Element {
  const [theme, setTheme] = useTheme()

  return (
    <SectionShell title="通用">
      <SettingRow title="外观">
        <ToggleGroup
          value={theme}
          onValueChange={(v) => v && setTheme(v as ThemePreference)}
        >
          <ToggleGroupItem value="system" className="aspect-square px-0" aria-label="跟随系统">
            <Monitor className="size-4" strokeWidth={2} />
          </ToggleGroupItem>
          <ToggleGroupItem value="light" className="aspect-square px-0" aria-label="浅色">
            <Sun className="size-4" strokeWidth={2} />
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" className="aspect-square px-0" aria-label="深色">
            <Moon className="size-4" strokeWidth={2} />
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
    </SectionShell>
  )
}

/**
 * 单词本分区，学习偏好五项：四项学习计划 + 学习时是否自动发音；账户级，不绑定具体词书。
 * 卡面怎么呈现（释义来源 / 口音）属「单词卡」分区，不在这里。
 */
function LearningPreferences(): React.JSX.Element {
  const [draft, patch] = useSettingsDraft()
  if (!draft) return <SectionLoading title="学习偏好" />

  return (
    <SectionShell title="学习偏好">
      <SettingRow title="每日新词量" desc="每天新进入学习队列的生词数量。">
        <Select value={String(draft.newPerDay)} onValueChange={(v) => patch({ newPerDay: Number(v) })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {[10, 20, 30, 50, 100].map((v) => (
              <SelectItem key={v} value={String(v)}>
                {v} 个/天
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="每日复习量" desc="每天最多复习的到期单词数量。">
        <Select value={String(draft.reviewsPerDay)} onValueChange={(v) => patch({ reviewsPerDay: Number(v) })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {[50, 100, 150, 200, 300, 400].map((v) => (
              <SelectItem key={v} value={String(v)}>
                {v} 个/天
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="学习顺序" desc="新词与复习在学习队列中的出现方式。">
        <Select value={draft.newReviewMix} onValueChange={(v) => patch({ newReviewMix: v as Settings['newReviewMix'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="mix">穿插出现</SelectItem>
            <SelectItem value="newFirst">先做新词</SelectItem>
            <SelectItem value="reviewFirst">先做复习</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="新词抽取顺序" desc="每天的新词从词库中抽取的方式。">
        <Select value={draft.newCardOrder} onValueChange={(v) => patch({ newCardOrder: v as Settings['newCardOrder'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="random">随机抽取</SelectItem>
            <SelectItem value="joinTime">按加入顺序</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="自动播放发音" desc="学习出示单词时自动朗读读音。">
        <Switch checked={draft.autoPlayAudio === 1} onCheckedChange={(c) => patch({ autoPlayAudio: c ? 1 : 0 })} />
      </SettingRow>
    </SectionShell>
  )
}

/**
 * 单词卡分区：卡面本身怎么呈现，单词本（学习 / 今日 / 词库 / 笔记）、查词页、阅读（精简卡 / 完整词条窗）共用这一组。
 * 卡上就地切换口音或释义来源只影响当前卡，不回写这里。
 */
function WordCardPreferences(): React.JSX.Element {
  const [draft, patch] = useSettingsDraft()
  if (!draft) return <SectionLoading title="单词卡" />

  return (
    <SectionShell title="单词卡">
      <SettingRow title="释义来源" desc="单词卡默认展示的释义类型。">
        <Select value={draft.meaningSource} onValueChange={(v) => patch({ meaningSource: v as Settings['meaningSource'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="concise">中文释义</SelectItem>
            <SelectItem value="collins">中英释义</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="默认发音口音" desc="音标与发音默认使用的口音。">
        <Select value={draft.accent} onValueChange={(v) => patch({ accent: v as Settings['accent'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="us">美式</SelectItem>
            <SelectItem value="uk">英式</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </SectionShell>
  )
}

/** 同步：立即同步（手动触发一回合，sync.md §3.4）+ 状态露出（上次同步 / 最近失败）。 */
function SyncSection(): React.JSX.Element {
  const [status, setStatus] = useState(getSyncStatus)
  const [syncing, setSyncing] = useState(false)

  // 后台回合会改状态，轮询刷新露出（诊断用，读引擎内存单例，无 IPC）。
  useEffect(() => {
    const t = setInterval(() => setStatus(getSyncStatus()), 2000)
    return () => clearInterval(t)
  }, [])

  const runNow = async (): Promise<void> => {
    setSyncing(true)
    try {
      await runRound()
    } finally {
      setSyncing(false)
      setStatus(getSyncStatus())
    }
  }

  return (
    <SectionShell title="同步">
      <SettingRow
        title="立即同步"
        desc={
          status.lastSyncAt
            ? `上次同步：${new Date(status.lastSyncAt).toLocaleString('zh-CN')}`
            : '尚未同步。'
        }
      >
        <Button variant="secondary" size="sm" disabled={syncing || !status.active} onClick={() => void runNow()}>
          {syncing ? '同步中…' : '立即同步'}
        </Button>
      </SettingRow>

      {status.pendingDirty > 0 && (
        <SettingRow title="待上传改动" desc="本地已改、等待下一次同步上传的条数。">
          <span className="text-sm tabular-nums text-text-secondary">{status.pendingDirty} 条</span>
        </SettingRow>
      )}

      {status.lastError && (
        <div className="flex items-start gap-2.5 py-3 text-[13px] leading-relaxed text-text-danger">
          <Info className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          <span>最近一次同步失败：{status.lastError}</span>
        </div>
      )}
    </SectionShell>
  )
}

/**
 * 字号挡位：首版只给这四挡（值落 `reading.fontSize`，存的是数值）。
 * 存量值若落在四挡之外（校验器放行 14–28 的其它整数），UI 归到最近挡位显示、不主动改写存储值。
 */
const FONT_SIZE_STEPS = [
  { value: 14, label: '小' },
  { value: 16, label: '标准' },
  { value: 20, label: '大' },
  { value: 24, label: '特大' },
] as const

/** 把任意合法字号归到最近的挡位（并列时取小挡），只用于显示，不回写。 */
function nearestFontSizeStep(v: number): number {
  return FONT_SIZE_STEPS.reduce((best, s) =>
    Math.abs(s.value - v) < Math.abs(best.value - v) ? s : best,
  ).value
}

/**
 * 阅读：正文排版偏好（接 getSettings/updateSettings，改动即时生效、随账号同步）。
 * 首版只开放字号与字体族，行高 / 行宽 / 页边距等固定为一套默认值（见 docs/feature/reading/settings.md）。
 */
function ReadingSection(): React.JSX.Element {
  // 写穿即时生效：阅读器订阅门面变更，开着弹窗改就能看见正文重排。
  const [draft, patch] = useSettingsDraft()
  if (!draft) return <SectionLoading title="阅读" />

  return (
    <SectionShell title="阅读">
      <SettingRow title="正文字体" desc="阅读时正文使用的字体族。">
        <ToggleGroup
          value={draft.readingFontFamily}
          onValueChange={(v) => v && patch({ readingFontFamily: v as Settings['readingFontFamily'] })}
        >
          <ToggleGroupItem value="serif" className="font-serif">
            衬线
          </ToggleGroupItem>
          <ToggleGroupItem value="sans" className="font-sans">
            无衬线
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <SettingRow title="正文字号" desc="阅读时正文的大小。">
        <ToggleGroup
          value={String(nearestFontSizeStep(draft.readingFontSize))}
          onValueChange={(v) => v && patch({ readingFontSize: Number(v) })}
        >
          {FONT_SIZE_STEPS.map((s) => (
            <ToggleGroupItem key={s.value} value={String(s.value)}>
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>
    </SectionShell>
  )
}

export interface SettingsSection {
  id: string
  label: string
  icon: LucideIcon
  Panel: () => React.JSX.Element
}

/** 分区注册表 —— 左侧导航与右侧内容共用这一份顺序。 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'general', label: '通用', icon: SlidersHorizontal, Panel: GeneralSection },
  { id: 'account', label: '账户', icon: User, Panel: AccountSection },
  { id: 'wordbook', label: '单词本', icon: Library, Panel: LearningPreferences },
  { id: 'wordcard', label: '单词卡', icon: WalletCards, Panel: WordCardPreferences },
  { id: 'reading', label: '阅读', icon: BookOpen, Panel: ReadingSection },
] as const
