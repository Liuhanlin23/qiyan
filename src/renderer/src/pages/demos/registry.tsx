import {
  Brain,
  CirclePlay,
  FileText,
  GraduationCap,
  History,
  Layers,
  ListPlus,
  LogIn,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import TodayLearn from '@/pages/word-book/today'
import { ExampleDemo } from './examples/ExampleDemo'
import { PastPaperReaderDemo } from './examples/PastPaperReaderDemo'
import { TtsBarPlayerDemo } from './examples/tts/TtsBarPlayerDemo'
import { LoginDemo } from './LoginDemo'
import { WordbookHomeMemoryDemo } from './WordbookHomeMemoryDemo'
import { WordbookHomeMemorySoloDemo } from './WordbookHomeMemorySoloDemo'
import { WordbookPickWordsDemo } from './WordbookPickWordsDemo'
import { WordStudyDemo } from './WordStudyDemo'

/**
 * UI Demo 展厅注册表 —— 所有候选页面 demo 的单一清单。
 *
 * 加一个 demo:写好页面组件,在 DEMOS 里追加一项即可,列表页 / 详情页自动收录。
 * 仅 DEV 使用(路由与侧栏入口都在 import.meta.env.DEV 下),不进生产包。
 */
export interface DemoEntry {
  /** URL slug,唯一;进入详情页 /demos/{id}。 */
  id: string
  /** 列表卡片与详情页返回栏显示的名称。 */
  title: string
  /** 一句话说明这个 demo 是什么 / 想验证什么。 */
  description: string
  /** 归类(如「单词本」),列表页按此分组;缺省归入「未分类」。 */
  group?: string
  /** 列表卡片的图标,缺省用通用占位图标。 */
  icon?: LucideIcon
  /** demo 页面组件本身。 */
  Component: React.ComponentType
}

export const DEMOS: DemoEntry[] = [
  {
    id: 'wordbook-home-memory',
    title: '单词本首页 · 去词书隔离 1｜记忆库+今日双联',
    description:
      '去词书隔离改版：删掉旧的「在学书 + 学习进度」进度卡（那是词书隔离的产物），进度唯一载体改为全局记忆库。首屏双联=记忆库存量（左）+ 今日计划/开始学习（右）；词书降为底部一条「新词来源」龙头行（只有来源名 + 余量 + 更换，无进度条）。',
    group: '单词本',
    icon: Brain,
    Component: WordbookHomeMemoryDemo,
  },
  {
    id: 'wordbook-home-memory-solo',
    title: '单词本首页 · 去词书隔离 2｜记忆库单卡',
    description:
      '同为去词书隔离，但更聚拢：存量总览 + 今日行动合成一张满宽记忆库大卡（大数字 + 分布条 + 分隔线下内嵌 待复习/今日新学/开始学习）。词书同样是底部一条无进度条的「新词来源」龙头。整页只有记忆库 + 龙头 + 功能三块，最干净。',
    group: '单词本',
    icon: Layers,
    Component: WordbookHomeMemorySoloDemo,
  },
  {
    id: 'wordbook-pick-words',
    title: '选词',
    description:
      '全局词库模型下的加词入口：从一本官方词书里逐词勾选，加入全局唯一的词库（不再是「换在学书」）。三态筛选（全部/未加入/已加入，默认停未加入）+ 前缀搜索 + 勾选（支持 shift 区间连选）+ 底部 sticky 行动栏（全选未加入 · 实时计数 · 加入学习）。已在词库的词按其全局状态挂徽标且不可再选，直观体现「重叠词不重学」。',
    group: '单词本',
    icon: ListPlus,
    Component: WordbookPickWordsDemo,
  },
  {
    id: 'word-study',
    title: '开始学习（新版）',
    description: '一体化 Card 闪卡：顶栏进度 + 词卡内容 + 三档评分同处一卡（顶/底 pin、中间滚动），贴合手机端整屏卡片观感。',
    group: '单词本',
    icon: GraduationCap,
    Component: WordStudyDemo,
  },
  {
    id: 'today-queue',
    title: '今日学习',
    description:
      '单词本首页「今日已学」入口的落地页（真实路由 /wordbook/today）：双栏 master-detail 复用在学词书的单词列表 + 词卡详情，顶栏收敛成「今日学习 / 今日复习」二段切换 + 搜索。',
    group: '单词本',
    icon: History,
    Component: TodayLearn,
  },
  {
    id: 'past-paper-reader',
    title: '真题阅读器',
    description:
      '真题点进去后的阅读页——本质是展示一份 PDF，走 vendor 的 foliate 引擎（识出固定版式后连续滚动，底层是 pdfjs），外壳 / 工具栏 / 缩放 / 页码由 CDS 定制。只做展示：不接进度、标注、划词等任何持久化。示例 PDF 由代码自包含生成，离线可用。',
    group: '资源',
    icon: FileText,
    Component: PastPaperReaderDemo,
  },
  {
    id: 'tts-bar-player',
    title: '朗读播放器 · 迷你条 + 完整播放器（readest 版式）',
    description:
      '朗读会话进行中常驻阅读页底部的那条播放器，版式取自 readest 的 TTSMiniPlayer：定高一行装下「封面 + 书名/章节 + 复读/上一句/播放/下一句/结束」，进度分三层（轨道 / 已合成未播的缓冲段 / 已播段）。外壳收成胶囊、封面收成圆——因此进度也从贴底直线改成沿胶囊下缘的一道描边弧（直线会被两端的大圆角斜切掉一截），弧仍可直接拖动定位；指到或拖动时副行的章节名让位给已播 / 剩余读数（胶囊高度是定的，长高会连圆角一起「胀」一下）。复读键是当前句循环重听（英语学习刚需，readest 没有）。CDS 适配：三层进度用同色不同透明度（alpha-2 / alpha-4 / 近黑 fill-primary，替掉 readest 的主题蓝），外壳走 CDS 浮层规格。带「模拟原生音色」开关可看无时间轴时的降级形态。点封面 / 标题区展开完整播放器（复刻 readest 的 TTSPlayerSheet）：大封面 + 章内进度条 + 复读/上一句/播放/下一句，最下面「倍速 / 音色」两张入口卡片点进去是同一张面板内的二级视图（倍速是梳齿刻度尺，0.5–3× 拖动松手才生效；音色按美音 / 英音 / 中文分组）。按 tts.md 的功能表砍掉了 readest 的睡眠定时、离线音频、段级导航与句/段间隙调节。',
    group: '阅读 · 朗读',
    icon: CirclePlay,
    Component: TtsBarPlayerDemo,
  },
  {
    id: 'login',
    title: '邮箱登录',
    description:
      '卡片式两步登录：页面居中大标题 + 登录卡片，先「Apple / 邮箱」发送验证码，再输入 4 位验证码（自动跳格 / 退格回退 / 整段粘贴 / 重发倒计时）完成登录。纯前端模拟，演示验证码 1234。',
    group: '账户',
    icon: LogIn,
    Component: LoginDemo,
  },
  {
    id: 'example',
    title: '示例 Demo',
    description: '展厅链路示范,之后真实页面会像这样一个个加进来。',
    group: '示例',
    icon: Sparkles,
    Component: ExampleDemo,
  },
]
