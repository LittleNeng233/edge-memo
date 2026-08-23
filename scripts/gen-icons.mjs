import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- 绘制基元（SDF，超采样抗锯齿） ---------- */
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const mix = (a, b, t) => a + (b - a) * t

function roundRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

function coverage(d, feather = 1.2) {
  return clamp01(0.5 - d / feather)
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
}

function blend(base, color, alpha) {
  base[0] = mix(base[0], color[0], alpha)
  base[1] = mix(base[1], color[1], alpha)
  base[2] = mix(base[2], color[2], alpha)
  base[3] = Math.max(base[3], alpha * 255)
}

function render(size, drawFn) {
  const ss = 3
  const S = size * ss
  const buf = new Float64Array(S * S * 4)
  const px = [0, 0, 0, 0]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      px[0] = px[1] = px[2] = 0
      px[3] = 0
      drawFn(x / S, y / S, px)
      const i = (y * S + x) * 4
      buf[i] = px[0]
      buf[i + 1] = px[1]
      buf[i + 2] = px[2]
      buf[i + 3] = px[3]
    }
  }
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * S + x * ss + sx) * 4
          const wa = buf[i + 3] / 255
          r += buf[i] * wa
          g += buf[i + 1] * wa
          b += buf[i + 2] * wa
          a += buf[i + 3]
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(r / (a / 255))
        out[o + 1] = Math.round(g / (a / 255))
        out[o + 2] = Math.round(b / (a / 255))
      }
      out[o + 3] = Math.round(a / (ss * ss))
    }
  }
  return out
}

/* ---------- 图标设计 ---------- */
const TILE = hex('#171a20')
const TILE_TOP = hex('#1e232b')
const EDGE_TOP = hex('#f2b558')
const EDGE_BOT = hex('#c96f14')
const LINE_DIM_1 = hex('#434b58')
const LINE_DIM_2 = hex('#363d49')
const LINE_ACCENT = hex('#9a6a20')

function drawIcon(u, v, px) {
  const x = u * 256
  const y = v * 256
  const gradTile = clamp01(y / 256)
  const tileColor = [mix(TILE_TOP[0], TILE[0], gradTile), mix(TILE_TOP[1], TILE[1], gradTile), mix(TILE_TOP[2], TILE[2], gradTile)]
  const dTile = roundRectSDF(x, y, 128, 128, 106, 106, 54)
  const aTile = coverage(dTile, 2.4)
  if (aTile > 0) blend(px, tileColor, aTile)

  const gradEdge = clamp01(y / 256)
  const edgeColor = [
    mix(EDGE_TOP[0], EDGE_BOT[0], gradEdge),
    mix(EDGE_TOP[1], EDGE_BOT[1], gradEdge),
    mix(EDGE_TOP[2], EDGE_BOT[2], gradEdge)
  ]
  const dEdge = roundRectSDF(x, y, 212, 128, 13, 82, 12)
  const aEdge = coverage(dEdge, 2)
  if (aEdge > 0) blend(px, edgeColor, aEdge)

  const lines = [
    { cy: 86, hw: 62, color: LINE_DIM_1 },
    { cy: 126, hw: 46, color: LINE_DIM_2 },
    { cy: 166, hw: 54, color: LINE_ACCENT }
  ]
  for (const ln of lines) {
    const dLine = roundRectSDF(x, y, 104, ln.cy, ln.hw, 7, 7)
    const aLine = coverage(dLine, 1.6)
    if (aLine > 0) blend(px, ln.color, aLine)
  }
}

function drawDragIcon(u, v, px) {
  const x = u * 32
  const y = v * 32
  const grad = clamp01(y / 32)
  const color = [
    mix(EDGE_TOP[0], EDGE_BOT[0], grad),
    mix(EDGE_TOP[1], EDGE_BOT[1], grad),
    mix(EDGE_TOP[2], EDGE_BOT[2], grad)
  ]
  const dBody = roundRectSDF(x, y, 16, 17, 10.5, 13, 4.5)
  const a = coverage(dBody, 1.2)
  if (a > 0) blend(px, color, a)
  const dStripe = roundRectSDF(x, y, 24, 17, 3, 13, 3)
  const as = coverage(dStripe, 1)
  if (as > 0 && a > 0) blend(px, hex('#8a520c'), as * 0.85)
}

function drawTrayIcon(u, v, px) {
  const x = u * 32
  const y = v * 32
  const dBg = roundRectSDF(x, y, 16, 16, 15, 15, 8)
  const aBg = coverage(dBg, 1)
  if (aBg > 0) blend(px, TILE_TOP, aBg * 0.98)
  const dBar = roundRectSDF(x, y, 22.5, 16, 3.4, 9.5, 3)
  const aBar = coverage(dBar, 0.8)
  if (aBar > 0) blend(px, EDGE_TOP, aBar)
  const l1 = roundRectSDF(x, y, 11, 10.5, 6.5, 1.8, 1.8)
  const a1 = coverage(l1, 0.8)
  if (a1 > 0) blend(px, LINE_DIM_1, a1)
  const l2 = roundRectSDF(x, y, 9.5, 17.5, 5, 1.8, 1.8)
  const a2 = coverage(l2, 0.8)
  if (a2 > 0) blend(px, LINE_DIM_2, a2)
  const l3 = roundRectSDF(x, y, 11, 24.5, 6.5, 1.8, 1.8)
  const a3 = coverage(l3, 0.8)
  if (a3 > 0) blend(px, LINE_ACCENT, a3)
}

/* ---------- 输出 ---------- */
const icon256 = render(256, drawIcon)
writeFileSync(join(outDir, 'icon.png'), encodePng(256, 256, icon256))

function writeIco(pngBuf, file) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = 0
  entry[1] = 0
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(pngBuf.length, 8)
  entry.writeUInt32LE(22, 12)
  writeFileSync(file, Buffer.concat([header, entry, pngBuf]))
}
writeIco(icon256, join(outDir, 'icon.ico'))

writeFileSync(join(outDir, 'drag-icon.png'), encodePng(32, 32, render(32, drawDragIcon)))
writeFileSync(join(outDir, 'tray.png'), encodePng(32, 32, render(32, drawTrayIcon)))

console.log('图标已生成：icon.png / icon.ico / drag-icon.png / tray.png')
