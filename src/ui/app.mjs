export const APP_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Contest Publisher · Workbench</title>
<link rel="icon" type="image/png" href="/assets/icon.png" />
<link rel="apple-touch-icon" href="/assets/icon.png" />
<style>
:root{
  /* 风格不变：同一套粉紫柔和配色，只统一尺度与层级 */
  --bg:#f4f1fb; --bg2:#fdf0f6;
  --glass:rgba(255,255,255,.62); --glass2:rgba(255,255,255,.8);
  --stroke:rgba(180,140,220,.2); --stroke2:rgba(180,140,220,.34);
  --text:#3d3450; --muted:#6f6187; --faint:#8d82a6;
  --accent:#e891b4; --accent2:#9d8ef0;
  --mint:#7dd8c3; --amber:#e9a83f; --red:#dd6b74;
  --r-lg:22px; --r-md:16px; --r-sm:12px; --r-xs:10px;
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px;
  --shadow:0 10px 36px rgba(180,140,200,.16), 0 2px 8px rgba(180,140,200,.08);
  --shadow-soft:0 3px 14px rgba(180,140,200,.12);
  --ease:cubic-bezier(.32,.72,.24,1);
  --t-fast:150ms; --t-med:280ms;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0; color:var(--text); overflow:hidden;
  font:13px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","Hiragino Sans GB",sans-serif;
  background:
    radial-gradient(1000px 640px at 88% -8%, rgba(232,145,180,.2) 0%, transparent 55%),
    radial-gradient(880px 560px at -8% 105%, rgba(157,142,240,.16) 0%, transparent 55%),
    radial-gradient(700px 500px at 50% 50%, rgba(125,216,195,.1) 0%, transparent 60%),
    linear-gradient(155deg, var(--bg2), var(--bg));
  -webkit-font-smoothing:antialiased;
}
body::before,body::after{content:''; position:fixed; border-radius:50%; filter:blur(70px); pointer-events:none; z-index:0}
body::before{width:340px;height:340px;top:-90px;right:-60px;background:rgba(232,145,180,.32);animation:drift 22s ease-in-out infinite}
body::after{width:300px;height:300px;bottom:-80px;left:36%;background:rgba(157,142,240,.26);animation:drift 28s ease-in-out infinite reverse}
@keyframes drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-36px,28px) scale(1.08)}}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
:focus-visible{outline:2px solid var(--accent2);outline-offset:2px;border-radius:8px}
svg.i{width:16px;height:16px;flex:none;stroke:currentColor;stroke-width:1.7;fill:none;stroke-linecap:round;stroke-linejoin:round}
svg.i.sm{width:14px;height:14px}

/* ---------- 骨架 ---------- */
.shell{height:100dvh;display:grid;grid-template-columns:272px 1fr;gap:var(--sp-4);padding:var(--sp-4);position:relative;z-index:1}
.rail{
  display:flex;flex-direction:column;gap:var(--sp-4);padding:var(--sp-4);border-radius:var(--r-lg);
  background:var(--glass);border:1px solid var(--stroke);
  backdrop-filter:blur(32px) saturate(1.6);-webkit-backdrop-filter:blur(32px) saturate(1.6);
  box-shadow:var(--shadow);min-height:0;
}
.brand{display:flex;gap:var(--sp-3);align-items:center;padding:var(--sp-1) var(--sp-2)}
.mark{width:38px;height:38px;border-radius:12px;flex:none;box-shadow:0 6px 18px rgba(232,145,180,.3)}
.mark img{width:100%;height:100%;display:block;border-radius:12px}
.brand strong{font-size:14px;letter-spacing:.01em;display:block}
.brand small{color:var(--muted);display:block;font-size:12px;margin-top:1px}

