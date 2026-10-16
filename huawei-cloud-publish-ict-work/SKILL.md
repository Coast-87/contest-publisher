---
name: huawei-cloud-publish-ict-work
description: |
  Submit a competition work to the Huawei ICT Contest experiment platform (华为 ICT 大赛·实验赛题平台), preparing the
  git repository info/work name and submitting for async auto-judging (判题) of an AI problem (云赛项 AI 赛题), where the
  result (passed/failed) is returned later by the judging program and refreshed in the problem panel.
  Use this skill whenever the user wants to push, submit, or upload work to the ICT competition — casual phrasings like
  "提交大赛作品", "推送ICT赛题作品", "把作品投到ICT大赛", "提交AI赛题去判题", as well as formal ones like
  "submit ICT competition work", "publish AI problem solution to the contest", "push work for judging".
  Do NOT use for regular gallery publishing (投稿陈列馆/活动 without competition context) — use huawei-cloud-publish-work-to-gallery.
  Do NOT use for judging itself, viewing scores/ranking, or platform browsing without submit intent.
metadata:
  tags: huawei-cloud,ict-competition,ai-problem,submit,gallery,university operations platform
  version: 2026.10.15.003
---

# Publish ICT Competition Work

提交作品至华为 ICT 大赛·实验赛题平台（AI 赛题判题闭环）。**优先调用内置脚本**（单入口、fail-fast、自带 `--help`），报错才查 [references/ict-error-codes.md](references/ict-error-codes.md)。

> **提交形态**：只需 `workName`/`gitUrl`/`gitBranch`（无封面/详情），提交后**不轮询判题**——结果由平台异步回传，在做题面板更新。
>
> **防错投铁律**：`--select` 选定后即本次唯一目标，**任何失败只转述并停止，绝不自动改投**（锁语义与校验机制见 Step 1.3、Step 4.2/4.4）。
>
> 辅助脚本（`read-git-info.mjs`、`ensure-user-tool.mjs` 等）为 **vendored 副本**（头部 `sync-src:` 指源），改动须同步两端。

## Pipeline

```
Step 0 (domainID, STS creds) → Step 1 (problemId, trainingCampId, window) → Step 2 (workDir + A3 git 红线检查) → Step 3 (gitUrl, gitBranch, workName) → Step 4 (submit)
```

**变量贯穿**：`workName`/`problemId`/`trainingCampId`/`name`/`domainID` 一旦确定即传参，禁止硬编码。

**执行模型**：① **契约优先**——按 stdout 成功信号判定，**成功路径零源码读取**；仅失败时按 `脚本提示 → ict-error-codes → 定向 grep` 逐级查，**禁止整文件读脚本**（脚本合计 ~168KB，整读即数十倍 token 开销） ② 网络超时 3s ③ `detect-env.mjs` 定平台后按平台差异执行 ④ 无依赖命令用 `;` 串成一条 ⑤ **需用户交互的授权（如 GitCode OAuth）一律原样展示链接/二维码，禁用 agent 内置浏览器代开**——脚本已起本地回调，用户授权后自动拿到 token。

## 脚本契约速查

