/**
 * 生成一份自包含的多页示例 PDF —— 仅用于「真题阅读器」demo 对比两种渲染方式。
 *
 * 手写最小 PDF(标准 Helvetica 字体绘制英文真题样式文字),不落地文件、离线可用:
 * pdfjs 从返回的字节渲染 canvas,内置 iframe 则把字节包成 Blob URL 加载。
 * 这是 demo 专用的一次性工具,不追求通用性。
 */

type LineKind = 'h1' | 'h2' | 'body' | 'gap'

interface Line {
  text: string
  size: number
  /** 相对上一行基线的下移量(pt)。 */
  gap: number
}

const KIND: Record<LineKind, { size: number; gap: number }> = {
  h1: { size: 20, gap: 36 },
  h2: { size: 13, gap: 28 },
  body: { size: 11, gap: 17 },
  gap: { size: 11, gap: 12 },
}

const h1 = (text: string): Line => ({ text, ...KIND.h1 })
const h2 = (text: string): Line => ({ text, ...KIND.h2 })
const t = (text: string): Line => ({ text, ...KIND.body })
const gap = (): Line => ({ text: '', ...KIND.gap })

/** 三页英文真题样式内容(纯 ASCII,行宽控制在 Helvetica 11pt 一行内)。 */
const PAGES: Line[][] = [
  [
    h1('2024 National English Proficiency Exam'),
    h2('Part A   Reading Comprehension                              Page 1 of 3'),
    t('Directions: Read the following passage and answer the questions below.'),
    gap(),
    t('For most of human history, the night sky was a shared inheritance. Anyone'),
    t('who looked up could trace the same constellations their ancestors had named.'),
    t('Today, artificial light has erased that view for two-thirds of the world.'),
    t('Astronomers call it light pollution, but its reach goes well beyond'),
    t('telescopes: migrating birds lose their way, sea turtles crawl inland, and'),
    t('human sleep is quietly disrupted night after night.'),
    gap(),
    t('The encouraging part is that light pollution is uniquely reversible. Unlike'),
    t('carbon already in the atmosphere, a poorly aimed lamp can be fixed in an'),
    t('evening. Shield the bulb, warm its colour, dim it after midnight, and the'),
    t('stars return the moment the switch is flipped.'),
    gap(),
    t('1. The passage is mainly concerned with'),
    t('   (A) the history of naming constellations'),
    t('   (B) a form of pollution that can be undone'),
    t('   (C) why telescopes must be built in deserts'),
    t('2. The word "inheritance" (line 1) most nearly means'),
    t('   (A) a legal document   (B) a shared birthright   (C) a rare disease'),
  ],
  [
    h2('Part A   Reading Comprehension                              Page 2 of 3'),
    t('Directions: The following passage is followed by two questions.'),
    gap(),
    t('When a language dies, it rarely dies loudly. More often it fades one'),
    t('speaker at a time, until a single elder holds words that no one else can'),
    t('answer. Linguists estimate that of the seven thousand languages spoken'),
    t('today, nearly half may be gone by the end of the century.'),
    gap(),
    t('Yet revival is not hopeless. Hebrew was a language of prayer for centuries'),
    t('before it became, once more, a language of the street. What such stories'),
    t('share is not a grammar but a community willing to speak imperfectly in'),
    t('public, trading fluency for the simple act of keeping the words alive.'),
    gap(),
    t('3. According to the passage, languages usually disappear'),
    t('   (A) suddenly and dramatically'),
    t('   (B) gradually and quietly'),
    t('   (C) only after being written down'),
    t('4. The example of Hebrew is used to suggest that'),
    t('   (A) prayer preserves grammar best'),
    t('   (B) a fading language can be brought back'),
    t('   (C) fluency matters more than community'),
  ],
  [
    h2('Part B   Writing                                           Page 3 of 3'),
    t('Directions: Write a short essay of about 120 words on the topic below.'),
    gap(),
    t('Some people believe that a city should protect its old buildings at any'),
    t('cost; others argue that a city must rebuild to grow. Which view is closer'),
    t('to your own, and why?'),
    gap(),
    t('In your essay you should:'),
    t('   - state your position clearly in the first sentence;'),
    t('   - support it with at least two concrete reasons or examples;'),
    t('   - close with a sentence that restates your view in new words.'),
    gap(),
    t('Notes ______________________________________________________________'),
    t('_____________________________________________________________________'),
    t('_____________________________________________________________________'),
    t('_____________________________________________________________________'),
  ],
]

/** PDF 文本串转义:反斜杠与圆括号需转义,否则破坏 (…) 字符串字面量。 */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** 单页内容流:BT…ET,首行绝对定位,其余按 gap 逐行下移。 */
function contentStream(lines: Line[]): string {
  const startX = 56
  const startY = 786
  let s = 'BT\n'
  let first = true
  for (const line of lines) {
    s += `/F1 ${line.size} Tf\n`
    s += first ? `${startX} ${startY} Td\n` : `0 -${line.gap} Td\n`
    first = false
    s += `(${escapeText(line.text)}) Tj\n`
  }
  s += 'ET'
  return s
}

/** 把 Latin1 字符串逐字节写成 Uint8Array(内容全为 0–255 单字节,偏移即字符下标)。 */
function latin1(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

/**
 * 组装多页 PDF 字节。对象编号:1 Catalog / 2 Pages / 3 Font,随后每页占两个对象
 * (页对象 4+2i、内容流对象 5+2i);末尾写经典 xref 表 + trailer。
 */
export function buildSamplePaperPdf(): Uint8Array<ArrayBuffer> {
  const offsets: number[] = []
  let pdf = ''
  const mark = (n: number): void => {
    offsets[n] = pdf.length
  }

  pdf += '%PDF-1.4\n'
  // 二进制标记行(高位字节),提示阅读器这是含二进制的 PDF。
  pdf += '%âãÏÓ\n'

  const pageObjNums = PAGES.map((_, i) => 4 + i * 2)
  const contentObjNums = PAGES.map((_, i) => 5 + i * 2)

  mark(1)
  pdf += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'

  mark(2)
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(' ')
  pdf += `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${PAGES.length} >>\nendobj\n`

  mark(3)
  pdf += '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'

  PAGES.forEach((lines, i) => {
    const pnum = pageObjNums[i]
    const cnum = contentObjNums[i]
    const stream = contentStream(lines)

    mark(pnum)
    pdf +=
      `${pnum} 0 obj\n` +
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${cnum} 0 R >>\nendobj\n`

    mark(cnum)
    pdf += `${cnum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
  })

  const totalObjs = 3 + PAGES.length * 2
  const xrefStart = pdf.length
  pdf += `xref\n0 ${totalObjs + 1}\n`
  pdf += '0000000000 65535 f\r\n'
  for (let n = 1; n <= totalObjs; n++) {
    pdf += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n\r\n`
  }
  pdf += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

  return latin1(pdf)
}