/* ---------- 运行列表 ---------- */
.rail-runs{display:flex;flex-direction:column;gap:var(--sp-2);min-height:0;flex:1}
.rail-head{display:flex;align-items:center;gap:var(--sp-2)}
.rail-label{color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:600;padding:0 2px}
.rail-label.toggle{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2);flex:1;min-width:0;background:none;border:0;text-align:left;font-family:inherit;min-height:28px}
.rail-label.toggle:hover{color:var(--text)}
.rail-label.toggle .chev{font-size:10px;transition:transform var(--t-fast) var(--ease)}
.runs-filter{position:relative}
.runs-filter input{
  width:100%;background:rgba(255,255,255,.7);border:1px solid var(--stroke);border-radius:var(--r-xs);
  padding:6px 10px;font-size:12px;outline:0;min-height:30px;
}
.runs-filter input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(232,145,180,.14);background:#fff}
.runs{display:flex;flex-direction:column;gap:2px;overflow:auto;min-height:0;flex:1;scrollbar-width:thin;padding-right:2px}
.run-row{display:flex;align-items:center;gap:2px}
.run-row .run{flex:1;min-width:0}
.run{
  border:1px solid transparent;border-radius:var(--r-xs);background:transparent;text-align:left;
  padding:6px 9px;display:flex;align-items:center;gap:var(--sp-2);color:var(--text);
  transition:background var(--t-fast) var(--ease),border-color var(--t-fast) var(--ease);
}
.run:hover{background:rgba(232,145,180,.1)}
.run.active{background:linear-gradient(135deg,rgba(232,145,180,.15),rgba(157,142,240,.11));border-color:var(--stroke2)}
.run .stage-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--faint);box-shadow:0 0 0 3px rgba(141,130,166,.12)}
.run .run-text{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.run .stage-dot.done{background:var(--mint);box-shadow:0 0 0 3px rgba(125,216,195,.16)}
.run .stage-dot.warn{background:var(--amber);box-shadow:0 0 0 3px rgba(233,168,63,.16)}
.run .stage-dot.block{background:var(--red);box-shadow:0 0 0 3px rgba(221,107,116,.16)}
.run .id{font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.run .stage-label{color:var(--faint);font-size:10px;font-weight:600;letter-spacing:.04em;line-height:1.3}
.run-del{border:1px solid transparent;background:transparent;color:var(--faint);border-radius:var(--r-xs);padding:5px;display:grid;place-items:center;flex:none;opacity:0;transition:opacity var(--t-fast) var(--ease),background var(--t-fast) var(--ease),color var(--t-fast) var(--ease)}
.run-row:hover .run-del,.run-del:focus-visible{opacity:1}
.run-del:hover{background:rgba(221,107,116,.14);color:#b8555d}
.empty{color:var(--muted);padding:var(--sp-3) var(--sp-2);font-size:12px}
.rail-footer{color:var(--faint);font-size:11px;padding:var(--sp-3) var(--sp-2) 0;border-top:1px solid var(--stroke);line-height:1.6}

/* ---------- 主区 ---------- */
.main{
  min-height:0;display:flex;flex-direction:column;gap:var(--sp-3);padding:0 var(--sp-5) var(--sp-5);border-radius:var(--r-lg);
  background:var(--glass);border:1px solid var(--stroke);
  backdrop-filter:blur(32px) saturate(1.6);-webkit-backdrop-filter:blur(32px) saturate(1.6);
  box-shadow:var(--shadow);overflow:auto;scrollbar-width:none;
}
.main::-webkit-scrollbar{display:none}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--sp-4);flex:none;position:sticky;top:0;z-index:5;background:rgba(252,243,249,.94);backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);border-bottom:1px solid var(--stroke);padding:var(--sp-4) var(--sp-5);margin:0 calc(var(--sp-5) * -1)}
.top-title{min-width:0}
.eyebrow{color:var(--accent);font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700}
.title{font-size:clamp(19px,2vw,24px);line-height:1.2;margin:var(--sp-1) 0 var(--sp-2);letter-spacing:-.02em;font-weight:700}
.statusbar{display:flex;flex-wrap:wrap;gap:var(--sp-1) var(--sp-2);align-items:center;margin-top:var(--sp-1)}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--stroke);border-radius:999px;padding:3px 10px;font-size:11px;color:var(--muted);background:rgba(255,255,255,.55);max-width:100%}
.pill.target{border-color:rgba(157,142,240,.45);color:#5f5192;background:rgba(157,142,240,.1)}
.pill.repo{border-color:rgba(125,216,195,.5);color:#2a7f70;background:rgba(125,216,195,.1)}
.hint{font-size:12px;color:var(--muted);margin:0;line-height:1.6}
.top-actions{display:flex;align-items:center;gap:var(--sp-2);flex:none;flex-wrap:wrap;justify-content:flex-end}
.icon-group{display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.5);border:1px solid var(--stroke)}
.icon-btn{border:0;background:none;color:var(--muted);border-radius:999px;width:30px;height:30px;display:grid;place-items:center;transition:background var(--t-fast) var(--ease),color var(--t-fast) var(--ease)}
.icon-btn:hover{background:#fff;color:var(--text);box-shadow:var(--shadow-soft)}
.icon-btn.danger:hover{background:rgba(221,107,116,.14);color:#b8555d;box-shadow:none}
.divider{width:1px;height:22px;background:var(--stroke);flex:none}

/* ---------- 按钮 ---------- */
.btn{
  border:1px solid var(--stroke2);background:var(--glass2);color:var(--text);border-radius:var(--r-sm);
  padding:8px 14px;font-weight:600;font-size:12.5px;min-height:36px;display:inline-flex;align-items:center;gap:6px;
  transition:transform var(--t-fast) var(--ease),background var(--t-fast) var(--ease),border-color var(--t-fast) var(--ease),box-shadow var(--t-fast) var(--ease);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:var(--shadow-soft);
}
.btn:hover{background:#fff;border-color:var(--accent);box-shadow:0 6px 20px rgba(232,145,180,.2)}
.btn:active{transform:scale(.97)}
.btn.primary{background:linear-gradient(135deg,var(--accent),#f0a8c8);border-color:transparent;color:#fff;box-shadow:0 6px 20px rgba(232,145,180,.34)}
.btn.primary:hover{background:linear-gradient(135deg,#f0a0c0,#e891b4);box-shadow:0 8px 26px rgba(232,145,180,.44)}
.btn.warn{background:linear-gradient(135deg,#f5c884,#f0b45c);border-color:transparent;color:#5a3a00;box-shadow:0 6px 20px rgba(240,180,92,.28)}
.btn.danger{border-color:#e8a0a8;color:#b8555d;background:rgba(221,107,116,.08)}
.btn:disabled{opacity:.42;cursor:not-allowed;transform:none;box-shadow:none}

/* ---------- 流程条 ---------- */
.pipeline-wrap{flex:none;display:flex;align-items:center;gap:var(--sp-3);position:sticky;top:var(--top-h,88px);z-index:4;background:rgba(252,243,249,.92);backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);border-bottom:1px solid var(--stroke);padding:var(--sp-2) var(--sp-5) var(--sp-2);margin:0 calc(var(--sp-5) * -1)}
.pipeline{display:grid;grid-template-columns:repeat(7,1fr);gap:var(--sp-2);flex:1}
.step{min-height:52px;border:1px solid var(--stroke);background:rgba(255,255,255,.46);border-radius:var(--r-sm);padding:8px 11px;display:flex;flex-direction:column;justify-content:center;gap:3px;transition:border-color var(--t-med) var(--ease),background var(--t-med) var(--ease),box-shadow var(--t-med) var(--ease)}
.step small{color:var(--faint);font-size:10px;letter-spacing:.1em;font-weight:700;font-variant-numeric:tabular-nums}
.step strong{font-size:12px;font-weight:600;color:var(--muted)}
.step.done{border-color:rgba(125,216,195,.5);background:linear-gradient(135deg,rgba(125,216,195,.16),rgba(125,216,195,.05))}
.step.done strong{color:#1f7f70}
.step.warn{border-color:rgba(233,168,63,.5);background:linear-gradient(135deg,rgba(233,168,63,.14),transparent)}
.step.warn strong{color:#9b6415}
.step.block{border-color:rgba(221,107,116,.5);background:linear-gradient(135deg,rgba(221,107,116,.13),transparent)}
.step.block strong{color:#b8555d}

/* ---------- 徽标 ---------- */
.badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--stroke2);border-radius:999px;padding:3px 10px;color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.02em;white-space:nowrap;background:rgba(255,255,255,.55);max-width:100%;overflow:hidden;text-overflow:ellipsis}
.badge.cyan{border-color:rgba(125,216,195,.55);color:#1f7f70}
.badge.red{border-color:rgba(221,107,116,.5);color:#b8555d}
.badge.amber{border-color:rgba(233,168,63,.5);color:#9b6415}

/* ---------- 两栏 ---------- */
.grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.32fr) minmax(360px,.98fr);gap:var(--sp-4);align-items:start}
.col{display:flex;flex-direction:column;gap:var(--sp-4);min-height:0;overflow:auto;scrollbar-width:thin;padding-right:var(--sp-1)}
.col::-webkit-scrollbar{width:6px}
.col::-webkit-scrollbar-thumb{background:rgba(180,140,200,.24);border-radius:3px}

/* ---------- 面板 ---------- */
.panel{background:rgba(255,255,255,.56);border:1px solid var(--stroke);border-radius:var(--r-lg);padding:var(--sp-4) var(--sp-5) var(--sp-5);flex:none;transition:border-color var(--t-med) var(--ease),box-shadow var(--t-med) var(--ease)}
.panel:hover{border-color:var(--stroke2);box-shadow:0 8px 26px rgba(232,145,180,.14)}
.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--sp-3);margin-bottom:var(--sp-3);padding-bottom:var(--sp-3);border-bottom:1px solid rgba(180,140,220,.14)}
.panel h2{font-size:14.5px;margin:0;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)}
.panel-num{display:inline-grid;place-items:center;min-width:26px;height:22px;padding:0 6px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.04em;font-variant-numeric:tabular-nums;color:#5f5192;background:rgba(157,142,240,.14);border:1px solid rgba(157,142,240,.22)}
.panel h3{font-size:12.5px;margin:0 0 var(--sp-2);color:var(--text)}

/* ---------- 表单 ---------- */
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)}
.field{display:flex;flex-direction:column;gap:var(--sp-1)}
.field.full{grid-column:1/-1}
.field label{color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.02em}
.field input,.field textarea,.field select{background:rgba(255,255,255,.75);border:1px solid var(--stroke);color:var(--text);border-radius:var(--r-sm);padding:8px 12px;outline:0;min-height:36px;transition:border-color var(--t-fast) var(--ease),box-shadow var(--t-fast) var(--ease),background var(--t-fast) var(--ease)}
.field input:focus,.field textarea:focus,.field select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(232,145,180,.15);background:#fff}
.field textarea{min-height:68px;resize:vertical}
.field input::placeholder,.field textarea::placeholder{color:rgba(141,130,166,.75)}
.actions{display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap;margin-top:var(--sp-3)}
.actions label.badge{cursor:pointer;gap:6px;padding:5px 11px;min-height:30px}
.actions input[type=checkbox],.actions input[type=radio]{accent-color:var(--accent);width:14px;height:14px}

/* ---------- 指标 / 发现 ---------- */
.split{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-2)}
.metric{background:linear-gradient(145deg,rgba(255,255,255,.72),rgba(255,255,255,.46));border:1px solid var(--stroke);border-radius:var(--r-sm);padding:10px 12px}
.metric b{font-size:20px;display:block;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:#6b5bb8}
.metric span{color:var(--muted);font-size:11px}
.finding{display:grid;grid-template-columns:8px 1fr auto;gap:var(--sp-3);align-items:start;padding:10px 0;border-bottom:1px solid rgba(180,140,220,.14)}
.finding:last-child{border-bottom:0}
.dot{width:8px;height:8px;border-radius:50%;background:var(--amber);margin-top:5px}
.dot.red{background:var(--red)}
.finding code{color:#6b5bb8;font-size:11px;word-break:break-all}
.finding p{margin:3px 0 0;color:var(--muted);font-size:12px}

/* ---------- 日志 ---------- */
.log{background:rgba(61,52,80,.05);border:1px solid rgba(180,140,220,.18);border-radius:var(--r-sm);padding:var(--sp-3);font:11px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:#5f5480;max-height:170px;overflow:auto;white-space:pre-wrap;scrollbar-width:thin;margin:0}
.banner{padding:10px 14px;border-radius:var(--r-sm);background:rgba(255,255,255,.72);border:1px solid var(--stroke);color:var(--text);font-size:12px;flex:none;white-space:pre-line}
.banner.error{border-color:rgba(221,107,116,.42);background:rgba(221,107,116,.1);color:#a03840}
.banner.ok{border-color:rgba(125,216,195,.5);background:rgba(125,216,195,.12);color:#1a6f60}

/* ---------- 编辑器 ---------- */
.editor-toolbar{display:flex;gap:var(--sp-2);align-items:center;margin-top:var(--sp-3)}
.editor-toolbar select{flex:1;min-width:0;background:rgba(255,255,255,.75);border:1px solid var(--stroke);color:var(--text);border-radius:var(--r-sm);padding:8px 12px;outline:0;min-height:36px}
.code-editor{width:100%;min-height:170px;margin-top:var(--sp-2);background:rgba(255,255,255,.8);border:1px solid var(--stroke);border-radius:var(--r-md);color:#4a3d63;padding:var(--sp-3);font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;tab-size:2;transition:border-color var(--t-fast) var(--ease),box-shadow var(--t-fast) var(--ease)}
.code-editor:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px rgba(232,145,180,.14)}

/* ---------- 弹窗 / 提示 ---------- */
.modal{position:fixed;inset:0;background:rgba(244,241,251,.55);display:none;align-items:center;justify-content:center;padding:var(--sp-5);z-index:40;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.modal.open{display:flex}
.modal-card{width:min(560px,100%);max-height:88vh;overflow:auto;background:rgba(255,255,255,.88);border:1px solid var(--stroke2);border-radius:var(--r-lg);padding:var(--sp-5);box-shadow:0 24px 70px rgba(180,140,200,.28);backdrop-filter:blur(44px) saturate(1.7);-webkit-backdrop-filter:blur(44px) saturate(1.7);transform:translateY(12px) scale(.98);transition:transform var(--t-med) var(--ease)}
.modal.open .modal-card{transform:none}
.modal-card h2{margin:0 0 var(--sp-1);font-size:16px}
.modal-card .form-grid{margin-top:var(--sp-4)}
.toast{position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;gap:var(--sp-2);z-index:60;max-width:min(420px,90vw)}
.toast div{background:rgba(255,255,255,.9);border:1px solid var(--stroke2);border-radius:var(--r-sm);padding:10px 14px;box-shadow:var(--shadow);font-size:12px;backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);color:var(--text);animation:toast-in 240ms var(--ease)}
.toast .bad{border-color:rgba(221,107,116,.5);color:#a03840}
@keyframes toast-in{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
.hidden{display:none!important}

/* ---------- 差异 ---------- */
.diff-wrap{display:grid;grid-template-columns:minmax(240px,300px) 1fr;gap:var(--sp-3);margin-top:var(--sp-3);align-items:start}
.diff-list{display:flex;flex-direction:column;gap:var(--sp-1);max-height:58vh;overflow:auto;scrollbar-width:thin;padding-right:2px}
.diff-item{display:flex;flex-direction:column;gap:2px;text-align:left;border:1px solid transparent;background:rgba(255,255,255,.55);border-radius:var(--r-xs);padding:7px 10px;font-size:12px;color:var(--text);transition:background var(--t-fast) var(--ease),border-color var(--t-fast) var(--ease)}
.diff-item:hover{background:#fff;border-color:var(--stroke2)}
.diff-item.active{border-color:var(--accent);background:linear-gradient(135deg,rgba(232,145,180,.14),rgba(157,142,240,.1))}
.diff-item .p{word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.diff-item small{color:var(--muted);font-size:11px}
.chip{display:inline-block;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:600;margin-right:6px}
.chip.added{background:rgba(125,216,195,.22);color:#1a6f60}
.chip.modified{background:rgba(233,168,63,.22);color:#9b6415}
.chip.deleted{background:rgba(221,107,116,.18);color:#a03840}
.diff-body{margin:0;background:rgba(61,52,80,.05);border:1px solid rgba(180,140,220,.18);border-radius:var(--r-sm);padding:var(--sp-3);font:11px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;color:#5f5480;max-height:58vh;overflow:auto;white-space:pre;scrollbar-width:thin}
.diff-body .dl-add{color:#1a6f60;background:rgba(125,216,195,.16);display:block}
.diff-body .dl-del{color:#a03840;background:rgba(221,107,116,.13);display:block}
.diff-body .dl-meta{color:var(--muted)}
.diff-excl{color:var(--muted);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 4px;word-break:break-all;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
@media(max-width:900px){.diff-wrap{grid-template-columns:1fr}}

@media(max-width:1200px){.shell{grid-template-columns:240px 1fr}}
@media(max-width:980px){
  .shell{grid-template-columns:1fr;grid-template-rows:auto 1fr;padding:var(--sp-3);gap:var(--sp-3)}
  .rail{flex-direction:row;align-items:center;overflow-x:auto;padding:var(--sp-3)}
  .rail-runs{flex:1;min-width:0}
  .rail-footer{display:none}
  .grid{grid-template-columns:1fr}
  .form-grid,.split{grid-template-columns:1fr 1fr}
  .pipeline{grid-template-columns:repeat(4,1fr)}
  .top{flex-direction:column;align-items:stretch}
  .top-actions{justify-content:flex-start}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:1ms!important;animation-duration:1ms!important}}
</style>
</head>
<body>
<div class="shell">
<aside class="rail">
  <div class="brand"><div class="mark"><img src="/assets/icon-mark.png" alt="" width="38" height="38" /></div><div><strong>Contest Publisher</strong><small>provenance workbench</small></div></div>
  <div class="rail-runs">
    <div class="rail-head">
      <button class="rail-label toggle" id="runsToggleBtn" type="button" aria-expanded="true" aria-controls="runs" title="点击折叠 / 展开运行列表"><span>运行 · <span id="runsCount">0</span></span><span class="chev" id="runsChev">▾</span></button>
      <button class="icon-btn danger" id="runsClearBtn" type="button" title="清除全部运行" aria-label="清除全部运行"><svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13"/></svg></button>
    </div>
    <div class="runs-filter" id="runsFilterWrap"><input id="runsFilter" type="search" placeholder="筛选 项目名 / 阶段" aria-label="筛选运行实例" /></div>
    <div id="runs" class="runs"><div class="empty">还没有运行实例</div></div>
  </div>
  <div class="rail-footer">源仓库只读 · 证据可追溯<br/>远程写入需要逐步确认</div>
</aside>
<main class="main">
  <header class="top"><div><div class="eyebrow">Code-only submission pipeline</div><h1 class="title">把代码变成可提交的作品。</h1><p class="sub" id="runCaption">先拉取一个源仓库开始。</p><div class="statusbar" id="targetHint" aria-live="polite"></div><p class="hint" id="actionHint" style="margin-top:6px"></p></div><div class="top-actions">
  <div class="icon-group" role="group" aria-label="工具与信息">
    <button class="icon-btn" id="helpBtn" title="使用说明" aria-label="使用说明"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z"/></svg></button>
    <button class="icon-btn" id="problemsBtn" title="赛题列表" aria-label="赛题列表"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg></button>
    <button class="icon-btn" id="envCheckBtn" title="环境自检" aria-label="环境自检"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.5-6 3.5 12 2.5-6H21"/></svg></button>
    <button class="icon-btn" id="settingsBtn" title="配置" aria-label="配置"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>
    <button class="icon-btn" id="refreshBtn" title="刷新状态" aria-label="刷新状态"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4.5V10h-5.5"/></svg></button>
    <button class="icon-btn danger" id="quitBtn" title="退出软件（结束本地服务进程）" aria-label="退出软件"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v9"/><path d="M6.5 6.5a7.5 7.5 0 1 0 11 0"/></svg></button>
  </div>
  <span class="divider" aria-hidden="true"></span>
  <button class="btn warn" id="autoRunBtn" disabled title="自动完成：审计 → 处理可脱敏/排除的发现 → 生成纯代码副本 → 验证。需要先拉取源仓库，且当前运行还没有工作副本。"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 5 13.5h5.5L9.5 22 19 10h-5.5z"/></svg><span id="autoRunLabel">一键自动</span></button>
  <button class="btn primary" id="autoPushBtn" disabled title="自动完成：创建 GitCode 公开仓库 → 确保仓库公开 → 初始化 → 推送 → 锁定赛题 → 生成提交计划。需要先在 03 面板运行验证并 passed，再在 配置 填好 GitCode Token 与 STS 凭证。"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 15.5C4 17 3.5 21 3.5 21s4-.5 5.5-2"/><path d="M14.5 3.5c3.6 0 6 2.4 6 6 0 4.6-4 8.6-9 10.2l-2.2-2.2-2.2-2.2c1.6-5 5.6-9 10.4-11.8z"/><circle cx="15" cy="9" r="1.4"/></svg><span id="autoPushLabel">一键推送</span></button>
  <button class="btn" id="newRunBtn"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>新建运行</button>
</div></header>
  <div class="pipeline-wrap"><span id="stageBadge" class="badge">未开始</span><div id="pipeline" class="pipeline"></div></div>
  <div id="notice" class="banner hidden"></div>
  <div class="grid">
    <div class="col">
      <section class="panel" id="acquirePanel"><div class="panel-head"><div><h2><span class="panel-num">01</span>获取源仓库</h2><p class="hint">Git 链接或本地代码包都可以；固定快照，source 目录只读。</p></div><span class="badge cyan">SOURCE</span></div><form id="acquireForm"><div class="actions" style="margin-top:0"><label class="badge"><input type="radio" name="sourceMode" id="modeGit" checked /> Git 链接</label><label class="badge"><input type="radio" name="sourceMode" id="modeLocal" /> 本地仓库（放代码包，下拉选取）</label></div><div class="form-grid" id="gitFields"><div class="field full"><label>仓库 HTTPS 地址</label><input id="sourceUrl" placeholder="https://gitcode.com/org/project.git" /></div><div class="field"><label>分支或 ref</label><input id="sourceRef" value="main" /></div></div><div class="form-grid hidden" id="localFields"><div class="field full"><label>从本地仓库选取</label><div style="display:flex;gap:6px"><select id="localSourceSelect" style="flex:1"><option value="">（下拉选取，先放代码包）</option></select><button class="btn" type="button" id="refreshLocalBtn" style="flex:none">刷新列表</button><button class="btn" type="button" id="openLocalDirBtn" style="flex:none">打开文件夹</button></div></div><div class="field full"><label class="hint" id="localDirHint" style="margin:0"></label></div></div><div class="form-grid"><div class="field full"><label>运行根目录（自动填写并记住）</label><input id="runsRoot" placeholder="默认 ~/contest-publisher-runs" title="每次拉取都会带上这里显示的根目录；修改后立即生效并保存，下次启动自动沿用" /></div></div><div class="actions"><button class="btn primary" type="submit" id="acquireSubmit">拉取并创建运行</button></div></form></section>
      <section class="panel" id="auditPanel"><div class="panel-head"><div><h2><span class="panel-num">02</span>审计与清理</h2><p class="hint">个人信息、凭证、运行产物和项目特征分开处理。</p></div><span id="auditBadge" class="badge">等待审计</span></div><div class="split"><div class="metric"><b id="trackedMetric">—</b><span>受版本控制文件</span></div><div class="metric"><b id="codeMetric">—</b><span>代码文件</span></div><div class="metric"><b id="reviewMetric">—</b><span>待复核发现</span></div><div class="metric"><b id="secretMetric">—</b><span>凭证发现</span></div></div><div class="actions"><label class="badge"><input id="rightsReviewed" type="checkbox" /> 已审阅代码授权</label><label class="badge"><input id="rulesReviewed" type="checkbox" /> 已审阅赛题规则</label></div><div class="actions"><button class="btn" id="auditBtn" disabled>执行审计</button><button class="btn" id="prepareBtn" disabled>生成纯代码副本</button></div><div id="findings" class="hidden"></div></section>
      <section class="panel" id="verifyPanel"><div class="panel-head"><div><h2><span class="panel-num">03</span>编写与验证</h2><p class="hint">在工作台内补充代码；验证会检查凭证、语法、文件白名单与原创增量（搬运模式可豁免最后一条）。</p></div><span id="verifyBadge" class="badge">等待副本</span></div><div class="field"><label>工作副本路径</label><input id="workDir" readonly placeholder="生成副本后显示" /></div><div class="editor-toolbar"><select id="fileSelect" disabled><option>生成副本后选择代码文件</option></select><button class="btn" id="newFileBtn" disabled>新建代码文件</button><button class="btn" id="loadFileBtn" disabled>打开</button><button class="btn primary" id="saveFileBtn" disabled>保存文件</button></div><textarea id="codeEditor" class="code-editor" spellcheck="false" placeholder="选取或新建代码文件，在此编写赛题功能。"></textarea><div class="actions"><label class="badge"><input id="copyMode" type="checkbox" disabled /> 搬运模式（豁免原创增量，其余门禁照旧）</label><label class="badge" id="modeBadge">严格模式</label></div><div class="actions"><button class="btn" id="verifyBtn" disabled>运行验证</button><button class="btn" id="scaffoldBtn" disabled title="在工作副本里生成可运行的赛题实现脚手架（结构+自检），逻辑位置留 TODO 给你填"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3H5a2 2 0 1 1 0-4h1V6a1 1 0 0 1 1-1h3z"/></svg>生成脚手架</button><button class="btn" id="diffBtn" disabled title="逐行对比 work/ 与 source/，并区分工具脱敏改写和你自己的改动"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M7.5 8 4 11.5 7.5 15M16.5 9l3.5 3.5-3.5 3.5"/></svg>对比原仓库</button><button class="btn" id="openWorkBtn" disabled><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span id="openWorkLabel">在 Finder 中打开</span></button></div><pre id="verifyLog" class="log hidden"></pre></section>
    </div>
    <div class="col">
      <section class="panel" id="repoPanel"><div class="panel-head"><div><h2><span class="panel-num">04</span>个人仓库</h2><p class="hint">创建公开 GitCode 仓库并上传（ICT 平台要求作品仓库所有人可见）。</p></div><span id="repoBadge" class="badge">未创建</span></div><div class="form-grid"><div class="field full"><label>目标仓库名称</label><input id="repoName" placeholder="contest-project" /></div><div class="field full"><label>GitCode Access Token（仅本次内存使用）</label><input id="gitToken" type="password" placeholder="输入后不会写入日志或仓库" /></div><div class="field"><label>提交作者名</label><input id="authorName" placeholder="Contest Author" /></div><div class="field"><label>提交邮箱</label><input id="authorEmail" placeholder="author@example.invalid" /></div></div><div class="actions"><button class="btn" id="createRepoBtn" disabled>创建公开仓库</button><button class="btn" id="initRepoBtn" disabled>初始化本地仓库</button><button class="btn primary" id="pushBtn" disabled>上传代码</button></div><pre id="repoLog" class="log hidden"></pre></section>
      <section class="panel" id="competitionPanel"><div class="panel-head"><div><h2><span class="panel-num">05</span>ICT 大赛</h2><p class="hint">选择赛题、锁定目标、检查窗口并提交。</p></div><span id="competitionBadge" class="badge">等待推送</span></div><div class="form-grid"><div class="field full"><label>ICT Skill 目录</label><input id="skillDir" placeholder="/absolute/path/to/huawei-cloud-publish-ict-work" /></div><div class="field"><label>STS 凭证文件</label><input id="credsPath" placeholder="/absolute/path/sts-creds.json" /></div><div class="field"><label>赛题序号</label><input id="problemNumber" type="number" min="1" placeholder="1" /></div></div><div class="actions"><button class="btn" id="selectProblemBtn" disabled>查询并锁定赛题</button><button class="btn primary" id="submitBtn" disabled>生成提交计划</button><button class="btn warn" id="executeSubmitBtn" disabled>执行提交</button><button class="btn" id="judgeBtn" disabled title="查询判题结果：判题由平台异步进行，失败原因会在这里显示（这是「为什么没通过」的权威来源）"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg><span id="judgeLabel">查询判题结果</span></button></div><div id="judgeResult" class="banner hidden"></div><pre id="competitionLog" class="log hidden"></pre></section>
      <section class="panel"><div class="panel-head"><div><h2>运行证据</h2><p class="hint">每一步的结果落在当前 run 的 evidence 目录。</p></div><span class="badge cyan">TRACEABLE</span></div><pre id="evidenceLog" class="log">等待运行实例。</pre></section>
    </div>
  </div>
</main>
</div>
<div id="settingsModal" class="modal"><div class="modal-card"><h2>⚙ 自动化配置</h2><p class="hint">配置只存在本机（浏览器 localStorage + 本机设置文件），不会上传到任何服务；Token 仅在创建仓库和推送时使用。「导出配置」默认连 Token 一起导出（明文，别外传）。</p><div class="form-grid">
<div class="field full"><label>作品 / 仓库名称（留空自动跟随源仓库名）</label><input id="cfgRepoName" placeholder="留空自动跟随源仓库名" /></div>
<div class="field full"><label>GitCode Access Token</label><input id="cfgGitToken" type="password" placeholder="仅在创建仓库和推送时使用" /></div>
<div class="field"><label>提交作者名（留空自动读 git config）</label><input id="cfgAuthorName" placeholder="留空则使用全局 git config user.name" /></div>
<div class="field"><label>提交邮箱（可选）</label><input id="cfgAuthorEmail" placeholder="留空则使用全局 git config user.email" /></div>
<div class="field"><label>华为云账号 ID（Domain ID，32 位）</label><input id="cfgAccountId" placeholder="用于自动生成 STS" /></div>
<div class="field"><label>STS 凭证文件（绝对路径）</label><div style="display:flex;gap:6px"><input id="cfgCredsPath" placeholder="可手动填或点旁边按钮生成" style="flex:1" /><button class="btn" id="genStsBtn" style="flex:none;padding:6px 12px"><span id="genStsLabel">生成</span></button></div></div>
<div class="field"><label>赛题序号（点右侧按钮查看并选择全部赛题）</label><div style="display:flex;gap:6px"><input id="cfgProblemNumber" type="number" min="1" value="1" style="flex:1" /><button class="btn" id="fetchProblemsBtn" style="flex:none;padding:6px 12px">📋 选择</button></div></div>
<input type="hidden" id="cfgProblemName" />
<div class="field full"><label>本地仓库目录（放 GitHub 下载的代码包，01 面板下拉选取）</label><div style="display:flex;gap:6px"><input id="cfgLocalSourcesDir" placeholder="默认 ~/contest-publisher-sources" style="flex:1" /><button class="btn" id="openLocalDirCfgBtn" style="flex:none;padding:6px 12px">打开</button></div></div>
<div class="field full"><label>额外保留的源路径（每行一个，如 reports/ 或 dashboard/；赛题要求的报告/看板产物）</label><textarea id="cfgKeepPaths" placeholder="reports/&#10;dashboard/&#10;scheduler/"></textarea></div>
</div><div class="actions"><label class="badge"><input id="cfgExecuteSubmit" type="checkbox" /> 最终提交也自动执行</label></div>
<div class="actions"><button class="btn" id="exportCfgBtn" title="把当前配置导出成 JSON 文件（默认不含 GitCode Token），导出后会自动打开所在目录">⬇ 导出配置</button><button class="btn" id="importCfgBtn" title="从导出的 JSON 文件恢复配置；导入前会先列出将要覆盖的项">⬆ 导入配置</button><label class="badge" title="导出文件里含 GitCode Token 明文，别转发、别提交进仓库；只想搬设置不搬凭证就取消勾选"><input id="cfgIncludeToken" type="checkbox" checked /> 导出含 Token（明文）</label><input type="file" id="importCfgFile" accept=".json,application/json" style="display:none" /></div>
<div class="actions"><button class="btn" id="cancelSettings">取消</button><button class="btn primary" id="saveSettings">保存配置</button><button class="btn warn" id="clearSettings">清除所有保存</button></div></div></div>
<div id="problemsModal" class="modal"><div class="modal-card" style="width:min(680px,100%);max-height:84vh;overflow:auto"><h2>📋 赛题列表</h2><p class="hint" id="problemsSummary">从平台拉取当前可选的 AI 赛题；点击一行把它设为本次提交目标。</p><div id="problemsList" style="margin-top:14px;display:flex;flex-direction:column;gap:8px"></div><div class="actions" style="margin-top:16px"><button class="btn" id="reloadProblems">重新拉取</button><button class="btn primary" id="closeProblems">关闭</button></div></div></div>
<div id="envModal" class="modal"><div class="modal-card" style="width:min(640px,100%)"><h2>🩺 环境自检</h2><p class="hint">检测本机运行所需的所有依赖与网络。</p><div id="envList" style="margin-top:14px;display:flex;flex-direction:column;gap:8px;font-size:13px"></div><div class="actions" style="margin-top:16px"><button class="btn" id="rerunEnvCheck">重新检测</button><button class="btn primary" id="closeEnv">关闭</button></div></div></div>
<div id="helpModal" class="modal"><div class="modal-card" style="width:min(720px,100%);max-height:84vh;overflow:auto"><h2>📖 使用说明</h2>
<h3 style="margin-top:16px">工作流程</h3>
<ol style="line-height:1.9;color:var(--text);font-size:13px;padding-left:22px">
<li><b>⚙ 配置</b>：先填好 GitCode Token、作者信息、赛题序号（点旁边「📋 选择」可从平台拉取全部赛题并点选）。STS 凭证文件路径也在此填写。数据仅保存在本机浏览器。<b>作品 / 仓库名称留空时自动跟随源仓库名</b>（如拉取 <code>.../Project.git</code> 就建 <code>Project</code>）。</li>
<li><b>左侧运行列表</b>：按项目名展示，搜索框即时过滤（项目名 / 阶段），点标题行可折叠；<b>🧹 一键清除</b>会删掉全部运行——含未推送工作副本的默认跳过，二次确认后才强制删除。</li>
<li><b>本地代码包默认搬运模式</b>：从本地仓库创建运行时自动按"搬运模式"发布（本地包没有上游基线，原创增量门禁不适用），一键自动即可通过验证；含疑似凭证的文件会被自动排除出副本（日志里会列出），凭证不会进入提交内容。</li>
<li><b>📋 赛题列表</b>：顶部按钮，随时从平台拉取当前全部 AI 赛题（含窗口与状态），点一行即设为目标；标题下方的 <span style="color:var(--muted)">🎯 目标赛题 / 📦 目标仓库</span> 一行常驻显示本次要提交的赛题（锁定后显示 problemId），一键推送前的确认框也会再次列出，避免"提交了但不知道哪道题"。</li>
<li><b>获取源仓库</b>：两种方式——①「Git 链接」粘贴仓库 HTTPS 地址；②「本地仓库」把 GitHub 下载的代码包（文件夹或 zip）放进代码包目录，点「刷新列表」后下拉选取。都生成 runs/&lt;id&gt;/ 目录，source/ 只读。运行根目录与代码包目录都会自动填写并记住。</li>
<li><b>删除运行</b>：左侧 Runs 列表每项右侧的 🗑 可删除该运行（source / work / evidence 一并移除）。尚未推送成功的工作副本会要求二次确认，避免误删唯一改动。</li>
<li><b>⚡ 一键自动</b>：审计 → 自动处理可脱敏/排除的发现 → 生成纯代码副本 → 验证。<b>可用条件</b>：已拉取源仓库，且当前运行还没有工作副本（ACQUIRED / AUDITED / REVIEW_REQUIRED / BLOCKED_AUDIT）。已生成副本后请改用 03 面板编辑 + "运行验证"，避免覆盖已有改动。</li>
<li><b>03 编写与验证</b>：在工作副本里补充原创代码（必须与源仓库有代码差异），完善 CONTRIBUTIONS.md，然后点"运行验证"。</li>
<li><b>🔍 对比原仓库</b>：03 面板的按钮，逐行对比 <code>work/</code> 与 <code>source/</code>（固定 commit）：每个文件标出 <b>新增 / 修改 / 删除</b>、±行数，并区分三种来源——<b>工具生成</b>（README/UPSTREAM/CONTRIBUTIONS 等）、<b>工具脱敏改写</b>（prepare 替换了邮箱或本机路径）、<b>你的改动</b>（你自己写的代码）。左侧点文件看 unified diff，底部列出按策略没进 work/ 的源文件。命令行同款：<code>node bin/contest-publisher.mjs diff --run runs/&lt;id&gt;</code>（加 <code>--stat</code> 只看清单）。</li>
<li><b>🚀 一键推送</b>：创建 GitCode <b>公开</b>仓库 → 确保仓库公开（平台要求所有人可见，老 run 的私有仓库会被自动改公开）→ 初始化本地仓库 → 推送 → 锁定赛题 → 生成提交计划（或按配置直接提交）。<b>可用条件</b>：03 面板"运行验证"passed（阶段 VERIFIED 及以后），并在 ⚙ 配置 填好 GitCode Access Token 与 STS 凭证文件路径。推送过程中按钮会实时显示<b>第几步/共 7 步</b>和当前步骤名，分步日志同步写入"运行证据"面板，失败时停在那一步并给出原因。</li>
<li><b>按钮为什么是灰的</b>：标题栏下方那行提示（<span style="color:var(--muted)">⚡ / 🚀 开头的灰字</span>）会实时写明两个按钮的可用条件和"下一步该点哪里"；鼠标悬停在按钮上也有同样的说明。</li>
<li><b>保留产物（判题要求）</b>：有些赛题的验收标准要求仓库里能看到报告/看板等产物，而这属于默认排除的运行产物。把目录名（如 <code>reports</code>、<code>dashboard</code>）填进 ⚙ 配置 的「额外保留的源路径」（或在 🔍 对比原仓库 的排除清单里点「保留」），重新拉取并准备后这些文件会进入副本；文本仍自动脱敏个人信息/本机路径，密钥照旧硬阻断。</li>
<li><b>🔎 查询判题结果</b>：判题由平台异步进行，05 面板按钮可随时取回 <code>judgeStatus</code> 与失败原因（<code>failureReason</code>），面板顶部横幅常驻显示——这是"为什么没通过"的权威来源。每题最多 3 次提交机会，2 次重提机会用完即封顶。</li>
<li><b>搬运模式</b>：如果这个 run 就是把上游仓库直接搬进自己仓库再提交，不需要原创代码，在 03 面板勾上「搬运模式」——原创增量那条门禁改为豁免并记入 <code>evidence/run-mode.json</code>（凭证、语法、文件白名单照旧检查）。<b>CONTRIBUTIONS.md / UPSTREAM.md 不是门禁</b>：工具会在验证 / 切模式时把两者的内容统一写成 <code>此为大赛提交所建</code>（四个章节与 UPSTREAM.md 同一句）；你自己写过的内容不会被覆盖。</li>
</ol>
<h3 style="margin-top:16px">常见报错说明</h3>
<table style="width:100%;font-size:12px;border-collapse:collapse;color:var(--text)">
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>Audit is blocked</b></td><td style="padding:6px 8px">源仓库存在凭证（API Key / 密码）或子模块。回源仓库清除后重新拉取。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>no-original-code-delta</b></td><td style="padding:6px 8px">工作副本与源仓库代码完全一致。必须在 03 面板里修改/新增至少一个代码文件。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>contribution-record-incomplete</b></td><td style="padding:6px 8px">CONTRIBUTIONS.md 里有 TODO / 占位文本。填写实际改动与验证步骤。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>请输入 GitCode Access Token</b></td><td style="padding:6px 8px">未配置 Token。点 ⚙ 配置 填入。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>ICT skill script not found</b></td><td style="padding:6px 8px">未找到内置 Skill 目录。点 🩺 环境自检 查看 skill 项。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>STS 凭证如何获取？</b></td><td style="padding:6px 8px">两种方式：<br/>① <b>推荐</b>：本机已装 KooCLI（hcloud）且配置过 AK/SK 时，在 ⚙ 配置 的"华为云账号 ID"填 32 位 Domain ID，点"自动生成 STS"，凭证会自动落盘并填入路径。<br/>② 手动：按 ICT Skill <code>references/iam-policies.md</code> 生成 sts-creds.json，把绝对路径填到配置面板。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>提交作者名如何来？</b></td><td style="padding:6px 8px">优先使用配置面板填写的值；留空则自动读取 <code>git config --global user.name</code>。邮箱同理，非必填。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>Source acquisition failed</b></td><td style="padding:6px 8px">Git clone 失败。检查仓库地址是否为 HTTPS 且可访问，分支名是否正确。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>Audit has N unresolved review finding(s)</b></td><td style="padding:6px 8px">还有发现没处理：在 02 面板点“处理”。每个类别只接受特定处理方式——许可证类只能选“已审阅许可证”，归属文件（LICENSE/NOTICE）里的联系方式只能选“保留归属信息”，否则会提示 Decision ... is not allowed。</td></tr>
<tr style="border-bottom:1px solid var(--stroke)"><td style="padding:6px 8px"><b>Review decisions are stale</b></td><td style="padding:6px 8px">审计结果已更新但人工决定未跟进。重新跑 ⚡ 一键自动。</td></tr>
<tr><td style="padding:6px 8px"><b>提交前验证未通过</b></td><td style="padding:6px 8px">查看"运行证据"面板里的 verify 状态和具体 finding，按提示修复。</td></tr>
</table>
<div class="actions" style="margin-top:18px"><button class="btn primary" id="closeHelp">我知道了</button></div>
</div></div>
<div id="reviewModal" class="modal"><div class="modal-card"><h2>处理审计发现</h2><p class="hint" id="reviewTitle"></p><div class="form-grid"><div class="field"><label>处理决定</label><select id="reviewDecision"><option value="sanitize">替换个人信息/路径</option><option value="exclude-file">排除文件</option><option value="false-positive">确认误报</option><option value="license-reviewed">已审阅许可证</option><option value="retain-attribution">保留归属信息</option></select></div><div class="field"><label>说明</label><input id="reviewNote" placeholder="填写处理依据" /></div></div><div class="actions"><button class="btn" id="cancelReview">取消</button><button class="btn primary" id="saveReview">保存决定</button></div></div></div>
<div id="diffModal" class="modal"><div class="modal-card" style="width:min(1100px,100%);max-height:88vh;overflow:auto"><h2>🔍 与原仓库的差异</h2><p class="hint" id="diffSummary">读取中…</p><div class="diff-wrap"><div id="diffList" class="diff-list"></div><pre id="diffBody" class="diff-body">选择左侧文件查看逐行差异</pre></div><div class="actions" style="margin-top:14px"><button class="btn" id="diffAllBtn">全部差异</button><button class="btn" id="closeDiff">关闭</button></div></div></div>
<div id="toast" class="toast"></div>
<script>
const state={run:null,audit:null,verification:null,selected:null,repo:null,reviewing:null,reviewed:[],actionLog:null,platform:''};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// macOS 是访达，Windows 是资源管理器；用哪个词由 /api/health 报回来的平台决定。
const isWindows=()=>state.platform==='win32';
const revealLabel=()=>isWindows()?'在资源管理器中打开':'在 Finder 中打开';
async function api(path,options={}){const r=await fetch(path,{headers:{'content-type':'application/json',...(options.headers||{})},...options});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d={raw:t}}if(!r.ok)throw new Error(d.error||d.message||t||\`HTTP \${r.status}\`);return d}
function toast(message,bad=false){const d=document.createElement('div');d.textContent=message;if(bad)d.className='bad';$('toast').appendChild(d);setTimeout(()=>d.remove(),4200)}
// 自绘确认框：WKWebView 没有 uiDelegate 时 window.confirm/prompt 直接返回 false/null，
// 会让删除、建副本、新建文件这些按钮"点了没反应"。改成页面内弹窗后与宿主无关。
function uiDialog(o={}){
  return new Promise(resolve=>{
    const host=document.createElement('div');host.className='modal open';
    const input=o.input?'<div class="field" style="margin-top:12px"><input id="uiDialogInput" value="'+esc(o.value||'')+'" placeholder="'+esc(o.placeholder||'')+'" /></div>':'';
    host.innerHTML='<div class="modal-card" role="dialog" aria-modal="true"><h2>'+esc(o.title||'确认')+'</h2><p class="hint" style="white-space:pre-line">'+esc(o.message||'')+'</p>'+input+'<div class="actions" style="margin-top:18px"><button class="btn" data-ui-cancel>取消</button><button class="btn '+(o.danger?'danger':'primary')+'" data-ui-ok>'+esc(o.okText||'确认')+'</button></div></div>';
    document.body.appendChild(host);
    const field=host.querySelector('#uiDialogInput');
    const close=value=>{document.removeEventListener('keydown',onKey);host.remove();resolve(value)};
    const onKey=e=>{if(e.key==='Escape')close(o.input?null:false);else if(e.key==='Enter'&&o.input){e.preventDefault();close(field.value.trim()||null)}};
    host.querySelector('[data-ui-cancel]').onclick=()=>close(o.input?null:false);
    host.querySelector('[data-ui-ok]').onclick=()=>close(o.input?(field.value.trim()||null):true);
    document.addEventListener('keydown',onKey);
    if(o.input)field.focus();else host.querySelector('[data-ui-ok]').focus();
  });
}
function stageClass(stage){if(!stage)return '';if(stage.startsWith('BLOCKED'))return 'block';if(stage==='REVIEW_REQUIRED')return 'warn';return ['ACQUIRED','AUDITED','PREPARED','VERIFIED','REPOSITORY_CREATED','INITIALIZED','PUSHED','PROBLEM_LOCKED','SUBMITTED'].includes(stage)?'done':''}
function renderPipeline(){const stage=state.run?.stage||'CREATED';const stages=[['01','获取','ACQUIRED'],['02','审计','AUDITED'],['03','副本','PREPARED'],['04','验证','VERIFIED'],['05','仓库','PUSHED'],['06','赛题','PROBLEM_LOCKED'],['07','提交','SUBMITTED']];$('pipeline').innerHTML=stages.map(([n,label,key])=>{const done=stage===key||['SUBMITTED','PROBLEM_LOCKED','PUSHED','VERIFIED','PREPARED','AUDITED'].includes(stage)&&stages.findIndex(x=>x[2]===key)<stages.findIndex(x=>x[2]===stage);return \`<div class="step \${done?'done':''} \${stageClass(stage)}"><small>\${n}</small><strong>\${label}</strong></div>\`}).join('');$('stageBadge').textContent=stage==='CREATED'?'未开始':stage;$('stageBadge').className=\`badge \${stageClass(stage)==='block'?'red':stageClass(stage)==='warn'?'amber':stageClass(stage)==='done'?'cyan':''}\`}
// 运行列表可折叠：数量多了以后折起来给主区域让位；状态记忆在 localStorage，重启软件仍保留。
const RUNS_COLLAPSED_KEY='cp_runs_collapsed';
function applyRunsCollapsed(){
  const collapsed=localStorage.getItem(RUNS_COLLAPSED_KEY)==='1';
  $('runs').classList.toggle('hidden',collapsed);
  $('runsFilterWrap').classList.toggle('hidden',collapsed);
  $('runsChev').textContent=collapsed?'▸':'▾';
  $('runsToggleBtn').setAttribute('aria-expanded',String(!collapsed));
}
$('runsToggleBtn').onclick=()=>{
  localStorage.setItem(RUNS_COLLAPSED_KEY,localStorage.getItem(RUNS_COLLAPSED_KEY)==='1'?'0':'1');
  applyRunsCollapsed();
};
$('runsFilter').oninput=()=>{localStorage.setItem(RUNS_FILTER_KEY,$('runsFilter').value);refreshRuns()};
// 一键清除：与单条删除同一套护栏——含未推送工作副本的默认跳过，用户确认后再强制清除。
$('runsClearBtn').onclick=async()=>{
  let runs=[];
  try{runs=await api('/api/runs')}catch(e){toast(e.message,true);return}
  if(!runs.length){toast('没有可清除的运行');return}
  const ok=await uiDialog({title:'清除全部运行',message:'将删除全部 '+runs.length+' 个运行实例（source / work / evidence 一并移除，不可恢复）。\\n含未推送工作副本的运行会被跳过。',okText:'全部删除',danger:true});
  if(!ok)return;
  try{
    const first=await api('/api/runs/clear',{method:'POST',body:JSON.stringify({force:false})});
    let deleted=first.deleted?.length||0;
    let skipped=first.skipped||[];
    if(skipped.length){
      const force=await uiDialog({title:'强制清除剩余运行',message:'还有 '+skipped.length+' 个运行含尚未推送的工作副本，强制删除会永久丢失这些本地改动：\\n'+skipped.slice(0,6).map(item=>'· '+item.runId).join('\\n')+(skipped.length>6?'\\n…':'')+String.fromCharCode(10,10)+'仍要全部删除吗？',okText:'仍然全部删除',danger:true});
      if(force){
        const second=await api('/api/runs/clear',{method:'POST',body:JSON.stringify({force:true})});
        deleted+=second.deleted?.length||0;skipped=second.skipped||[];
      }
    }
    toast('已清除 '+deleted+' 个运行'+(skipped.length?'，保留 '+skipped.length+' 个未推送的':''));
    if(state.run&&!(await api('/api/runs')).some(r=>runMatches(r,runRef())))clearRun();
    await refreshRuns();
  }catch(e){toast(e.message,true)}
};
// 运行列表：状态点 + 关键词筛选（数量多时用得上），行内删除按钮悬停才出现。
const RUNS_FILTER_KEY='cp_runs_filter';
const ICON_TRASH='<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13"/></svg>';
function stageTone(stage){
  const s=String(stage||'');
  if(s.startsWith('BLOCKED')||s==='ACQUIRE_FAILED')return 'block';
  if(s==='REVIEW_REQUIRED')return 'warn';
  if(['SUBMITTED','PROBLEM_LOCKED','PUSHED','INITIALIZED','REPOSITORY_CREATED','VERIFIED','PREPARED','AUDITED','ACQUIRED'].includes(s))return 'done';
  return '';
}
// 列表按「项目名」展示（本地包名 / 仓库名），时间戳退到 title：用户认的是项目，不是 run id。
function runLabel(r,id){
  if(r.source?.sourceKind==='local')return String(r.source.localName||'').replace(/\.zip$/i,'')||id;
  const url=r.source?.sourceUrl;
  if(url){try{return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop()||'').replace(/\.git$/i,'')||id}catch{}}
  return id;
}
function renderRuns(runs){
  const filter=($('runsFilter')?.value||'').trim().toLowerCase();
  const visible=filter?runs.filter(r=>{
    const id=String(r.runId||'');
    return id.toLowerCase().includes(filter)||String(r.stage||'').toLowerCase().includes(filter)||runLabel(r,id).toLowerCase().includes(filter);
  }):runs;
  $('runsCount').textContent=String(runs.length);
  $('runs').innerHTML=visible.length?visible.map(r=>{
    const id=r.runId||String(r.runDir||'').split('/').pop();
    const active=!!state.run&&r.runDir===state.run.runDir;
    const label=runLabel(r,id);
    return \`<div class="run-row"><button class="run \${active?'active':''}" data-run="\${esc(id)}" title="\${esc(label)} · \${esc(r.stage)} · \${esc(id)}"><span class="stage-dot \${stageTone(r.stage)}" aria-hidden="true"></span><span class="run-text"><span class="id">\${esc(label)}</span><span class="stage-label">\${esc(r.stage)}</span></span></button><button class="run-del" data-del="\${esc(id)}" title="删除该运行" aria-label="删除 \${esc(label)}">\${ICON_TRASH}</button></div>\`;
  }).join(''):(runs.length?'<div class="empty">没有匹配的运行</div>':'<div class="empty">还没有运行实例</div>');
  document.querySelectorAll('[data-run]').forEach(b=>b.onclick=()=>loadRun(b.dataset.run));
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=e=>{e.stopPropagation();removeRun(b.dataset.del)});
}
function runRef(){const r=state.run;return r?.runId||String(r?.runDir||'').split('/').pop()||''}
function runMatches(item,id){return !!item&&(item.runId===id||String(item.runDir||'').endsWith('/'+id))}
function clearRun(){state.run=null;state.audit=null;state.selected=null;state.repo=null;state.reviewed=[];state.actionLog=null;editorPath=null;$('codeEditor').value='';$('workDir').value='';$('fileSelect').innerHTML='<option>生成副本后选择代码文件</option>';$('findings').innerHTML='';$('runCaption').textContent='先拉取一个源仓库开始。';$('evidenceLog').textContent='等待运行实例。';$('auditBadge').textContent='等待审计';$('verifyBadge').textContent='等待副本';$('repoBadge').textContent='未创建';$('competitionBadge').textContent='等待推送';$('openWorkBtn').disabled=true;for(const id of ['fileSelect','newFileBtn','loadFileBtn','saveFileBtn','auditBtn','prepareBtn','verifyBtn','createRepoBtn','initRepoBtn','pushBtn','selectProblemBtn','submitBtn','executeSubmitBtn','autoRunBtn','autoPushBtn'])$(id).disabled=true;renderRun();renderFindings()}
async function removeRun(id){
  const ok=await uiDialog({title:'删除运行',message:'删除运行 '+id+'？该运行的 source / work / evidence 会全部移除，无法恢复。',okText:'删除',danger:true});
  if(!ok)return;
  try{await api(\`/api/runs/\${encodeURIComponent(id)}\`,{method:'DELETE'});toast(\`已删除 \${id}\`);if(runMatches(state.run,id))clearRun();await refreshRuns()}
  catch(e){
    if(/强制删除/.test(e.message)){
      const forced=await uiDialog({title:'强制删除',message:e.message+'\\n继续会永久丢失该运行里尚未推送的本地改动。',okText:'仍然删除',danger:true});
      if(!forced)return;
      try{await api(\`/api/runs/\${encodeURIComponent(id)}?force=1\`,{method:'DELETE'});toast(\`已强制删除 \${id}\`);if(runMatches(state.run,id))clearRun();await refreshRuns()}
      catch(e2){toast(e2.message,true)}
      return;
    }
    toast(e.message,true);
  }
}
async function refreshRuns(){const runs=await api('/api/runs');renderRuns(runs)}
function setEnabled(id,on){$(id).disabled=!on}
const WORK_STAGES=['PREPARED','VERIFIED','REPOSITORY_CREATED','INITIALIZED','PUSHED','PROBLEM_LOCKED','SUBMITTED','BLOCKED_VERIFY'];
// 两个一键按钮什么时候能点、不能点时下一步做什么，都写在这一行里，避免"按钮是灰的又不说为什么"。
function renderActionHint(){
  const r=state.run;const tips=[];
  const autoRun=$('autoRunBtn').disabled, autoPush=$('autoPushBtn').disabled;
  if(!r){tips.push('一键自动 / 一键推送：先在 01 面板「拉取并创建运行」');}
  else{
    if(!autoRun){
      if(!r.source)tips.push('一键自动：该运行没有源快照（拉取失败），请重新拉取');
      else tips.push('一键自动：审计 → 自动处理可脱敏/排除的发现 → 生成纯代码副本 → 验证');
    }else if(r.stage==='SUBMITTED'){tips.push('一键自动：该运行已提交，要重做请点右上「新建运行」');}
    else{tips.push('一键自动：已存在工作副本（'+r.stage+'），直接改 03 面板代码后点「运行验证」；纯搬运就勾上「搬运模式」');}
    if(!autoPush){
      const cfg=getCfg();
      tips.push(cfg.gitToken&&cfg.credsPath?'一键推送：建仓 → 初始化 → 推送 → 锁赛题 → 提交计划':'一键推送：还需在 ⚙ 配置 填 GitCode Token 与 STS 凭证');
    }else if(['ACQUIRED','AUDITED','REVIEW_REQUIRED'].includes(r.stage)){tips.push('一键推送：先跑 ⚡ 一键自动 生成工作副本');}
    else if(r.stage==='PREPARED'){tips.push('一键推送：在 03 面板补齐原创代码与 CONTRIBUTIONS.md 后点「运行验证」，passed 后解锁');}
    else if(String(r.stage).startsWith('BLOCKED')){tips.push('一键推送：验证被阻断，按「运行证据」里的 finding 修复后重跑「运行验证」；如果本来就是纯搬运，勾上「搬运模式」即可豁免原创增量');}
    else{tips.push('一键推送：需要先在 03 面板通过「运行验证」');}
  }
  $('actionHint').textContent=tips.join('　|　');
  syncTopHeight();
}
// 一键自动/一键推送的分步日志保留在证据面板顶部：刷新状态会重画面板，日志不能一闪就没。
function renderEvidence(){
  const r=state.run;
  const status=r?JSON.stringify({runDir:r.runDir,stage:r.stage,audit:r.audit,verify:r.verify,selectedProblem:r.selectedProblem,repository:r.repository,submission:r.submission},null,2):'等待运行实例。';
  const log=(state.actionLog||[]).map(l=>String(l.status||'').toUpperCase().padEnd(6)+' '+String(l.name||'').padEnd(12)+' '+(l.detail||'')).join(String.fromCharCode(10));
  $('evidenceLog').textContent=log?log+String.fromCharCode(10,10)+status:status;
}
function renderRun(){const r=state.run;if(!r){renderPipeline();renderActionHint();renderTargetHint();renderEvidence();return}renderPipeline();$('runCaption').textContent=\`\${r.runDir} · \${r.source?.sourceKind==='local'?('本地源 '+ (r.source.localName||'')):(r.source?.commit?.slice(0,12)||'commit 未记录')}\`;renderEvidence();$('auditBadge').textContent=r.audit?.status||'等待审计';$('verifyBadge').textContent=r.verify?.status||'等待副本';$('repoBadge').textContent=r.repository?'已创建':'未创建';$('competitionBadge').textContent=r.selectedProblem?('已锁定：'+(r.selectedProblem.problemName||'赛题')):'等待推送';
// 判题结果横幅：judgeStatus + failureReason（失败原因是"为什么没通过"的权威来源）。
const jd=r.judgement,banner=$('judgeResult');
if(jd&&jd.judgeStatus){banner.classList.remove('hidden');banner.className='banner '+(jd.judgeStatus==='passed'?'ok':jd.judgeStatus==='failed'?'error':'');banner.textContent=(jd.judgeStatus==='pending'?'⏳ 判题中':'判题结果：'+jd.judgeStatus)+'（attemptNo '+(jd.attemptNo??'?')+'／共 3 次机会）'+(jd.failureReason?'\\n原因：'+jd.failureReason:'');}
else{banner.classList.add('hidden');banner.textContent='';}setEnabled('auditBtn',!!r.source&&!r.audit);setEnabled('prepareBtn',!!state.audit&&state.audit.summary.status!=='blocked');setEnabled('verifyBtn',!!r&&!!r.runDir&&!!state.audit);setEnabled('createRepoBtn',!!r&&!!r.runDir&&r.stage==='VERIFIED');setEnabled('initRepoBtn',!!state.repo);setEnabled('pushBtn',!!r&&!!r.runDir&&r.stage==='INITIALIZED');setEnabled('selectProblemBtn',!!r&&r.stage==='PUSHED');setEnabled('submitBtn',!!state.selected&&r.stage==='PROBLEM_LOCKED');setEnabled('executeSubmitBtn',!!state.selected&&r.stage==='PROBLEM_LOCKED');setEnabled('autoPushBtn',!!r&&!!r.runDir&&['VERIFIED','REPOSITORY_CREATED','INITIALIZED','PUSHED','PROBLEM_LOCKED'].includes(r.stage));setEnabled('judgeBtn',!!(r.submission?.submissionId||r.judgement));const hasWork=!!r&&WORK_STAGES.includes(r.stage);setEnabled('autoRunBtn',!!r&&!!r.source&&!hasWork);setEnabled('diffBtn',hasWork);setEnabled('scaffoldBtn',hasWork);$('copyMode').disabled=!r.source;$('copyMode').checked=r.mode==='copy';$('modeBadge').textContent=r.mode==='copy'?'搬运模式（原创增量豁免）':'严格模式';$('modeBadge').className=r.mode==='copy'?'badge amber':'badge';$('workDir').value=r.runDir?\`\${r.runDir}/work\`:'';$('openWorkBtn').disabled=!$('workDir').value;for(const id of ['fileSelect','newFileBtn','loadFileBtn','saveFileBtn'])$(id).disabled=!hasWork;// 仓库名与目标赛题：仓库名留空时自动跟随源仓库名，目标行常驻可见，避免"提交了不知道哪道题"。
if(!$('cfgRepoName').value.trim()&&r.suggestedRepoName)$('cfgRepoName').value=r.suggestedRepoName;if(!$('repoName').value.trim()&&r.suggestedRepoName)$('repoName').value=r.suggestedRepoName;renderActionHint();renderTargetHint();}
async function loadRun(dir){try{const previous=state.run?.runId;state.run=await api(\`/api/runs/\${encodeURIComponent(dir)}\`);state.run.runId=state.run.runId||dir.split('/').pop();if(previous&&previous!==state.run.runId)state.actionLog=null;state.reviewed=state.run.reviewedFindings||[];state.audit=state.run.audit?await api(\`/api/runs/\${encodeURIComponent(dir)}/audit\`):null;state.selected=state.run.selectedProblem;state.repo=state.run.repository;renderRun();renderFindings();if(state.run.stage!=='CREATED'&&state.run.stage!=='ACQUIRED'&&state.run.stage!=='AUDITED'&&state.run.stage!=='REVIEW_REQUIRED')await loadWorkFiles();await refreshRuns()}catch(e){toast(e.message,true)}}
function renderFindings(){const box=$('findings');const pending=(state.audit?.findings??[]).filter(f=>['review','retain-attribution'].includes(f.disposition)&&!(state.reviewed??[]).includes(f.id));if(!pending.length){box.classList.add('hidden');box.innerHTML='';return}box.classList.remove('hidden');box.innerHTML='<h3 style="margin-top:20px">需要处理的发现</h3>'+pending.map(f=>\`<div class="finding"><span class="dot"></span><div><strong>\${esc(f.category)}</strong><p><code>\${esc(f.file||'全局')}</code> · \${esc(f.pattern||'')}</p></div><button class="btn" data-finding="\${esc(f.id)}">处理</button></div>\`).join('');document.querySelectorAll('[data-finding]').forEach(b=>b.onclick=()=>openReview(b.dataset.finding))}
// 每个类别只接受合法决定：密钥只有「排除文件」一条路（放行=把凭证留在提交里，不给这个选项）。
const REVIEW_CHOICES={secret:['exclude-file'],'personal-data':['sanitize','exclude-file','false-positive'],'environment-path':['sanitize','exclude-file','false-positive'],'project-identity':['exclude-file','false-positive','retain-attribution'],license:['license-reviewed'],repository:['exclude-file','false-positive']};
const REVIEW_LABELS={'sanitize':'替换个人信息/路径','exclude-file':'排除文件','false-positive':'确认误报','license-reviewed':'已审阅许可证','retain-attribution':'保留归属信息'};
function openReview(id){
  const f=state.audit.findings.find(x=>x.id===id);if(!f)return;state.reviewing=f;
  const choices=f.disposition==='retain-attribution'?['retain-attribution']:(REVIEW_CHOICES[f.category]||['exclude-file','false-positive']);
  $('reviewDecision').innerHTML=choices.map(v=>'<option value="'+v+'">'+(REVIEW_LABELS[v]||v)+'</option>').join('');
  $('reviewTitle').textContent=(f.category==='secret'?'含疑似凭证的文件只能选择「排除文件」（不会进入提交内容）：':'')+\`\${f.category} · \${f.file||'全局'} · \${f.pattern||''}\`;
  $('reviewModal').classList.add('open')
}
$('cancelReview').onclick=()=>$('reviewModal').classList.remove('open');$('saveReview').onclick=async()=>{try{await api(\`/api/runs/\${encodeURIComponent(runRef())}/review\`,{method:'POST',body:JSON.stringify({findingId:state.reviewing.id,decision:$('reviewDecision').value,note:$('reviewNote').value})});$('reviewModal').classList.remove('open');$('reviewNote').value='';toast('审计决定已保存');await loadRun(runRef())}catch(e){toast(e.message,true)}};
async function syncRunsRoot(force){try{const r=await api('/api/runs-root');$('runsRoot').placeholder=r.defaultRunsRoot||'默认 ~/contest-publisher-runs';if(force||!$('runsRoot').value.trim())$('runsRoot').value=r.runsRoot||''}catch{}}
$('runsRoot').onchange=async()=>{const value=$('runsRoot').value.trim();if(!value)return;try{const r=await api('/api/settings',{method:'POST',body:JSON.stringify({runsRoot:value})});$('runsRoot').value=r.runsRoot;if(state.run&&!String(state.run.runDir||'').startsWith(r.runsRoot))clearRun();toast(\`运行根目录已切换到 \${r.runsRoot}\`);await refreshRuns()}catch(e){toast(e.message,true);await syncRunsRoot(true)}};
// ===== 源：Git 链接 / 本地仓库（下拉选取放进去的代码包）=====
function sourceModeLocal(){return $('modeLocal').checked}
function renderSourceMode(){$('gitFields').classList.toggle('hidden',sourceModeLocal());$('localFields').classList.toggle('hidden',!sourceModeLocal());$('acquireSubmit').textContent=sourceModeLocal()?'用本地代码包创建运行':'拉取并创建运行'}
$('modeGit').onchange=renderSourceMode;$('modeLocal').onchange=renderSourceMode;
async function loadLocalSources(){
  try{
    const d=await api('/api/local-sources');
    $('localDirHint').textContent='代码包目录：'+d.dir+'（把文件夹或 .zip 放进去，然后点「刷新列表」）';
    const prior=$('localSourceSelect').value;
    $('localSourceSelect').innerHTML=d.entries.length?d.entries.map(e=>'<option value="'+esc(e.name)+'">'+esc(e.name)+(e.kind==='zip'?'（zip）':'')+'</option>').join(''):'<option value="">（目录为空，先放代码包）</option>';
    if(d.entries.some(e=>e.name===prior))$('localSourceSelect').value=prior;
    return d;
  }catch(e){toast(e.message,true);return null}
}
$('refreshLocalBtn').onclick=async()=>{await loadLocalSources();toast('本地仓库列表已刷新')};
$('openLocalDirBtn').onclick=()=>api('/api/local-sources/open',{method:'POST'}).then(r=>toast('已打开：'+r.dir)).catch(e=>toast(e.message,true));
$('openLocalDirCfgBtn').onclick=()=>api('/api/local-sources/open',{method:'POST'}).catch(e=>toast(e.message,true));
$('acquireForm').onsubmit=async e=>{e.preventDefault();try{
  const runsRoot=$('runsRoot').value.trim();
  let payload;
  if(sourceModeLocal()){
    const name=$('localSourceSelect').value;
    if(!name){toast('请先把代码包放进本地仓库目录并刷新列表，再下拉选取',true);return}
    payload={localSource:name,runsRoot:runsRoot||undefined};
  }else{
    if(!$('sourceUrl').value.trim()){toast('请填写仓库 HTTPS 地址',true);return}
    payload={sourceUrl:$('sourceUrl').value,ref:$('sourceRef').value,runsRoot:runsRoot||undefined};
  }
  const d=await api('/api/runs',{method:'POST',body:JSON.stringify(payload)});
  toast(sourceModeLocal()?'已从本地代码包创建运行':'源仓库已拉取');await syncRunsRoot(true);await loadRun(d.runId||d.runDir);
}catch(e){toast(e.message,true)}};
$('auditBtn').onclick=async()=>{try{state.audit=await api(\`/api/runs/\${encodeURIComponent(runRef())}/audit\`,{method:'POST'});state.run=await api(\`/api/runs/\${encodeURIComponent(runRef())}\`);renderRun();renderFindings();toast('审计完成')}catch(e){toast(e.message,true)}};
$('prepareBtn').onclick=async()=>{if(!$('rightsReviewed').checked||!$('rulesReviewed').checked){toast('请先确认代码授权和赛题规则',true);return}const name=await uiDialog({title:'作品名称',message:'输入作品 / 项目名称（不超过 80 字符）',input:true,value:'contest-project'});if(!name)return;try{await api(\`/api/runs/\${encodeURIComponent(runRef())}/prepare\`,{method:'POST',body:JSON.stringify({name,keepPaths:getCfg().keepPaths,rightsReviewed:$('rightsReviewed').checked,contestRulesReviewed:$('rulesReviewed').checked})});toast('纯代码副本已生成');await loadRun(runRef())}catch(e){toast(e.message,true)}};
$('verifyBtn').onclick=async()=>{try{const d=await api(\`/api/runs/\${encodeURIComponent(runRef())}/verify\`,{method:'POST'});$('verifyLog').classList.remove('hidden');$('verifyLog').textContent=JSON.stringify(d,null,2);toast(d.status==='passed'?'验证通过':'验证未通过',d.status!=='passed');await loadRun(runRef())}catch(e){toast(e.message,true)}};
$('openWorkBtn').onclick=()=>api('/api/open-path',{method:'POST',body:JSON.stringify({path:$('workDir').value})}).catch(e=>toast(e.message,true));
$('createRepoBtn').onclick=async()=>{try{const d=await api(\`/api/runs/\${encodeURIComponent(runRef())}/create-repo\`,{method:'POST',body:JSON.stringify({name:$('repoName').value,token:$('gitToken').value,execute:true})});state.repo=d;toast('GitCode 公开仓库已创建');$('repoLog').classList.remove('hidden');$('repoLog').textContent=JSON.stringify(d,null,2);await loadRun(runRef())}catch(e){toast(e.message,true)}};
$('initRepoBtn').onclick=async()=>{try{const d=await api(\`/api/runs/\${encodeURIComponent(runRef())}/init-repo\`,{method:'POST',body:JSON.stringify({authorName:$('authorName').value,authorEmail:$('authorEmail').value,remote:state.repo?.cloneUrl})});$('repoLog').classList.remove('hidden');$('repoLog').textContent=JSON.stringify(d,null,2);toast('本地目标仓库已初始化');await loadRun(runRef())}catch(e){toast(e.message,true)}};
$('pushBtn').onclick=async()=>{try{const d=await api(\`/api/runs/\${encodeURIComponent(runRef())}/push\`,{method:'POST',body:JSON.stringify({execute:true})});$('repoLog').classList.remove('hidden');$('repoLog').textContent=JSON.stringify(d,null,2);toast('代码已上传');await loadRun(runRef())}catch(e){toast(e.message,true)}};
$('selectProblemBtn').onclick=async()=>{try{const d=await api(\`/api/runs/\${encodeURIComponent(runRef())}/select-problem\`,{method:'POST',body:JSON.stringify({skillDir:$('skillDir').value,number:Number($('problemNumber').value),creds:$('credsPath').value})});state.selected=d;$('competitionLog').classList.remove('hidden');$('competitionLog').textContent=JSON.stringify(d,null,2);toast(\`已锁定：\${d.problemName}\`);await loadRun(runRef())}catch(e){toast(e.message,true)}};
async function submit(execute){try{const d=await api(\`/api/runs/\${encodeURIComponent(runRef())}/submit\`,{method:'POST',body:JSON.stringify({skillDir:$('skillDir').value,creds:$('credsPath').value,execute})});$('competitionLog').classList.remove('hidden');$('competitionLog').textContent=JSON.stringify(d,null,2);toast(execute?'作品已提交':'提交计划已生成');await loadRun(runRef())}catch(e){toast(e.message,true)}}
$('judgeBtn').onclick=async()=>{
  try{
    $('judgeBtn').disabled=true;$('judgeLabel').textContent='查询中…';
    const cfg=getCfg();
    const d=await api(\`/api/runs/\${encodeURIComponent(runRef())}/judge-status\`,{method:'POST',body:JSON.stringify({creds:cfg.credsPath||$('credsPath').value,skillDir:$('skillDir').value||undefined})});
    state.run.judgement=d;
    if(d.judgeStatus==='pending')toast('判题中：平台仍在异步判题，稍后再查');
    else if(d.judgeStatus==='passed')toast('🎉 判题通过！+20 分，作品已公开展示');
    else toast('判题未通过：'+(d.failureReason||'（平台未提供原因）'),true);
    await loadRun(runRef());
  }catch(e){toast(e.message,true)}
  finally{$('judgeLabel').textContent='查询判题结果';renderRun()}
};
// 把"按策略排除"的文件（报告/看板等）加入保留清单：下次 prepare 会带进副本。
async function keepPath(rel){
  const top=rel.split('/').length>1?rel.split('/')[0]:rel;
  const cfg=getCfg();
  if(!cfg.keepPaths.includes(top)){cfg.keepPaths.push(top);$('cfgKeepPaths').value=cfg.keepPaths.join(String.fromCharCode(10));await saveCfgSynced()}
  toast(\`已把「\${top}」加入保留清单：新建 run 重新准备后生效（prepare 只写空副本）\`);
}
$('submitBtn').onclick=()=>submit(false);$('executeSubmitBtn').onclick=async()=>{if(await uiDialog({title:'执行提交',message:'确认调用 ICT 提交接口？提交后由平台异步判题，不可撤回。',okText:'提交',danger:true}))submit(true)};$('refreshBtn').onclick=()=>state.run?loadRun(runRef()):refreshRuns();
$('autoRunBtn').onclick=async()=>{if(!state.run?.runDir){toast('请先拉取源仓库',true);return}
try{$('autoRunBtn').disabled=true;$('autoRunLabel').textContent='自动运行中…';
const r=await api(\`/api/runs/\${encodeURIComponent(runRef())}/auto-run\`,{method:'POST',body:JSON.stringify({name:'contest-project',keepPaths:getCfg().keepPaths})});
const ok=r.ok; const last=(r.log||[]).slice(-1)[0];
toast(ok?'✅ 自动流水线完成':\`⚠ \${last?.detail||'流程中止'}\`,!ok);
if(r.log){state.actionLog=r.log}
await loadRun(runRef());}
catch(e){toast(e.message,true)}
finally{$('autoRunLabel').textContent='一键自动';renderRun();}};$('newRunBtn').onclick=()=>{clearRun();$('sourceUrl').focus()};

let editorPath=null;
async function loadWorkFiles(){if(!state.run)return;try{const files=await api(\`/api/runs/\${encodeURIComponent(runRef())}/work-files\`);const select=$('fileSelect');const prior=editorPath;select.innerHTML=files.map(f=>\`<option value="\${esc(f.path)}">\${esc(f.path)} · \${esc(f.kind)}</option>\`).join('');if(files.length){editorPath=files.find(f=>f.path===prior)?.path||files.find(f=>f.path.endsWith('CONTRIBUTIONS.md'))?.path||files.find(f=>f.kind==='code')?.path||files[0].path;select.value=editorPath;await loadEditorFile()}else{$('codeEditor').value='';editorPath=null}}catch(e){toast(e.message,true)}}
async function loadEditorFile(){if(!state.run||!editorPath)return;try{const d=await api(\`/api/runs/\${encodeURIComponent(runRef())}/file?path=\${encodeURIComponent(editorPath)}\`);$('codeEditor').value=d.content}catch(e){toast(e.message,true)}}
$('fileSelect').onchange=()=>{editorPath=$('fileSelect').value;loadEditorFile()};$('loadFileBtn').onclick=loadEditorFile;$('saveFileBtn').onclick=async()=>{try{await api(\`/api/runs/\${encodeURIComponent(runRef())}/file\`,{method:'PUT',body:JSON.stringify({path:editorPath,content:$('codeEditor').value})});toast(\`已保存 \${editorPath}\`)}catch(e){toast(e.message,true)}};$('newFileBtn').onclick=async()=>{const file=await uiDialog({title:'新建代码文件',message:'输入新源代码文件相对路径，例如 src/solution.mjs',input:true,placeholder:'src/solution.mjs'});if(!file)return;try{await api(\`/api/runs/\${encodeURIComponent(runRef())}/file\`,{method:'PUT',body:JSON.stringify({path:file,content:'',create:true})});editorPath=file;await loadWorkFiles();$('fileSelect').value=file;toast('代码文件已创建')}catch(e){toast(e.message,true)}};
// ===== 与原仓库的差异（逐行 diff，区分工具脱敏改写 / 你的改动）=====
function diffChip(status){return status==='added'?'新增':status==='deleted'?'删除':'修改'}
function renderDiffFile(f){
  const head='--- a/'+f.path+'\\n+++ b/'+f.path;
  const hunks=f.diff?.hunks;
  if(!hunks?.length)return '<span class="dl-meta">'+esc(head)+'\\n（'+esc(f.diff?.reason||'无逐行差异')+'）</span>';
  const body=hunks.map(h=>esc(h.header)+'\\n'+h.lines.map(l=>'<span class="'+(l.type==='add'?'dl-add':l.type==='del'?'dl-del':'')+'">'+esc((l.type==='add'?'+':l.type==='del'?'-':' ')+l.text)+'</span>').join('\\n')).join('\\n');
  return esc(head)+'\\n'+body;
}
function diffFlags(f){const flags=[];if(f.origin==='generated')flags.push('工具生成');if(f.rewrittenByTool)flags.push('工具脱敏改写');if(f.editedByAuthor)flags.push('你的改动');return flags}
async function diffOpen(){
  try{
    $('diffBody').textContent='选择左侧文件查看逐行差异';
    const list=await api(\`/api/runs/\${encodeURIComponent(runRef())}/diff?hunks=0\`);
    const s=list.summary;
    $('diffSummary').textContent=\`对比原仓库 source@\${(list.sourceCommit||'').slice(0,12)||'未记录'}：新增 \${s.added} · 修改 \${s.modified} · 删除 \${s.deleted} · 未变 \${s.unchanged}　｜　工具生成 \${s.generated} · 工具脱敏改写 \${s.rewrittenByTool} · 你改动 \${s.editedByAuthor}　｜　行数 +\${s.addedLines} -\${s.removedLines}\`;
    const changed=list.files.filter(f=>f.status!=='unchanged');
    const items=changed.length?changed.map(f=>{
      const flags=diffFlags(f);
      const counts=f.addedLines===null?'未统计行数':'+'+f.addedLines+' -'+f.removedLines;
      return '<button class="diff-item" data-diff="'+esc(f.path)+'"><span><span class="chip '+f.status+'">'+diffChip(f.status)+'</span><span class="p">'+esc(f.path)+'</span></span><small>'+esc(counts)+(flags.length?'　｜　'+esc(flags.join(' / ')):'')+'</small></button>';
    }).join(''):'<div class="empty">work/ 与 source/ 内容一致（只有工具生成的说明文件）</div>';
    const excluded=(list.excluded??[]).length?'<div class="hint" style="margin-top:10px">未进入 work/ 的源文件（赛题要求的报告/看板产物可点「保留」加入保留清单）</div>'+list.excluded.map(e=>'<div class="diff-excl">'+esc(e.path)+' · '+esc(e.reason)+' <button class="btn" data-keep="'+esc(e.path)+'" style="padding:1px 8px;min-height:0;font-size:11px">保留</button></div>').join(''):'';
document.querySelectorAll('[data-keep]').forEach(b=>b.onclick=()=>keepPath(b.dataset.keep));
    $('diffList').innerHTML=items+excluded;
    document.querySelectorAll('[data-diff]').forEach(b=>b.onclick=()=>diffShow(b.dataset.diff));
  }catch(e){toast(e.message,true);$('diffModal').classList.remove('open')}
}
async function diffShow(rel){
  try{
    const r=await api(\`/api/runs/\${encodeURIComponent(runRef())}/diff?path=\${encodeURIComponent(rel)}&hunks=1\`);
    const f=r.files[0];if(!f)return;
    document.querySelectorAll('[data-diff]').forEach(b=>b.classList.toggle('active',b.dataset.diff===rel));
    $('diffBody').innerHTML=renderDiffFile(f);
  }catch(e){toast(e.message,true)}
}
async function diffAll(){
  try{
    const r=await api(\`/api/runs/\${encodeURIComponent(runRef())}/diff?hunks=1\`);
    const parts=r.files.filter(f=>f.status!=='unchanged'&&f.diff?.hunks?.length).map(renderDiffFile);
    document.querySelectorAll('[data-diff]').forEach(b=>b.classList.remove('active'));
    $('diffBody').innerHTML=parts.length?parts.join('\\n\\n'):'<span class="dl-meta">没有逐行差异</span>';
  }catch(e){toast(e.message,true)}
}
$('diffBtn').onclick=async()=>{$('diffModal').classList.add('open');await diffOpen()};
$('diffAllBtn').onclick=diffAll;
$('closeDiff').onclick=()=>$('diffModal').classList.remove('open');

// ===== 生成脚手架 =====
$('scaffoldBtn').onclick=async()=>{
  try{
    $('scaffoldBtn').disabled=true;
    const r=await api(\`/api/runs/\${encodeURIComponent(runRef())}/scaffold\`,{method:'POST',body:JSON.stringify({name:'solution'})});
    toast(\`已生成脚手架（\${r.language}）：\${r.files.join('、')}\`);
    await loadWorkFiles();
    const entry=r.files.find(f=>f.endsWith('.mjs')||f.endsWith('.py')||f.endsWith('.sh'));
    if(entry){editorPath=entry;$('fileSelect').value=entry;await loadEditorFile()}
    $('evidenceLog').textContent=[\`脚手架语言: \${r.language}\`,\`文件: \${r.files.join(', ')}\`,\`自检命令: \${r.next}\`,\`\${r.note}\`].join(String.fromCharCode(10));
  }catch(e){toast(e.message,true)}
  finally{renderRun()}
};
$('copyMode').onchange=async()=>{
  const mode=$('copyMode').checked?'copy':'strict';
  try{
    await api(\`/api/runs/\${encodeURIComponent(runRef())}/mode\`,{method:'POST',body:JSON.stringify({mode})});
    toast(mode==='copy'?'已切到搬运模式：原创增量豁免并记录进 evidence/run-mode.json':'已切回严格模式：必须存在原创代码增量');
    await loadRun(runRef());
  }catch(e){toast(e.message,true);renderRun()}
};

// ===== Settings (localStorage-backed) =====
const CFG_KEY='cp_settings_v1';
const CFG_FIELDS=['cfgRepoName','cfgGitToken','cfgAuthorName','cfgAuthorEmail','cfgAccountId','cfgCredsPath','cfgProblemNumber','cfgProblemName','cfgKeepPaths','cfgLocalSourcesDir','cfgExecuteSubmit'];
function loadCfg(){try{return JSON.parse(localStorage.getItem(CFG_KEY)||'{}')}catch{return {}}}
async function loadCfgSynced(){
  const local = loadCfg();
  try{
    const remote = await api('/api/settings');
    // merge: remote (server) wins for fields present
    const merged = { ...local };
    for (const [k,v] of Object.entries(remote||{})) if (v !== '' && v != null) merged[k]=v;
    localStorage.setItem(CFG_KEY, JSON.stringify(merged));
    return merged;
  }catch{ return local; }
}
async function saveCfgSynced(){
  const cfg = saveCfg();
  try { await api('/api/settings', { method:'POST', body: JSON.stringify(cfg) }); } catch {}
  return cfg;
}
function saveCfg(){const cfg={};for(const id of CFG_FIELDS){const el=$(id);if(!el)continue;cfg[id]=el.type==='checkbox'?el.checked:el.value}localStorage.setItem(CFG_KEY,JSON.stringify(cfg));return cfg}
function applyCfg(cfg){for(const id of CFG_FIELDS){const el=$(id);if(!el||!(id in cfg))continue;el.type==='checkbox'?(el.checked=!!cfg[id]):(el.value=cfg[id]??'')}}
function getCfg(){const cfg={repoName:$('cfgRepoName').value.trim(),gitToken:$('cfgGitToken').value.trim(),authorName:$('cfgAuthorName').value.trim(),authorEmail:$('cfgAuthorEmail').value.trim(),accountId:$('cfgAccountId').value.trim(),credsPath:$('cfgCredsPath').value.trim(),problemNumber:Number($('cfgProblemNumber').value||1),problemName:$('cfgProblemName').value.trim(),keepPaths:$('cfgKeepPaths').value.split('\\n').map(v=>v.trim()).filter(Boolean),executeSubmit:$('cfgExecuteSubmit').checked};return cfg}
$('settingsBtn').onclick=()=>{applyCfg(loadCfg());$('settingsModal').classList.add('open')};
$('cancelSettings').onclick=()=>$('settingsModal').classList.remove('open');
$('saveSettings').onclick=async()=>{await saveCfgSynced();$('settingsModal').classList.remove('open');toast('配置已保存（本地 + 服务端）');renderActionHint();renderTargetHint()};
// 手改序号后旧的赛题名不再可信，清掉，避免确认框显示错题名。
$('cfgProblemNumber').onchange=()=>{$('cfgProblemName').value='';renderTargetHint()};
$('genStsBtn').onclick=async()=>{
  const accountId=$('cfgAccountId').value.trim();
  if(!accountId){toast('请先填华为云账号 ID',true);return}
  try{$('genStsBtn').disabled=true;$('genStsLabel').textContent='生成中…';
  const r=await api('/api/gen-sts',{method:'POST',body:JSON.stringify({accountId})});
  if(r.ok){$('cfgCredsPath').value=r.credsPath;toast('✅ STS 凭证已生成并填入');await saveCfgSynced()}
  else toast(r.error||'生成失败',true)}
  catch(e){toast(e.message,true)}
  finally{$('genStsBtn').disabled=false;$('genStsLabel').textContent='生成'}};
// ===== 配置导出 / 导入 =====
// 导出：交给服务端写文件（浏览器与 WKWebView 里"下载"都不可靠），写完直接打开所在目录。
$('exportCfgBtn').onclick=async()=>{
  const includeToken=$('cfgIncludeToken').checked;
  try{
    await saveCfgSynced();
    const r=await api('/api/config/export?includeToken='+(includeToken?1:0));
    toast('已导出 '+r.keys.length+' 项配置（'+(r.includesToken?'含 GitCode Token 明文，请勿外传':'不含 Token')+'）：'+r.path);
    await api('/api/open-path',{method:'POST',body:JSON.stringify({path:r.path})}).catch(()=>{});
  }catch(e){toast(e.message,true)}
};
$('importCfgBtn').onclick=()=>$('importCfgFile').click();
$('importCfgFile').onchange=async()=>{
  const file=$('importCfgFile').files&&$('importCfgFile').files[0];
  $('importCfgFile').value='';
  if(!file)return;
  let parsed;
  try{parsed=JSON.parse(await file.text())}catch{toast('不是合法的 JSON 文件',true);return}
  const settings=parsed&&parsed.settings;
  if(!settings||typeof settings!=='object'||Array.isArray(settings)){toast('不是本软件导出的配置文件（缺少 settings 字段）',true);return}
  const keys=Object.keys(settings);
  if(!keys.length){toast('文件里没有配置项',true);return}
  const hasToken=keys.includes('cfgGitToken');
  const ok=await uiDialog({title:'导入配置',message:'来自 '+file.name+'，将覆盖这 '+keys.length+' 项：'+keys.join('、')+(hasToken?'。\\n\\n注意：文件里含 GitCode Access Token（明文），导入后会写进本机配置。':''),okText:'导入'});
  if(!ok)return;
  try{
    const r=await api('/api/config/import',{method:'POST',body:JSON.stringify({settings})});
    const merged=await loadCfgSynced();
    applyCfg(merged);
    $('settingsModal').classList.remove('open');
    await syncRunsRoot();
    await refreshRuns();
    renderRun();
    toast('已导入 '+r.applied.length+' 项配置'+(r.skipped.length?'（跳过 '+r.skipped.length+' 项不支持或非标量的键）':''));
  }catch(e){toast(e.message,true)}
};
$('clearSettings').onclick=async()=>{if(!await uiDialog({title:'清除配置',message:'清除所有本地保存的配置？配置面板与 localStorage 都会被清空。',okText:'清除',danger:true}))return;localStorage.removeItem(CFG_KEY);try{await api('/api/settings',{method:'POST',body:JSON.stringify({})})}catch{}for(const id of CFG_FIELDS){const el=$(id);if(!el)continue;el.type==='checkbox'?(el.checked=false):(el.value='')};toast('本地配置已清除')};

// ===== 目标赛题与目标仓库（让"提交哪道题、推到哪个仓库"始终可见、可确认）=====
function targetRepoName(){const typed=$('cfgRepoName').value.trim();return typed||state.run?.suggestedRepoName||'contest-project'}
function renderTargetHint(){
  const r=state.run,locked=r?.selectedProblem,number=Number($('cfgProblemNumber').value||0),name=$('cfgProblemName').value.trim();
  const pills=[];
  if(locked)pills.push('<span class="pill target">已锁定赛题 '+esc(locked.number)+'「'+esc(locked.problemName)+'」（problemId '+esc(locked.problemId)+'）</span>');
  else if(number)pills.push('<span class="pill target">目标赛题 '+number+(name?'「'+esc(name)+'」':'（名称待锁定）')+'</span>');
  else pills.push('<span class="pill">未选择目标赛题 · 点右上「赛题列表」选择</span>');
  if(r?.runDir)pills.push('<span class="pill repo">目标仓库 '+esc(targetRepoName())+'</span>');
  $('targetHint').innerHTML=pills.join('');
}
async function fetchProblems(){
  const cfg=getCfg();
  if(!cfg.credsPath){toast('请先在 ⚙ 配置 填 STS 凭证路径，或点「生成」自动生成',true);$('settingsModal').classList.add('open');return null}
  return await api(\`/api/runs/\${encodeURIComponent(runRef())}/problems?creds=\${encodeURIComponent(cfg.credsPath)}\`);
}
function renderProblems(items){
  const cfg=getCfg();
  $('problemsSummary').textContent=\`共 \${items.length} 个赛题，点击一行设为本次提交目标。当前目标：\${cfg.problemNumber||'未设置'}\${cfg.problemName?\`「\${cfg.problemName}」\`:''}\`;
  $('problemsList').innerHTML=items.map(it=>{
    const active=Number(cfg.problemNumber)===it.number;
    return \`<button class="diff-item\${active?' active':''}" data-problem="\${it.number}"><span><span class="chip \${it.status==='published'?'added':'modified'}">\${esc(it.status||'未知')}</span><span class="p">\${it.number}. \${esc(it.name)}</span></span><small>\${esc(it.window||'窗口未知')}</small></button>\`;
  }).join('');
  document.querySelectorAll('[data-problem]').forEach(b=>b.onclick=()=>chooseProblem(Number(b.dataset.problem),items));
}
async function chooseProblem(number,items){
  const it=items.find(x=>x.number===number);if(!it)return;
  $('cfgProblemNumber').value=it.number;$('cfgProblemName').value=it.name;
  await saveCfgSynced();
  renderProblems(items);renderTargetHint();
  toast(\`已设为目标赛题：\${it.number}「\${it.name}」\`);
}
async function openProblems(){
  $('problemsModal').classList.add('open');
  $('problemsList').innerHTML='<div class="hint">拉取中…</div>';
  try{const d=await fetchProblems();if(d)renderProblems(d.items)}
  catch(e){$('problemsList').innerHTML='<div class="banner error">'+esc(e.message)+'</div>'}
}
$('problemsBtn').onclick=openProblems;
$('fetchProblemsBtn').onclick=openProblems;
$('reloadProblems').onclick=openProblems;
$('closeProblems').onclick=()=>$('problemsModal').classList.remove('open');

// ===== Auto push =====
$('autoPushBtn').onclick=async()=>{
  if(!state.run?.runDir){toast('请先拉取源仓库',true);return}
  const cfg=getCfg();
  if(!cfg.gitToken){toast('请先在 ⚙ 配置里填写 GitCode Access Token',true);$('settingsModal').classList.add('open');return}
  if(!cfg.credsPath){toast('请先在 ⚙ 配置里填 STS 凭证路径，或点生成按钮自动生成',true);$('settingsModal').classList.add('open');return}
  // 推送前把"要提交哪道题、推到哪个仓库"摆进确认框；列表拉取失败不拦截，名称以「锁定赛题」步骤为准。
  let targetLine='';
  try{
    const d=await fetchProblems();
    const it=d?.items.find(x=>x.number===Number(cfg.problemNumber||1));
    if(it){targetLine=\`目标赛题：\${it.number}「\${it.name}」（\${it.window||'窗口未知'}）\`;$('cfgProblemName').value=it.name;saveCfg()}
  }catch{}
  if(!targetLine)targetLine=\`目标赛题：序号 \${cfg.problemNumber||1}（赛题列表拉取失败，名称以「锁定赛题」步骤为准）\`;
  const msg=\`\${targetLine}\n目标仓库：\${targetRepoName()}\n\n将自动：建仓→确保仓库公开→初始化→推送→锁赛题→\${cfg.executeSubmit?'执行提交':'生成提交计划'}。确认继续？\`;
  if(!await uiDialog({title:'确认自动推送',message:msg,okText:'开始',danger:true}))return;
  // 服务端把 6 个步骤装在一个长请求里跑，进度靠轮询 /auto-push-progress 取回，
  // 按钮、提示行和证据面板随每个步骤实时更新；请求结束后以最终返回为准。
  let pushDone=false;
  const poll=setInterval(async()=>{
    if(pushDone)return;
    try{
      const p=await api(\`/api/runs/\${encodeURIComponent(runRef())}/auto-push-progress\`);
      if(pushDone||!p||p.stage==='idle')return;
      const steps=p.steps||[];const total=Number(p.total)||7;
      const finished=steps.filter(s=>s.status!=='running').length;
      const cur=steps.find(s=>s.status==='running');
      $('autoPushLabel').textContent=cur?\`推送中 \${Math.min(finished+1,total)}/\${total} · \${cur.label||cur.name}\`:\`推送中 \${finished}/\${total}\`;
      $('actionHint').textContent=\`一键推送进行中（\${finished}/\${total} 完成）\${cur?\`：\${cur.label||cur.name}\`:''}\`;
      if(steps.length){state.actionLog=steps.map(s=>({name:s.name,status:s.status,detail:s.detail}));renderEvidence()}
    }catch{}
  },800);
  try{$('autoPushBtn').disabled=true;$('autoPushLabel').textContent='推送中…';
  const r=await api(\`/api/runs/\${encodeURIComponent(runRef())}/auto-push\`,{method:'POST',body:JSON.stringify({config:cfg})});
  if(r.log){state.actionLog=r.log}
  if(r.ok){toast(r.stage==='submit'&&cfg.executeSubmit?'🎉 已完成提交':'✅ 自动推送完成')}
  else{toast(\`⚠ \${r.error||'流程中止'}\`,true)}
  await loadRun(runRef());}
  catch(e){toast(e.message,true)}
  finally{pushDone=true;clearInterval(poll);$('autoPushLabel').textContent='一键推送';renderRun()}};

// Restore saved config on boot
// 粘性头部高度自适应：顶部换行（窄屏）时流程条仍紧贴其下，不会互相压住。
function syncTopHeight(){const top=document.querySelector('.top');if(top)document.documentElement.style.setProperty('--top-h',top.offsetHeight+'px')}
window.addEventListener('resize',syncTopHeight);
document.addEventListener('DOMContentLoaded',async()=>{syncTopHeight();try{new ResizeObserver(syncTopHeight).observe(document.querySelector('.top'))}catch{}
  const cfg=await loadCfgSynced();applyCfg(cfg);applyRunsCollapsed();$('runsFilter').value=localStorage.getItem(RUNS_FILTER_KEY)||'';renderActionHint();renderTargetHint();renderSourceMode();
  try{const s=await api('/api/settings');if(!$('cfgLocalSourcesDir').value.trim()&&s.localSourcesDir)$('cfgLocalSourcesDir').value=s.localSourcesDir}catch{}
  await loadLocalSources()});
// ===== Help modal =====
$('helpBtn').onclick=()=>$('helpModal').classList.add('open');
$('closeHelp').onclick=()=>$('helpModal').classList.remove('open');

// ===== Env check =====
async function runEnvCheck(){
  const box=$('envList'); box.innerHTML='<div class="hint">检测中…</div>';
  try{
    const r=await api('/api/env-check');
    box.innerHTML=r.checks.map(c=>{
      const icon=c.ok===true?'✅':c.ok==='client'?'⚙':c.ok===false?'❌':'⚠';
      const hint=c.hint?\`<div style="color:var(--muted);font-size:11px;margin-top:2px">↳ \${esc(c.hint)}</div>\`:'';
      return \`<div style="padding:8px 10px;background:rgba(255,255,255,.5);border:1px solid var(--stroke);border-radius:10px"><b style="color:\${c.ok===false?'#c45058':'var(--text)'}">\${icon} \${esc(c.name)}</b> <span style="color:var(--muted);font-size:11px">\${esc(c.detail||'')}</span>\${hint}</div>\`;
    }).join('');
  }catch(e){ box.innerHTML=\`<div class="banner error">检测失败：\${esc(e.message)}</div>\`; }
}
$('envCheckBtn').onclick=()=>{$('envModal').classList.add('open');runEnvCheck()};
$('rerunEnvCheck').onclick=runEnvCheck;
$('closeEnv').onclick=()=>$('envModal').classList.remove('open');

// ===== 退出软件 =====
// Windows 绿色包是「双击 → 打开工作台窗口」的形态：用应用窗口时关掉窗口就等于退出；
// 退回默认浏览器时没有窗口可关，这个按钮就是唯一的退出入口（只监听 127.0.0.1）。
$('quitBtn').onclick=async()=>{
  if(!await uiDialog({title:'退出软件',message:'退出后本地服务会停止，未推送的运行数据仍保留在运行根目录，下次启动继续用。',okText:'退出',danger:true}))return;
  try{await api('/api/quit',{method:'POST'});document.body.innerHTML='<div style="padding:48px;font-size:15px;line-height:1.6;color:#3d3450">已退出 Contest Publisher，这个页面可以关掉了。</div>';}
  catch(e){toast(e.message,true)}
};

// 平台差异只影响文案：macOS 说访达，Windows 说资源管理器；路径示例也跟着换。
async function applyPlatform(){
  try{
    const health=await api('/api/health');
    state.platform=health.platform||'';
    $('openWorkLabel').textContent=revealLabel();
    $('openWorkBtn').title=revealLabel()+'工作副本目录';
    if(isWindows()){
      $('skillDir').placeholder='C:\\\\path\\\\to\\\\huawei-cloud-publish-ict-work';
      $('credsPath').placeholder='C:\\\\path\\\\sts-creds.json';
    }
  }catch{/* 平台信息拿不到就按 macOS 文案显示，不影响功能 */}
}

applyPlatform().then(()=>syncRunsRoot()).then(()=>refreshRuns()).then(()=>renderRun());
</script>
</body></html>`;