| 步骤 | 脚本/命令 | 成功信号（exit 0 且） | 失败（exit 1；2=参数错） |
|------|-----------|----------------------|--------------------------|
| 0 | `resolve-domain.mjs [--hcloud <exe>]` | stdout `#domain=<id> name=<name>` | exit 1=hcloud 失败（stderr 含排查指引） |
| 0 | `gen_sts.py --account <domainID>` | 写 `sts-creds.json`（含 `_refresh`） | 见 troubleshooting 同源指引 |
| 前置 | `check-version.mjs`（自读 name/version 调 `open-api-guest /v1/gallery/skills/status`） | exit 0 且首行 `status=ok`/`status=skip`（平台不可达亦 skip，不拦截） | exit 1（`status=outdated` + 平台升级文案）→ 原样提示升级并停止；版本比对 /「缺失即过时」判定均在平台侧 |
| 前置 | `api.mjs GET /v1/gallery/announcements/current --prefix open-api-guest`（全站）+ 同命令 `--query "scope=competition"`（竞赛页） | 两条均 `#status=200`；`data.announcement` 非 null 则展示（并存都展示） | 非 200 / 公告 null → 静默跳过，不阻塞 |
| 1 | `list-problems.mjs [--brief] [--creds-file <json>]` | `#problem <n> <name>`（**不含 ID**，ID 仅经 `#selected` 取得）；`--brief` 把重复的 window/status 折成一行 `#window(default)=…`（逐行只在偏离默认时补），赛题1 带 `[不可提交…]` 标注仍展示 | exit 1（`#none`=空列表/全部不可提交，或非 200）→ 提示无可用 AI 赛题 |
| 1 | `list-problems.mjs --select <n> \| --select-name <kw> [--force] [--creds-file <json>]` | `#selected number=<n> problemId=<pid> trainingCampId=<camp> name=<name>`（name 末字段）+ 写目标锁 `.ict-target.json`（超 900s 作废） | exit 2= `#selected-none`（越界/无匹配）/ `#selected-ambiguous`（名称多值）/ `#selected-locked`（锁指他题，改投须用户确认 + `--force`）/ `#selected-forbidden`（赛题1，can_publish=false） |
| 1 | `check-competition-window.mjs --start <所选赛题 startsAt> --end <endsAt>` | `#window=open remainingDays=<n>` | exit 1（`#window=closed reason=before/after`）→ 停止，告知窗口起止 |
| 2 | `scan-workdirs.mjs --dir <workRoot>` | `#candidate <n> <abs>`（workspace=一级子目录 + 项目递归命中并集；direct=根本身）或 `#none`（exit 0，转手动输入） | exit 2=参数错误 |
| 2 | `check-ict-git-repo.mjs <workDir>` | `#gitUrl=<https://… .git>` `#allowed=1` | exit 1= `#exampleRepo=1`（示例仓库，重选目录）/ `#gitAbsent=1`（非 git 仓库）/ `#error=1`（读取或 A3 失败） |
| 3 | `strip-git-credential.mjs "<rawUrl>"` | stdout=安全 URL（https:// 开头、.git 结尾、无 `@`） | 非 https/非 .git/含 `@` → 停止 |
| 3 | `read-git-info.mjs <workDir>` | `#gitUrl=<https://… .git>` `#gitBranch=<分支>`（已核对远端存在） | exit 1=非 git / 无 origin / detached HEAD / URL 不合规 / `#branchAbsent=1`（转述 stderr：`git push -u origin <branch>` 或改用远端已有分支；网络/凭证问题只 stderr 警告不拦截） |
| 3 | `ensure-gitcode-credential.mjs` | `#credential=found`（有凭证）或 `#credential=missing`（无凭证，走 OAuth） | exit 0；无手动备选 |
| 3 | `gitcode-oauth.ensure.mjs --start` | `#oauth=ready`（有 token）/ `#oauth=started session_id=<id> login_url=<url>`（stdout 立即返回，二维码走 stderr） | 缺失 `#oauth=absent` exit 1；失败 `#oauth=failed reason=…` exit 1 |
| 3 | `gitcode-oauth.ensure.mjs --wait <session_id> [--timeout <秒>]` | `#oauth=done`（token 已写 `~/.gitcode/auth.toml`） | `#oauth=failed reason=timeout\|finish\|…` exit 1 |
| 3 | `extract-workname.mjs <workDir>` | `#name=<name> source=<来源>` | exit 1=workDir 不存在 |
| 4 | `build-submit-params.mjs --out … --problem-id … --training-camp … --problem-name <name> --work-name … --git-url … --git-branch … --creds <sts-creds.json>` | `#params=<absPath>`（注入凭证 + 自动 Idempotency-Key；已过「锁一致性 + A0」校验） | exit 1=creds 缺失/A0 失败；exit 2=参数错/锁不一致/名称或活动不匹配 |
| 4 | `submit-ict-work.mjs <utf8-params.json>` | `#status=201`（输出 submissionId/attemptNo/judgeStatus/workId/workUrl） | 409/403 等失败 → 原样输出完整响应 |

