#!/usr/bin/env node
// check-competition-window.mjs — ICT 大赛实验窗口预检（客户端 fail-early，服务端 fail-closed）
//
// 窗口来源：A0 下发的活动(training_camp)起止时间（`startsAt`/`endsAt`），活动缺窗口时服务端回退管理面
// 「大赛时间设置」（competition_configs.module=experiment），两者都无 → 服务端 fail-closed
// （GALLERY.COMPETITION.EXPERIMENT_WINDOW_UNCONFIGURED，503）。
// 2026-10-15：服务端已删除硬编码全局默认窗口 → 本脚本同步取消默认值，--start/--end 必传。
//
// 用法:
//   node check-competition-window.mjs --start <iso|date> --end <iso|date>
//
// 成功(窗口内) exit 0，stdout: `#window=open remainingDays=<n>`（消息走 stderr）
// 失败(窗口外) exit 1，stdout: `#window=closed reason=<before|after>`（stderr 含说明）
// 参数错误 exit 2（缺 --start/--end 或时间非法）。

// ===== 实验窗口（2026-10-15：服务端已删除硬编码全局默认窗口，本脚本同步去掉默认值） =====
// 窗口只来自真实数据：A0 下发的活动起止（活动窗口优先）→ 管理面「大赛时间设置」。
// 故 --start/--end 必传：活动缺窗口且未配置时服务端 fail-closed（EXPERIMENT_WINDOW_UNCONFIGURED），
// 客户端不得凭空兜底历史默认日期（否则会出现「本地判 open、服务端拒收」的口径分叉）。

function parseArgs(argv) {
  const cli = { start: null, end: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      console.log(`check-competition-window.mjs — ICT 大赛实验窗口预检

用法:
  node check-competition-window.mjs --start <iso|date> --end <iso|date>

窗口来源: A0 下发的活动起止（startsAt/endsAt）。2026-10-15 起服务端已删除硬编码全局默认窗口，
  故 --start/--end 均必传（缺参 exit 2）——不得用本地默认日期兜底。

stdout: #window=open remainingDays=<n>   （exit 0）
        #window=closed reason=<before|after>（exit 1）
退出码: 0=窗口内; 1=窗口外; 2=参数错误（缺 --start/--end 或时间非法）
`);
      process.exit(0);
    } else if (a === "--start") cli.start = argv[++i];
    else if (a === "--end") cli.end = argv[++i];
    else {
      console.error(`❌ 未知参数: ${a}`);
      process.exit(2);
    }
  }
  return cli;
}

const cli = parseArgs(process.argv.slice(2));
// 缺参必须 exit 2（不得让 new Date(null) 退化成 1970 而误判「已截止」）
if (!cli.start || !cli.end) {
  console.error("❌ --start 与 --end 均必传（取 A0 下发该赛题活动的 startsAt/endsAt；服务端已无全局默认窗口）");
  process.exit(2);
}
const start = new Date(cli.start);
const end = new Date(cli.end);
if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
  console.error(`❌ 窗口起止时间不合法: start=${cli.start} end=${cli.end}`);
  process.exit(2);
}

const now = new Date();
if (now < start) {
  const days = Math.ceil((start.getTime() - now.getTime()) / 86400000);
  console.log("#window=closed reason=before");
  console.error(`⏳ 实验窗口未开始（${start.toISOString()} 后开启，剩余约 ${days} 天）。提交将被服务端拒绝，无需生成产物。`);
  process.exit(1);
}
if (now > end) {
  console.log("#window=closed reason=after");
  console.error(`⏹ 实验窗口已截止（${end.toISOString()}）。已无法提交/重提，停止发布。`);
  process.exit(1);
}
const remainingDays = Math.ceil((end.getTime() - now.getTime()) / 86400000);
console.log(`#window=open remainingDays=${remainingDays}`);
console.error(`✅ 实验窗口内（剩余约 ${remainingDays} 天），可提交 AI 赛题作品。`);
process.exit(0);