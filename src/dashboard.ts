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

/* 组合框（主题下拉+可输入，替代 native input+datalist） */
.combobox{position:relative}
.cb-field{display:flex;align-items:center;gap:4px;background:#0d0d0d;border:1px solid var(--bd-2);border-radius:8px;transition:border-color .15s,box-shadow .15s}
.cb-field:focus-within,.combobox.open .cb-field{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.cb-text{flex:1;min-width:0;background:transparent;border:0;outline:none;color:var(--fg);font:inherit;font-size:13px;padding:7px 10px}
.cb-caret{width:26px;align-self:stretch;background:transparent;color:var(--faint);font-size:12px;padding:0;border-radius:0 8px 8px 0}
.cb-caret:hover{color:var(--acc)}
.combobox.open .cb-caret{color:var(--acc)}
.cb-menu{position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:60;background:var(--card);border:1px solid var(--bd-2);border-radius:10px;overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,.65)}
.cb-filter{width:100%;padding:8px 10px;background:#0d0d0d;border:0;border-bottom:1px solid var(--bd);color:var(--fg);font:inherit;font-size:12.5px;outline:none}
.cb-list{max-height:210px;overflow-y:auto;padding:4px}
.cb-opt{padding:7px 10px;border-radius:7px;font-size:13px;color:var(--muted);cursor:pointer}
.cb-opt:hover{background:var(--card2);color:#fff}
.cb-opt.on{color:var(--acc);background:rgba(139,92,246,.12)}
.cb-opt.dim{opacity:.4;pointer-events:none}
.cb-hint{font-size:10.5px;color:#52525b;margin-top:5px}

/* 自绘文本组件（contenteditable，替代原生 input） */
[contenteditable]{outline:none;cursor:text}
[contenteditable]:empty::before{content:attr(data-placeholder);color:#52525b;pointer-events:none}
.txtbox{display:block;width:100%;background:#0d0d0d;border:1px solid var(--bd-2);border-radius:8px;padding:7px 10px;min-height:32px;font-size:13px;white-space:pre-wrap;word-break:break-all}
.txtbox:focus-within{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 2px rgba(139,92,246,.18)}
.cb-filter,.cb-text,.step-val{white-space:pre-wrap;word-break:break-all}

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

@media(max-width:760px){.wall{columns:1}.top{flex-wrap:wrap;height:auto;padding:10px 16px}}
</style>
</head>
<body>

<header class="top">
  <div class="brand"><span class="dot"></span>Inspira</div>
  <span class="link">创意灵感生成 · 只产提示词</span>
  <div class="spacer"></div>
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
        <label class="f">主题</label>
        <div class="combobox" id="themeBox">
          <div class="cb-field">
            <div class="cb-text" contenteditable="true" role="textbox" aria-label="主题"></div>
            <button class="cb-caret" type="button" aria-label="选择主题">▾</button>
          </div>
          <div class="cb-menu" hidden>
            <div class="cb-filter" contenteditable="true" role="textbox" data-placeholder="过滤或输入自定义主题…" aria-label="过滤主题"></div>
            <div class="cb-list">
              <div class="cb-opt" data-v="general">综合</div>
              <div class="cb-opt" data-v="nature">自然</div>
              <div class="cb-opt" data-v="technology">科技</div>
              <div class="cb-opt" data-v="fashion">时尚</div>
              <div class="cb-opt" data-v="surreal">超现实</div>
              <div class="cb-opt" data-v="city">都市</div>
            </div>
          </div>
        </div>
        <div class="cb-hint">预设主题可直接点选，也支持输入自定义主题</div>
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

/* ===== 自定义组件：组合框（主题） ===== */
function makeCombobox(box){
  const field=box.querySelector('.cb-field'),
        caret=box.querySelector('.cb-caret'),menu=box.querySelector('.cb-menu'),
        opts=[...box.querySelectorAll('.cb-opt')];
  const textV=makeTextField(box.querySelector('.cb-text'),{initial:'general'});
  const text=textV.el;
  const filterV=makeTextField(box.querySelector('.cb-filter'),{placeholder:'过滤或输入自定义主题…'});
  const filter=filterV.el;
  let open=false,focused=0;
  const mark=()=>opts.forEach(o=>o.classList.toggle('on',o.dataset.v===textV.get()));
  const render=()=>{const q=filterV.get().toLowerCase();
    opts.forEach(o=>o.classList.toggle('dim',q&&!o.dataset.v.includes(q)&&!o.textContent.toLowerCase().includes(q)));};
  const toggle=v=>{open=v??!open;menu.hidden=!open;box.classList.toggle('open',open);
    if(open){filterV.set('');render();mark();filter.focus();}};
  caret.addEventListener('click',()=>toggle());
  text.addEventListener('focus',()=>{if(!open)toggle(true);});
  text.addEventListener('keydown',e=>{
    if(e.key==='Enter'){toggle(false);}
    if(e.key==='Escape'){toggle(false);}});
  filter.addEventListener('input',()=>{render();focused=0;});
  filter.addEventListener('keydown',e=>{
    const visible=opts.filter(o=>!o.classList.contains('dim'));
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();
      focused=Math.max(0,Math.min(visible.length-1,focused+(e.key==='ArrowDown'?1:-1)));}
    if(e.key==='Enter'){e.preventDefault();
      const pick=visible[focused]||visible[0];
      if(pick)textV.set(pick.dataset.v);
      toggle(false);}
    if(e.key==='Escape'){toggle(false);}});
  opts.forEach(o=>o.addEventListener('click',()=>{textV.set(o.dataset.v);toggle(false);}));
  document.addEventListener('mousedown',e=>{if(open&&!box.contains(e.target))toggle(false);});
  mark();
  return {get:()=>textV.get()||'general',set:v=>{textV.set(v);mark();}};
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

/* 设置 modal */
function openModal(){loadSettings();loadSourceConfig();overlay.classList.add('show');}
function closeModal(){overlay.classList.remove('show');}
$('#openSettings').onclick=openModal;
$('#closeModal').onclick=closeModal;
$('#cancelModal').onclick=closeModal;
overlay.onclick=(e)=>{if(e.target===overlay)closeModal();};
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&overlay.classList.contains('show'))closeModal();});

const themeBox=makeCombobox($('#themeBox'));
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
      '<div class="tags"><span class="tag acc">'+esc(i.theme)+'</span>'+(isVid?'<span class="tag">T2VA · 16:9</span>':'<span class="tag">文生图</span>')+'<span class="tag">ready 提示词</span></div>'+
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
  themeBox.set(s.theme);intervalStepper.set(s.intervalMinutes);enabledSw.set(s.enabled);
  kinds=s.kinds.slice();sources=s.sources.slice();renderChips();}
async function loadHealth(){try{const h=await (await fetch('/api/health')).json();
  const llm=h.llmConfigured?'LLM 已配置':'LLM 未配置（设置 LLM_API_KEY 后可用）';
  const s=h.scheduler;
  const src=(h.scrape&&h.scrape.providers&&h.scrape.providers.length)?h.scrape.providers.join('·'):'无';
  health.innerHTML='<b>'+llm+'</b> · 自动生成：'+(s.enabled?'开':'关')+' · 间隔 '+s.intervalMinutes+' 分钟 · 采集源：<b>'+src+'</b> · 下次：'+(s.nextRunAt?new Date(s.nextRunAt).toLocaleTimeString():'—');}catch(e){}}
async function loadList(){try{items=await (await fetch('/api/inspirations?limit=60')).json();render();}catch(e){}}

$('#save').onclick=async()=>{const body=JSON.stringify({intervalMinutes:intervalStepper.get(),enabled:enabledSw.get(),theme:themeBox.get(),kinds,sources});
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

loadHealth();loadList();
setInterval(()=>{loadHealth();loadList();},3000);
</script>
</body></html>`;
}