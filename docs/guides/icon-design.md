# 主屏幕图标维护

最终源文件为 `public/logo.svg`，三个纯色：`#F5F5F5` 背景、`#202020` 账本、`#0885FA` 点缀。没有渐变、纹理、阴影或拟物材质。`node scripts/generate-icons.cjs` 使用当前依赖链里的 sharp 生成 PNG 与 ICO；Apple 图标 180×180，PWA 图标 64/192/512，maskable 512，favicon 32。重要形状预留主屏幕圆角/遮罩空间，图标为不透明背景。

制作模式：内置 imagegen 构思与 2D 变体，再用 SVG 纯色路径定稿，保证所有尺寸的颜色与边缘可维护。最终 SVG 与 PNG 放在 `public/`，没有引用 Codex 默认生成目录中的文件。概念参考保存在本机忽略目录 `.superpowers/logo-flat-concept.png`。

2D 变体的完整提示词：

> Edit the reference into a completely flat 2D solid-color app logo for 记账本. Preserve only the broad idea of a compact centered ledger/wallet with two entry lines and one small blue accent. Redraw as a clean modern vector-like silhouette with smooth geometric curves: graphite black ledger shape, white short entry lines, one small #0885FA blue closure tab. Opaque single solid light-gray #F5F5F5 background filling the entire square. Absolutely flat fills, absolutely NO gradients, NO shadows, NO highlights, NO bevels, NO metallic material, NO leather texture, NO glass, NO depth, NO perspective, NO photorealism, NO coin/currency symbols/text/watermark. One centered symbol, crisp edges, meaningful elements safely within central 65% region. It must look like a restrained premium 2D icon with solid black white gray and a single electric-blue accent, recognizable at very small home-screen sizes.

更新图标后重新构建并重启。Apple 图标链接版本参数在 `index.html`；旧主屏幕入口仍有缓存时从 Safari 重新添加即可，账目保存在服务器不会因移除入口而删除。
