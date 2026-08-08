# App 图标资源

打包时嵌进应用包的图标。目录名 `build/` 是 electron-builder 的默认 `buildResources`，
它会自动认领 `icon.icns`（macOS）、`icon.ico`（Windows）与 `icon.png`（Linux），
无需在 `../electron-builder.yml` 里逐平台写 icon 路径。

**只在打包产物上生效**：`npm run release:win` / `release:mac` / `release:linux` 出来的
安装包与可执行文件会带上图标；`npm run dev` 跑的是 node_modules 里的 Electron 可执行文件，
Windows / Linux 任务栏顶的仍是 Electron 默认图标（macOS 例外，见下表 `icon.png` 一行）。

| 文件 | 用途 |
| --- | --- |
| `app-icon.png` | 设计源图，1254×1254。改图标只改这个，其余三个由下面的命令重新生成 |
| `icon.png` | 1024×1024 母版。dev 期 `src/main/appIcon.ts` 拿它设 Dock 图标；Linux 打包也取它 |
| `icon.icns` | macOS 应用包图标 |
| `icon.ico` | Windows exe 图标 |

## 重新生成

需要 ImageMagick（`brew install imagemagick`）与 macOS 自带的 `sips` / `iconutil`。
在本目录下执行：

```bash
# 1) 母版：裁掉透明边 → 等比缩到 824 → 居中放进 1024 透明画布
#    824/1024 是 macOS 的图标安全区，留白约 10%，Dock 里才和其他 App 一样大
magick app-icon.png -trim +repage -resize 824x824 \
  -background none -gravity center -extent 1024x1024 \
  -define png:color-type=6 icon.png

# 2) icns
rm -rf icon.iconset && mkdir icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s icon.png --out "icon.iconset/icon_${s}x${s}.png"
  sips -z $((s*2)) $((s*2)) icon.png --out "icon.iconset/icon_${s}x${s}@2x.png"
done
iconutil -c icns icon.iconset -o icon.icns && rm -rf icon.iconset

# 3) ico
magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```
