#!/bin/bash
# 构建 Windows 绿色包：dist/windows/ 目录 + dist/ContestPublisher-windows-x64.zip
# 可以在 macOS 上交叉编译（bun --compile --target=bun-windows-x64），也可以在 Windows 上直接跑。
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(node -p "require('./package.json').version")"
OUT="dist/windows"
STAGE="dist/.stage-windows"
ZIP="dist/ContestPublisher-windows-x64.zip"

# 内置 ICT Skill：仓库里自带一份，本地工作区则通常与 contest-publisher 并排。
# 工作区里与 contest-publisher 并排的那份是权威副本（随 ICT Skill 升级维护）；
# 仓库内自带的是给全新 clone 兜底的快照。
SKILL_SRC="$(pwd)/../huawei-cloud-publish-ict-work"
[ -d "$SKILL_SRC" ] || SKILL_SRC="$(pwd)/huawei-cloud-publish-ict-work"

COMMON_META=()
# bun 只允许在 Windows 上编译时写版本/厂商/描述这些 PE 元数据；在 macOS 上交叉编译只能带图标。
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) COMMON_META=(
    --windows-title "Contest Publisher"
    --windows-version "${VERSION}.0"
    --windows-description "Audit, prepare, verify, publish and submit code-only competition workspaces."
  ) ;;
esac

mkdir -p dist
rm -rf "$STAGE" "$OUT" "$ZIP"
mkdir -p "$STAGE/assets"

echo "==> [1/6] 生成 Windows 图标 (assets/icon.ico)"
node scripts/make-ico.mjs

echo "==> [2/6] 编译控制台版可执行文件 (命令行入口)"
bun build bin/contest-publisher.mjs --compile --target=bun-windows-x64 \
  --outfile "$STAGE/contest-publisher-windows-x64.exe" "${COMMON_META[@]+"${COMMON_META[@]}"}"

echo "==> [3/6] 编译窗口版可执行文件 (双击即用，不弹黑框)"
bun build bin/contest-publisher.mjs --compile --target=bun-windows-x64 \
  --outfile "$STAGE/Contest Publisher.exe" --windows-hide-console \
  "${COMMON_META[@]+"${COMMON_META[@]}"}"

# 交叉编译时 bun 不接受 --windows-icon（和 --windows-hide-console 不能同时给），
# 所以图标与版本信息在编译后就地写进 .rsrc（见 scripts/patch-exe-resources.mjs），
# 再逐段核对：除 .rsrc 数据外，PE 头与其它段必须一字未改。
echo "==> [3b/6] 就地写入图标/版本信息，并逐段核对哈希"
for exe in "$STAGE/contest-publisher-windows-x64.exe" "$STAGE/Contest Publisher.exe"; do
  cp "$exe" "$exe.orig"
  node scripts/patch-exe-resources.mjs "$exe" --ico assets/icon.ico --version "$VERSION" \
    --description "Audit, prepare, verify, publish and submit code-only competition workspaces."
  node scripts/patch-exe-resources.mjs "$exe" --verify
  node scripts/inspect-exe.mjs "$exe"
  node scripts/inspect-exe.mjs "$exe" --compare "$exe.orig"
  rm -f "$exe.orig"
done

echo "==> [4/6] 复制资源与内置 Skill"
cp assets/icon.png assets/icon.svg assets/icon-mark.png assets/icon.ico "$STAGE/assets/"
if [ -d "$SKILL_SRC" ]; then
  cp -R "$SKILL_SRC" "$STAGE/huawei-cloud-publish-ict-work"
else
  echo "  警告：未找到 huawei-cloud-publish-ict-work，ICT 提交步骤将不可用"
fi

echo "==> [5/6] 写使用说明"
# Windows 记事本用 CRLF，避免老版本记事本把整段读成一行。
sed 's/$/\r/' > "$STAGE/使用说明.txt" <<TXT
Contest Publisher $VERSION · Windows 绿色版
==========================================

怎么用
  双击「Contest Publisher.exe」→ 打开工作台窗口（Edge / Chrome 的应用窗口，没有地址栏）。
  关掉那个窗口 = 退出软件。若系统里没有 Edge / Chrome，会用默认浏览器打开，
  这时用界面右上角的「退出软件」按钮结束进程。

  命令行用法（可选）：
    contest-publisher-windows-x64.exe --help
    contest-publisher-windows-x64.exe ui --port 8787

运行环境
  - Windows 10 1809 及以上（64 位）
  - 需要安装 Git for Windows：https://git-scm.com/download/win
    安装时保持默认的「Git from the command line」，提交流水线要用它 clone / commit / push。
  - 可选：KooCLI（hcloud）用于自动生成 STS 凭证；不装也可以手动填 STS 凭证文件路径。
  - ICT 提交脚本需要 node 或内置 Bun 运行：装了 node 就用 node，没装则自动用内置 Bun。

首次运行
  这个 exe 没有代码签名，Windows SmartScreen 可能提示「已保护你的电脑」：
  点「更多信息」→「仍要运行」即可。

数据放在哪
  - 运行根目录（默认）：%USERPROFILE%\contest-publisher-runs
  - 本地仓库目录（放要提交的代码包）：%USERPROFILE%\contest-publisher-sources
  - 启动器日志：%LOCALAPPDATA%\Contest Publisher\launcher.log

不要动的东西
  assets\ 与 huawei-cloud-publish-ict-work\ 要和 exe 放在一起，删了或挪走工作台会缺资源 / 缺 ICT Skill。
TXT

echo "==> [6/6] 打包 zip"
mv "$STAGE" "$OUT"
if command -v zip >/dev/null 2>&1; then
  (cd "$OUT" && zip -q -r "../$(basename "$ZIP")" .)
else
  ditto -c -k --sequesterRsrc "$OUT" "$ZIP"
fi
echo "构建完成: $(pwd)/$ZIP"
ls -lh "$ZIP" | awk '{print "  大小:", $5}'
