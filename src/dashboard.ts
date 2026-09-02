/** 瀑布式提示词画廊控制台 —— 借鉴 prompts.chat 的 UI/UX（纯黑背景+深灰卡片+紫罗兰点缀+mono 提示词块）。
 *  UI 约定（见 AGENTS.md）：不使用原生表单控件外观，输入框/下拉框/调节框/开关均自行实现，统一样式体系。 */
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inspira · 灵感生成器</title>
<style>
:root{
  --bg:#0a0a0a;--card:#131313;--card2:#171717;--bd:#242424;--bd-2:#333;
  --fg:#ededed;--muted:#a1a1aa;--faint:#71717a;--acc:#a78bfa;--acc-deep:#8b5cf6;
  --ok:#4ade80;--bad:#f87171;--run:#7dd3fc;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--acc);text-decoration:none}
button{border:0;border-radius:9px;cursor:pointer;font-weight:600;transition:.15s;font-family:inherit;color:inherit}

/* 顶部栏 */
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;padding:0 22px;height:56px;background:rgba(10,10,10,.82);backdrop-filter:blur(12px);border-bottom:1px solid var(--bd)}
.brand{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;letter-spacing:.2px}
.brand .dot{width:8px;height:8px;border-radius:50%;background:var(--acc-deep);box-shadow:0 0 10px var(--acc-deep)}
.top .spacer{flex:1}
.top .link{color:var(--muted);font-size:12.5px}
.btn{background:var(--acc-deep);color:#fff;padding:7px 14px;font-size:13px}
.btn:hover{filter:brightness(1.15)}
.btn.ghost{background:transparent;border:1px solid var(--bd-2);color:#d4d4d8;font-weight:500}
.btn.ghost:hover{border-color:#52525b;color:#fff}
.btn.sm{padding:4px 10px;font-size:11.5px;border-radius:7px;font-weight:500}

.status{padding:10px 22px 0;font-size:12px;color:var(--faint)}
.status b{color:#d4d4d8;font-weight:600}
.filters{display:flex;align-items:center;gap:8px;padding:14px 22px 10px;flex-wrap:wrap}
.chip{padding:5px 12px;background:var(--card);border:1px solid var(--bd-2);border-radius:999px;font-size:12px;color:var(--muted);cursor:pointer;transition:.15s;font-weight:500}
.chip:hover{border-color:#52525b;color:#fff}
.chip.on{background:var(--acc-deep);border-color:var(--acc-deep);color:#fff}
.count{margin-left:auto;font-size:12px;color:var(--faint)}

/* 瀑布流 */
.wall{columns:300px 4;column-gap:14px;padding:4px 22px 80px}
.card{break-inside:avoid;margin-bottom:14px;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .18s,transform .18s,box-shadow .18s}
.card:hover{border-color:#3d3d3d;transform:translateY(-1px);box-shadow:0 8px 24px rgba(0,0,0,.5)}
.card.failed{border-color:#4a1d24}

.cover{position:relative;overflow:hidden}
.cover.image{aspect-ratio:4/3;background:radial-gradient(120% 100% at 20% 0%,#1b1b2e 0%,#141422 45%,#101018 100%)}
.cover.video{aspect-ratio:16/9;background:radial-gradient(120% 100% at 85% 10%,#2a1430 0%,#1a1426 48%,#0f0f16 100%)}
.cover .glow{position:absolute;inset:0;background:linear-gradient(to top,rgba(10,10,10,.85),transparent 55%);pointer-events:none}
.cover .ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:rgba(255,255,255,.9)}
.cover .ph .ic{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
.cover.video .ph .ic{background:var(--acc);border:0;box-shadow:0 0 24px rgba(139,92,246,.8)}
.cover .ph .ic img{width:13px;height:13px;filter:invert(1)}
.cover .ph .t{font-size:11.5px;letter-spacing:.4px;opacity:.85}
.cover .ph .s{font-size:10px;color:var(--faint)}
.cover .ribbon{position:absolute;top:10px;left:10px;display:flex;gap:5px}
.cover .ribbon b,.cover .dur{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);color:#e4e4e7}
.cover .dur{position:absolute;top:10px;right:10px;background:var(--acc-deep);color:#fff}
.cover .st{position:absolute;bottom:8px;right:10px;font-size:10px;font-weight:700;display:flex;align-items:center;gap:5px;color:#c9c9ce}
.cover .st i{width:6px;height:6px;border-radius:50%;background:var(--ok)}
.cover .st.running i{background:var(--run);animation:blink 1.1s infinite}
.cover .st.queued i{background:var(--run)}
.cover .st.failed i{background:var(--bad)}
@keyframes blink{50%{opacity:.25}}

.body{padding:12px 14px 10px;display:flex;flex-direction:column;flex:1;min-height:0}
h3{margin:0 0 4px;font-size:13.5px;font-weight:600;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1}
.desc{font-size:11.5px;color:var(--faint);margin-bottom:8px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.mono{font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#b9c3e0;background:#0d0d13;border:1px solid #1c1c24;border-radius:8px;padding:8px 10px;margin-bottom:8px;white-space:pre-wrap;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4}
.mono.open{-webkit-line-clamp:unset}
.card.failed .mono{display:none}
.err{color:var(--bad);font-size:11.5px;margin-bottom:6px}

/* 视频提示词中的 <Picture N> 参考画面：悬停显示配套生图提示词 */
.mono .pcref{color:var(--acc);text-decoration:underline dotted rgba(167,139,250,.6);text-underline-offset:3px;cursor:help;font-weight:600}
.mono .pcref:hover,.mono .pcref:focus{background:rgba(139,92,246,.16);border-radius:3px;outline:none}
.ptip{position:fixed;z-index:90;max-width:min(380px,calc(100vw - 24px));background:#0d0d13;border:1px solid var(--bd-2);border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.75);padding:10px 12px;font:12px/1.6 ui-sans-serif,system-ui,sans-serif;color:#d4d4d8;pointer-events:none;display:none}
.ptip b{color:var(--acc);font-size:11px;letter-spacing:.5px;display:block;margin-bottom:2px}
.ptip .ptd{color:var(--muted)}
.ptip .ptp{margin-top:6px;padding-top:6px;border-top:1px solid var(--bd);color:#b9c3e0;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto}
.ptip .ptp.dim{color:#71717a}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:auto}
.tag{font-size:10px;font-weight:500;padding:2px 8px;border-radius:6px;border:1px solid var(--bd-2);color:var(--muted)}
.tag.acc{color:var(--acc);border-color:rgba(167,139,250,.35)}
.foot{display:flex;align-items:center;gap:6px;padding:10px 14px 12px;border-top:1px solid var(--bd);margin-top:2px}
.foot .t{font-size:11px;color:var(--faint);margin-right:auto}
.empty{padding:80px 22px;text-align:center;color:var(--faint)}

/* ===== 自定义组件：统一暗色体系，禁用原生控件外观 ===== */

/* 主题库标签编辑器（替代原生 input） */
.themes{display:flex;flex-wrap:wrap;gap:6px;min-height:32px;align-items:center}
.tchip{display:inline-flex;align-items:center;gap:6px;background:var(--card2);border:1px solid var(--bd-2);border-radius:999px;padding:3px 6px 3px 8px;font-size:12.5px;color:var(--fg);transition:border-color .15s,background .15s}
.tchip.on{border-color:rgba(167,139,250,.55);background:rgba(139,92,246,.12)}
.tdot{width:14px;height:14px;line-height:12px;text-align:center;font-size:10px;color:#52525b;cursor:pointer;border-radius:50%;flex:none;user-select:none}
.tchip.on .tdot{color:var(--acc)}
.tdot:hover{color:var(--acc)}
.tchip .tname{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;border-radius:4px}
.tchip .tname:hover{color:var(--acc)}
.tchip .tname[contenteditable="true"]{outline:none;cursor:text;max-width:240px;white-space:pre-wrap;word-break:break-all;border-bottom:1px dashed var(--acc);color:var(--fg)}
.tchip .tdel{background:transparent;border:0;color:var(--faint);font-size:11px;padding:0 4px;cursor:pointer;flex:none;border-radius:50%}
.tchip .tdel:hover:not(:disabled){color:#f87171;background:rgba(248,113,113,.12)}
.tchip .tdel:disabled{color:#52525b;cursor:not-allowed}
.tnew{margin-top:8px;min-height:30px;padding:5px 10px;font-size:12.5px}
.cb-hint{font-size:10.5px;color:#52525b;margin-top:5px}

/* 采集源健康状态（设置 modal 内，数据来自 /api/source-health） */
.src-health{display:flex;flex-direction:column;gap:3px;margin:-2px 0 10px;font-size:11px;color:var(--faint)}
.src-health .hrow{display:flex;align-items:center;gap:7px;min-width:0;line-height:1.6}
.src-health .hdot{width:6px;height:6px;border-radius:50%;flex:none;background:#3f3f46}
.src-health .hdot.ok{background:var(--ok)}
.src-health .hdot.bad{background:var(--bad);box-shadow:0 0 6px rgba(248,113,113,.6)}
.src-health .hname{color:#c9c9ce;font-weight:500;flex:none}
.src-health .hstat{flex:none}
.src-health .herr{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b0666e}

/* 自绘文本组件（contenteditable，替代原生 input） */
[contenteditable]{outline:none;cursor:text}
[contenteditable]:empty::before{content:attr(data-placeholder);color:#52525b;pointer-events:none}
.txtbox{display:block;width:100%;background:#0d0d0d;border:1px solid var(--bd-2);border-radius:8px;padding:7px 10px;min-height:32px;font-size:13px;white-space:pre-wrap;word-break:break-all}
.txtbox:focus-within{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.step-val{white-space:pre-wrap;word-break:break-all}

/* 步进调节框（替代 native number input） */
.stepper{display:flex;align-items:center;background:#0d0d0d;border:1px solid var(--bd-2);border-radius:8px;overflow:hidden}
.stepper:focus-within{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.step{width:34px;align-self:stretch;background:transparent;color:var(--muted);font-size:16px;padding:0}
.step:hover{background:var(--card2);color:var(--acc)}
.step-val{flex:1;min-width:0;background:transparent;border:0;outline:none;color:var(--fg);font:inherit;font-size:13px;text-align:center;padding:7px 0}

/* 开关（替代 native checkbox） */
.sw{display:flex;align-items:center;gap:9px;cursor:pointer;user-select:none;margin:0 0 14px;color:#c9c9ce;font-size:13px}
.sw .track{position:relative;width:38px;height:21px;border-radius:999px;background:#26262b;border:1px solid var(--bd-2);transition:background .18s,border-color .18s;flex-shrink:0}
.sw .knob{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#9a9aa3;transition:transform .18s,background .18s}
.sw.on .track{background:var(--acc-deep);border-color:var(--acc-deep)}
.sw.on .knob{transform:translateX(17px);background:#fff}

/* 设置 modal */
.overlay{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;padding:20px}
.overlay.show{display:flex}
.modal{width:100%;max-width:460px;background:var(--card);border:1px solid var(--bd-2);border-radius:14px;padding:20px 22px;box-shadow:0 30px 80px rgba(0,0,0,.7);animation:pop .16s ease}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.modal .mhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.modal .mhead h2{margin:0;font-size:15px;font-weight:700}
.modal .x{background:transparent;color:var(--faint);font-size:18px;line-height:1;padding:4px 8px;border-radius:8px}
.modal .x:hover{color:#fff;background:var(--card2)}
.modal .row{display:flex;gap:14px;flex-wrap:wrap}
.modal label.f{display:block;font-size:11.5px;color:var(--faint);margin-bottom:4px}
.modal .field{flex:1;min-width:150px;margin-bottom:12px}
.modal .chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px}
.modal .sep{margin:4px 0 12px;padding-top:12px;border-top:1px solid var(--bd);font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);font-weight:600}
.modal .mfoot{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
.modal .mfoot .grow{flex:1}

/* ===== LLM 配置面板（master-detail：左提供商列表 / 右编辑表单，宽版 modal） ===== */
.modal.llm{max-width:920px;height:min(660px,94vh);padding:0;display:flex;flex-direction:column;overflow:hidden}
.modal.llm .mhead{padding:12px 16px;border-bottom:1px solid var(--bd);margin-bottom:0;flex:none;gap:10px;justify-content:flex-start}
.modal.llm .mhead .lsub{font-size:11px;color:var(--faint);font-weight:400;margin-left:auto;margin-right:8px}
.lbody{display:flex;flex:1;min-height:0}
.lside{width:250px;flex:none;border-right:1px solid var(--bd);display:flex;flex-direction:column;min-height:0}
.lside-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);font-weight:600}
.plist{flex:1;overflow-y:auto;padding:0 8px 12px}
.pitem{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer;border:1px solid transparent;border-right:2px solid transparent;transition:background .15s}
.pitem:hover{background:var(--card2)}
.pitem.sel{background:rgba(139,92,246,.10);border-right-color:var(--acc-deep)}
.pdot{width:7px;height:7px;border-radius:50%;background:#3f3f46;flex:none}
.pdot.on{background:var(--ok);box-shadow:0 0 8px rgba(74,222,128,.8)}
.pinfo{min-width:0;flex:1;display:flex;flex-direction:column}
.pname{font-size:13px;font-weight:600;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmeta{font-size:10.5px;color:var(--faint)}
.pdel{display:none;background:transparent;border:0;color:var(--faint);font-size:11px;padding:3px 6px;border-radius:6px;cursor:pointer;flex:none;line-height:1}
.pitem:hover .pdel{display:block}
.pdel:hover{color:#f87171;background:rgba(248,113,113,.12)}
.pempty{padding:30px 14px;text-align:center;color:var(--faint);font-size:12px;line-height:1.8}
.ldetail{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.lempty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--faint);font-size:13px}
.lempty .ic{font-size:30px;opacity:.6}
.lform{flex:1;overflow-y:auto;padding:16px 18px 20px}
.lbar{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--bd);flex:none}
.lbar .lstat{margin-right:auto;font-size:12px;color:var(--faint)}
.txtbox.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.txtbox.ro{color:var(--faint);background:#101010;cursor:default}
.seg{display:flex;gap:6px;flex-wrap:wrap}
.seg-btn{background:#0d0d0d;border:1px solid var(--bd-2);color:var(--muted);padding:6px 12px;font-size:12.5px;border-radius:8px;font-weight:500}
.seg-btn:hover{border-color:#52525b;color:#fff}
.seg-btn.on{background:var(--acc-deep);border-color:var(--acc-deep);color:#fff;box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.secret{position:relative}
.secret .txtbox{padding-right:36px}
.seye{position:absolute;right:5px;top:50%;transform:translateY(-50%);background:transparent;color:var(--faint);font-size:13px;padding:3px 5px;border-radius:6px;line-height:1}
.seye:hover{color:var(--acc);background:var(--card2)}
.txtbox.keyed{-webkit-text-security:disc}
.mgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.mcard{display:flex;align-items:center;gap:7px;background:#0d0d0d;border:1px solid rgba(167,139,250,.45);border-radius:8px;padding:6px 9px;cursor:pointer;user-select:none;min-width:0;transition:.15s}
.mcard:hover{border-color:var(--acc);background:rgba(139,92,246,.12)}
.mcard .mk{width:14px;height:14px;flex:none;border-radius:4px;background:var(--acc-deep);color:#fff;font-size:9.5px;display:flex;align-items:center;justify-content:center;line-height:1}
.mcard .mname{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d4d4d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mempty{border:1px dashed var(--bd-2);border-radius:10px;padding:18px 14px;text-align:center;color:var(--faint);font-size:12px;line-height:1.7}
/* 自绘下拉（listbox，替代原生 select/datalist） */
.cselect{position:relative;user-select:none}
.cs-btn{display:flex;align-items:center;gap:8px;width:100%;background:#0d0d0d;border:1px solid var(--bd-2);border-radius:8px;padding:7px 10px;font-size:13px;color:var(--fg);text-align:left;font-weight:400}
.cselect.open .cs-btn{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.cs-btn .cs-val{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-btn .cs-val.dim{color:#52525b}
.cs-caret{color:var(--faint);font-size:11px;flex:none;transition:transform .15s}
.cselect.open .cs-caret{transform:rotate(180deg)}
.cs-list{display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:#0d0d13;border:1px solid var(--bd-2);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.7);z-index:60;max-height:240px;overflow-y:auto;padding:4px}
.cselect.open .cs-list{display:block}
.cs-opt{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:7px;cursor:pointer;font-size:12.5px;color:#d4d4d8}
.cs-opt:hover,.cs-opt.act{background:var(--card2)}
.cs-opt.on{background:rgba(139,92,246,.14);color:#fff}
.cs-opt .cs-p{color:var(--acc);flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-opt.none .cs-p{color:var(--faint)}
.cs-opt .cs-m{font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-empty{padding:12px;text-align:center;color:var(--faint);font-size:12px}
.lside-foot{border-top:1px solid var(--bd);padding:6px 8px;flex:none}
.nav-badge{background:var(--acc-deep);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;flex:none}
.spin{display:inline-block;animation:rot .9s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(10px);background:#0d0d13;border:1px solid rgba(167,139,250,.45);color:#d4d4d8;padding:8px 16px;border-radius:10px;font-size:12.5px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:99;box-shadow:0 12px 32px rgba(0,0,0,.6);max-width:min(80vw,480px)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast.bad{border-color:rgba(248,113,113,.55)}

@media(max-width:760px){.wall{columns:1}.top{flex-wrap:wrap;height:auto;padding:10px 16px}.modal.llm{height:94vh}.lside{width:180px}.mgrid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>

<header class="top">
  <div class="brand"><span class="dot"></span>Inspira</div>
  <span class="link">创意灵感生成 · 只产提示词</span>
  <div class="spacer"></div>
  <button class="btn ghost" id="openLlm">LLM 配置</button>
  <button class="btn ghost" id="openSettings">设置</button>
  <button class="btn" id="gen">立即生成</button>
</header>

<div class="status" id="health">加载中…</div>

<div class="filters">
  <span class="chip on" data-f="all">全部</span>
  <span class="chip" data-f="image">图像</span>
  <span class="chip" data-f="video">视频</span>
  <span class="count" id="count"></span>
</div>

<div class="wall" id="wall"></div>

<!-- 设置 modal（全部为自定义组件：combobox / stepper / switch / chips） -->
<div class="overlay" id="overlay">
  <div class="modal" role="dialog" aria-modal="true" aria-label="灵感设置">
    <div class="mhead"><h2>⚙ 灵感设置</h2><button class="x" id="closeModal" aria-label="关闭" type="button">✕</button></div>

    <div class="row">
      <div class="field">
        <label class="f">主题库（每次生成随机取一个）</label>
        <div class="themes" id="themeList" role="list" aria-label="主题列表"></div>
        <div class="txtbox tnew" id="themeNew" contenteditable="true" role="textbox" data-placeholder="输入新主题，回车添加…" aria-label="新主题"></div>
        <div class="cb-hint" id="themeHint">点击 ○ 勾选参与随机 · 点击主题名改名 · ✕ 删除 · 回车添加</div>
      </div>

      <div class="field" style="flex:0 0 148px">
        <label class="f">间隔（分钟）</label>
        <div class="stepper" id="intervalStepper">
          <button class="step" data-d="-5" type="button" aria-label="减少 5 分钟">−</button>
          <div class="step-val" contenteditable="true" role="textbox" aria-label="间隔分钟"></div>
          <button class="step" data-d="5" type="button" aria-label="增加 5 分钟">+</button>
        </div>
        <div class="cb-hint">1–10080 分钟，步进 5</div>
      </div>
    </div>

    <div class="sw" id="enabledSw" role="switch" aria-checked="true" tabindex="0">
      <span class="track"><span class="knob"></span></span>
      <span>自动定时生成</span>
    </div>

    <div class="chips">
      <span class="chip on" data-g="kinds" data-v="image">图像</span>
      <span class="chip on" data-g="kinds" data-v="video">视频（6 秒）</span>
    </div>
    <div class="chips">
      <span class="chip on" data-g="sources" data-v="hot_topic">热点</span>
      <span class="chip on" data-g="sources" data-v="hot_image">热图</span>
      <span class="chip on" data-g="sources" data-v="original_idea">原创点子</span>
    </div>

    <div class="sep">采集数据源（图像聚合抓取）</div>
    <div class="chips" id="srcChips"></div>
    <div class="cb-hint" id="srcHint">google 常被反爬（可能 0 结果）；x 需 X_BEARER_TOKEN（环境变量）才生效；custom 需填写下方 URL</div>
    <div class="src-health" id="srcHealth"></div>
    <div class="row">
      <div class="field"><label class="f">自定义热点 JSON URL（可选）</label><div id="topicsUrl" class="txtbox" contenteditable="true" role="textbox" data-placeholder="留空 = 内置 GitHub 热门" aria-label="热点 JSON URL"></div></div>
    </div>
    <div class="row" style="margin-top:10px">
      <div class="field"><label class="f">自定义热图 JSON URL（可选，供 custom 源）</label><div id="imagesUrl" class="txtbox" contenteditable="true" role="textbox" data-placeholder="如 https://example.com/images.json" aria-label="热图 JSON URL"></div></div>
    </div>

    <div class="mfoot">
      <button class="btn ghost" id="clear" type="button">清空历史</button>
      <span class="grow"></span>
      <button class="btn ghost" id="cancelModal" type="button">取消</button>
      <button class="btn" id="save" type="button">保存设置</button>
    </div>
  </div>
</div>

<!-- LLM 配置面板（master-detail：左侧提供商列表 + 右侧编辑表单；全部自绘组件，无原生控件） -->
<div class="overlay" id="llmOverlay">
  <div class="modal llm" role="dialog" aria-modal="true" aria-label="LLM 配置">
    <div class="mhead">
      <button class="btn ghost sm" id="llmBack" type="button">← 返回</button>
      <h2>LLM 配置</h2>
      <span class="lsub">生成统一走各协议的 OpenAI 兼容接口 · 可为点子/图像/视频分配不同模型</span>
      <button class="x" id="llmClose" aria-label="关闭" type="button">✕</button>
    </div>
    <div class="lbody">
      <aside class="lside">
        <div class="lside-head"><span>提供商</span><button class="btn ghost sm" id="llmAdd" type="button">+ 添加</button></div>
        <div class="plist" id="providerList"></div>
        <div class="lside-foot">
          <div class="pitem" id="assignNav" role="button" tabindex="0" aria-label="模型分配">
            <span class="pinfo"><span class="pname">⚖ 模型分配</span><span class="pmeta">点子 / 图像 / 视频</span></span>
            <span class="nav-badge" id="asgBadge" style="display:none">0</span>
          </div>
        </div>
      </aside>
      <section class="ldetail">
        <div class="lempty" id="llmEmpty">
          <span class="ic">⚙</span>
          <span>选择一个提供商或创建新的配置</span>
          <button class="btn" id="llmEmptyAdd" type="button">+ 新建提供商</button>
        </div>
        <div class="lform" id="llmForm" style="display:none">
          <div class="row">
            <div class="field" style="flex:0 0 200px">
              <label class="f">ID</label>
              <div class="txtbox mono" id="pId" contenteditable="true" role="textbox" data-placeholder="例如：my-openai" aria-label="提供商 ID"></div>
              <div class="cb-hint" id="pIdHint">创建后不可修改 · 仅限字母/数字/连字符/下划线</div>
            </div>
            <div class="field">
              <label class="f">名称</label>
              <div class="txtbox" id="pName" contenteditable="true" role="textbox" data-placeholder="例如：GPT-4o" aria-label="提供商名称"></div>
            </div>
          </div>
          <label class="f">协议类型</label>
          <div class="seg" id="kindSeg" role="radiogroup" aria-label="协议类型">
            <button class="seg-btn on" type="button" role="radio" aria-checked="true" data-k="openai">OpenAI</button>
            <button class="seg-btn" type="button" role="radio" aria-checked="false" data-k="anthropic">Anthropic</button>
            <button class="seg-btn" type="button" role="radio" aria-checked="false" data-k="gemini">Gemini</button>
            <button class="seg-btn" type="button" role="radio" aria-checked="false" data-k="openai_compat">OpenAI 兼容</button>
          </div>
          <div id="baseUrlWrap" style="display:none;margin-top:12px">
            <label class="f">Base URL</label>
            <div class="txtbox mono" id="pBaseUrl" contenteditable="true" role="textbox" data-placeholder="https://api.openai.com/v1" aria-label="Base URL"></div>
          </div>
          <div style="margin-top:12px">
            <label class="f">API Key</label>
            <div class="secret">
              <div class="txtbox mono" id="pKey" contenteditable="true" role="textbox" data-placeholder="sk-…" aria-label="API Key"></div>
              <button class="seye" id="keyEye" type="button" aria-label="显示或隐藏密钥" aria-pressed="false">👁</button>
            </div>
            <div class="cb-hint" id="keyHint" style="display:none">密钥已脱敏，如需更换请重新输入</div>
          </div>
          <div class="sep" style="display:flex;align-items:center;gap:10px">
            <span>模型列表</span>
            <span style="flex:1"></span>
            <button class="btn ghost sm" id="fetchModels" type="button">获取模型列表</button>
          </div>
          <div id="modelEmpty" class="mempty"></div>
          <div id="modelGrid" class="mgrid" style="display:none"></div>
          <div class="txtbox tnew" id="modelNew" contenteditable="true" role="textbox" data-placeholder="手动添加模型 ID，回车添加…" aria-label="手动添加模型"></div>
          <div class="cb-hint">点击模型卡片取消勾选并移除 · 未分配任务的生成使用列表中第一个可用提供商的第一个模型</div>
        </div>
        <!-- 模型分配视图：为不同生成任务指定「提供商 · 模型」（自绘下拉，无原生 select） -->
        <div class="lform" id="assignForm" style="display:none">
          <div class="cb-hint" style="font-size:11.5px;color:var(--muted);margin:0 0 14px">为不同生成任务指定不同的「提供商 · 模型」；留空（自动）时使用提供商列表中第一个可用提供商的第一个模型。</div>
          <div class="field">
            <label class="f">创意点子（中文灵感点子）</label>
            <div class="cselect" id="asgIdea"></div>
          </div>
          <div class="field">
            <label class="f">图像提示词（Krea 规范 · 含视频参考画面生图提示词）</label>
            <div class="cselect" id="asgImage"></div>
          </div>
          <div class="field">
            <label class="f">视频提示词（MiniMax H3 规范 · 固定 6 秒）</label>
            <div class="cselect" id="asgVideo"></div>
          </div>
          <div class="cb-hint">删除提供商或从列表移除模型后，对应分配自动失效并回退为自动</div>
        </div>
        <div class="lbar" id="llmBar" style="display:none">
          <span class="lstat" id="llmStat">新建提供商</span>
          <button class="btn ghost" id="pDelete" type="button" style="display:none">删除提供商</button>
          <button class="btn" id="pSave" type="button">保存配置</button>
        </div>
        <div class="lbar" id="assignBar" style="display:none">
          <span class="lstat" id="assignStat">自动分配</span>
          <button class="btn ghost" id="asgReset" type="button">全部设为自动</button>
          <button class="btn" id="asgSave" type="button">保存分配</button>
        </div>
      </section>
    </div>
  </div>
</div>

<script>
const $=s=>document.querySelector(s),wall=$('#wall'),health=$('#health'),count=$('#count');
const overlay=$('#overlay');
let kinds=['image','video'],sources=['hot_topic','hot_image','original_idea'];
let enabled=true;
let items=[],filter='all';
const KIND={image:{n:'图像',ic:'image'},video:{n:'视频',ic:'video'}};
const SRC={hot_topic:'热点',hot_image:'热图',original_idea:'原创点子'};
const ST={queued:'排队中',running:'生成中',ready:'提示词就绪',failed:'失败'};

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(t){const d=new Date(t);return d.toLocaleDateString(undefined,{month:'2-digit',day:'2-digit'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function ago(t){if(!t)return'';const s=Math.floor((Date.now()-new Date(t).getTime())/1000);
  if(s<60)return'刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';if(s<86400)return Math.floor(s/3600)+' 小时前';return Math.floor(s/86400)+' 天前';}

/* ===== 自定义组件：文本输入（contenteditable 自绘，替代原生 input） ===== */
function makeTextField(el,opts={}){
  if(opts.placeholder!==undefined)el.dataset.placeholder=opts.placeholder;
  const refresh=()=>{
    el.classList.toggle('ph',!el.textContent.replace(/\u00A0/g,' ').trim());
    if(opts.maxlength&&el.textContent.length>opts.maxlength)el.textContent=el.textContent.slice(0,opts.maxlength);
  };
  el.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key==='Escape')e.preventDefault(); // 阻止 contenteditable 产生换行
    if(opts.digits&&e.key.length===1&&!/[0-9]/.test(e.key)&&!e.ctrlKey&&!e.metaKey)e.preventDefault();
  });
  el.addEventListener('paste',e=>{
    e.preventDefault();
    const t=((e.clipboardData||window.clipboardData).getData('text/plain')||'').trim();
    document.execCommand('insertText',false,t);
  });
  el.addEventListener('input',()=>{
    let t=el.textContent.replace(/\u00A0/g,' ');
    if(opts.digits)t=t.replace(/[^0-9]/g,'');
    if(t!==el.textContent)el.textContent=t;
    refresh();
    opts.onInput&&opts.onInput();
  });
  const set=v=>{el.textContent=String(v??'');refresh();};
  const get=()=>el.textContent.replace(/\u00A0/g,' ').trim();
  set(opts.initial??'');
  return {el,get,set};
}

/* ===== 自定义组件：步进调节框（间隔） ===== */
function makeStepper(comp){
  const minus=comp.querySelector('[data-d="-5"]'),plus=comp.querySelector('[data-d="5"]');
  const valV=makeTextField(comp.querySelector('.step-val'),{digits:true,maxlength:5,initial:60});
  const val=valV.el;
  const clamp=n=>Math.max(1,Math.min(10080,Math.round(n)));
  const read=()=>{const n=parseInt(valV.get(),10);return Number.isFinite(n)?clamp(n):60;};
  const set=n=>{valV.set(String(clamp(n)));};
  minus.addEventListener('click',()=>set(read()-5));
  plus.addEventListener('click',()=>set(read()+5));
  val.addEventListener('blur',()=>set(read()));
  val.addEventListener('keydown',e=>{if(e.key==='Enter'){set(read());val.blur();}});
  return {get:()=>read(),set};
}

/* ===== 自定义组件：开关（自动生成） ===== */
function makeSwitch(sw){
  const on=()=>{
    sw.classList.toggle('on',enabled);
    sw.setAttribute('aria-checked',String(enabled));
  };
  sw.addEventListener('click',()=>{enabled=!enabled;on();});
  sw.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();enabled=!enabled;on();}});
  on();
  return {get:()=>enabled,set:v=>{enabled=!!v;on();}};
}

/* ===== 自定义组件：下拉选择（listbox，替代原生 select） =====
   cfg: { options():[{v,p,m,none?}], onChange?, placeholder? }；值经 esc() 转义，支持键盘（↓↑/Enter/Esc） */
const SELECTS=[];
function makeSelect(el,cfg){
  let value='',open=false,actIdx=-1;
  const btn=document.createElement('button');btn.type='button';btn.className='cs-btn';
  btn.setAttribute('aria-haspopup','listbox');btn.setAttribute('aria-expanded','false');
  const list=document.createElement('div');list.className='cs-list';list.setAttribute('role','listbox');
  el.appendChild(btn);el.appendChild(list);
  const paint=()=>{
    const cur=cfg.options().find(o=>o.v===value);
    btn.innerHTML='<span class="cs-val'+(cur?'':' dim')+'">'+esc(cur?(cur.p+' · '+cur.m):(cfg.placeholder||'自动（第一个可用模型）'))+'</span><span class="cs-caret">▾</span>';
  };
  const renderList=()=>{
    const os=cfg.options();
    list.innerHTML=os.length?os.map((o,i)=>
      '<div class="cs-opt'+(o.v===value?' on':'')+(o.none?' none':'')+(open&&i===actIdx?' act':'')+'" role="option" aria-selected="'+(o.v===value)+'" data-v="'+esc(o.v)+'">'+
      '<span class="cs-p">'+esc(o.p)+'</span><span class="cs-m">'+esc(o.m)+'</span></div>').join('')
      :'<div class="cs-empty">暂无可选模型——先添加提供商并启用模型</div>';
  };
  const actPaint=()=>{list.querySelectorAll('.cs-opt').forEach((n,i)=>n.classList.toggle('act',open&&i===actIdx));};
  const move=(d)=>{const n=cfg.options().length;if(!n)return;actIdx=(actIdx+d+n)%n;actPaint();
    const node=list.querySelectorAll('.cs-opt')[actIdx];if(node)node.scrollIntoView({block:'nearest'});};
  const setOpen=(v)=>{
    if(v===open)return;
    open=v;el.classList.toggle('open',open);btn.setAttribute('aria-expanded',String(open));
    if(open){const os=cfg.options();actIdx=Math.max(0,os.findIndex(o=>o.v===value));renderList();}
  };
  const commit=(v)=>{
    value=v;paint();renderList();setOpen(false);
    cfg.onChange&&cfg.onChange();
  };
  btn.addEventListener('click',()=>setOpen(!open));
  btn.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open)setOpen(true);else move(e.key==='ArrowDown'?1:-1);}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!open)setOpen(true);else if(actIdx>-1){const o=cfg.options()[actIdx];if(o)commit(o.v);}}
  });
  list.addEventListener('click',e=>{const o=e.target.closest('.cs-opt');if(o)commit(o.dataset.v);});
  document.addEventListener('click',e=>{if(open&&!el.contains(e.target))setOpen(false);});
  document.addEventListener('keydown',e=>{
    if(!open)return;
    if(e.key==='Escape'){e.preventDefault();setOpen(false);}
    else if(e.key==='ArrowDown'){e.preventDefault();move(1);}
    else if(e.key==='ArrowUp'){e.preventDefault();move(-1);}
    else if(e.key==='Enter'){e.preventDefault();if(actIdx>-1){const o=cfg.options()[actIdx];if(o)commit(o.v);}}
  });
  paint();renderList();
  const inst={get:()=>value,set:(v)=>{value=v||'';paint();renderList();},refresh:()=>{paint();renderList();},close:()=>setOpen(false),isOpen:()=>open};
  SELECTS.push(inst);
  return inst;
}

/* 设置 modal */
function openModal(){loadSettings();loadSourceConfig();loadHealth();overlay.classList.add('show');}
function closeModal(){overlay.classList.remove('show');}
$('#openSettings').onclick=openModal;
$('#closeModal').onclick=closeModal;
$('#cancelModal').onclick=closeModal;
overlay.onclick=(e)=>{if(e.target===overlay)closeModal();};
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&overlay.classList.contains('show'))closeModal();});

/* ===== 主题库编辑器（勾选激活 + 增/删/改；替代原组合框） ===== */
let themes=[];
let activeThemes=[];
const themeNew=makeTextField($('#themeNew'),{placeholder:'输入新主题，回车添加…',maxlength:40});
const themeHint=$('#themeHint');
const THEME_HINT='点击 ○ 勾选参与随机 · 点击主题名改名 · ✕ 删除 · 回车添加';
function flashThemeHint(msg){themeHint.textContent=msg;setTimeout(()=>{themeHint.textContent=THEME_HINT;},1800);}
function themeActive(t){return activeThemes.some(x=>x.toLowerCase()===t.toLowerCase());}
function renderThemes(){
  $('#themeList').innerHTML=themes.map((t,i)=>
    '<span class="tchip'+(themeActive(t)?' on':'')+'" data-i="'+i+'" role="listitem">'+
    '<span class="tdot" role="checkbox" aria-checked="'+(themeActive(t)?'true':'false')+'" tabindex="0" aria-label="勾选参与随机：'+esc(t)+'">'+(themeActive(t)?'●':'○')+'</span>'+
    '<span class="tname">'+esc(t)+'</span>'+
    '<button class="tdel" type="button" aria-label="删除主题 '+esc(t)+'"'+(themes.length<2?' disabled':'')+'>✕</button></span>'
  ).join('');
}
function commitThemeEdit(nm,orig){
  nm.removeAttribute('contenteditable');
  const v=nm.textContent.replace(/\u00A0/g,' ').trim().slice(0,100);
  if(!v||(v.toLowerCase()!==orig.toLowerCase()&&themes.some(t=>t.toLowerCase()===v.toLowerCase()))){nm.textContent=orig;return;}
  const i=+nm.parentElement.dataset.i;
  if(!Number.isFinite(i)||themes[i]===undefined)return;
  const wasActive=themeActive(themes[i]);
  themes[i]=v;renderThemes();
  if(wasActive){
    const ai=activeThemes.findIndex(x=>x.toLowerCase()===orig.toLowerCase());
    if(ai>-1)activeThemes[ai]=v;
  }
}
$('#themeList').addEventListener('click',e=>{
  const dot=e.target.closest('.tdot');
  if(dot){
    const i=+dot.closest('.tchip').dataset.i;
    if(!Number.isFinite(i)||themes[i]===undefined)return;
    const v=themes[i];
    if(themeActive(v)){
      // 至少保留 1 个激活主题
      if(activeThemes.length<2){flashThemeHint('至少需要 1 个参与随机的主题');return;}
      activeThemes=activeThemes.filter(x=>x.toLowerCase()!==v.toLowerCase());
    }else{
      activeThemes.push(v);
    }
    renderThemes();
    return;
  }
  const del=e.target.closest('.tdel');
  if(del&&!del.disabled){
    const i=+del.closest('.tchip').dataset.i;
    if(themes.length>1){
      const v=themes[i];
      themes.splice(i,1);
      activeThemes=activeThemes.filter(x=>x.toLowerCase()!==v.toLowerCase());
      if(!activeThemes.length)activeThemes=[...themes];
      renderThemes();
    }
    return;
  }
  const nm=e.target.closest('.tname');
  if(nm&&!nm.isContentEditable){
    nm.dataset.orig=nm.textContent;
    nm.setAttribute('contenteditable','true');nm.focus();
    const r=document.createRange();r.selectNodeContents(nm);
    const sel=getSelection();sel.removeAllRanges();sel.addRange(r);
  }
});
$('#themeList').addEventListener('keydown',e=>{
  const nm=e.target.closest('.tname');
  if(nm&&nm.isContentEditable){
    if(e.key==='Enter'){e.preventDefault();nm.blur();}
    else if(e.key==='Escape'){nm.textContent=nm.dataset.orig??'';nm.removeAttribute('contenteditable');}
    return;
  }
  const dot=e.target.closest('.tdot');
  if(dot&&(e.key===' '||e.key==='Enter')){e.preventDefault();dot.click();}
});
$('#themeList').addEventListener('blur',e=>{
  const nm=e.target.closest('.tname');
  if(!nm)return;
  commitThemeEdit(nm,nm.dataset.orig??'');
},{capture:true});
function addTheme(){
  const v=themeNew.get();
  if(!v)return;
  if(themes.some(t=>t.toLowerCase()===v.toLowerCase())){flashThemeHint('主题已存在：'+v);themeNew.set('');return;}
  themes.push(v.slice(0,40));
  activeThemes.push(v.slice(0,40)); // 新主题默认参与随机
  themeNew.set('');renderThemes();
}
themeNew.el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addTheme();}});

const intervalStepper=makeStepper($('#intervalStepper'));
const enabledSw=makeSwitch($('#enabledSw'));

/* ===== 采集数据源（聚合 provider 白名单 + 自定义 URL） ===== */
const SRC_PROVIDERS=[
  {id:'wikimedia',n:'Wikimedia'},{id:'bing',n:'Bing'},{id:'openverse',n:'Openverse'},
  {id:'google',n:'Google'},{id:'custom',n:'自定义JSON'},{id:'x',n:'X/Twitter'},
];
let scrapeProviders=['wikimedia','bing','openverse','custom'];
const topicsUrlV=makeTextField($('#topicsUrl'),{placeholder:'留空 = 内置 GitHub 热门'});
const imagesUrlV=makeTextField($('#imagesUrl'),{placeholder:'如 https://example.com/images.json'});
function renderSrcChips(){document.querySelectorAll('#srcChips .chip').forEach(ch=>{
  ch.classList.toggle('on',scrapeProviders.includes(ch.dataset.p));});}
const srcChips=$('#srcChips');
srcChips.innerHTML=SRC_PROVIDERS.map(p=>'<span class="chip" data-p="'+p.id+'">'+esc(p.n)+'</span>').join('');
async function loadSourceConfig(){try{const s=await (await fetch('/api/source-config')).json();
  scrapeProviders=s.providers.length?s.providers.slice():['wikimedia'];
  topicsUrlV.set(s.hotTopicsUrl||'');imagesUrlV.set(s.hotImagesUrl||'');
  renderSrcChips();}catch(e){}}

/* 采集源健康面板：每个 provider 的最近成功/失败、连续失败次数与冷却剩余（数据来自 /api/source-health） */
let srcHealth=[];
function renderSrcHealth(){
  const el=$('#srcHealth');
  if(!srcHealth.length){el.innerHTML='<div class="hrow"><span class="hstat">（暂无抓取记录）</span></div>';return;}
  el.innerHTML=srcHealth.map(p=>{
    const bad=p.coolingDown||p.consecutiveFailures>0;
    const dot=bad?'bad':(p.lastSuccessAt?'ok':'idle');
    let stat;
    if(p.lastSuccessAt)stat='上次成功 '+ago(p.lastSuccessAt);
    else if(p.lastFailureAt)stat='尚未成功';
    else stat='尚未使用';
    if(p.lastFailureAt){
      stat+=' · 上次失败 '+ago(p.lastFailureAt)+(p.consecutiveFailures>1?('（连续 '+p.consecutiveFailures+' 次）'):'');
      if(p.coolingDown)stat+=' · 冷却中 '+Math.ceil(p.cooldownRemainingMs/1000)+'s';
    }
    const err=bad&&p.lastError?'<span class="herr" title="'+esc(p.lastError)+'">'+esc(p.lastError.length>70?p.lastError.slice(0,70)+'…':p.lastError)+'</span>':'';
    return '<div class="hrow"><span class="hdot '+dot+'"></span><span class="hname">'+esc(p.label)+'</span><span class="hstat">'+esc(stat)+'</span>'+err+'</div>';
  }).join('');
}

function renderChips(){document.querySelectorAll('.modal .chip[data-g]').forEach(ch=>{
  const g=ch.dataset.g,arr=g==='kinds'?kinds:sources;
  ch.classList.toggle('on',arr.includes(ch.dataset.v));});}
/* 事件委托：modal 内所有 chip（kinds / sources / 采集源 provider）统一分发，避免绑定覆盖与数组污染 */
document.querySelector('.modal').addEventListener('click',e=>{
  const ch=e.target.closest('.chip');
  if(!ch)return;
  if(ch.dataset.g){const g=ch.dataset.g,v=ch.dataset.v,arr=g==='kinds'?kinds:sources;
    const next=arr.includes(v)?arr.filter(x=>x!==v):[...arr,v];
    if(g==='kinds'){kinds=next.length?next:['image'];}else{sources=next.length?next:['original_idea'];}
    renderChips();}
  else if(ch.dataset.p){const v=ch.dataset.p;
    scrapeProviders=scrapeProviders.includes(v)?scrapeProviders.filter(x=>x!==v):[...scrapeProviders,v];
    if(!scrapeProviders.length)scrapeProviders=['wikimedia'];
    renderSrcChips();}
});
document.querySelector('.filters').addEventListener('click',e=>{
  const ch=e.target.closest('.chip');
  if(!ch)return;
  document.querySelectorAll('.filters .chip').forEach(x=>x.classList.remove('on'));
  ch.classList.add('on');filter=ch.dataset.f;render();});

/* <Picture N> 参考画面悬停浮层：显示画面描述与配套生图提示词 */
function promptHtml(i){
  const text=esc(i.prompt);
  if(!i.pictures||!i.pictures.length)return text;
  return text.replace(/&lt;Picture *([0-9]+) *&gt;/gi,(all,n)=>{
    const p=(i.pictures||[]).find(x=>x.index===parseInt(n,10));
    if(!p)return all;
    return '<span class="pcref" tabindex="0" data-idx="'+esc(n)+'">Picture '+esc(n)+'</span>';
  });
}
const ptip=document.createElement('div');ptip.className='ptip';document.body.appendChild(ptip);
function hideTip(){ptip.style.display='none';}
function showTip(r){
  const id=r.closest('.card')&&r.closest('.card').dataset.id;
  const item=id?items.find(x=>x.id===id):null;
  const p=item&&item.pictures?(item.pictures||[]).find(x=>x.index===parseInt(r.dataset.idx,10)):null;
  const desc=p?p.description:'';
  const img=(p&&p.imagePrompt||'').trim();
  ptip.innerHTML='<b>参考画面 '+esc(r.dataset.idx||'')+'</b><div class="ptd">'+esc(desc)+'</div>'+'<div class="ptp'+(img?'':' dim')+'">'+esc(img||'（配套生图提示词生成失败）')+'</div>';
  ptip.style.display='block';
  const rc=r.getBoundingClientRect(),tw=ptip.offsetWidth,th=ptip.offsetHeight;
  let left=rc.left,top=rc.bottom+8;
  if(top+th>innerHeight-8)top=rc.top-th-8;
  if(left+tw>innerWidth-12)left=innerWidth-tw-12;
  if(left<12)left=12;
  ptip.style.left=left+'px';ptip.style.top=Math.max(8,top)+'px';
}
wall.addEventListener('mouseover',e=>{const r=e.target.closest&&e.target.closest('.pcref');if(r)showTip(r);});
wall.addEventListener('mouseout',e=>{const r=e.target.closest&&e.target.closest('.pcref');
  if(r){const rt=e.relatedTarget;if(!(rt&&rt.closest&&(rt.closest('.pcref')===r||rt.closest('.ptip'))))hideTip();}});
wall.addEventListener('focusin',e=>{const r=e.target.closest&&e.target.closest('.pcref');if(r)showTip(r);});
wall.addEventListener('focusout',e=>{const r=e.target.closest&&e.target.closest('.pcref');if(r)hideTip();});
window.addEventListener('scroll',hideTip,true);

function render(){
  hideTip();
  const list=items.filter(i=>filter==='all'||i.kind===filter);
  count.textContent=list.length+' 条提示词';
  if(!list.length){wall.innerHTML='<div class="empty">暂无灵感 — 点击右上角「立即生成」或等待定时任务<br><span style="font-size:11.5px;color:#52525b">只生成提示词，图片/视频由你粘贴到 Krea / MiniMax H3 生成</span></div>';return;}
  wall.innerHTML=list.map((i,idx)=>{
    const k=KIND[i.kind]||KIND.image,st=i.status;
    const isVid=i.kind==='video';
    const ribbon='<span class="ribbon"><b>'+esc(k.n)+'</b><b>'+esc(SRC[i.source]||i.source)+'</b></span>';
    const stLine='<span class="st '+st+'"><i></i>'+ST[st]+'</span>';
    const cover=isVid
      ? '<div class="cover video">'+ribbon+'<span class="dur">6 秒</span><div class="ph"><span class="ic"><img src="data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>')+'"></span><span class="t">视频提示词</span><span class="s">接 MiniMax H3 后在此展示成片</span></div>'+stLine+'<div class="glow"></div></div>'
      : '<div class="cover image">'+ribbon+'<div class="ph"><span class="ic">🖼</span><span class="t">图像提示词</span><span class="s">接 Krea 后在此展示成图</span></div>'+stLine+'<div class="glow"></div></div>';
    const srcNote=(i.material&&(i.material.label||i.material.note))?'<div class="desc">'+(i.material.url?'<a href="'+esc(i.material.url)+'" target="_blank" rel="noopener">'+esc(i.material.label)+' ↗</a>':'')+(i.material.label&&!i.material.url?esc(i.material.label):'')+(i.material.note?' <span style="opacity:.7">· '+esc(i.material.note)+'</span>':'')+'</div>':'';
    const isOpen=expanded.has(i.id);
    return '<div class="card '+st+'" data-id="'+esc(i.id)+'">'+cover+
      '<div class="body">'+(i.idea?'<h3>'+esc(i.idea)+'</h3>':'')+srcNote+
      (i.error?'<div class="err">✕ '+esc(i.error)+'</div>':'')+
      (i.prompt?'<div class="mono'+(isOpen?' open':'')+'" data-full="'+esc(i.prompt)+'">'+promptHtml(i)+'</div>':'')+
      '<div class="tags"><span class="tag acc">'+esc(i.theme)+'</span>'+(isVid?'<span class="tag">T2VA · 16:9</span>':'<span class="tag">文生图</span>')+'<span class="tag">'+esc(st==='failed'?'失败':'ready 提示词')+'</span></div>'+
      '</div>'+
      '<div class="foot"><span class="t">'+fmt(i.createdAt)+'</span>'+(i.prompt?'<button class="btn sm ghost" onclick="expand(this)">'+(isOpen?'收起':'展开')+'</button><button class="btn sm" onclick="copyPrompt(this,'+idx+')">复制</button>':'')+'</div>'+
      '</div>';}).join('');
}

window.copyPrompt=(btn,idx)=>{
  const item=items.filter(i=>filter==='all'||i.kind===filter)[idx];
  if(!item)return;
  const full=item.prompt;
  const done=()=>{btn.textContent='已复制';setTimeout(()=>btn.textContent='复制',1200);};
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=full;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();done();};
  if(navigator.clipboard){navigator.clipboard.writeText(full).then(done).catch(fallback);}else{fallback();}
};
/* 展开状态按 id 记录在 Set 中 —— render() 每 3s 轮询重建卡片时会据此恢复，避免展开被自动折叠 */
const expanded=new Set();
window.expand=(btn)=>{
  const card=btn.closest('.card');
  if(!card)return;
  const id=card.dataset.id;const m=card.querySelector('.mono');
  if(!m)return;
  if(expanded.has(id)){expanded.delete(id);m.classList.remove('open');btn.textContent='展开';}
  else{expanded.add(id);m.classList.add('open');btn.textContent='收起';}
};

async function loadSettings(){const s=await (await fetch('/api/settings')).json();
  themes=s.themes&&s.themes.length?s.themes.slice():['general'];
  activeThemes=(s.activeThemes&&s.activeThemes.length)?s.activeThemes.filter(t=>themes.includes(t)):[...themes];
  if(!activeThemes.length)activeThemes=[...themes];
  intervalStepper.set(s.intervalMinutes);enabledSw.set(s.enabled);
  kinds=s.kinds.slice();sources=s.sources.slice();renderChips();renderThemes();}
async function loadHealth(){try{
  const hRes=await fetch('/api/health');
  const h=await hRes.json();
  const sRes=await fetch('/api/source-health').catch(()=>null);
  const sh=sRes?await sRes.json().catch(()=>({providers:[]})):{providers:[]};
  srcHealth=sh.providers||[];renderSrcHealth();
  const f=(x)=>x?(x.label+' · '+x.model):null;
  const t=h.llmTasks||{};
  const per={idea:f(t.idea),image:f(t.image),video:f(t.video)};
  const uniq=[...new Set([per.idea,per.image,per.video].filter(Boolean))];
  const llm=!uniq.length?'<b>LLM 未配置</b>（点右上角「LLM 配置」添加提供商）'
    :uniq.length===1?'LLM：<b>'+esc(uniq[0])+'</b>'
    :'LLM：点子 <b>'+esc(per.idea||'—')+'</b> · 图像 <b>'+esc(per.image||'—')+'</b> · 视频 <b>'+esc(per.video||'—')+'</b>';
  const s=h.scheduler;
  const src=(h.scrape&&h.scrape.providers&&h.scrape.providers.length)?h.scrape.providers.join('·'):'无';
  const bad=srcHealth.filter(p=>p.enabled&&(p.coolingDown||p.consecutiveFailures>0));
  const warn=bad.length?' · <span style="color:var(--bad)" title="打开「设置」可查看各采集源最近成功/失败详情">⚠ 采集源异常：'+esc(bad.map(p=>p.label).join('、'))+'</span>':'';
  health.innerHTML=llm+' · 自动生成：'+(s.enabled?'开':'关')+' · 间隔 '+s.intervalMinutes+' 分钟 · 采集源：<b>'+src+'</b> · 下次：'+(s.nextRunAt?new Date(s.nextRunAt).toLocaleTimeString():'—')+warn;}catch(e){}}
async function loadList(){try{items=await (await fetch('/api/inspirations?limit=60')).json();render();}catch(e){}}

$('#save').onclick=async()=>{  const body=JSON.stringify({intervalMinutes:intervalStepper.get(),enabled:enabledSw.get(),themes,activeThemes,kinds,sources});
  const r=await fetch('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body});
  if(!r.ok){alert('保存失败：'+(await r.json()).error);return;}
  const sbody=JSON.stringify({providers:scrapeProviders,hotTopicsUrl:topicsUrlV.get()||undefined,hotImagesUrl:imagesUrlV.get()||undefined});
  const sr=await fetch('/api/source-config',{method:'PUT',headers:{'content-type':'application/json'},body:sbody});
  if(!sr.ok){alert('采集源配置保存失败：'+(await sr.json()).error);return;}
  const btn=$('#save');btn.textContent='已保存';setTimeout(()=>{btn.textContent='保存设置';closeModal();},400);
  await loadSettings();await loadSourceConfig();await loadHealth();};
$('#gen').onclick=async()=>{const r=await fetch('/api/generate',{method:'POST'});
  if(r.status===409){alert((await r.json()).error);}setTimeout(loadList,300);};
$('#clear').onclick=async()=>{if(!confirm('确认清空全部提示词历史？'))return;
  await fetch('/api/inspirations',{method:'DELETE'});loadList();};

/* ===== LLM 配置面板：提供商 CRUD + 模型列表拉取（master-detail） ===== */
const KINDN={openai:'OpenAI',anthropic:'Anthropic',gemini:'Gemini',openai_compat:'OpenAI 兼容'};
const llmOverlay=$('#llmOverlay');
let llmProviders=[],llmSelected=null,llmIsNew=false,llmSaving=false,llmFetching=false;
let llmView='empty'; // 'empty'（无选择）| 'provider'（编辑提供商）| 'assign'（模型分配）
let savedAssignments={idea:null,image:null,video:null};
let asgSaving=false;
let editing={kind:'openai',models:[]};
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function isMaskedKey(k){k=String(k||'');return k.indexOf('***')>=0||(k.length>0&&k.split('').every(c=>c==='*'));}

/* 轻量 toast：成功/失败提示，自动消失 */
const toastEl=document.createElement('div');document.body.appendChild(toastEl);
let toastTimer=0;
function toast(msg,ok){toastEl.className='toast show'+(ok===false?' bad':'');toastEl.textContent=msg;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2600);}

const pIdV=makeTextField($('#pId'),{placeholder:'例如：my-openai',maxlength:64,onInput:renderBar});
const pNameV=makeTextField($('#pName'),{placeholder:'例如：GPT-4o',maxlength:60,onInput:renderBar});
const pBaseUrlV=makeTextField($('#pBaseUrl'),{placeholder:'https://api.openai.com/v1',onInput:renderBar});
const modelNewV=makeTextField($('#modelNew'),{placeholder:'手动添加模型 ID，回车添加…',maxlength:200});

/* API Key 输入：默认打码（-webkit-text-security），不支持的浏览器回退为失焦显示圆点 */
let keyReal='',showKey=false;
const keyDisc=(window.CSS&&CSS.supports&&CSS.supports('-webkit-text-security','disc'));
const pKeyEl=$('#pKey');
const pKeyV=makeTextField(pKeyEl,{placeholder:'sk-…',onInput:()=>{keyReal=pKeyV.get();renderBar();}});
function paintKey(){
  pKeyEl.classList.toggle('keyed',!showKey&&keyDisc);
  $('#keyHint').style.display=isMaskedKey(keyReal)?'':'none';
  if(!keyDisc&&!showKey&&document.activeElement!==pKeyEl)pKeyEl.textContent='•'.repeat(Math.min(keyReal.length,24));
}
pKeyEl.addEventListener('focus',()=>{if(!keyDisc&&!showKey&&pKeyEl.textContent!==keyReal){pKeyEl.textContent=keyReal;
  const r=document.createRange();r.selectNodeContents(pKeyEl);const s=getSelection();s.removeAllRanges();s.addRange(r);}});
pKeyEl.addEventListener('blur',()=>{keyReal=pKeyV.get();paintKey();});
$('#keyEye').addEventListener('click',()=>{showKey=!showKey;const b=$('#keyEye');
  b.textContent=showKey?'🙈':'👁';b.setAttribute('aria-pressed',String(showKey));paintKey();});
function setKey(v){keyReal=String(v??'');pKeyV.set(keyReal);paintKey();}

function normProv(p){return {id:String(p.id||''),name:String(p.name||''),kind:p.kind,apiKey:String(p.apiKey||''),
  baseUrl:String(p.baseUrl||''),models:(p.models||[]).slice()};}
function readForm(){return normProv({id:pIdV.get().trim(),name:pNameV.get().trim(),kind:editing.kind,
  apiKey:keyReal,baseUrl:pBaseUrlV.get().trim(),models:editing.models});}
function hasChanges(){
  if(llmIsNew)return true;
  const sel=llmProviders.find(x=>x.id===llmSelected);
  return sel!=null&&JSON.stringify(normProv(sel))!==JSON.stringify(readForm());
}
function renderBar(){
  $('#llmStat').textContent=llmIsNew?'新建提供商':(llmSelected==null?'':(hasChanges()?'有未保存的更改':'已是最新'));
  $('#pDelete').style.display=llmIsNew?'none':'';
  const save=$('#pSave');
  save.disabled=llmSaving||(!llmIsNew&&!hasChanges());
  save.textContent=llmSaving?'保存中…':'保存配置';
}

function paintKind(k){
  document.querySelectorAll('#kindSeg .seg-btn').forEach(b=>{
    const on=b.dataset.k===k;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));});
  $('#baseUrlWrap').style.display=k==='openai_compat'?'':'none';
}
function setKind(k){
  if(editing.kind==='openai_compat'&&k!=='openai_compat')pBaseUrlV.set(''); // 切换离开兼容协议时清空 Base URL
  editing.kind=k;paintKind(k);renderModels();renderBar();
}
$('#kindSeg').addEventListener('click',e=>{const b=e.target.closest('.seg-btn');if(b)setKind(b.dataset.k);});

function renderProviders(){
  const list=$('#providerList');
  if(!llmProviders.length){list.innerHTML='<div class="pempty">暂无提供商<br>点击「+ 添加」创建</div>';}
  else list.innerHTML=llmProviders.map(p=>{
    const n=(p.models||[]).length,nm=p.name||p.id;
    return '<div class="pitem'+(llmView==='provider'&&p.id===llmSelected?' sel':'')+'" data-id="'+esc(p.id)+'" tabindex="0" role="button" aria-label="编辑 '+esc(nm)+'">'+
      '<span class="pdot'+(n?' on':'')+'"></span>'+
      '<span class="pinfo"><span class="pname">'+esc(nm)+'</span><span class="pmeta">'+esc(KINDN[p.kind]||p.kind)+' · '+n+' 模型</span></span>'+
      '<button class="pdel" type="button" aria-label="删除 '+esc(nm)+'" title="删除">✕</button></div>';
  }).join('');
  $('#assignNav').classList.toggle('sel',llmView==='assign');
  const assigned=['idea','image','video'].filter(k=>savedAssignments[k]).length;
  const badge=$('#asgBadge');
  badge.style.display=assigned?'':'none';
  badge.textContent=String(assigned);
}
$('#providerList').addEventListener('click',e=>{
  const item=e.target.closest('.pitem');if(!item)return;
  if(e.target.closest('.pdel')){e.stopPropagation();delProvider(item.dataset.id);return;}
  selectProvider(item.dataset.id);
});
$('#providerList').addEventListener('keydown',e=>{
  const item=e.target.closest('.pitem');
  if(item&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectProvider(item.dataset.id);}
});

function showPane(view){
  llmView=view;
  $('#llmEmpty').style.display=view==='empty'?'':'none';
  $('#llmForm').style.display=view==='provider'?'':'none';
  $('#llmBar').style.display=view==='provider'?'':'none';
  $('#assignForm').style.display=view==='assign'?'':'none';
  $('#assignBar').style.display=view==='assign'?'':'none';
}
function showLlmEmpty(){
  llmSelected=null;llmIsNew=false;
  showPane('empty');
  renderProviders();renderBar();
}
function showAssignView(){
  llmSelected=null;llmIsNew=false;
  showPane('assign');
  renderProviders();loadAssignments();
}
function selectProvider(id){
  const p=llmProviders.find(x=>x.id===id);if(!p)return;
  const n=normProv(p);
  llmSelected=id;llmIsNew=false;showKey=false;
  $('#keyEye').textContent='👁';$('#keyEye').setAttribute('aria-pressed','false');
  editing={kind:n.kind,models:n.models.slice()};
  pIdV.set(n.id);pNameV.set(n.name);setKey(n.apiKey);pBaseUrlV.set(n.baseUrl);
  $('#pId').removeAttribute('contenteditable');$('#pId').classList.add('ro');
  $('#pIdHint').textContent='ID 创建后不可修改';
  paintKind(n.kind);
  showPane('provider');
  renderProviders();renderModels();renderBar();
}
function startNew(){
  llmSelected=null;llmIsNew=true;showKey=false;
  $('#keyEye').textContent='👁';$('#keyEye').setAttribute('aria-pressed','false');
  editing={kind:'openai',models:[]};
  pIdV.set('');pNameV.set('');setKey('');pBaseUrlV.set('');
  $('#pId').setAttribute('contenteditable','true');$('#pId').classList.remove('ro');
  $('#pIdHint').textContent='创建后不可修改 · 仅限字母/数字/连字符/下划线';
  paintKind('openai');
  showPane('provider');
  renderProviders();renderModels();renderBar();
  $('#pId').focus();
}

function renderModels(){
  const grid=$('#modelGrid'),empty=$('#modelEmpty');
  if(!editing.models.length){
    grid.style.display='none';grid.innerHTML='';empty.style.display='';
    empty.textContent=(editing.kind==='openai_compat'&&!pBaseUrlV.get().trim())?'请先填写 Base URL 和 API Key'
      :(!keyReal.trim()||isMaskedKey(keyReal))?'请先填写有效的 API Key'
      :'点击「获取模型列表」从提供商拉取，或在下方手动输入模型 ID';
    return;
  }
  empty.style.display='none';grid.style.display='';
  grid.innerHTML=editing.models.map((m,i)=>
    '<span class="mcard" role="checkbox" aria-checked="true" tabindex="0" data-i="'+i+'" title="取消勾选并移除 '+esc(m)+'">'+
    '<span class="mk">✓</span><span class="mname">'+esc(m)+'</span></span>').join('');
}
function toggleModelAt(i){
  const m=editing.models[i];if(m===undefined)return;
  editing.models.splice(i,1); // 取消勾选即从列表移除
  renderModels();renderBar();
}
$('#modelGrid').addEventListener('click',e=>{const c=e.target.closest('.mcard');if(c)toggleModelAt(+c.dataset.i);});
$('#modelGrid').addEventListener('keydown',e=>{const c=e.target.closest('.mcard');
  if(c&&(e.key===' '||e.key==='Enter')){e.preventDefault();toggleModelAt(+c.dataset.i);}});
$('#modelNew').addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;e.preventDefault();
  const v=modelNewV.get();if(!v)return;
  if(editing.models.includes(v)){toast('模型已存在：'+v);modelNewV.set('');return;}
  editing.models.push(v);modelNewV.set('');renderModels();renderBar();
});

function renderFetchBtn(){$('#fetchModels').disabled=llmFetching;
  $('#fetchModels').innerHTML=llmFetching?'<span class="spin">◌</span> 获取中…':'获取模型列表';}
$('#fetchModels').addEventListener('click',async()=>{
  if(llmFetching)return;
  const kind=editing.kind,baseUrl=pBaseUrlV.get().trim(),key=keyReal.trim();
  if(kind==='openai_compat'&&!baseUrl){toast('请先填写 Base URL',false);return;}
  if(!key||isMaskedKey(key)){toast('请先填写有效的 API Key',false);return;}
  llmFetching=true;renderFetchBtn();
  try{
    const r=await fetch('/api/llm/fetch-models',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({kind,apiKey:key,baseUrl:baseUrl||undefined})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){toast(data.error||('获取失败（HTTP '+r.status+'）'),false);return;}
    const fresh=(data.models||[]).filter(m=>!editing.models.includes(m));
    editing.models=editing.models.concat(fresh); // 合并：保留手动添加项，去重新增
    renderModels();renderBar();
    toast(fresh.length?('已获取 '+fresh.length+' 个新模型'):'没有发现新模型，已保留现有列表');
  }catch(e){toast('获取模型列表失败：网络错误',false);}
  finally{llmFetching=false;renderFetchBtn();}
});

/* ===== 模型分配：为 点子/图像/视频 任务指定「提供商 · 模型」（自绘下拉） ===== */
function asgOptions(){
  const os=[{v:'',p:'自动',m:'第一个可用提供商的第一个模型',none:true}];
  for(const p of llmProviders){
    const pn=p.name||p.id;
    for(const m of (p.models||[]))os.push({v:p.id+'|'+m,p:pn,m});
  }
  return os;
}
function asgVal(a){return a?(a.providerId+'|'+a.model):'';}
function asgFromVal(v){if(!v)return null;const i=v.indexOf('|');if(i<1)return null;return {providerId:v.slice(0,i),model:v.slice(i+1)};}
const asgSelects={
  idea:makeSelect($('#asgIdea'),{options:asgOptions,onChange:renderAssignBar}),
  image:makeSelect($('#asgImage'),{options:asgOptions,onChange:renderAssignBar}),
  video:makeSelect($('#asgVideo'),{options:asgOptions,onChange:renderAssignBar}),
};
function currentAssignments(){
  return {idea:asgFromVal(asgSelects.idea.get()),image:asgFromVal(asgSelects.image.get()),video:asgFromVal(asgSelects.video.get())};
}
function hasAssignChanges(){
  const cur=currentAssignments();
  return ['idea','image','video'].some(k=>JSON.stringify(cur[k]||null)!==JSON.stringify(savedAssignments[k]||null));
}
function renderAssignBar(){
  const custom=['idea','image','video'].some(k=>savedAssignments[k]);
  $('#assignStat').textContent=hasAssignChanges()?'有未保存的更改':(custom?'自定义分配':'自动分配');
  const btn=$('#asgSave');
  btn.disabled=asgSaving||!hasAssignChanges();
  btn.textContent=asgSaving?'保存中…':'保存分配';
}
async function loadAssignments(){
  try{savedAssignments=await (await fetch('/api/llm/assignments')).json();}
  catch(e){savedAssignments={idea:null,image:null,video:null};toast('加载模型分配失败',false);}
  for(const k of ['idea','image','video']){asgSelects[k].refresh();asgSelects[k].set(asgVal(savedAssignments[k]));}
  renderProviders();renderAssignBar();
}
$('#asgSave').addEventListener('click',async()=>{
  if(asgSaving)return;
  asgSaving=true;renderAssignBar();
  try{
    const r=await fetch('/api/llm/assignments',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify(currentAssignments())});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){toast(data.error||('保存失败（HTTP '+r.status+'）'),false);return;}
    savedAssignments=data;
    for(const k of ['idea','image','video'])asgSelects[k].set(asgVal(savedAssignments[k]));
    renderProviders();renderAssignBar();loadHealth();
    toast('已保存模型分配');
  }catch(e){toast('保存失败：网络错误',false);}
  finally{asgSaving=false;renderAssignBar();}
});
$('#asgReset').addEventListener('click',()=>{
  for(const k of ['idea','image','video'])asgSelects[k].set('');
  renderAssignBar();
});
$('#assignNav').addEventListener('click',showAssignView);
$('#assignNav').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showAssignView();}});

$('#pSave').addEventListener('click',async()=>{
  if(llmSaving)return;
  const id=pIdV.get().trim(),name=pNameV.get().trim(),baseUrl=pBaseUrlV.get().trim();
  if(!id){toast('请填写提供商 ID',false);$('#pId').focus();return;}
  if(!ID_RE.test(id)){toast('ID 仅限字母/数字/连字符/下划线，且以字母或数字开头',false);return;}
  if(!name){toast('请填写提供商名称',false);$('#pName').focus();return;}
  if(editing.kind==='openai_compat'&&!baseUrl){toast('OpenAI 兼容类型必须填写 Base URL',false);return;}
  if(llmProviders.some(p=>p.id===id)&&!confirm('ID「'+id+'」已存在，确认覆盖该提供商？'))return;
  llmSaving=true;renderBar();
  try{
    const r=await fetch('/api/llm/providers',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify({id,name,kind:editing.kind,apiKey:keyReal,baseUrl:baseUrl||undefined,models:editing.models.slice()})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){toast(data.error||('保存失败（HTTP '+r.status+'）'),false);return;}
    await reloadProviders();
    llmIsNew=false;selectProvider(id);
    toast('已保存「'+name+'」');
  }catch(e){toast('保存失败：网络错误',false);}
  finally{llmSaving=false;renderBar();}
});
async function delProvider(id){
  const p=llmProviders.find(x=>x.id===id);if(!p)return;
  if(!confirm('确认删除提供商「'+(p.name||p.id)+'」？此操作不可恢复。'))return;
  try{
    const r=await fetch('/api/llm/providers/'+encodeURIComponent(id),{method:'DELETE'});
    if(!r.ok){const d=await r.json().catch(()=>({}));toast(d.error||('删除失败（HTTP '+r.status+'）'),false);return;}
    if(llmSelected===id)showLlmEmpty();
    await reloadProviders();
    toast('已删除「'+(p.name||p.id)+'」');
  }catch(e){toast('删除失败：网络错误',false);}
}
$('#pDelete').addEventListener('click',()=>{if(llmSelected)delProvider(llmSelected);});

async function reloadProviders(){
  try{llmProviders=await (await fetch('/api/llm/providers')).json();}
  catch(e){llmProviders=[];toast('加载提供商列表失败',false);}
  renderProviders();loadHealth();
  if(llmView==='assign')loadAssignments(); // 分配视图打开时同步可选项与已保存的分配
}
function openLlm(){llmOverlay.classList.add('show');showLlmEmpty();reloadProviders();}
function closeLlm(){llmOverlay.classList.remove('show');}
$('#openLlm').onclick=openLlm;
$('#llmBack').onclick=closeLlm;
$('#llmClose').onclick=closeLlm;
llmOverlay.addEventListener('click',e=>{if(e.target===llmOverlay)closeLlm();});
$('#llmAdd').onclick=startNew;
$('#llmEmptyAdd').onclick=startNew;
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape'&&llmOverlay.classList.contains('show')){
    if(SELECTS.some(s=>s.isOpen()))return; // 下拉展开时 Esc 只关下拉（由各自监听处理）
    closeLlm();
  }
});

loadHealth();loadList();
setInterval(()=>{loadHealth();loadList();},3000);
</script>
</body></html>`;
}