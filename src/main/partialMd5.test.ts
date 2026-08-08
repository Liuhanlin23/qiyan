// 部分 MD5 的跨端契约测试。两类断言，缺一不可：
// ① 把 12 个采样偏移量**逐个写死**——实现里的 `step << (2 * i)`（i = -1..10）在 i = -1 时靠 JS 位移量
//    取模 32 意外得 0 而非 256，所有书的身份系于此。将来谁「顺手改清楚」或换语言重写，这条会立刻红。
// ② 固定测试向量：用**内存构造**的确定字节序列锁死 hex 输出，供将来 iOS 端逐字节对拍
//    （向量定义与期望值同载于 docs/db/05-reading.md 末节，改这里必须同步改文档）。
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeReadAt, partialMd5, partialMd5OfFile, sampleRanges } from './partialMd5'

/**
 * 向量用的确定字节序列：`byte(i) = (i * 7 + 13) % 251`。
 * 取模 251（质数）而非 256——采样偏移全是 1024 的倍数，用 256 会让每个采样段字节完全相同，向量就废了。
 */
function byteAt(i: number): number {
  return (i * 7 + 13) % 251
}

/** 无需真造大文件的读取器：按需现算字节，可模拟到 GB 级尺寸。 */
function syntheticReader(fileSize: number) {
  return async (offset: number, length: number): Promise<Uint8Array> => {
    const n = Math.max(0, Math.min(length, fileSize - offset))
    const buf = new Uint8Array(n)
    for (let k = 0; k < n; k++) buf[k] = byteAt(offset + k)
    return buf
  }
}

describe('sampleRanges', () => {
  it('偏移量就是 0 与 1024·4^i（i=0..10），共 12 个点 —— 首点是 0 不是 256', () => {
    const starts = sampleRanges(2 ** 31).map(([start]) => start)
    expect(starts).toEqual([
      0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864, 268435456,
      1073741824,
    ])
  })

  it('每点固定读 1024 字节（不越 EOF 时）', () => {
    for (const [start, end] of sampleRanges(2 ** 31)) expect(end - start).toBe(1024)
  })

  it('末段越过 EOF 截断；偏移 ≥ 文件大小即停', () => {
    expect(sampleRanges(500)).toEqual([[0, 500]])
    expect(sampleRanges(5000)).toEqual([
      [0, 1024],
      [1024, 2048],
      [4096, 5000],
    ])
    expect(sampleRanges(0)).toEqual([])
  })
})

describe('partialMd5 测试向量（跨端对拍基准）', () => {
  it('空文件 → 空输入的 MD5', async () => {
    expect(await partialMd5(0, syntheticReader(0))).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })

  it('向量 A：500 字节（< 1024，单采样点、整文件参与）', async () => {
    expect(await partialMd5(500, syntheticReader(500))).toBe('32a1872dffc56c1cc991d58a10732445')
  })

  it('向量 B：5000 字节（跨 3 个采样点，末段截断）', async () => {
    expect(await partialMd5(5000, syntheticReader(5000))).toBe('afabfdd49774b09fb97cc79a49184a34')
  })

  it('向量 C：2^30 + 512 字节（覆盖全部 12 个采样点，末点仅 512 字节）', async () => {
    expect(await partialMd5(2 ** 30 + 512, syntheticReader(2 ** 30 + 512))).toBe(
      '29bae18ef4a9c99e632b176a211eb561',
    )
  })

  it('小于 1024 时等价于整文件 MD5（采样退化为全读）', async () => {
    const bytes = new Uint8Array(500)
    for (let i = 0; i < bytes.length; i++) bytes[i] = byteAt(i)
    const whole = createHash('md5').update(bytes).digest('hex')
    expect(await partialMd5(500, syntheticReader(500))).toBe(whole)
  })
})

describe('makeReadAt（短读补齐）', () => {
  it('每次只返回 100 字节的读取器，hex 与一次读满一致', async () => {
    const size = 5000
    // 模拟 POSIX 短读：不报错，只是喂得少。少一个字节 hash 就变，跨端身份即分裂。
    const shortRead = async (
      buf: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ): Promise<{ bytesRead: number }> => {
      const n = Math.max(0, Math.min(length, 100, size - position))
      for (let k = 0; k < n; k++) buf[offset + k] = byteAt(position + k)
      return { bytesRead: n }
    }
    expect(await partialMd5(size, makeReadAt(shortRead))).toBe(
      await partialMd5(size, syntheticReader(size)),
    )
  })
})

describe('partialMd5OfFile（fs 壳）', () => {
  it('真实文件的结果与注入读取器一致', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qiyan-md5-'))
    try {
      const size = 5000
      const bytes = new Uint8Array(size)
      for (let i = 0; i < size; i++) bytes[i] = byteAt(i)
      const path = join(dir, 'book.epub')
      await writeFile(path, bytes)
      expect(await partialMd5OfFile(path)).toBe(await partialMd5(size, syntheticReader(size)))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
