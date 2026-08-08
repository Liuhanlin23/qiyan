// 书籍身份哈希：文件「部分 MD5」——只取 12 个定点采样各 1024 字节喂同一个 MD5，避免 40MB 级书文件全量读。
// 这是**跨端契约**：同一本书在桌面 / 将来 iOS 必须算出同一 hash（它是 user_book 主键与 books/<hash>/ 目录名），
// 以此处实际行为为准，规格与测试向量见 docs/db/05-reading.md 末节。
//
// 采样偏移为 `0, 1024, 4096, …, 1024·4^10`：下面 `step << (2 * i)` 在 `i = -1` 时因 JS 位移量取模 32 的
// 语义实际得 **0**（不是 256）。别「按理解重写」成 256——那会换掉所有书的身份。
//
// 采样逻辑拷自 readest `apps/readest-app/src/utils/md5.ts::partialMD5`（AGPL-3.0）。
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

/**
 * 文件大小 → 采样区间 `[start, end)` 列表（纯函数，无 IO）。
 * 单独成函数是为了让单测能把那 12 个偏移量钉死——跨端对拍的就是这串数。
 */
export function sampleRanges(fileSize: number): Array<[number, number]> {
  const step = 1024
  const size = 1024

  const ranges: Array<[number, number]> = []
  for (let i = -1; i <= 10; i++) {
    const start = Math.min(fileSize, step << (2 * i))
    const end = Math.min(start + size, fileSize)
    if (start >= fileSize) break
    ranges.push([start, end])
  }
  return ranges
}

/** 定点读取器：返回 `[offset, offset + length)` 的实际字节（越过 EOF 时短于 length）。 */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>

/**
 * 部分 MD5 的核心逻辑（可注入读取器，供单测用内存字节序列跑）：
 * 按偏移升序把各采样段依次喂进**同一个** MD5 上下文，输出 32 位小写 hex。
 */
export async function partialMd5(fileSize: number, readAt: ReadAt): Promise<string> {
  const hasher = createHash('md5')
  for (const [start, end] of sampleRanges(fileSize)) {
    hasher.update(await readAt(start, end - start))
  }
  return hasher.digest('hex')
}

/** `fd.read` 的最小契约（单测可注入短读实现）。 */
export type PositionalRead = (
  buf: Uint8Array,
  offset: number,
  length: number,
  position: number,
) => Promise<{ bytesRead: number }>

/**
 * 定点读取器工厂（壳层，非采样逻辑）：POSIX 不保证单次 read 读满，短读时循环续读直到读满或 EOF。
 * 少喂的字节不会报错、只会静默改掉 hash——那就是跨端身份分裂。
 */
export function makeReadAt(read: PositionalRead): ReadAt {
  return async (offset, length) => {
    const buf = new Uint8Array(length)
    let filled = 0
    while (filled < length) {
      const { bytesRead } = await read(buf, filled, length - filled, offset + filled)
      if (bytesRead <= 0) break // EOF
      filled += bytesRead
    }
    return buf.subarray(0, filled)
  }
}

/** 薄 fs 壳：按路径算部分 MD5（fd 定点读，不整文件载入内存）。 */
export async function partialMd5OfFile(path: string): Promise<string> {
  const fd = await open(path, 'r')
  try {
    const { size } = await fd.stat()
    return await partialMd5(
      size,
      makeReadAt((buf, offset, length, position) => fd.read(buf, offset, length, position)),
    )
  } finally {
    await fd.close()
  }
}
