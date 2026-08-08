// 从设计源图 `build/app-icon.png` 生成三个平台的 App 图标：
// `build/icon.png`（Linux + dev Dock）/ `icon.ico`（Windows）/ `icon.icns`（macOS）。
//
// 为什么是脚本而不是几条 ImageMagick 命令：原流程要 `magick` + macOS 自带的 `sips` / `iconutil`，
// 在 Windows 开发机上一条都跑不了，图标改不动。这里只用 Node 内置的 zlib 手写 PNG / ICO / ICNS
// 编码，任何平台都能重新生成。
//
// 图形铺满画布，不留安全区边距。
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const buildDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'build')

// ---------- PNG 解码 ----------

/** 解出 8bit RGBA 像素。只认设计源图会用到的格式：非隔行、8 位深、灰度/RGB/RGBA/灰度+A。 */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8
  let w, h, depth, colorType, interlace
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (interlace !== 0) throw new Error('不支持隔行 PNG')
  if (depth !== 8) throw new Error(`不支持 ${depth} 位深`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`不支持 colorType ${colorType}（调色板图请先转成 RGBA）`)

  // 反 PNG 行滤波（每行首字节是滤波类型，其余按 Paeth 等规则还原）。
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const flat = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const cur = flat.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? flat.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let v = line[x]
      switch (filter) {
        case 0: break
        case 1: v += a; break
        case 2: v += b; break
        case 3: v += (a + b) >> 1; break
        case 4: {
          const pa = Math.abs(b - c)
          const pb = Math.abs(a - c)
          const pc = Math.abs(a + b - 2 * c)
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default: throw new Error(`未知滤波类型 ${filter}`)
      }
      cur[x] = v & 0xff
    }
  }

  // 统一成 RGBA
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * channels
    const d = i * 4
    if (colorType === 6) {
      rgba[d] = flat[s]; rgba[d + 1] = flat[s + 1]; rgba[d + 2] = flat[s + 2]; rgba[d + 3] = flat[s + 3]
    } else if (colorType === 2) {
      rgba[d] = flat[s]; rgba[d + 1] = flat[s + 1]; rgba[d + 2] = flat[s + 2]; rgba[d + 3] = 255
    } else if (colorType === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = flat[s]; rgba[d + 3] = flat[s + 1]
    } else {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = flat[s]; rgba[d + 3] = 255
    }
  }
  return { w, h, data: rgba }
}

// ---------- PNG 编码 ----------

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePNG({ w, h, data }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // colorType RGBA
  // 每行前置一个 0（无滤波）——图标尺寸小，压缩率差异不值得逐行试滤波。
  const stride = w * 4
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- 几何 ----------

/** 裁掉四周完全透明的边，返回图形本体。 */
function trim(img, threshold = 0) {
  let minX = img.w, minY = img.h, maxX = -1, maxY = -1
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('源图整张透明')
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    img.data.copy(data, y * w * 4, ((minY + y) * img.w + minX) * 4, ((minY + y) * img.w + minX + w) * 4)
  }
  return { w, h, data, offset: { x: minX, y: minY } }
}

/**
 * 面积平均重采样。图标是大比例缩小（1024 → 最小 16，64:1），box filter 比双线性更干净；
 * 混合在预乘 alpha 空间做，否则透明区的残留 RGB 会渗进边缘。
 */
function resize(img, dw, dh) {
  const { w: sw, h: sh, data: src } = img
  const dst = Buffer.alloc(dw * dh * 4)
  const xRatio = sw / dw
  const yRatio = sh / dh
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * yRatio
    const y1 = (dy + 1) * yRatio
    const iy0 = Math.floor(y0)
    const iy1 = Math.min(sh, Math.ceil(y1))
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * xRatio
      const x1 = (dx + 1) * xRatio
      const ix0 = Math.floor(x0)
      const ix1 = Math.min(sw, Math.ceil(x1))
      let r = 0, g = 0, b = 0, a = 0, total = 0
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy)
        if (wy <= 0) continue
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx)
          if (wx <= 0) continue
          const weight = wx * wy
          const i = (sy * sw + sx) * 4
          const alpha = src[i + 3] / 255
          r += src[i] * alpha * weight
          g += src[i + 1] * alpha * weight
          b += src[i + 2] * alpha * weight
          a += src[i + 3] * weight
          total += weight
        }
      }
      const d = (dy * dw + dx) * 4
      if (total <= 0) continue
      const alpha = a / total
      const unpremul = alpha > 0 ? 255 / alpha : 0
      dst[d] = Math.min(255, Math.round((r / total) * unpremul))
      dst[d + 1] = Math.min(255, Math.round((g / total) * unpremul))
      dst[d + 2] = Math.min(255, Math.round((b / total) * unpremul))
      dst[d + 3] = Math.round(alpha)
    }
  }
  return { w: dw, h: dh, data: dst }
}

