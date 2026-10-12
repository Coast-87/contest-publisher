<div align="center">

<img src="assets/icon.png" width="116" alt="Contest Publisher" />

# Contest Publisher

**把代码变成可提交的作品。**

一个纯本地工作台：拉取源仓库 → 审计脱敏 → 生成纯代码副本 → 验证原创增量 → 建公开仓库 → 推送 → 锁定赛题 → 提交。
中间每一步都留证据，需要写出去的操作默认只生成计划、逐步确认。

[![Release](https://img.shields.io/github/v/release/Coast-87/contest-publisher?label=release&color=e891b4)](https://github.com/Coast-87/contest-publisher/releases)
[![Downloads](https://img.shields.io/github/downloads/Coast-87/contest-publisher/total?color=e9a83f)](https://github.com/Coast-87/contest-publisher/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-9d8ef0)](#下载与安装)
[![Tests](https://img.shields.io/badge/tests-87%20passing-7dd8c3)](#测试)
[![Node](https://img.shields.io/badge/node-%3E%3D22-7dd8c3?logo=nodedotjs&logoColor=white)](#从源码构建)
[![Bun](https://img.shields.io/badge/build-bun-black?logo=bun&logoColor=white)](#从源码构建)
![Skill](https://img.shields.io/badge/skill-2026.10.09.001-e891b4)

<img src="assets/screenshot-workbench.png" width="900" alt="工作台：左侧运行列表，中间七个阶段，右侧赛题与仓库配置" />

<sub>本地工作台：七个阶段（获取 → 审计 → 副本 → 验证 → 仓库 → 赛题 → 提交），左侧是运行实例列表，所有状态与证据都落在运行根目录。</sub>

</div>

## 目录

- [下载与安装](#下载与安装) · [快速开始](#快速开始) · [它能做什么](#它能做什么)
- [跨平台实现](#跨平台实现) · [从源码构建](#从源码构建) · [测试](#测试)
- [设计原则](#设计原则) · [命令行](#cli-命令行) · [架构](#软件架构)

## 下载与安装

发布包在 [Releases](https://github.com/Coast-87/contest-publisher/releases) 里，macOS 与 Windows 各一个绿色包，外加源码包：

| 平台 | 包 | 怎么用 |
|---|---|---|
| macOS（Apple Silicon） | `ContestPublisher-macos-arm64.zip` | 解压后双击 `Contest Publisher.app`。系统要求 macOS 13+ |
| Windows（64 位） | `ContestPublisher-windows-x64.zip` | 解压后双击 `Contest Publisher.exe`。系统要求 Windows 10 1809+ |
| 任意平台（源码） | `contest-publisher-source-<版本>.zip` | 需要 Node 22+ 与 [Bun](https://bun.sh) 自行构建，见下方「从源码构建」 |

解压后先看包里的 `README-Windows.txt` / `README-macOS.txt`（中文说明，文件名用 ASCII 免得 Windows 解压器乱码）。两个绿色包都是**解压即用**：不用装 Node，不用装运行时，内置 ICT Skill（`huawei-cloud-publish-ict-work`）和界面资源都在包里。

**首次运行会被系统拦一次**（包没有代码签名，是本地构建的）：

- macOS：右键点 App →「打开」；或 `xattr -dr com.apple.quarantine "/Applications/Contest Publisher.app"`。
- Windows：SmartScreen 提示「已保护你的电脑」→「更多信息」→「仍要运行」。

**还需要的外部依赖**（软件启动后可用顶部 ⚙ 环境自检确认）：

| 依赖 | 必要性 | 说明 |
|---|---|---|
| Git | **必需** | macOS 自带；Windows 装 [Git for Windows](https://git-scm.com/download/win)，安装时保持默认的「Git from the command line」 |
| Node.js | 可选 | 只影响 ICT Skill 脚本用哪个运行时：装了就用它，没装自动回退到应用内置的 Bun |
| KooCLI（hcloud） | 可选 | 装了可以自动生成 STS 凭证；不装就手动填已有的 STS 凭证文件路径 |

数据落点（两个平台一致，都可用环境变量覆盖）：运行根目录 `~/contest-publisher-runs`（Windows 为 `%USERPROFILE%\contest-publisher-runs`）、本地代码包目录 `~/contest-publisher-sources`、启动器日志 `~/Library/Logs/Contest Publisher/launcher.log`（Windows 为 `%LOCALAPPDATA%\Contest Publisher\launcher.log`）。

## 快速开始

```text
1. 打开软件 → 01 面板填源仓库 HTTPS 地址（或选「本地仓库」从 ~/contest-publisher-sources 下拉选取）
2. 「⚡ 一键自动」  审计 → 处理可脱敏/排除的发现 → 生成纯代码副本 → 验证
3. 03 面板写代码 / 加文件 → 「运行验证」（原创增量门禁；纯搬运的包可用「搬运模式」豁免）
4. ⚙ 配置 填 GitCode Token 与 STS 凭证 → 「🚀 一键推送」建公开仓库、初始化、推送、锁定赛题
5. 05 面板「生成提交计划」确认参数 → 「执行提交」；之后用「查询判题结果」看判题与失败原因
```

## 它能做什么

| 能力 | 说明 |
|---|---|
| 🔒 源仓库只读 | 拉取即固定 commit，`source/` 永不修改，所有改动发生在独立的 `work/` 副本里 |
| 🧭 白名单式纯代码副本 | 只保留代码 + 项目文档 + 构建元数据 + 许可证/归属文件；报告、看板等交付物可用「保留路径」显式放行 |
| 🕵️ 审计与脱敏 | 凭证硬阻断（不可通过 review 豁免）、个人信息与本机路径可替换或排除、许可证与归属信息保留 |
| 🔍 逐行对比原仓库 | 区分「上游内容 / 工具生成 / 工具脱敏改写 / 你自己的改动」，也列出按策略没进副本的文件 |
| ✅ 验证门禁 | 凭证、语法、文件白名单、原创代码增量四道检查，任何一项不过就不让推送 |
| 🚀 一键推送 | 建 GitCode 公开仓库 → 确保公开 → 初始化 → 推送 → 锁定赛题 → 生成提交计划，6 步带实时进度 |
| 🎯 目标始终可见 | 标题下常驻显示目标赛题与目标仓库名，推送前用确认框再对一次，避免提交错题 |
| 🧾 证据留痕 | 每次运行一个目录，审计、验证、推送、提交的参数与结果都写成 JSON 证据，可回看可追溯 |
| 🖥 两个平台同源 | 一份源码出 macOS `.app` 与 Windows 绿色包；平台差异集中在两个文件里，见[跨平台实现](#跨平台实现) |

> 关于内置的 ICT Skill：仓库里 `huawei-cloud-publish-ict-work/` 是该 Skill 的随包快照（当前版本 `2026.10.09.001`，取自上游公开仓库 `https://gitcode.com/Lingxi-HandsOn/gallery.git` 的 `skills/huawei-cloud-publish-ict-work`，含 4 处本地差异：STS 900s 自动刷新、自包含的 troubleshooting 链接等）。它是应用运行提交步骤必需的外部适配器，不参与本项目的业务逻辑，也不含任何凭证。本地开发时与 `contest-publisher/` 并排的那一份是权威副本，构建脚本优先用它。

## UI 工作台

直接运行编译后的软件即可启动完整 UI 软件：

```bash
./dist/contest-publisher-macos-arm64
```

软件会启动本地工作台并打开浏览器。也可以手动启动：

```bash
./dist/contest-publisher-macos-arm64 ui --port 8787
```

UI 已覆盖完整流程：

```text
获取源仓库（Git 链接 或 本地仓库下拉选取）
  → 执行审计
  → 处理审计发现
  → 生成纯代码副本（可保留报告/看板等交付物）
  → 验证原创增量
  → 创建 GitCode 公开仓库
  → 确保仓库公开（平台要求所有人可见）
  → 初始化本地仓库
  → 上传代码
  → 查询并锁定 ICT 赛题
  → 生成提交计划
  → 执行作品提交
```

> **仓库必须公开**：ICT 平台只接受所有人可见的作品仓库，私有仓库会在判题前被拒（`GALLERY.PARAM.INVALID：代码仓库不可公开访问`）。因此建仓默认就是公开，一键推送里另有一步幂等的「确保仓库公开」——老 run 或手工建的私有仓库会被自动改成公开，无需去 GitCode 网站手动改。

界面同时提供：

- 左侧运行实例列表（每项右侧 🗑 可直接删除该运行）
- 运行根目录自动填写并记住：改一次后每次拉取都沿用，重启软件也保留
- 顶部流程状态条，以及一行实时提示两个"一键"按钮的可用条件与下一步
- 审计统计和发现处理弹窗（已有决定的发现不再重复列出）
- 许可证和赛题规则确认框
- 工作副本验证结果
- GitCode 仓库创建、初始化和推送
- ICT Skill 目录、STS 凭证、赛题选择
- 提交计划和异步提交结果
- 工作副本代码编辑器：按 `path · kind` 选择文件、打开、保存、新建代码文件
- 当前运行证据 JSON 查看

> 工作台里的确认框、名称输入框、文件路径输入框都是**页面内自绘弹窗**，不依赖宿主 `window.confirm` / `window.prompt`。macOS 原生壳的 `WKWebView` 在没有 `uiDelegate` 时会直接让 `confirm` 返回 false、`prompt` 返回 null，按钮就表现为"点了没反应"；现在删除、生成副本、新建文件、一键推送、执行提交、清除配置都走自绘弹窗，且原生壳也补上了 `WKUIDelegate` 作为兜底。

### 两个"一键"按钮什么时候能点

按钮不是随手就能点，也不是点了没反应：标题下方那行提示会实时写明条件和下一步，鼠标悬停按钮也有同样说明。

| 按钮 | 可用条件 | 不能点时的下一步 |
|---|---|---|
| ⚡ 一键自动 | 已拉取源仓库（有 `source`），且当前运行**还没有工作副本**（`ACQUIRED` / `AUDITED` / `REVIEW_REQUIRED` / `BLOCKED_AUDIT`） | 已有副本时说明"改 03 面板代码/贡献记录后点运行验证"；已提交则建议新建运行 |
| 🚀 一键推送 | 03 面板"运行验证"**passed**（`VERIFIED` 及以后阶段） | `ACQUIRED`/`AUDITED` → 先跑一键自动；`PREPARED` → 补齐原创代码与 CONTRIBUTIONS.md 后运行验证；`BLOCKED_*` → 按证据面板里的 finding 修复后重跑验证；缺配置 → 直接打开 ⚙ 配置 |

一键自动 / 一键推送的分步日志会保留在"运行证据"面板顶部（刷新状态后不会被状态 JSON 覆盖），便于回看每一步做了什么。

**一键推送的进度提示**：推送共 6 步（验证 → 建仓 → 初始化 → 推送 → 锁赛题 → 提交计划/提交），进行中按钮会实时显示 `⏳ 推送中 3/6 · 推送代码到 GitCode…` 这样的当前进度，标题下的提示行和"运行证据"面板同步滚动每个步骤的开始/完成/失败；失败时停在对应步骤并给出原因，不重试、不静默跳过。

### 本地代码包默认按「搬运模式」发布

本地代码包就是作者自己的成品，没有"相对上游的原创增量"可言——严格模式必然卡在验证。所以**从本地仓库创建的运行默认就是搬运模式**（豁免增量门禁并留痕 `evidence/run-mode.json`），一键自动即可一次通过；需要严格模式可在 03 面板勾掉。

配套的三处口径统一（都是"扫描报了却没法处理"造成的死路）：

| 情况 | 处理 |
|---|---|
| 含疑似凭证的文件（含测试夹具里的 `test-password` / `secret-value` 这类假值会被识别为占位，不误报） | 唯一合法处置是**排除该文件**；一键自动会做这件事并在日志里列出，凭证绝不进入提交内容 |
| `example.com` 及其子域、`.invalid` 邮箱 | 按 RFC 2606 占位地址处理（与脱敏口径一致），既不报也不改 |
| 电话号码样式数字串 | 扫描与脱敏共用同一规则：脱敏为 `[REDACTED_PHONE]`，副本因此能通过验证 |
| `tsconfig.json` 这类带注释/尾逗号的 JSONC | 容忍注释与尾逗号，不再误判为非法 JSON |

另外 **IaC / 部署清单也算源代码**（`.tf` `.tfvars` `.hcl` `.yaml` `.yml` `.toml`）——否则 Terraform / k8s 类赛题包会被复制成空的。

### 初始化仓库只做提示，不做门禁

`git diff --check` 的**行尾空白告警不再阻断流程**（源文件里有尾空格极常见，为此卡死整条提交没有道理）：初始化照常完成，告警清单记进 `evidence/repository-init.json` 并在推送日志里以「N 处行尾空白告警，仅提示不影响推送」显示。

### 运行列表：折叠 · 筛选 · 一键清除

左侧「运行」栏在三处做了顺手化：

- **按项目名展示与筛选**：每行显示代码包名（或仓库名）+ 阶段，颜色点对应状态（绿=已通过验证/已提交，黄=待复核，红=被阻断）；搜索框按项目名或阶段即时过滤——80 个运行里找某个包一秒定位。
- **折叠**：点标题行收起/展开（状态记忆在浏览器，重启软件仍保留）。
- **🧹 一键清除**：删掉全部运行实例。**与单条删除同一套护栏**：含未推送工作副本的运行默认被跳过，弹窗会列出它们并要求二次确认后才强制删除；删除项会跳过 `.sts` 等非运行目录。

> 界面另做了一轮排版整理：图标统一为矢量（不再用 emoji 当图标）、间距/字号/圆角/阴影收敛到统一尺度、正文对比度提到 4.6:1 以上、粘性头部改为实底毛玻璃（滚动时不再压住内容）。配色与整体风格保持不变。

### 两种取源方式：Git 链接 / 本地仓库（放代码包，下拉选取）

不想翻仓库链接、或者想把软件直接给别人用时，用**本地仓库**：软件首次运行会自动建一个代码包目录（默认 `~/contest-publisher-sources`，可在 ⚙ 配置 改），并在里面留一份说明。

1. 01 面板选「**本地仓库（放代码包，下拉选取）**」→ 点「打开文件夹」；
2. 把 GitHub 下载的代码包丢进去——**文件夹**（解压出来的 `repo-main` 整个拷进来）或 **Download ZIP 原样放**都行；
3. 回到软件点「刷新列表」，下拉选取，点「用本地代码包创建运行」。zip 会自动解压，只有一层顶层目录时自动展平。

取源之后流程完全一样：本地源会被冻结成只读 git 快照（`source/` 单提交），审计、脱敏、对比原仓库、验证、推送、提交都走同一条链路；仓库名默认跟随代码包名（`My-Project-main` → `My-Project`）。目录路径也可用环境变量 `CONTEST_PUBLISHER_SOURCES` 指定，便于分发给别人时固定位置。

### 判题闭环：让交付物进得去、让失败原因看得见

判题由平台异步进行（判题 agent 拉取你的仓库地址后评审），判定依据是**仓库里实际存在的内容**——README 里描述"已生成日报和看板"不算证据，文件必须真的在仓库里。工具围绕这一点做了三件事：

1. **保留路径（交付物）**：报告/看板等默认被当作运行产物排除，但赛题验收要的往往正是它们。在 ⚙ 配置 的「额外保留的源路径」里按行填目录（如 `reports`、`dashboard`），或在 🔍 对比原仓库 的排除清单里点「保留」，重新准备后这些文件就会进入副本；文本仍自动脱敏个人信息/本机路径，**密钥照旧硬阻断**。
2. **🔎 查询判题结果**：05 面板按钮，随时取回 `judgeStatus` 与失败原因（`failureReason`），面板顶部横幅常驻显示——这是"为什么没通过"的权威来源。每题 **3 次提交机会**（判题通过即终态、作品公开；失败可重提）。
3. **已有仓库再推送**：目标仓库已有历史（例如上一次提交占用的仓库）时，推送前先取回远端历史，把新副本叠成一个新提交再推，不再以 non-fast-forward 失败。

### 应用图标

图标源文件是 `assets/icon.svg`（1024×1024，macOS 安全区 824×824 圆角方块，配色与界面同一套粉紫渐变，意象是"作品装盒向上提交"）。构建产物一并入库：

| 文件 | 用途 |
|---|---|
| `assets/AppIcon.icns` | .app 的 Dock/Finder 图标（`CFBundleIconFile=AppIcon`，由 `build-app.sh` 拷进 `Contents/Resources/`） |
| `assets/icon.png`（256） | 网页 favicon / apple-touch-icon |
| `assets/icon-mark.png`（256，裁掉安全区留白） | 工作台左上角品牌标记 |
| `assets/icon-1024.png` | 母版位图，改图标时的起点 |

改图标：编辑 `assets/icon.svg` → 渲染成 `assets/icon-1024.png` → 跑 `./build-icon.sh`（自动生成 icns 与两张 PNG）→ `./build-app.sh` 重新打包。

### 提交的是哪道题、推到哪个仓库：始终可见、必须确认

以前只有配置里的一个"赛题序号"，看不到平台上有哪些赛题，提交完也不知道锁定了哪道。现在：

- **📋 赛题列表**（顶部按钮，⚙ 配置里赛题序号旁的「📋 选择」同款）：实时从平台拉取当前全部 AI 赛题，列出**序号、名称、窗口、状态**，点一行即设为本次目标；选中项高亮，当前目标写在列表顶部。
- **常驻目标行**：标题下方固定显示 `🎯 目标赛题：3「Git-代码时光机…」　|　📦 目标仓库：github-trending-scheduler`；赛题锁定后改为 `🎯 已锁定赛题：3「…」（problemId …）`，04/05 面板的徽标也会显示赛题名。
- **推送前确认**：点 🚀 一键推送，确认框会先拉一次列表、把**目标赛题名称与目标仓库名**明确列出来再让你点"开始"；列表拉取失败（如凭证缺失）不拦截，只提示名称以"锁定赛题"步骤为准。手动改赛题序号会清掉旧的赛题名，避免确认框显示错题。

**仓库名自动跟随源仓库**：`作品 / 仓库名称` 留空时，目标仓库名取自源仓库地址（拉取 `https://gitcode.com/aoligei11172/github-trending-scheduler.git` → 建 `github-trending-scheduler`），不再一律落到 `contest-project`。命令行 `create-repo` 留空名称时同样走这条回退链。

### 我到底改了什么：对比原仓库

`verify` 只告诉你"有没有原创增量"（哪些文件 added/modified）。要看**改了哪几行、哪些改动其实是工具做的**，用 03 面板的「🔍 对比原仓库」或命令行：

```bash
node bin/contest-publisher.mjs diff --run runs/<run-id>            # 逐行 unified diff
node bin/contest-publisher.mjs diff --run runs/<run-id> --stat     # 只看清单与行数
node bin/contest-publisher.mjs diff --run runs/<run-id> --path src/main.js
node bin/contest-publisher.mjs diff --run runs/<run-id> --json
```

对比的是固定 commit 的 `source/` 与 `work/`，每个文件给出四件事：

| 信息 | 含义 |
|---|---|
| 状态 | **新增** / **修改** / **删除**（prepare 复制过但 work 里被删）/ 未变 |
| 来源 | `upstream`（从源复制）/ `generated`（README、UPSTREAM、CONTRIBUTIONS、.gitignore、manifest）/ `author`（你自己新建） |
| 工具脱敏改写 | prepare 把邮箱替换成 `maintainer@example.invalid`、把 `/Users/xxx` 换成 `${PROJECT_ROOT}` 这类改动，**不是你写的** |
| 你的改动 | work 内容与 prepare 出来的基线不同 → 这才是你的原创部分 |

同时列出**按策略没进 `work/` 的源文件**（上游 README、`docs/`、`reports/` 等），所以"原仓库有什么没跟过来"也是可见的。

示例输出（`--stat`）：

```text
对比原仓库 (source@d0dd1f61b33d) → work
  新增 5 · 修改 2 · 删除 0 · 未变 1（工具生成 5，工具脱敏改写 0，你改动 2）
  行数：+54 -6

修改	index.html	+3 -0	[你的改动]
新增	src-extra.js	+1 -0	[你的改动]
新增	CONTRIBUTIONS.md	+17 -0	[工具生成]
修改	README.md	+4 -6	[工具生成]
未进入 work/ 的源文件（按策略排除）：
  README.md	exclude	replace with transparent generated README
```

实现细节：自带行级 diff（公共前后缀裁剪 + LCS），不调用外部 `diff`；单文件超过 1 MiB 或差异超 1500 行时降级为"仅统计行数"，避免界面卡住。

### 保留什么、排除什么

工作副本保留 **代码 + 项目文档**，只排除运行产物和敏感内容：

| 保留 | 说明 |
|---|---|
| 代码 | `.c .cc .cpp .cs .css .go .graphql .h .hpp .html .java .js .jsx .kt .mjs .php .py .rb .rs .scss .sql .svelte .ts .tsx .vue .wasm .sh .bash .zsh` |
| 项目文档 | `.md .markdown .rst .txt .adoc`，以及 `README` / `CHANGELOG` / `CONTRIBUTING` / `AUTHORS` / `INSTALL` / `USAGE` / `MANUAL` / `NOTES` 这类无扩展名文档 |
| 上游 README | **原样保留**（它才是"这是什么项目"的第一份说明）；只有源仓库完全没有 README 时，工具才写自己的透明说明 |
| 构建元数据 | `package.json`、`Dockerfile`、`go.mod`、`tsconfig.json`、`.gitignore` 等 |
| 归属文件 | `LICENSE` / `NOTICE` / `COPYING` / `THIRD-PARTY*`，永远原样保留 |

| 排除 | 原因 |
|---|---|
| `reports/ logs/ data/ dist/ build/ coverage/ cache/ tmp/ uploads/ screenshots/ node_modules/ assets/ examples/` | 运行产物、报告、依赖、素材，不是项目内容 |
| `.env*`、`config*`、`secrets*` | 可能含私有值，列为 `review` 需要人工决定，默认不复制 |
| 其它扩展名（图片、二进制、`.json` 数据等） | 不在白名单 |
| 文档里的敏感内容 | 由审计发现 + 复核决定处理：secret 一律阻断；个人信息/本机路径可"替换"（prepare 自动脱敏）或排除；文档本身不会被整体删掉 |

> 策略变更只影响**新建的 run**（`prepare` 拒绝非空工作副本）。老 run 想套用新策略要重新拉取。

### 一键：生成脚手架

```bash
node bin/contest-publisher.mjs scaffold --run runs/<run-id> [--lang js|py|sh] [--name solution] [--force]
```

- `scaffold`：按工作副本里已有的语言（或 `--lang`）生成 `solution/index.mjs` + `solution/self-test.mjs`（py/sh 同理）——参数解析、错误处理、自检骨架都在，逻辑位置留 `TODO`。它满足"原创代码增量"，但**判题会真跑赛题用例，占位实现拿不到分**。
- `CONTRIBUTIONS.md` **不是门禁，工具自己写**：验证 / 切换模式时，如果文件还是 prepare 占位或旧版本留下的措辞，工具会把**四个章节**都统一写成 `此为大赛提交所建`（与 `UPSTREAM.md` 同一句，提交树里措辞一致）。**你自己写过的内容永远不会被覆盖**，重复调用幂等；旧版本生成的 `UPSTREAM.md`（英文许可说明）也会在此时自动换成这一句。要看真实改动清单用 🔍 对比原仓库或 `diff --stat`。

工作台 03 面板对应按钮：**🧩 生成脚手架**。

### 搬运模式（copy）：直接搬运上游仓库，不重写代码

如果这个 run 的目的就是"把上游仓库搬进我自己的仓库再提交"，不需要原创代码增量，用运行模式开关显式声明：

```bash
node bin/contest-publisher.mjs mode --run runs/<run-id> --copy     # 切到搬运模式
node bin/contest-publisher.mjs mode --run runs/<run-id>            # 查看当前模式（strict / copy）
node bin/contest-publisher.mjs mode --run runs/<run-id> --strict   # 切回严格模式
```

工作台 03 面板有对应的「搬运模式」勾选与模式徽标；API 是 `POST /api/runs/:id/mode {mode}`。

| 模式 | 语义 | 原创代码增量 |
|---|---|---|
| `strict`（默认） | work/ 必须体现本人的原创代码 | 缺失 → `no-original-code-delta` **block**，建仓/推送/提交全被拦 |
| `copy` | 显式声明"本 run 是上游仓库的直接搬运" | 缺失 → `waived` **放行**，豁免理由写进 `evidence/run-mode.json` 与验证结果 |

`copy` 只放宽这一条。凭证/个人信息/本机路径、语法检查、文件白名单、文档保留**全部照旧**；`CONTRIBUTIONS.md` 与 `UPSTREAM.md` 由工具自动写成同一句 `此为大赛提交所建`，不需要任何手写。

完整搬运链路：`⚡ 一键自动`（拉取 + 脱敏准备，文档/README 保留）→ 勾选搬运模式 → `运行验证`（passed，自动写好 CONTRIBUTIONS.md）→ `🚀 一键推送`（建仓 → 初始化 → 推送 → 锁赛题 → 提交）。


> 原生壳手工装了 **App / 编辑 / 窗口** 三套菜单：macOS 的快捷键先经主菜单的 key equivalent 再进响应链，没有主菜单时 `Cmd+C/V/X/A/Z`、`Cmd+Q`、`Cmd+W`、`Cmd+M` 全都无处派发（软件内不能复制粘贴、也退不出）。现在可用：
>
> | 快捷键 | 动作 | 快捷键 | 动作 |
> |---|---|---|---|
> | `Cmd+C` | 拷贝 | `Cmd+X` | 剪切 |
> | `Cmd+V` | 粘贴 | `Cmd+A` | 全选 |
> | `Cmd+Z` / `Cmd+Shift+Z` | 撤销 / 重做 | `Cmd+Q` | 退出软件 |
> | `Cmd+W` | 关闭窗口 | `Cmd+M` | 最小化 |
>
> 验证：`CONTEST_PUBLISHER_MENU_SELFTEST=1 "dist/Contest Publisher.app/Contents/MacOS/Contest Publisher"` 会打印实际挂上的菜单与快捷键后退出。

### 审查决定（Review）与一键自动

每个发现类别只接受合法决定，写错会被直接拒绝：

| 类别 | 允许的决定 |
|---|---|
| `personal-data` / `environment-path` | 替换（sanitize）、排除文件、误报 |
| `project-identity` | 排除文件、误报、保留归属信息 |
| `license` | 已审阅许可证 |
| `repository` | 排除文件、误报 |
| 归属文件里的联系方式（LICENSE/NOTICE） | 保留归属信息（原样保留，不改写法律声明） |

`prepare` 只放行已经带决定的发现，所以"一键自动"会在日志里逐步显示它自动登记了哪些决定：许可证类记录为"已审阅许可证"并提示自行确认来源合规；归属文件里的联系方式记录为"自动保留归属信息"。剩下的唯一人工动作是在 03 面板里补上原创代码和 `CONTRIBUTIONS.md`。


### 运行根目录与删除

运行根目录（`runs/<run-id>/` 的父目录）按以下顺序解析：

```text
--runs-root 参数（如显式提供）
  → 已保存的工作区设置（~/.contest-publisher/settings.json，可用 CONTEST_PUBLISHER_HOME 改位置）
  → CONTEST_PUBLISHER_RUNS 环境变量
  → ~/contest-publisher-runs
```

工作台里的"运行根目录"输入框在打开时自动填入当前生效值，修改后立即切换并保存。

删除运行有两种方式，二者共用同一套安全护栏：

```bash
node bin/contest-publisher.mjs delete-run --run <run-id> --confirm-delete
node bin/contest-publisher.mjs delete-run --run <run-id> --force --confirm-delete
```

护栏规则：

- 只删除运行根目录内的目录，且必须像运行实例（含 `source.json` / `evidence` / `work` 之一），临时目录不会被误删。
- 工作副本已初始化但尚未推送成功时，默认拒绝删除；确认无其他副本后再加 `--force`（UI 会弹二次确认）。


## 跨平台实现

macOS 与 Windows 是同一份源码的两个构建目标，平台差异全部集中在两个文件里。

同一份源码出两个平台的包，平台差异集中在 `src/platform.mjs`（纯函数，可注入 `platform`/`env`）与 `src/launcher.mjs`（工作台窗口的启动与生命周期），其余各层不含 `process.platform` 分支。

| 关注点 | macOS | Windows |
|---|---|---|
| 工作台窗口 | `native/main.swift` 的 WKWebView 原生壳（含主菜单，Cmd+C/V/Q 可用） | 没有可编译的系统 WebView，改用 Edge / Chrome 的 `--app` 窗口：无地址栏、无标签页，外观就是一个独立软件窗口 |
| 窗口生命周期 | 关窗口 = 退出；界面里点「退出软件」会让服务退出，壳跟着退出（`terminationHandler`） | 用带独立 `--user-data-dir` 的浏览器进程当"窗口"，进程退出 = 关窗口 = 退出。找不到 Chromium 时退回默认浏览器并常驻，用界面右上角「退出软件」结束 |
| 无控制台启动 | 不适用 | `Contest Publisher.exe` 是 GUI 子系统（双击不弹黑框）；启动器日志写 `%LOCALAPPDATA%\Contest Publisher\launcher.log` |
| 打开文件/目录 | `open` | `explorer`（目录）/ `rundll32 url.dll,FileProtocolHandler`（链接），界面文案自动切成「在资源管理器中打开」 |
| PATH 探测 | `/usr/bin/which` + homebrew/nvm/volta/fnm 常见位置 | `where` + Program Files / LOCALAPPDATA / Volta / fnm / scoop / nvm-windows（`%NVM_HOME%`、`%NVM_SYMLINK%`） |
| Git 环境隔离 | `GIT_CONFIG_GLOBAL=/dev/null`、`core.hooksPath=/dev/null` | `GIT_CONFIG_GLOBAL` 指向不存在的文件、`core.hooksPath` 指向一个空目录；两个平台都强制 `core.autocrlf=false`——Git for Windows 默认开启它会把工作副本的行尾改写一遍，工作副本的字节就不再等于审计过的字节 |
| 解压本地代码包 | `ditto` → `unzip` | 系统自带 `tar`（Win10 1803+ 的 bsdtar 能读 zip）→ PowerShell `Expand-Archive` |
| STS 生成脚本 | `/usr/bin/python3` | `python` 解析顺序：`CONTEST_PUBLISHER_PYTHON` → `py` → `python` → `python3`，并用 `--version` 探活（Microsoft Store 的占位壳会返回非 0） |
| 图标/版本信息 | `build-icon.sh` 出 `.icns`，写入 `.app` | `scripts/make-ico.mjs` 出 `.ico`；交叉编译时 bun 不接受 `--windows-icon`，所以由 `scripts/patch-exe-resources.mjs` **就地**改写 `.rsrc`（见下） |

### Windows 包里的图标是怎么进去的

bun 只在「在 Windows 上编译」时才支持 `--windows-icon` / `--windows-title`，而本项目在 macOS 上交叉编译；`resedit` 这类库又要求资源段排在最后（bun 的 `.bun` 段在 `.rsrc` 之后，会直接拒绝重构）。所以这里是**原地改写**：

- `RT_ICON` 的数据换成我们的 256×256 PNG（`assets/icon.ico` 里最大的那张），剩余空间清零，长度写回目录项；
- `RT_GROUP_ICON` 重写成「1 个 256×256 / 32bpp」；
- `RT_VERSION` 换成标准 `VS_VERSION_INFO`（产品名、版本号），数据放在 `.rsrc` 里的空闲间隙，RVAs 指过去。

PE 头与其它段一个字节都不动，构建脚本会用 `scripts/inspect-exe.mjs` **逐段核对哈希**（除 `.rsrc` 外 12/13 段必须一字未改），再用 `--verify` 从产物里读回图标与版本信息。Windows 上原生编译则直接用 bun 的 `--windows-icon` 等一系列参数，不需要补丁。

真实产物上的核对结果：

```text
Contest Publisher.exe  82.4 MiB
  架构: amd64 · PE32+ 是 · 子系统: windows-gui     ← 双击不弹控制台
  资源段: .rsrc rva=0x53a9000 size=272128
  资源回查: 图标 PNG 256×256 40197 字节 · 图标组 1 项 32bpp · 版本信息 → Contest Publisher 0.1.0.0
与未打补丁的产物逐段比对：12/13 个段未改动（仅 .rsrc 变化）
```

## 从源码构建

```bash
npm install          # 只有一个开发依赖 resedit（给 Windows exe 写图标/版本信息）
npm test             # 87 个用例，含 Windows 分支的纯函数用例
./build-app.sh       # macOS：dist/Contest Publisher.app + dist/ContestPublisher-macos-arm64.zip
./build-win.sh       # Windows：dist/windows/ + dist/ContestPublisher-windows-x64.zip（可在 macOS 上交叉编译）
```

`build-win.sh` 在 macOS / Linux / Windows 上都能跑：非 Windows 环境用 `bun --compile --target=bun-windows-x64` 交叉编译，Windows 环境（MSYS/Cygwin）额外带上版本/厂商等 PE 元数据。

### 编译产物怎么跑

```bash
./dist/contest-publisher-macos-arm64 help            # macOS 命令行版
./dist/contest-publisher-macos-arm64 ui              # 只起工作台，用默认浏览器打开
dist/windows/contest-publisher-windows-x64.exe --help # Windows 命令行版
```

编译产物是独立的原生可执行文件（macOS 是 Mach-O，Windows 是 PE32+），启动不需要 Node 或 Bun。运行 ICT Skill 脚本时的 node 运行时按以下顺序自动解析：环境变量 `CONTEST_PUBLISHER_NODE` → PATH 里的 node → 常见安装位置（macOS 的 homebrew / nvm / volta / fnm，Windows 的 Program Files / LOCALAPPDATA / Volta / fnm / scoop / nvm-windows）→ 兜底用打包进自身的 Bun 运行时执行（`BUN_BE_BUN=1`）。环境自检的 `node` 项会显示最终选用的运行时；机器上完全没有 node 也能完成提交。ICT Skill 目录、GitCode 凭证和 STS 凭证仍通过命令参数或环境提供。

## 测试

```bash
npm test        # 87 个用例（node --test）
npm run check   # bin/ src/ scripts/ 全量语法检查
```

用例覆盖完整流水线（获取 / 审计 / 脱敏 / 副本 / 验证 / 差异 / 建仓 / 推送 / 提交参数）。其中 `test/platform.test.mjs` 专门盯**平台分支**：Windows 的 node 与 PATH 探测、zip 解压命令、python 启动器解析、`--app` 窗口参数，以及「窗口常驻 / 秒退回退 / 无 Chromium 回退」三条启动路径，全部用注入的假 `env`、假文件系统、假子进程在 macOS 上断言。工作台页面另有一个门禁用例：把内嵌 `<script>` 编译一遍，防止模板字符串里的转义写错导致整页按钮失效。

## 设计原则

- 原始仓库放在 `source/`，只读；准备结果放在 `work/`。
- 只复制源代码、必要构建文件和许可证/NOTICE 文件。
- `.git`、日报、缓存、日志、截图、dashboard、个人配置和部署产物不进入工作副本。
- 发现密钥后硬阻断，不能用 review 决定绕过。
- 保留许可证和来源记录；本地 `evidence/` 保存完整审计证据。
- `create-repo`、`push`、`submit` 默认 dry-run，真实外部写入必须带 `--execute` 和对应确认参数。
- `status` 和 `list-runs` 从 `runs/<run-id>/` 的证据文件恢复流程状态，支持中断后继续。
- 参赛提交前需要明确记录权利审阅和赛题规则审阅。

## CLI 命令行

UI 里每个按钮都对应下面一条命令；除 `--execute` 外都只读或只生成计划。

```bash
cd contest-publisher
npm test
npm run check

node bin/contest-publisher.mjs acquire \
  --source https://gitcode.com/ORG/REPO.git \
  --ref main

node bin/contest-publisher.mjs audit --run runs/<run-id>
node bin/contest-publisher.mjs review \
  --run runs/<run-id> \
  --finding <finding-id> \
  --decision sanitize \
  --note "已复核并确认替换范围"

node bin/contest-publisher.mjs prepare \
  --run runs/<run-id> \
  --name contest-project \
  --rights-reviewed \
  --contest-rules-reviewed

node bin/contest-publisher.mjs verify --run runs/<run-id> --workdir runs/<run-id>/work
node bin/contest-publisher.mjs status --run runs/<run-id>
node bin/contest-publisher.mjs list-runs --runs-root runs
```

## GitCode 建仓、推送和 ICT 提交

创建仓库前设置访问令牌，但不要把令牌写入命令历史或 remote URL：

```bash
export GITCODE_ACCESS_TOKEN='在安全凭证存储中读取的令牌'
node bin/contest-publisher.mjs create-repo --run runs/<run-id> --name contest-project --execute --confirm-create
node bin/contest-publisher.mjs init-repo \
  --run runs/<run-id> \
  --remote https://gitcode.com/<account>/contest-project.git \
  --author-name "Contest Author" \
  --author-email author@example.invalid
node bin/contest-publisher.mjs push \
  --run runs/<run-id> \
  --execute --confirm-push
```

先通过提取出的 ICT Skill 查询并锁定赛题：

```bash
node bin/contest-publisher.mjs select-problem \
  --run runs/<run-id> \
  --skill-dir ../huawei-cloud-publish-ict-work \
  --number '<problem-number>' \
  --creds '/absolute/path/to/sts-creds.json'
```

再生成提交计划。`window-start`、`window-end`、`problem-id`、`training-camp` 和 `problem-name` 必须来自 `selected-problem.json`，不能手工猜测：

```bash
node bin/contest-publisher.mjs submit \
  --run runs/<run-id> \
  --skill-dir ../huawei-cloud-publish-ict-work \
  --problem-id '<problem-id>' \
  --training-camp '<training-camp-id>' \
  --problem-name '<problem-name>' \
  --window-start '<startsAt>' \
  --window-end '<endsAt>' \
  --target-lock 'runs/<run-id>/evidence/.ict-target.json' \
  --creds '/absolute/path/to/sts-creds.json'
```

确认 dry-run 计划、远程分支和赛题目标后，再加 `--execute --confirm-submit`。

## 软件架构

分层、模块职责与扩展点见 [`ARCHITECTURE.md`](ARCHITECTURE.md)，领域词汇与边界见 [`CONTEXT.md`](CONTEXT.md)，架构决策记录见 [`docs/adr/`](docs/adr/)。

一句话版本：`bin/`（命令路由）→ `src/api-server.mjs` + `src/ui-server.mjs`（本地 HTTP 与工作台）→ `src/*.mjs`（获取 / 审计 / 副本 / 验证 / 提交等应用服务）→ `src/policy.mjs`（领域策略）→ `src/store.mjs`、`src/git.mjs`、`src/gitcode.mjs`、`src/process.mjs`（基础设施）→ `src/platform.mjs`、`src/launcher.mjs`（平台适配，唯一允许出现平台分支的地方）。
