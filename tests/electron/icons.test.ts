import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import path from 'node:path'

// The Windows shell paints the taskbar button straight from these files. The mark is a rounded
// square, so an opaque corner turns into a white box around the icon; guard the alpha channel
// instead of trusting whoever exports the artwork next time.
function decodePng(file: Buffer) {
  expect(file.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  const data: Buffer[] = []
  for (let offset = 8; offset < file.length; ) {
    const length = file.readUInt32BE(offset)
    const type = file.toString('ascii', offset + 4, offset + 8)
    const body = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
    }
    if (type === 'IDAT') data.push(body)
    offset += length + 12
  }
  expect({ depth, colorType }).toEqual({ depth: 8, colorType: 6 })
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  const paeth = (left: number, up: number, corner: number) => {
    const estimate = left + up - corner
    const toLeft = Math.abs(estimate - left)
    const toUp = Math.abs(estimate - up)
    const toCorner = Math.abs(estimate - corner)
    if (toLeft <= toUp && toLeft <= toCorner) return left
    return toUp <= toCorner ? up : corner
  }
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x += 1) {
      const byte = raw[y * (stride + 1) + 1 + x]
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const corner = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0
      const guess =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, corner)
                : 0
      pixels[y * stride + x] = (byte + guess) & 0xff
    }
  }
  return { width, height, pixels }
}

function alphaAt(png: ReturnType<typeof decodePng>, x: number, y: number) {
  return png.pixels[(y * png.width + x) * 4 + 3]
}

describe('application icon', () => {
  it('keeps the raster corners transparent', () => {
    const png = decodePng(readFileSync(path.resolve('assets/flowchat.png')))
    expect(png.width).toBe(png.height)
    for (const [x, y] of [
      [0, 0],
      [png.width - 1, 0],
      [0, png.height - 1],
      [png.width - 1, png.height - 1],
    ])
      expect(alphaAt(png, x, y)).toBe(0)
    expect(alphaAt(png, png.width >> 1, png.height >> 1)).toBe(255)
  })

  it('keeps every ico layer transparent at its corners', () => {
    const ico = readFileSync(path.resolve('assets/flowchat.ico'))
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    const sizes = new Set<number>()
    for (let index = 0; index < ico.readUInt16LE(4); index += 1) {
      const entry = 6 + index * 16
      const width = ico[entry] || 256
      const height = ico[entry + 1] || 256
      const bytes = ico.readUInt32LE(entry + 8)
      const start = ico.readUInt32LE(entry + 12)
      const layer = ico.subarray(start, start + bytes)
      sizes.add(width)
      expect(height).toBe(width)
      if (layer.readUInt32BE(0) === 0x89504e47) {
        const png = decodePng(layer)
        expect(png.width).toBe(width)
        expect(alphaAt(png, 0, 0)).toBe(0)
      } else {
        expect(layer.readUInt32LE(0)).toBe(40)
        expect(layer.readUInt16LE(14)).toBe(32)
        // 32-bit rows are stored bottom-up, so the first stored pixel is the bottom-left corner.
        expect(layer[40 + 3]).toBe(0)
      }
    }
    expect(sizes.has(32)).toBe(true)
    expect(sizes.has(256)).toBe(true)
  })
})
