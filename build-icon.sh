#!/bin/bash
# 从 assets/icon-1024.png 重新生成 assets/AppIcon.icns（图标源文件是 assets/icon.svg）。
# 修改图标后：先用任意方式把 icon.svg 栅格化成 1024×1024 的 icon-1024.png，再跑本脚本。
set -euo pipefail
cd "$(dirname "$0")"

SRC="assets/icon-1024.png"
[ -f "$SRC" ] || { echo "缺少 $SRC（请先把 assets/icon.svg 渲染成 1024×1024 PNG）"; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/AppIcon.iconset"
while read -r size name; do
  sips -z "$size" "$size" "$SRC" --out "$STAGE/AppIcon.iconset/$name.png" >/dev/null
done <<'SPEC'
16 icon_16x16
32 icon_16x16@2x
32 icon_32x32
64 icon_32x32@2x
128 icon_128x128
256 icon_128x128@2x
256 icon_256x256
512 icon_256x256@2x
512 icon_512x512
1024 icon_512x512@2x
SPEC

iconutil -c icns "$STAGE/AppIcon.iconset" -o assets/AppIcon.icns
sips -z 256 256 "$SRC" --out assets/icon.png >/dev/null
# 界面里用的方形标记：裁掉 macOS 安全区的透明边距（824×824 居中）
sips -c 824 824 "$SRC" --out "$STAGE/mark.png" >/dev/null
sips -z 256 256 "$STAGE/mark.png" --out assets/icon-mark.png >/dev/null
echo "已生成 assets/AppIcon.icns、assets/icon.png、assets/icon-mark.png"
