#!/usr/bin/env node
import path from 'node:path';
import { acquireSource } from '../src/acquire.mjs';
import { auditRun } from '../src/audit.mjs';
import { reviewFinding } from '../src/review.mjs';
import { prepareRun } from '../src/prepare.mjs';
import { scaffoldRun } from '../src/scaffold.mjs';
import { writeContributionRecord } from '../src/prepare.mjs';
import { verifyPrepared } from '../src/verify.mjs';
import { diffRun, formatDiffReport } from '../src/diff.mjs';
import { buildGitCodeCreateRequest, createGitCodeRepo } from '../src/gitcode.mjs';
import { initPreparedRepo, pushPreparedRepo } from '../src/git.mjs';
import { buildSubmitPlan } from '../src/submit.mjs';
import { selectCompetitionProblem } from '../src/competition.mjs';
import { defaultRunsRoot, exists, readJson, writeJson } from '../src/store.mjs';
import { deleteRun, listRuns, readRunMode, statusRun, writeRunMode } from '../src/state.mjs';
import { startUiServer } from '../src/ui-server.mjs';
import { appendLauncherLog, openTarget } from '../src/platform.mjs';
import { isHeadlessConsole, runWorkbenchSession } from '../src/launcher.mjs';

const HELP = `contest-publisher — 纯代码审计、清理、建仓、上传与 ICT 大赛提交流水线

命令:
  acquire       拉取源仓库并固定 commit
  audit         审计源仓库文件、凭证、个人信息和项目特征
  review        记录单个审计发现的处理决定
  prepare       按代码白名单生成独立工作副本
  verify        对工作副本执行静态校验
  mode          查看/切换运行模式：strict（默认）或 copy（搬运，豁免原创增量）
  diff          对比工作副本与原仓库（source/）的逐行差异
  scaffold      在工作副本里生成可运行的赛题实现脚手架
  create-repo   创建 GitCode 私有仓库（默认只生成计划）
  init-repo     初始化工作副本并绑定目标 remote
  push          推送工作副本（默认只生成计划）
  select-problem 通过 ICT Skill 查询并锁定参赛赛题
  status        查看单次运行状态
  list-runs     列出本地运行实例
  delete-run    删除一个运行实例（source/work/evidence 一并移除）
  submit        调用提取出的 ICT Skill（默认只生成计划）
  ui            启动可视化工作台

运行根目录:
  acquire / list-runs / delete-run / ui 未显式传 --runs-root 时，依次取
  已保存的工作区设置、CONTEST_PUBLISHER_RUNS、~/contest-publisher-runs。
  工作台里改动的运行根目录会被记住，下次启动自动沿用。

启动方式:
  不带命令运行即启动工作台。macOS 双击 .app 由原生壳开窗口；
  Windows 绿色包用 Edge / Chrome 的应用窗口呈现（窗口关掉即退出，没有可用 Chromium 时退回默认浏览器，
  此时用界面右上角「退出软件」结束进程）。终端里运行则打开默认浏览器并常驻，Ctrl+C 退出。
  --app-window 强制应用窗口模式，--no-open 完全不自动打开界面。

关键门禁:
  - source/ 永远只读，所有变更写入 work/
  - 凭证发现后不可通过 review 豁免，必须回源仓库清除并重新审计
  - prepare 必须带 --rights-reviewed --contest-rules-reviewed
  - 许可证/NOTICE 保留；来源证据写入本地 runs/<id>/evidence/
  - create-repo/push/submit 默认 dry-run；真实执行还需对应 --confirm-create/--confirm-push/--confirm-submit

示例:
  node bin/contest-publisher.mjs acquire --source https://gitcode.com/org/repo.git --ref main
  node bin/contest-publisher.mjs audit --run runs/<run-id>
  node bin/contest-publisher.mjs review --run runs/<run-id> --finding <id> --decision sanitize --note "已确认可替换"
  node bin/contest-publisher.mjs prepare --run runs/<run-id> --name contest-project --rights-reviewed --contest-rules-reviewed
  node bin/contest-publisher.mjs verify --workdir runs/<run-id>/work
  node bin/contest-publisher.mjs mode --run runs/<run-id> --copy       # 切到搬运模式：原创增量豁免并记录
  node bin/contest-publisher.mjs mode --run runs/<run-id>              # 查看当前模式
  node bin/contest-publisher.mjs diff --run runs/<run-id>              # 逐行差异（含工具脱敏改写标注）
  node bin/contest-publisher.mjs diff --run runs/<run-id> --stat       # 只看文件清单与行数
  node bin/contest-publisher.mjs create-repo --run runs/<run-id> --name contest-project --execute --confirm-create
  node bin/contest-publisher.mjs init-repo --run runs/<run-id> --remote https://gitcode.com/me/contest-project.git --author-name "Contest Author" --author-email author@example.invalid
  node bin/contest-publisher.mjs push --run runs/<run-id> --execute --confirm-push
  node bin/contest-publisher.mjs select-problem --run runs/<run-id> --skill-dir /path/to/huawei-cloud-publish-ict-work --number 1 --creds /path/to/sts-creds.json
  node bin/contest-publisher.mjs delete-run --run runs/<run-id> --confirm-delete
`;

