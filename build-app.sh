#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(node -p "require('./package.json').version")"
CLI="dist/contest-publisher-macos-arm64"
ZIP="dist/ContestPublisher-macos-arm64.zip"

mkdir -p build dist

echo '==> [1/5] 编译后端服务 (bun --compile)'
bun build bin/contest-publisher.mjs --compile --outfile build/server

echo '==> [2/5] 编译命令行版 (同一个入口，带 UI 工作台)'
bun build bin/contest-publisher.mjs --compile --outfile "$CLI"

echo '==> [3/5] 编译原生壳 (swiftc)'
swiftc -O native/main.swift -o build/ContestPublisherShell -framework AppKit -framework WebKit

echo '==> [4/5] 组装 .app 包（先装进临时目录，避免给正在运行的包签名）'
APP="dist/Contest Publisher.app"
STAGE="dist/.stage-contest-publisher.app"
rm -rf "$STAGE"
APP="$STAGE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp build/ContestPublisherShell "$APP/Contents/MacOS/Contest Publisher"
cp build/server "$APP/Contents/Resources/server"
[ -d assets ] && ditto --noextattr --norsrc assets "$APP/Contents/Resources/assets" || true
# 应用图标：CFBundleIconFile 指向 Resources 根下的 .icns
if [ -f assets/AppIcon.icns ]; then cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"; fi
# 内置 ICT Skill：仓库里自带一份，本地工作区则通常与 contest-publisher 并排。
# 工作区里与 contest-publisher 并排的那份是权威副本（随 ICT Skill 升级维护）；
# 仓库内自带的是给全新 clone 兜底的快照。
SKILL_SRC="$(pwd)/../huawei-cloud-publish-ict-work"
[ -d "$SKILL_SRC" ] || SKILL_SRC="$(pwd)/huawei-cloud-publish-ict-work"
if [ -d "$SKILL_SRC" ]; then
  rm -rf "$APP/Contents/Resources/huawei-cloud-publish-ict-work"
  ditto --noextattr --norsrc "$SKILL_SRC" "$APP/Contents/Resources/huawei-cloud-publish-ict-work"
else
  echo "  警告：未找到 huawei-cloud-publish-ict-work，ICT 提交步骤将不可用"
fi
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Contest Publisher</string>
    <key>CFBundleDisplayName</key><string>Contest Publisher</string>
    <key>CFBundleIdentifier</key><string>local.contest-publisher.app</string>
    <key>CFBundleExecutable</key><string>Contest Publisher</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleIconName</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${VERSION}</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
</dict>
</plist>
PLIST

echo '==> [5/5] 清理扩展属性后 Ad-hoc 签名 + 打包 zip'
# macOS 15+ 会给拷进来的文件加 com.apple.provenance，.DS_Store 也会混进来；
# 带着这些 detritus 签名会失败并留下 "code has no resources" 的半成品签名。
# 另外：正在运行的 .app 无法重新签名，所以先签临时目录，再原子替换。
# macOS 会在读文件时重新加 com.apple.provenance，签名与加属性之间有竞态，所以重试几次。
signed=0
for attempt in 1 2 3 4 5; do
  find "$APP" -name '.DS_Store' -delete
  xattr -cr "$APP"
  if codesign --force --deep --sign - "$APP" 2>/tmp/contest-publisher-codesign.err; then signed=1; break; fi
  echo "  签名第 ${attempt} 次失败，清理后重试：$(tail -1 /tmp/contest-publisher-codesign.err)"
  sleep 1
done
if [ "$signed" != "1" ]; then
  echo '签名失败：'; cat /tmp/contest-publisher-codesign.err; exit 1
fi
xattr -cr "$APP"
codesign -v --deep "$APP" && echo '签名校验通过'
echo '==> 替换正式包'
rm -rf "dist/Contest Publisher.app"
mv "$STAGE" "dist/Contest Publisher.app"

# 发布包：.app 与命令行版一起打 zip。必须用 ditto（保留符号链接、可执行位与签名），
# 不能用 zip 的默认行为，否则解压后签名失效、双击打不开。
echo '==> 打包 zip'
PKG="dist/.stage-macos"
rm -rf "$PKG"
mkdir -p "$PKG"
ditto --noextattr --norsrc "dist/Contest Publisher.app" "$PKG/Contest Publisher.app"
cp "$CLI" "$PKG/contest-publisher-macos-arm64"
# 命令行版从可执行文件同目录找内置 Skill，所以发布包里再放一份（272KB），
# 这样 .app 和命令行版都能独立运行，不需要用户另外准备 Skill 目录。
if [ -d "$SKILL_SRC" ]; then
  ditto --noextattr --norsrc "$SKILL_SRC" "$PKG/huawei-cloud-publish-ict-work"
fi
sed 's/$/\r/' > "$PKG/使用说明.txt" <<TXT
Contest Publisher $VERSION · macOS (Apple Silicon)
================================================

怎么用
  双击「Contest Publisher.app」即可打开工作台窗口。
  命令行版（可选）：./contest-publisher-macos-arm64 --help

首次打开
  应用是本地 ad-hoc 签名的，从浏览器下载后 macOS 会拦一次：
  右键点 App →「打开」→「打开」；或者执行
    xattr -dr com.apple.quarantine "/Applications/Contest Publisher.app"

运行环境
  - macOS 13 及以上（Apple Silicon）
  - 需要 git（系统自带，或 xcode-select --install）
  - 可选：KooCLI（hcloud）用于自动生成 STS 凭证
  - ICT 提交脚本需要 node：装了就用 node，没装则自动用应用内置的 Bun

数据放在哪
  - 运行根目录（默认）：~/contest-publisher-runs
  - 本地仓库目录（放要提交的代码包）：~/contest-publisher-sources
TXT
rm -f "$ZIP"
ditto -c -k --sequesterRsrc "$PKG" "$ZIP"
rm -rf "$PKG"
echo "构建完成: $(pwd)/dist/Contest Publisher.app"
echo "发布包:   $(pwd)/$ZIP ($(du -h "$ZIP" | cut -f1))"
