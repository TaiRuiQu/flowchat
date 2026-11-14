#!/usr/bin/env node
// Rasterises the FlowChat mark into assets/flowchat.png and assets/flowchat.ico with a real
// alpha channel. The artwork is a rounded square, so every layer must keep its corners fully
// transparent; flattening the shape against white makes the Windows taskbar draw a white box
// around the icon. Geometry mirrors assets/flowchat.svg and is rendered analytically, which
// stays crisp at 16 px instead of decimating one large bitmap.
import { deflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CANVAS = 24
const CORNER = 6.5
const HALF_STROKE = 0.8
const DOT_RADIUS = 1.7
const FILL = [0x4b, 0x5f, 0xd0]
const MARK = [255, 255, 255]
// "M9 18V6M9 13h1a5 5 0 0 0 5-5V7" plus the three discs at (9,6), (15,6) and (9,18).
// The arc is sampled into a short polyline so a single round-capped capsule union describes
// the whole stroke: caps and joins then match the SVG instead of being special-cased.
const DISCS = [
  [9, 6],
  [15, 6],
  [9, 18],
]

function arcPoints(center, radius, from, to, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / steps
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
  })
}

// Two subpaths, exactly like the SVG: the full stem, and the hook that leaves the stem
// sideways, sweeps around (10,8) and rejoins the top-right disc from below.
const STROKES = [
  [
    [9, 18],
    [9, 6],
  ],
  [[9, 13], [10, 13], ...arcPoints([10, 8], 5, Math.PI / 2, 0), [15, 7]],
]
const PNG_SIZE = 256
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const PNG_FROM = 96

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value)

function capsule(x, y, from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : clamp01(((x - from[0]) * dx + (y - from[1]) * dy) / length)
  return Math.hypot(x - from[0] - dx * t, y - from[1] - dy * t) - HALF_STROKE
}

function roundedSquare(x, y) {
  const qx = Math.abs(x - CANVAS / 2) - (CANVAS / 2 - CORNER)
  const qy = Math.abs(y - CANVAS / 2) - (CANVAS / 2 - CORNER)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - CORNER
}

function mark(x, y) {
  let distance = Infinity
  for (const stroke of STROKES)
    for (let index = 1; index < stroke.length; index += 1)
      distance = Math.min(distance, capsule(x, y, stroke[index - 1], stroke[index]))
  for (const center of DISCS)
    distance = Math.min(distance, Math.hypot(x - center[0], y - center[1]) - DOT_RADIUS)
  return distance
}

// 4x4 supersampling of an anti-aliased signed distance field: alpha comes out clean and the
// straight-alpha colours never bleed white into the corner because averaging is premultiplied.
function render(size) {
  const supersample = 4
  const scaled = size * supersample
  const unit = scaled / CANVAS
  const wide = new Float64Array(scaled * scaled * 4)
  for (let y = 0; y < scaled; y += 1) {
    for (let x = 0; x < scaled; x += 1) {
      const u = (x + 0.5) / unit
      const v = (y + 0.5) / unit
      const alpha = clamp01(0.5 - roundedSquare(u, v) * unit)
      const ink = clamp01(0.5 - mark(u, v) * unit)
      const offset = (y * scaled + x) * 4
      for (let channel = 0; channel < 3; channel += 1)
        wide[offset + channel] = (FILL[channel] + (MARK[channel] - FILL[channel]) * ink) * alpha
      wide[offset + 3] = alpha
    }
  }
  const pixels = Buffer.alloc(size * size * 4)
  const samples = supersample * supersample
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const offset = ((y * supersample + sy) * scaled + x * supersample + sx) * 4
          red += wide[offset]
          green += wide[offset + 1]
          blue += wide[offset + 2]
          alpha += wide[offset + 3]
        }
      }
      const offset = (y * size + x) * 4
      // Un-premultiply back into 0..255 straight alpha; transparent pixels keep the fill
      // colour so a non-premultiplied scaler cannot bleed dark fringes into the corners.
      const straight = (sum, fallback) =>
        alpha > 0 ? Math.min(255, Math.max(0, Math.round(sum / alpha))) : fallback
      pixels[offset] = straight(red, FILL[0])
      pixels[offset + 1] = straight(green, FILL[1])
      pixels[offset + 2] = straight(blue, FILL[2])
      pixels[offset + 3] = Math.round(clamp01(alpha / samples) * 255)
    }
  }
  return pixels
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // truecolour with alpha
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Bitmap layers keep the legacy AND mask in sync with the alpha channel; PNG layers are used
// from 96 px up so the container stays small without upsetting the shell.
function encodeBitmap(size, pixels) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(size * size * 4, 20)
  const colors = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const source = ((size - 1 - y) * size + x) * 4
      const target = (y * size + x) * 4
      colors[target] = pixels[source + 2]
      colors[target + 1] = pixels[source + 1]
      colors[target + 2] = pixels[source]
      colors[target + 3] = pixels[source + 3]
    }
  }
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (pixels[((size - 1 - y) * size + x) * 4 + 3] > 127) continue
      mask[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return Buffer.concat([header, colors, mask])
}

function encodeIco(entries) {
  const directory = Buffer.alloc(6 + entries.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(entries.length, 4)
  let offset = directory.length
  entries.forEach((entry, index) => {
    const at = 6 + index * 16
    directory[at] = entry.size >= 256 ? 0 : entry.size
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(entry.data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entry.data.length
  })
  return Buffer.concat([directory, ...entries.map((entry) => entry.data)])
}

const png = encodePng(PNG_SIZE, render(PNG_SIZE))
const ico = encodeIco(
  ICO_SIZES.map((size) => {
    const pixels = render(size)
    return { size, data: size >= PNG_FROM ? encodePng(size, pixels) : encodeBitmap(size, pixels) }
  }),
)
await writeFile(path.join(root, 'assets/flowchat.png'), png)
await writeFile(path.join(root, 'assets/flowchat.ico'), ico)

const probe = render(32)
const corners = [0, 31, 32 * 31, 32 * 32 - 1].map((index) => probe[index * 4 + 3])
if (corners.some((alpha) => alpha !== 0)) throw new Error(`Corner alpha is opaque: ${corners}`)
if (probe[(16 * 32 + 16) * 4 + 3] !== 255) throw new Error('Centre is not opaque.')
console.log(
  `assets/flowchat.png ${PNG_SIZE}px (${png.length} B) · assets/flowchat.ico ${ICO_SIZES.join('/')} (${ico.length} B) · corner alpha ${corners.join(',')}`,
)