function parseArgs(argv) {
  const command = argv[0];
  const values = {};
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2).replaceAll('-', '_');
    if (['execute', 'confirm_create', 'confirm_push', 'confirm_submit', 'confirm_public', 'confirm_delete', 'copy', 'dry_run', 'force', 'strict', 'json', 'no_open', 'no_check', 'public', 'rights_reviewed', 'stat', 'contest_rules_reviewed', 'app_window'].includes(key)) values[key] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key.replaceAll('_', '-')}`);
      values[key] = value;
    }
  }
  return { command, ...values };
}

function required(args, ...keys) {
  for (const key of keys) if (!args[key]) throw new Error(`Missing required option --${key.replaceAll('_', '-')}`);
}

function jsonOutput(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// 双击启动（macOS 的 .app 由原生壳托管；Windows 绿色包没有壳）与终端启动走同一段逻辑：
// 起服务 → 把地址交给工作台窗口 → 等它关闭。Windows 无控制台时没有任何可见输出，所以同步写日志文件。
async function keepWorkbenchOpen(app, args) {
  const headless = isHeadlessConsole();
  const log = message => {
    const line = String(message);
    process.stdout.write(`${line}\n`);
    if (headless) appendLauncherLog(line);
  };
  if (args.no_open) { await new Promise(() => {}); return; }
  log(`工作台已启动：${app.url}`);
  // 终端里（macOS / Windows 控制台版）就是「开默认浏览器 + 前台常驻」，Ctrl+C 退出。
  if (!headless && !args.app_window) {
    openTarget(app.url, { kind: 'url' });
    await new Promise(() => {});
    return;
  }
  const session = await runWorkbenchSession(app.url, { log });
  log(`工作台窗口会话结束：${JSON.stringify(session)}`);
  if (session.mode === 'app-window') { app.workspace.shutdown(); return; }
  // 只打开了默认浏览器：窗口什么时候关我们观测不到，服务必须继续活着，退出走工作台里的「退出软件」。
  log('工作台仍在运行；在界面右上角点「退出软件」即可结束进程。');
  await new Promise(() => {});
}

async function main(args) {
  if (!args.command) {
    const app = await startUiServer({ host: '127.0.0.1', port: 0, runsRoot: args.runs_root ? path.resolve(args.runs_root) : undefined, open: false });
    console.log(`CONTEST_PUBLISHER_UI=${app.url}`);
    await keepWorkbenchOpen(app, args);
    return;
  }
  if (args.command === 'help' || args.command === '--help') { process.stdout.write(HELP); return; }
  switch (args.command) {
    case 'acquire': {
      required(args, 'source');
      const result = await acquireSource({ sourceUrl: args.source, ref: args.ref ?? 'HEAD', runsRoot: args.runs_root ? path.resolve(args.runs_root) : await defaultRunsRoot() });
      jsonOutput(result);
      return;
    }
    case 'audit': {
      required(args, 'run');
      jsonOutput(await auditRun(args.run));
      return;
    }
    case 'review': {
      required(args, 'run', 'finding', 'decision', 'note');
      jsonOutput(await reviewFinding(args.run, { findingId: args.finding, decision: args.decision, note: args.note }));
      return;
    }
    case 'prepare': {
      required(args, 'run', 'name');
      jsonOutput(await prepareRun(args.run, { name: args.name, force: Boolean(args.force), rightsReviewed: Boolean(args.rights_reviewed), contestRulesReviewed: Boolean(args.contest_rules_reviewed), output: args.output }));
      return;
    }
    case 'verify': {
      required(args, 'workdir');
      const verification = await verifyPrepared(args.workdir, {
        runChecks: !args.no_check,
        allowCopy: args.run ? (await readRunMode(args.run)) === 'copy' : false,
      });
      if (args.run) {
        await writeJson(path.join(path.resolve(args.run), 'evidence', 'verify.json'), verification);
        await writeContributionRecord(args.run);
      }
      jsonOutput(verification);
      return;
    }
    case 'diff': {
      required(args, 'run');
      const context = args.context === undefined ? 3 : Number(args.context);
      const report = await diffRun(args.run, {
        path: args.path,
        includeHunks: !args.stat,
        context: Number.isFinite(context) && context >= 0 ? context : 3,
      });
      if (args.json) jsonOutput(report);
      else process.stdout.write(formatDiffReport(report, { stat: Boolean(args.stat) }));
      return;
    }
    case 'mode': {
      required(args, 'run');
      if (args.copy || args.strict) {
        const mode = await writeRunMode(args.run, args.copy ? 'copy' : 'strict', args.note ?? '');
        const record = await writeContributionRecord(args.run);
        jsonOutput({ mode, record });
      } else jsonOutput({ mode: await readRunMode(args.run) });
      return;
    }
    case 'scaffold': {
      required(args, 'run');
      const result = await scaffoldRun(args.run, { lang: args.lang, name: args.name ?? 'solution', force: Boolean(args.force) });
      jsonOutput(result);
      return;
    }
    case 'status': {
      required(args, 'run');
      jsonOutput(await statusRun(args.run));
      return;
    }
    case 'list-runs': {
      jsonOutput(await listRuns(args.runs_root ? path.resolve(args.runs_root) : await defaultRunsRoot()));
      return;
    }
    case 'delete-run': {
      required(args, 'run');
      const root = args.runs_root ? path.resolve(args.runs_root) : await defaultRunsRoot();
      if (!args.confirm_delete) throw new Error('Deleting a run requires --confirm-delete');
      const runDir = path.isAbsolute(args.run) ? args.run : path.resolve(root, args.run);
      jsonOutput(await deleteRun(runDir, { root, force: Boolean(args.force) }));
      return;
    }
    case 'create-repo': {
      required(args, 'run', 'name');
      const runDir = path.resolve(args.run);
      const workDir = path.join(runDir, 'work');
      if (!(await exists(path.join(runDir, 'evidence', 'prepare.json')))) throw new Error('Run must complete prepare first');
      const verification = await verifyPrepared(workDir, { allowCopy: (await readRunMode(runDir)) === 'copy' });
      if (verification.status !== 'passed') throw new Error(`Prepared work did not pass verify: ${verification.findings.map(item => item.category).join(', ')}`);
      if (args.public && !args.confirm_public) throw new Error('Public repo creation also requires --confirm-public');
      const token = process.env.GITCODE_ACCESS_TOKEN;
      const request = buildGitCodeCreateRequest({ name: args.name, description: args.description ?? '', privateRepo: !args.public, defaultBranch: args.default_branch ?? 'main', token: token ?? 'dry-run-token' });
      if (!args.execute) {
        jsonOutput({ dryRun: true, provider: 'gitcode', endpoint: request.url.origin + request.url.pathname, method: request.method, body: request.body, next: 'set GITCODE_ACCESS_TOKEN and rerun with --execute --confirm-create' });
        return;
      }
      if (!args.confirm_create) throw new Error('Creating a remote repository requires --confirm-create');
      if (!token) throw new Error('GITCODE_ACCESS_TOKEN is required with --execute');
      const repository = await createGitCodeRepo({ name: args.name, description: args.description ?? '', privateRepo: !args.public, defaultBranch: args.default_branch ?? 'main', token });
      await writeJson(path.join(runDir, 'evidence', 'repository.json'), repository);
      jsonOutput(repository);
      return;
    }
    case 'init-repo': {
      required(args, 'run', 'author_name', 'author_email');
      const runDir = path.resolve(args.run);
      const workDir = path.join(runDir, 'work');
      const verification = await verifyPrepared(workDir, { allowGit: true, allowCopy: (await readRunMode(runDir)) === 'copy' });
      if (verification.status !== 'passed') throw new Error(`Prepared work did not pass verify: ${verification.findings.map(item => item.category).join(', ')}`);
      await writeJson(path.join(runDir, 'evidence', 'verify.json'), verification);
      const repository = args.remote ? { cloneUrl: args.remote } : await readJson(path.join(runDir, 'evidence', 'repository.json'));
      const initialized = initPreparedRepo(workDir, { remote: repository.cloneUrl, authorName: args.author_name, authorEmail: args.author_email, message: args.message ?? 'Initialize prepared contest project' });
      await writeJson(path.join(runDir, 'evidence', 'repository-init.json'), initialized);
      jsonOutput(initialized);
      return;
    }
    case 'push': {
      required(args, 'run');
      const runDir = path.resolve(args.run);
      const workDir = path.join(runDir, 'work');
      if (!(await exists(path.join(runDir, 'evidence', 'repository-init.json')))) throw new Error('Run init-repo before push');
      const verification = await verifyPrepared(workDir, { allowGit: true, allowCopy: (await readRunMode(runDir)) === 'copy' });
      if (verification.status !== 'passed') throw new Error(`Prepared work did not pass verify: ${verification.findings.map(item => item.category).join(', ')}`);
      await writeJson(path.join(runDir, 'evidence', 'verify.json'), verification);
      if (args.execute && !args.confirm_push) throw new Error('Remote push requires --confirm-push');
      const result = pushPreparedRepo(workDir, { remote: args.remote, branch: args.branch ?? 'main', execute: Boolean(args.execute) });
      if (!result.dryRun) await writeJson(path.join(runDir, 'evidence', 'push.json'), result);
      jsonOutput(result);
      return;
    }
    case 'select-problem': {
      required(args, 'run', 'skill_dir', 'number', 'creds');
      const runDir = path.resolve(args.run);
      const result = await selectCompetitionProblem({ runDir, skillDir: args.skill_dir, number: Number(args.number), creds: args.creds });
      jsonOutput(result);
      return;
    }
    case 'submit': {
      required(args, 'run', 'skill_dir', 'problem_id', 'training_camp', 'problem_name', 'window_start', 'window_end', 'creds');
      const runDir = path.resolve(args.run);
      const workDir = path.join(runDir, 'work');
      if (!(await exists(path.join(runDir, 'evidence', 'push.json')))) throw new Error('Run must successfully push before competition submit');
      const verification = await verifyPrepared(workDir, { allowGit: true, allowCopy: (await readRunMode(runDir)) === 'copy' });
      if (verification.status !== 'passed') throw new Error(`Prepared work did not pass verify: ${verification.findings.map(item => item.category).join(', ')}`);
      await writeJson(path.join(runDir, 'evidence', 'verify.json'), verification);
      const targetLock = path.resolve(args.target_lock ?? path.join(path.dirname(path.resolve(args.creds)), '.ict-target.json'));
      if (!(await exists(targetLock))) throw new Error(`ICT Skill target lock not found: ${targetLock}; run list-problems.mjs --select first`);
      if (args.execute && !args.confirm_submit) throw new Error('Competition submission requires --confirm-submit');
      const result = await buildSubmitPlan({ workDir, skillDir: args.skill_dir, problemId: args.problem_id, trainingCampId: args.training_camp, problemName: args.problem_name, windowStart: args.window_start, windowEnd: args.window_end, targetLock, creds: args.creds, domainId: args.domain_id, execute: Boolean(args.execute), evidenceDir: path.join(runDir, 'evidence') });
      if (args.execute) await writeJson(path.join(runDir, 'evidence', 'submission.json'), { submittedAt: new Date().toISOString(), problemId: args.problem_id, problemName: args.problem_name, result: result.submissionOutput });
      jsonOutput(result);
      return;
    }
    case 'ui': {
      const app = await startUiServer({ host: args.host ?? '127.0.0.1', port: Number(args.port ?? 0), runsRoot: args.runs_root ? path.resolve(args.runs_root) : undefined, open: !args.no_open });
      console.log(`CONTEST_PUBLISHER_UI=${app.url}`);
      await new Promise(() => {});
      return;
    }
    default: throw new Error(`Unknown command: ${args.command}`);
  }
}

try {
  await main(parseArgs(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
