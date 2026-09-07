/**
 * 前后台共享的 UI 层：设计体系 CSS（纯黑 + 紫罗兰，全部控件自绘，无原生控件外观）
 * 与少量通用客户端工具函数（esc/fmt/ago，以字符串形式内联到页面 <script>，保证单一来源）。
 * 组件工厂（makeTextField/makeStepper/makeSwitch/makeSelect 等）仅后台用到，留在 admin.ts。
 */
export const uiCss = `
:root{
  --bg:#0a0a0a;--card:#131313;--card2:#171717;--bd:#242424;--bd-2:#333;
  --fg:#ededed;--muted:#a1a1aa;--faint:#71717a;--acc:#a78bfa;--acc-deep:#8b5cf6;
  --ok:#4ade80;--bad:#f87171;--run:#7dd3fc;--warn:#fbbf24;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--acc);text-decoration:none}
button{border:0;border-radius:9px;cursor:pointer;font-weight:600;transition:.15s;font-family:inherit;color:inherit}
button:disabled{opacity:.45;cursor:not-allowed}
h2,h3{margin:0}

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
.btn.danger{background:rgba(248,113,113,.14);border:1px solid rgba(248,113,113,.45);color:#fca5a5}

.status{padding:10px 22px 0;font-size:12px;color:var(--faint)}
.status b{color:#d4d4d8;font-weight:600}
.filters{display:flex;align-items:center;gap:8px;padding:14px 22px 10px;flex-wrap:wrap}
.chip{padding:5px 12px;background:var(--card);border:1px solid var(--bd-2);border-radius:999px;font-size:12px;color:var(--muted);cursor:pointer;transition:.15s;font-weight:500}
.chip:hover{border-color:#52525b;color:#fff}
.chip.on{background:var(--acc-deep);border-color:var(--acc-deep);color:#fff}
.count{margin-left:auto;font-size:12px;color:var(--faint)}

.mono{font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#b9c3e0;background:#0d0d13;border:1px solid #1c1c24;border-radius:8px;padding:8px 10px;white-space:pre-wrap;word-break:break-word}
.mono.open{-webkit-line-clamp:unset}
.err{color:var(--bad);font-size:11.5px;margin-bottom:6px}
.desc{font-size:11.5px;color:var(--faint)}
.tags{display:flex;flex-wrap:wrap;gap:5px}
.tag{font-size:10px;font-weight:500;padding:2px 8px;border-radius:6px;border:1px solid var(--bd-2);color:var(--muted)}
.tag.acc{color:var(--acc);border-color:rgba(167,139,250,.35)}
.empty{padding:60px 22px;text-align:center;color:var(--faint)}
.empty small{font-size:11.5px;color:#52525b}

/* <Picture N> 参考画面 + 悬停浮层 */
.mono .pcref{color:var(--acc);text-decoration:underline dotted rgba(167,139,250,.6);text-underline-offset:3px;cursor:help;font-weight:600}
.mono .pcref:hover,.mono .pcref:focus{background:rgba(139,92,246,.16);border-radius:3px;outline:none}
.ptip{position:fixed;z-index:90;max-width:min(380px,calc(100vw - 24px));background:#0d0d13;border:1px solid var(--bd-2);border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.75);padding:10px 12px;font:12px/1.6 ui-sans-serif,system-ui,sans-serif;color:#d4d4d8;pointer-events:none;display:none}
.ptip b{color:var(--acc);font-size:11px;letter-spacing:.5px;display:block;margin-bottom:2px}
.ptip .ptd{color:var(--muted)}
.ptip .ptp{margin-top:6px;padding-top:6px;border-top:1px solid var(--bd);color:#b9c3e0;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto}
.ptip .ptp.dim{color:#71717a}

/* ===== 表单 / 输入类（全部自绘，无原生控件外观） ===== */
[contenteditable]{outline:none;cursor:text}
[contenteditable]:empty::before{content:attr(data-placeholder);color:#52525b;pointer-events:none}
.txtbox{display:block;width:100%;background:#0d0d0d;border:1px solid var(--bd-2);border-radius:8px;padding:7px 10px;min-height:32px;font-size:13px;white-space:pre-wrap;word-break:break-all}
.txtbox:focus-within{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.txtbox.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.txtbox.ro{color:var(--faint);background:#101010;cursor:default}
.txtbox.keyed{-webkit-text-security:disc}
.cb-hint{font-size:10.5px;color:#52525b;margin-top:5px}
.tnew{margin-top:8px;min-height:30px;padding:5px 10px;font-size:12.5px}
/* 多行文本编辑（override 提示词等） */
.txtarea{display:block;width:100%;background:#0d0d13;border:1px solid var(--bd-2);border-radius:8px;padding:9px 11px;min-height:150px;max-height:42vh;overflow-y:auto;font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#b9c3e0;white-space:pre-wrap;word-break:break-word}
.txtarea:focus-within{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.modal .txtarea{max-height:40vh}

/* 主题库标签编辑器 */
.themes{display:flex;flex-wrap:wrap;gap:6px;min-height:32px;align-items:center}
.tchip{display:inline-flex;align-items:center;gap:6px;background:var(--card2);border:1px solid var(--bd-2);border-radius:999px;padding:3px 6px 3px 8px;font-size:12.5px;color:var(--fg);transition:border-color .15s,background .15s}
.tchip.on{border-color:rgba(167,139,250,.55);background:rgba(139,92,246,.12)}
.tdot{width:14px;height:14px;line-height:12px;text-align:center;font-size:10px;color:#52525b;cursor:pointer;border-radius:50%;flex:none;user-select:none}
.tchip.on .tdot{color:var(--acc)}
.tdot:hover{color:var(--acc)}
.tchip .tname{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;border-radius:4px}
.tchip .tname:hover{color:var(--acc)}
.tchip .tname[contenteditable="true"]{outline:none;cursor:text;max-width:240px;white-space:pre-wrap;word-break:break-all;border-bottom:1px dashed var(--acc);color:var(--fg)}
.tchip .tovr{background:transparent;border:0;color:var(--faint);font-size:11px;padding:1px 3px;cursor:pointer;flex:none;border-radius:6px;line-height:1.2}
.tchip .tovr:hover{color:var(--acc);background:rgba(139,92,246,.16)}
.tchip .tovr.on{color:var(--acc);text-shadow:0 0 6px rgba(139,92,246,.6)}
.tchip .tdel{background:transparent;border:0;color:var(--faint);font-size:11px;padding:0 4px;cursor:pointer;flex:none;border-radius:50%}
.tchip .tdel:hover:not(:disabled){color:#f87171;background:rgba(248,113,113,.12)}
.tchip .tdel:disabled{color:#52525b;cursor:not-allowed}
/* override 编辑弹窗辅助 */
.ovr-place{font-size:11px;line-height:1.9;color:var(--muted);background:#0d0d0d;border:1px solid var(--bd);border-radius:9px;padding:8px 12px;margin:0 0 12px}
.ovr-place code{font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--acc);background:rgba(139,92,246,.08);border-radius:4px;padding:0 4px}
.ovr-place .k{color:var(--faint)}

/* 采集源健康状态 */
.src-health{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--faint)}
.src-health .hrow{display:flex;align-items:center;gap:7px;min-width:0;line-height:1.6}
.src-health .hdot{width:6px;height:6px;border-radius:50%;flex:none;background:#3f3f46}
.src-health .hdot.ok{background:var(--ok)}
.src-health .hdot.bad{background:var(--bad);box-shadow:0 0 6px rgba(248,113,113,.6)}
.src-health .hname{color:#c9c9ce;font-weight:500;flex:none}
.src-health .hstat{flex:none}
.src-health .herr{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b0666e}

/* 步进调节框 */
.stepper{display:flex;align-items:center;background:#0d0d0d;border:1px solid var(--bd-2);border-radius:8px;overflow:hidden}
.stepper:focus-within{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.step{width:34px;align-self:stretch;background:transparent;color:var(--muted);font-size:16px;padding:0}
.step:hover{background:var(--card2);color:var(--acc)}
.step-val{flex:1;min-width:0;background:transparent;border:0;outline:none;color:var(--fg);font:inherit;font-size:13px;text-align:center;padding:7px 0;white-space:pre-wrap;word-break:break-all}

/* 开关 */
.sw{display:flex;align-items:center;gap:9px;cursor:pointer;user-select:none;margin:0 0 14px;color:#c9c9ce;font-size:13px}
.sw .track{position:relative;width:38px;height:21px;border-radius:999px;background:#26262b;border:1px solid var(--bd-2);transition:background .18s,border-color .18s;flex-shrink:0}
.sw .knob{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#9a9aa3;transition:transform .18s,background .18s}
.sw.on .track{background:var(--acc-deep);border-color:var(--acc-deep)}
.sw.on .knob{transform:translateX(17px);background:#fff}

/* modal 弹窗（+ 后台页内嵌区块 .box 共用一套表单排布） */
.overlay{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;padding:20px}
.overlay.show{display:flex}
.modal{width:100%;max-width:460px;background:var(--card);border:1px solid var(--bd-2);border-radius:14px;padding:20px 22px;box-shadow:0 30px 80px rgba(0,0,0,.7);animation:pop .16s ease}
.modal.wide{max-width:640px}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.modal .mhead,.box .mhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px}
.modal .mhead h2,.box .mhead h2{font-size:15px;font-weight:700}
.modal .x,.box .x{background:transparent;color:var(--faint);font-size:18px;line-height:1;padding:4px 8px;border-radius:8px}
.modal .x:hover,.box .x:hover{color:#fff;background:var(--card2)}
.modal .row,.box .row{display:flex;gap:14px;flex-wrap:wrap}
.modal label.f,.box label.f{display:block;font-size:11.5px;color:var(--faint);margin-bottom:4px}
.modal .field,.box .field{flex:1;min-width:150px;margin-bottom:12px}
.modal .chips,.box .chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px}
.modal .sep,.box .sep{margin:4px 0 12px;padding-top:12px;border-top:1px solid var(--bd);font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);font-weight:600}
.modal .mfoot,.box .mfoot{display:flex;gap:8px;justify-content:flex-end;margin-top:4px;align-items:center}
.modal .mfoot .grow,.box .mfoot .grow{flex:1}
.mhead .lsub{font-size:11px;color:var(--faint);font-weight:400;margin-left:auto;margin-right:8px}

/* LLM 配置面板（master-detail） */
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
.lside-foot{border-top:1px solid var(--bd);padding:6px 8px;flex:none}
.seg{display:flex;gap:6px;flex-wrap:wrap}
.seg-btn{background:#0d0d0d;border:1px solid var(--bd-2);color:var(--muted);padding:6px 12px;font-size:12.5px;border-radius:8px;font-weight:500}
.seg-btn:hover{border-color:#52525b;color:#fff}
.seg-btn.on{background:var(--acc-deep);border-color:var(--acc-deep);color:#fff;box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.secret{position:relative}
.secret .txtbox{padding-right:36px}
.seye{position:absolute;right:5px;top:50%;transform:translateY(-50%);background:transparent;color:var(--faint);font-size:13px;padding:3px 5px;border-radius:6px;line-height:1}
.seye:hover{color:var(--acc);background:var(--card2)}
.mgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-height:300px;overflow-y:auto;align-content:start;padding-right:2px}
.modal .mgrid{max-height:360px}
.mcard{display:flex;align-items:center;gap:7px;background:#0d0d0d;border:1px solid rgba(167,139,250,.45);border-radius:8px;padding:6px 9px;cursor:pointer;user-select:none;min-width:0;transition:.15s}
.mcard:hover{border-color:var(--acc);background:rgba(139,92,246,.12)}
.mcard .mk{width:14px;height:14px;flex:none;border-radius:4px;background:var(--acc-deep);color:#fff;font-size:9.5px;display:flex;align-items:center;justify-content:center;line-height:1}
.mcard .mname{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d4d4d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mempty{border:1px dashed var(--bd-2);border-radius:10px;padding:18px 14px;text-align:center;color:var(--faint);font-size:12px;line-height:1.7}
.mtool{display:flex;align-items:center;gap:8px;margin:2px 0 10px}
.tsearch{flex:1;min-width:0;min-height:30px;padding:4px 10px;font-size:12.5px}
.mcount{font-size:11.5px;color:var(--faint);font-weight:500}
.mcard.off{border-color:var(--bd-2);background:transparent}
.mcard.off:hover{border-color:#52525b;background:var(--card2)}
.mcard.off .mk{background:transparent;border:1px solid var(--bd-2);color:transparent;box-shadow:none}
.mcard.off .mname{color:var(--faint)}
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
.nav-badge{background:var(--acc-deep);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;flex:none}
.spin{display:inline-block;animation:rot .9s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(10px);background:#0d0d13;border:1px solid rgba(167,139,250,.45);color:#d4d4d8;padding:8px 16px;border-radius:10px;font-size:12.5px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:99;box-shadow:0 12px 32px rgba(0,0,0,.6);max-width:min(80vw,480px)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast.bad{border-color:rgba(248,113,113,.55)}

/* 表格（后台灵感 / 用户管理共用） */
.tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.tbl th{font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);text-align:left;padding:6px 10px;border-bottom:1px solid var(--bd-2);font-weight:600;white-space:nowrap}
.tbl td{padding:7px 10px;border-bottom:1px solid var(--bd);vertical-align:top}
.tbl tr:hover td{background:rgba(255,255,255,.02)}
.tbl .num{color:var(--faint);font-size:11px}
.st-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#c9c9ce;white-space:nowrap}
.st-dot i{width:6px;height:6px;border-radius:50%;background:var(--ok)}
.st-dot.failed i{background:var(--bad)}
.st-dot.queued i,.st-dot.running i{background:var(--run)}
.st-dot.queued i{animation:blink 1.2s infinite}
@keyframes blink{50%{opacity:.25}}

@media(max-width:900px){.lside{width:180px}.mgrid{grid-template-columns:1fr 1fr}}
`;

/** 客户端通用工具（内联到页面 <script>，画廊与后台共用，单一来源防 XSS 逃逸不一致） */
export const utilClientJs = `
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(t){if(!t)return'—';const d=new Date(t);return d.toLocaleDateString(undefined,{month:'2-digit',day:'2-digit'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function ago(t){if(!t)return'—';const s=Math.floor((Date.now()-new Date(t).getTime())/1000);
  if(s<60)return'刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';if(s<86400)return Math.floor(s/3600)+' 小时前';return Math.floor(s/86400)+' 天前';}
`;
