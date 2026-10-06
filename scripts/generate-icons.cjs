const fs = require('node:fs/promises')
const sharp = require('sharp')
const path = require('node:path')

async function main() {
  const logo = await fs.readFile(path.resolve('public/logo.svg'), 'utf8')
  const mark = /<g id="app-mark" transform="[^"]+">/
  if (!mark.test(logo)) throw new Error('logo.svg 缺少 app-mark 分组，无法生成独立遮罩图标')
  // Apple 图标扩大主体；maskable 单独保留安全圆内的比例。
  const maskableLogo = logo.replace(mark,
    '<g id="app-mark" transform="translate(256 256) scale(1) translate(-256 -256)">')
  const sizes = [
    ['pwa-64x64.png', 64],
    ['pwa-192x192.png', 192],
    ['pwa-512x512.png', 512],
    ['apple-touch-icon-180x180.png', 180],
  ]
  for (const [filename, size] of sizes) {
    await sharp(Buffer.from(logo)).resize(size, size).png().toFile(path.resolve('public', filename))
  }
  await sharp(Buffer.from(maskableLogo)).resize(512, 512).png().toFile(path.resolve('public/maskable-icon-512x512.png'))
  const png = await sharp(Buffer.from(logo)).resize(32, 32).png().toBuffer()
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
  await fs.writeFile('public/favicon.svg', logo)
  console.log('已生成扩大主体的 Apple/PWA/favicon 图标，以及独立安全区遮罩图标')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