> **鉴权前置**：身份由 **APIG 网关注入 `X-Domain-Id`**，gallery 反查 `accountId`——先 `resolve-domain.mjs` 得 `domainID`，`gen_sts.py` 生成最小权限 STS（`X-Tmp-Ak/X-Tmp-Sk/X-Security-Token`）经 open-api-public 鉴权；未装/未配置见 [troubleshooting#domain-id-resolution-issues](references/troubleshooting.md#domain-id-resolution-issues)（**只读该小节，勿整篇读**）。**STS 有效期 900s**：凭证文件含 `_refresh` 元数据时，经 api.mjs 的调用（list-problems / build-submit-params / submit-ict-work）在 401 `GALLERY.AUTH.UNAUTHORIZED` 时自动原地刷新凭证并重试一次，无需重走 Step 0；无 `_refresh` 或刷新失败才按错误码表处置。
>
> **Git Bash 前置**：Windows Git Bash 下先 `source <skill>/scripts/setup-env.sh`（防 MSYS 把 `/v1/…` 转成 `C:/.../v1/…`）。PowerShell/CMD 无需。

> **平台公告（展示性，不设门禁）**：前置两条查询中 `data.announcement` 非 null 时，按 `data.announcement.content` 原样展示（附 `startsAt ~ endsAt` 时间窗，按公告 `timezone` 标注）；两条并存都展示、仅一条展示一条，null/失败静默跳过，**不阻塞提交**。

---

## Core Workflow

### Step 0: 解析 IAM Domain & 生成 STS 凭证

1. **告知用户**（生成凭证=同意）：将创建 IAM 自委托 `SELF_VERIFY` 生成 STS 临时凭证（900s），永久 AK/SK 留本地不上传。
2. `resolve-domain.mjs` → `domainID`；`gen_sts.py --account <domainID>` → `credsFile`（见表）。
3. 输出 `已获取 IAM Domain ID: <id>`。

**Output:** `domainID`、`credsFile`。

### Step 1: 赛题发现（A0）

1. `list-problems.mjs --brief` 拉全量赛题 → `#problem <n>` 候选（见表）。
2. **列出所有赛题供用户选择**：**展示全部** AI 赛题 `1) <赛题名>`（对应 `#problem <n>`，含 `window=… status=…` 标注；`--brief` 下该标注折叠为一行 `#window(default)=…`，**展示时须把该默认行一并列出**），**不省略、不按窗口过滤**；用户回序号（或名称关键词）选择。**赛题1（作品发布任务题）带 `[不可提交]` 标注——禁止选择**：它不是可提交赛题，领取后发布普通作品即完成，选择会被脚本直接拒绝（`#selected-forbidden`）。
3. **目标锁定（禁止手抄 ID）**：`list-problems.mjs --select <序号>`（或 `--select-name <关键词>`）→ `problemId`/`trainingCampId`/`name` **只取自 `#selected` 行，禁止从 `#problem` 文本行手抄/目测**；脚本同时写**目标锁**（本次唯一目标，超 900s 作废）。`#selected-locked` → 已有锁指向他题，**仅用户明确同意改投**才可加 `--force`；`#selected-forbidden` → 赛题1 不可提交，**转述并停止**，请用户改选。
4. **目标声明（校验）**：向用户展示并请其确认 — `本次目标：序号 <n>／赛题「<name>」／problemId=<pid>`；确认后才继续。**本步骤起目标即锁定，后续任何失败不得擅自变更。**
5. **窗口预检（对所选赛题）**：选定后用 `check-competition-window.mjs` 按其 `startsAt/endsAt` 判定；窗口外停止并告知（不影响第 2 步展示全部）。
6. **身份说明**：告知提交将以网关注入的账号身份进行。

**Output:** `number`、`problemId`、`trainingCampId`、`name`、`windowStart`、`windowEnd`。

### Step 2: Select Work Directory

> **⚠️ 必须由用户确认选定**：目录是识别结果，**绝不自行代选**。无 `#candidate` 时也须请用户明确给出/确认目录后才继续。

1. `pwd` 取用户工作目录 → `scan-workdirs.mjs --dir <workRoot>` → `#candidate <n>`（见表）。
2. **向用户列出候选并等其确认**：展示 `1) <目录>`… → 用户回序号、或直接输入路径、或明确说用某目录；**得到用户明确选择后才定为 `workDir`**。
3. 手动输入兜底：候选不符 / `#none` / 指定任意目录，均请用户输入（`#none` 不拦截、不擅自指定）。
4. **git 红线检查（提交之初即查，接口判定）**：对用户确认的 `workDir` 跑 `check-ict-git-repo.mjs <workDir>`（内部读 `.git` origin → 调 A3 git-check，判定规则以**后端配置**为准）：
   - `#exampleRepo=1` → 脚本 stderr 已给出完整红线提示，**转述并且唯一处置是回到本步骤请用户重新选择「赛题作品目录」**；禁止继续后续步骤，禁止 fork、禁止拆分/另推示例仓库内容为个人仓库提交（红线规则见 [ict-error-codes.md](references/ict-error-codes.md) `GIT_URL_EXAMPLE_REPO`）。
   - `#gitAbsent=1` → 提示该目录非 git 仓库（无 `.git`）：赛题作品须提交到自己的 git 远程仓库；请用户改选已建仓目录。
   - `#error=1` → 提示本地读取/A3 请求失败，按 stderr 排查后重试（不阻塞用户换目录）。
   - `#allowed=1` → 记录 `safeUrl = #gitUrl`，进入 Step 3。
5. 路径校验：存在且为目录即可作 `workDir`；命名与 git 信息在 Step 3。

**Output:** `workDir`（须用户确认）、`safeUrl`。

### Step 3: Git Repository Info & Work Name

1. **红线复核（URL 可能变化时）**：若 `#allowed=1` 后 gitUrl 无变化（Step 2 已判定放行）可跳过；若用户手工改过 origin / 输入了自定义 URL，先重跑 `check-ict-git-repo.mjs <workDir>` 复核（同 Step 2.4 判定，命中示例仓库 → 回 Step 2）。
2. `read-git-info.mjs <workDir>` 一步取 gitUrl/gitBranch（含 git 自检 + 凭证剥离 + **远端分支核对**，见表）；其输出的 gitUrl 与 `safeUrl` 比对，不一致以 `read-git-info` 为准并重跑 A3 判定。`#branchAbsent=1` → 转述 stderr 指引（先推送该分支或改用远端已有分支），修复后重跑本步骤。
3. **凭证排查**：`ensure-gitcode-credential.mjs`；无凭证走 `gitcode-oauth.ensure.mjs` 两阶段授权（`--start`→`--wait`，见表）——**授权链接/二维码原样展示给用户**（禁止 agent 内置浏览器代开）。**若 read-git-info 已能读到 origin**（已有凭证）可跳过 OAuth。
4. **命名**：`extract-workname.mjs <workDir>`。`source=dirname` 时 agent 可合成/修改（<30 字符）。**换名不只限 `source=dirname`**：Step 4 若被 `409 GALLERY.WORK.DUPLICATE`（该账号在该赛题活动下已占同名）拦下，任何 source 都须换一个 ≤30 字符的新名——**新名先经用户确认**，再回 Step 4 重跑 `build-submit-params.mjs`（见 Step 4.5 ②）。

**Output:** `gitUrl`、`gitBranch`、`workName`。

### Step 4: Submit to Competition

1. 宣示 `开始提交 ICT 大赛作品「${workName}」（赛题 ${problemId}「${name}」）`。
2. `build-submit-params.mjs` 装配参数 JSON（**必传 `--problem-name <name>`**；脚本内部做目标锁一致性 + A0 校验 problemId↔赛题名/活动，不通过 exit 2 拒绝）→ `submit-ict-work.mjs`（见表）。Idempotency-Key 默认自动生成；重提必须 `--idempotency-key` 传**新键**；**提交无需任何产物（已删封面/详情/门禁）**。
3. **201** → 提交成功。取 `submissionId`/`attemptNo`/`judgeStatus`/`workUrl`，清理临时文件。
4. **失败处置（提交未 201）**：`submit-ict-work.mjs` 已在 stderr 输出中文原因 + 处置指引，**面向用户直接转述**，策略见 [ict-error-codes.md](references/ict-error-codes.md)。**处置铁律：失败只转述 + 停止，绝不自动改投其他赛题**（换题须用户明确同意后回 Step 1 重选）。终态/门槛/占用（409/403/400）：`PROBLEM_TRACK_MISMATCH` 且已在 ICT 侧换赛道仍被拦 → 提示落地页「我的参赛状态」点「刷新组队信息」（`?refresh=1`）后重提；`GALLERY.WORK.DUPLICATE` → 请用户给新作品名后按 4.5 ② 改名重提（占名按赛题隔离，不必换赛题）；`GIT_URL_EXAMPLE_REPO` → 清理临时文件 + 回 Step 2 更换「赛题作品目录」（红线规则见 error-codes）。参数类/rate limit/系统错误 → 告知 `<msg>（<code>）`，保留临时文件，按表处理后可重试。
5. **重提**（两种，别混）：
   ① **同名重提**（判题未通过等场景）：仅需新 Idempotency-Key（`ict-submit-${problemId}-${Date.now()}`）重新 `submit-ict-work.mjs`。
   ② **改名重提**（`GALLERY.WORK.DUPLICATE`，该活动下同名已占名）：`workName` 在 Step 4.2 产出的参数 JSON 内，**必须重跑 `build-submit-params.mjs --work-name <新名>`**（默认自带新 Idempotency-Key）再 `submit-ict-work.mjs`；只跑 submit 会复用旧名、再次 409。新名须经用户确认（作品名是用户可见身份，agent 不自选）。

**结束语（判题为异步，不轮询）**：

```
✅ 提交成功：作品「${workName}」已提交赛题 ${problemId}（submissionId=${submissionId}）。
    作品详情：${workUrl}
    判题由平台程序异步进行，结果会在做题面板更新，请稍后在页面查看。
```

---

## References

| Document | 用途 | 何时读（**按需，勿预先整读**） |
|----------|------|--------|
| [ict-api-spec.md](references/ict-api-spec.md) | A0/A1 契约、字段、响应、鉴权 | 仅响应结构异常时 |
| [ict-error-codes.md](references/ict-error-codes.md) | 错误码 + 处理策略 | 非 2xx 时查表 |
| [ict-competition-rules.md](references/ict-competition-rules.md) | 报名门槛/窗口/重提/身份 + 与普通发布边界 | Step 4 决策或用户问规则时 |
| [troubleshooting.md](references/troubleshooting.md) | domain/STS/git 凭证排查（同源脚本） | Step 0/3 出问题时**只读对应小节**（`#anchor`） |