// ---------- ICO 编码（Windows） ----------

/** 32bpp BMP 帧（bottom-up BGRA + 全零 AND mask）；比 PNG 帧体积大，但兼容到最老的 shell。 */
function bmpFrame(img) {
  const { w, h, data } = img
  const maskStride = (((w + 31) >> 5) << 2) // 1bpp 且行按 4 字节对齐
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(w, 4)
  header.writeInt32LE(h * 2, 8) // 高度含 AND mask，故 ×2
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(w * h * 4 + maskStride * h, 20)
  const xor = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y // BMP 自下而上
    for (let x = 0; x < w; x++) {
      const s = (srcY * w + x) * 4
      const d = (y * w + x) * 4
      xor[d] = data[s + 2] // B
      xor[d + 1] = data[s + 1] // G
      xor[d + 2] = data[s] // R
      xor[d + 3] = data[s + 3] // A
    }
  }
  return Buffer.concat([header, xor, Buffer.alloc(maskStride * h)])
}

function encodeICO(frames) {
  const dir = Buffer.alloc(6 + frames.length * 16)
  dir.writeUInt16LE(1, 2) // type = icon
  dir.writeUInt16LE(frames.length, 4)
  let offset = dir.length
  const blobs = []
  frames.forEach((img, i) => {
    const blob = bmpFrame(img)
    const e = 6 + i * 16
    dir[e] = img.w >= 256 ? 0 : img.w // 256 在 1 字节字段里记作 0
    dir[e + 1] = img.h >= 256 ? 0 : img.h
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(blob.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += blob.length
    blobs.push(blob)
  })
  return Buffer.concat([dir, ...blobs])
}

// ---------- ICNS 编码（macOS） ----------

/** 各 OSType 对应的像素尺寸；`ic**` 系列自 macOS 10.7 起直接吃 PNG 数据。 */
const ICNS_TYPES = [
  ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64],
  ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512],
  ['ic09', 512], ['ic10', 1024],
]

function encodeICNS(pngBySize) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const png = pngBySize.get(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(8 + png.length, 4) // 长度含这 8 字节头
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

// ---------- 主流程 ----------

const source = decodePNG(readFileSync(join(buildDir, 'app-icon.png')))
const body = trim(source)
console.log(`源图 ${source.w}x${source.h} → 裁掉透明边后 ${body.w}x${body.h} @ (${body.offset.x},${body.offset.y})`)

// 图标本体是圆角矩形，本该正方；实测长宽差不到 1%，属源图抗锯齿边界的误差，直接拉满到
// 正方形，换取画布零留白（形变远低于可察阈值）。
const skew = Math.abs(body.w - body.h) / Math.max(body.w, body.h)
console.log(`长宽比偏差 ${(skew * 100).toFixed(2)}%，拉伸铺满正方画布`)
if (skew > 0.02) {
  console.warn(`⚠ 偏差超过 2%，形变可能可见——确认 app-icon.png 的图形本体是否为正方形`)
}

const master = resize(body, 1024, 1024)
writeFileSync(join(buildDir, 'icon.png'), encodePNG(master))
console.log('✓ icon.png    1024x1024（Linux 打包 + dev 期 Dock）')

// 各尺寸只从 1024 母版降采样一次，避免多级缩放累积模糊。
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
const bySize = new Map(sizes.map((s) => [s, s === 1024 ? master : resize(master, s, s)]))

const ico = encodeICO([256, 128, 64, 48, 32, 16].map((s) => bySize.get(s)))
writeFileSync(join(buildDir, 'icon.ico'), ico)
console.log(`✓ icon.ico    256/128/64/48/32/16（Windows exe + NSIS），${(ico.length / 1024).toFixed(0)}KB`)

const pngBySize = new Map([...bySize].map(([s, img]) => [s, encodePNG(img)]))
const icns = encodeICNS(pngBySize)
writeFileSync(join(buildDir, 'icon.icns'), icns)
console.log(`✓ icon.icns   16→1024 共 ${ICNS_TYPES.length} 帧（macOS .app），${(icns.length / 1024).toFixed(0)}KB`)
