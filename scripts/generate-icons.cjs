const fs = require('node:fs/promises')
const sharp = require('sharp')
const path = require('node:path')

async function main() {
  const logo = path.resolve('public/logo.svg')
  const sizes = [
    ['pwa-64x64.png', 64],
    ['pwa-192x192.png', 192],
    ['pwa-512x512.png', 512],
    ['maskable-icon-512x512.png', 512],
    ['apple-touch-icon-180x180.png', 180],
  ]
  for (const [filename, size] of sizes) {
    await sharp(logo).resize(size, size).png().toFile(path.resolve('public', filename))
  }
  const png = await sharp(logo).resize(32, 32).png().toBuffer()
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = 32
  header[7] = 32
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  await fs.writeFile('public/favicon.ico', Buffer.concat([header, png]))
  await fs.copyFile(logo, 'public/favicon.svg')
  console.log('已生成不透明背景的液态玻璃图标：64、180、192、512、遮罩图标与网站图标')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
