/**
 * 公开画廊页（只读）：等宽瀑布流提示词画廊。
 * 布局：JS 均衡瀑布流（列宽一致、按最短列填充，铺满整行不留空）；封面图按原始比例缩放。
 * 预览：图像封面点击进入灯箱（←/→ 切换、Esc 关闭）。
 * 性能（双层懒加载）：
 *  - 数据层：服务端分页窗口（每页 PAGE 条、窗口上限 MAX_WIN 条），滚动到底扩展 / 回到顶部回缩，
 *    5s 轮询只取当前窗口，位移用「锚点槽位」补偿保持视觉位置；
 *  - DOM 层：视窗虚拟化 —— 槽位进入视窗 700px 内才挂载真实卡片、离开 1600px 外卸载为等高占位，
 *    挂载/卸载的高度测量合并进 rAF 批处理（避免读写交替反复强制重排），
 *    高度漂移触发的重新分列去抖到滚动停歇后执行，且只移动换列的槽位。
 * 管理功能（设置 / LLM 配置 / 生成 / 清理）全部在 /admin（需登录）。
 */
import { uiCss, utilClientJs } from './ui.js';

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inspira · 灵感画廊</title>
<style>
${uiCss}
/* 画廊专有：等宽瀑布流（JS 均衡分列）与封面占位 */
a.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.wall{display:flex;gap:14px;align-items:flex-start;padding:4px 22px 40px;min-height:50vh;overflow-anchor:none}
.col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:14px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .18s,transform .18s,box-shadow .18s}
.card:hover{border-color:#3d3d3d;transform:translateY(-1px);box-shadow:0 8px 24px rgba(0,0,0,.5)}
.card.failed{border-color:#4a1d24}
/* 视窗虚拟化：槽位 = 真实卡片 或 等高占位（不画边框，只撑高度） */
.slot{min-height:1px}
.ph-card{border-radius:12px;background:rgba(255,255,255,.025)}
.cover{position:relative;overflow:hidden}
.cover.image:not(.hasimg){aspect-ratio:4/3;background:radial-gradient(120% 100% at 20% 0%,#1b1b2e 0%,#141422 45%,#101018 100%)}
.cover.video{aspect-ratio:16/9;background:radial-gradient(120% 100% at 85% 10%,#2a1430 0%,#1a1426 48%,#0f0f16 100%)}
.imgwrap{position:relative;width:100%;aspect-ratio:var(--ar,4/3);background:radial-gradient(120% 100% at 20% 0%,#1b1b2e 0%,#141422 45%,#101018 100%);overflow:hidden}
.cover .cimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.cover.zoom{cursor:zoom-in}
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
.body h3{margin:0 0 4px;font-size:13.5px;font-weight:600;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1}
.body .desc{margin-bottom:8px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.body .mono{margin-bottom:8px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4}
.body .mono.open{-webkit-line-clamp:unset}
.body .tags{margin-top:auto}
.card.failed .mono{display:none}
.foot{display:flex;align-items:center;gap:6px;padding:10px 14px 12px;border-top:1px solid var(--bd);margin-top:2px}
.foot .t{font-size:11px;color:var(--faint);margin-right:auto}
/* 灯箱预览 */
.lb{position:fixed;inset:0;z-index:80;background:rgba(5,5,7,.93);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center}
.lb.show{display:flex}
.lb .lb-img{max-width:min(1100px,94vw);max-height:88vh;border-radius:10px;box-shadow:0 30px 90px rgba(0,0,0,.85)}
.lb .lb-cap{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:12.5px}
.lb button{background:rgba(255,255,255,.07);border:1px solid var(--bd-2);color:#e4e4e7;font-size:18px;width:42px;height:42px;border-radius:50%}
.lb button:hover{background:rgba(139,92,246,.28);border-color:var(--acc-deep);color:#fff}
.lb .lb-x{position:absolute;top:16px;right:18px}
.lb .lb-pv,.lb .lb-nx{position:absolute;top:50%;transform:translateY(-50%)}
.lb .lb-pv{left:18px}.lb .lb-nx{right:18px}
/* 分页懒加载哨兵 */
.sent{height:1px}
.sent-load{padding:14px 0 64px;text-align:center;color:var(--faint);font-size:12px;display:none}
.sent-load.on{display:block}
@media(max-width:760px){.top{flex-wrap:wrap;height:auto;padding:10px 16px}}
</style>
</head>
<body>

<header class="top">
  <div class="brand"><span class="dot"></span>Inspira</div>
  <span class="link">创意灵感生成 · 只产提示词</span>
  <div class="spacer"></div>
  <a class="btn ghost" href="/admin">管理后台</a>
</header>

<div class="status" id="status">公开只读画廊 · 设置 / 生成 / 清理请在「管理后台」进行</div>

<div class="filters">
  <span class="chip on" data-f="all">全部</span>
  <span class="chip" data-f="image">图像</span>
  <span class="chip" data-f="video">视频</span>
  <span class="count" id="count"></span>
</div>

<div class="sent" id="sent-top"></div>
<div class="wall" id="wall"></div>
<div class="sent" id="sent-bottom"></div>
<div class="sent-load" id="sent-load">加载中…</div>

<script>
${utilClientJs}
const $=s=>document.querySelector(s),wall=$('#wall'),count=$('#count'),sentT=$('#sent-top'),sentB=$('#sent-bottom'),sentLoad=$('#sent-load');
/* 懒加载参数：数据窗口每页 PAGE 条、最多 MAX_WIN 条（滚动按需扩展/回缩）；
   DOM 槽位只有接近视窗才挂载真实卡片，远离后卸载为等高占位（最近实测高度），滚动位置不跳 */
const PAGE=30,MAX_WIN=120,MOUNT_MARGIN=700,UNMOUNT_MARGIN=1600;
let list=[],total=0,filter='all',loading=false,lastIds='',winStart=0,winEnd=0;
const KIND={image:{n:'图像',ic:'image'},video:{n:'视频',ic:'video'}};
const SRC={hot_topic:'热点',hot_image:'热图',original_idea:'原创点子'};
const ST={queued:'排队中',running:'生成中',ready:'提示词就绪',failed:'失败'};
const heights=new Map(),slots=new Map(),expanded=new Set();

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
  const item=id?list.find(x=>x.id===id):null;
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

/* ===== 灯箱预览（图像项目点开看大图） ===== */
const lb=document.createElement('div');lb.className='lb';
lb.innerHTML='<button class="lb-x" title="关闭">✕</button><button class="lb-pv" title="上一张">‹</button><img class="lb-img" alt="预览"><button class="lb-nx" title="下一张">›</button><div class="lb-cap"></div>';
document.body.appendChild(lb);
const lbImg=lb.querySelector('.lb-img'),lbCap=lb.querySelector('.lb-cap');
let lbList=[],lbIndex=0;
function renderLb(){
  const it=lbList[lbIndex];if(!it){closeLb();return;}
  lbImg.src='/api/images/'+it.cover.file;
  lbCap.textContent=it.title||it.idea||'';
  const one=lbList.length<2;
  lb.querySelector('.lb-pv').style.visibility=one?'hidden':'visible';
  lb.querySelector('.lb-nx').style.visibility=one?'hidden':'visible';
}
function openLb(id){
  lbList=list.filter(x=>x.kind==='image'&&x.cover&&x.cover.file);
  lbIndex=lbList.findIndex(x=>x.id===id);
  if(lbIndex<0)return;
  hideTip();renderLb();lb.classList.add('show');document.documentElement.style.overflow='hidden';
}
function closeLb(){lb.classList.remove('show');lbImg.src='';document.documentElement.style.overflow='';}
function stepLb(d){if(!lbList.length)return;lbIndex=(lbIndex+d+lbList.length)%lbList.length;renderLb();}
lb.addEventListener('click',e=>{
  if(e.target===lb){closeLb();return;}
  const b=e.target.closest('button');if(!b)return;
  if(b.classList.contains('lb-x'))closeLb();
  else if(b.classList.contains('lb-pv'))stepLb(-1);
  else if(b.classList.contains('lb-nx'))stepLb(1);
});
document.addEventListener('keydown',e=>{
  if(!lb.classList.contains('show'))return;
  if(e.key==='Escape')closeLb();
  else if(e.key==='ArrowLeft')stepLb(-1);
  else if(e.key==='ArrowRight')stepLb(1);
});

/* ===== 卡片 DOM 工厂 ===== */
function coverHtml(i){
  const k=KIND[i.kind]||KIND.image;
  const ribbon='<span class="ribbon"><b>'+esc(k.n)+'</b><b>'+esc(SRC[i.source]||i.source)+'</b></span>';
  const stLine='<span class="st '+i.status+'"><i></i>'+ST[i.status]+'</span>';
  if(i.kind==='video'){
    const play='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    return '<div class="cover video">'+ribbon+'<span class="dur">6 秒</span><div class="ph"><span class="ic"><img src="data:image/svg+xml;utf8,'+encodeURIComponent(play)+'"></span><span class="t">视频提示词</span><span class="s">接 MiniMax H3 后在此展示成片</span></div>'+stLine+'<div class="glow"></div></div>';
  }
  if(i.cover&&i.cover.file){
    return '<div class="cover image hasimg zoom" data-preview="1"><div class="imgwrap"><img class="cimg" src="/api/images/'+esc(i.cover.file)+'" alt="AI 生成封面" loading="lazy"></div>'+ribbon+stLine+'<div class="glow"></div></div>';
  }
  return '<div class="cover image">'+ribbon+'<div class="ph"'+(i.coverError?' title="'+esc(i.coverError)+'"':'')+'><span class="ic">🖼</span><span class="t">图像提示词</span><span class="s">'+(i.coverError?'⚠ 生图失败':'分配「生图」模型后自动出封面')+'</span></div>'+stLine+'<div class="glow"></div></div>';
}
function makeCard(i){
  const el=document.createElement('div');
  el.className='card '+i.status;el.dataset.id=i.id;
  const isVid=i.kind==='video';
  const srcNote=(i.material&&(i.material.label||i.material.note))?'<div class="desc">'+(i.material.url?'<a href="'+esc(i.material.url)+'" target="_blank" rel="noopener">'+esc(i.material.label)+' ↗</a>':'')+(i.material.label&&!i.material.url?esc(i.material.label):'')+(i.material.note?' <span style="opacity:.7">· '+esc(i.material.note)+'</span>':'')+'</div>':'';
  const isOpen=expanded.has(i.id);
  el.innerHTML=coverHtml(i)+
    '<div class="body">'+(i.title||i.idea?'<h3>'+esc(i.title||i.idea)+'</h3>':'')+srcNote+
    (i.error?'<div class="err">✕ '+esc(i.error)+'</div>':'')+
    (i.prompt?'<div class="mono'+(isOpen?' open':'')+'">'+promptHtml(i)+'</div>':'')+
    '<div class="tags"><span class="tag acc">'+esc(i.theme)+'</span>'+(i.style?'<span class="tag">'+esc(i.style)+'</span>':'')+(isVid?'<span class="tag">T2VA · 16:9</span>':'<span class="tag">文生图'+(i.aspect?' · '+esc(i.aspect):'')+'</span>')+'<span class="tag">'+esc(i.status==='failed'?'失败':'ready 提示词')+'</span></div>'+
    '</div>'+
    '<div class="foot"><span class="t">'+fmt(i.createdAt)+'</span>'+(i.prompt?'<button class="btn sm ghost" onclick="expand(this)">'+(isOpen?'收起':'展开')+'</button><button class="btn sm" onclick="copyPrompt(this)">复制</button>':'')+'</div>';
  const img=el.querySelector('img.cimg');
  if(img){
    img.addEventListener('load',()=>{
      if(img.naturalWidth){
        const w=el.querySelector('.imgwrap');
        if(w)w.style.setProperty('--ar',img.naturalWidth+'/'+img.naturalHeight);
        queueMeasure(el);
      }
    });
  }
  return el;
}
window.copyPrompt=btn=>{
  const card=btn.closest('.card');if(!card)return;
  const item=list.find(x=>x.id===card.dataset.id);if(!item)return;
  const full=item.prompt;
  const done=()=>{btn.textContent='已复制';setTimeout(()=>btn.textContent='复制',1200);};
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=full;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();done();};
  if(navigator.clipboard){navigator.clipboard.writeText(full).then(done).catch(fallback);}else{fallback();}
};
window.expand=btn=>{
  const card=btn.closest('.card');if(!card)return;
  const id=card.dataset.id;const m=card.querySelector('.mono');if(!m)return;
  if(expanded.has(id)){expanded.delete(id);m.classList.remove('open');btn.textContent='展开';}
  else{expanded.add(id);m.classList.add('open');btn.textContent='收起';}
  queueMeasure(card);
};

/* ===== DOM 读写批处理：挂载/卸载/测高合并进 rAF，一帧最多两次强制重排 ===== */
const mountQ=new Set(),unmountQ=new Set();
let domRaf=0;
function scheduleDomFlush(){
  if(domRaf)return;
  domRaf=requestAnimationFrame(()=>{domRaf=0;flushDom();});
}
function flushDom(){
  /* 先统一读（卸载前测高），再统一写（占位替换），最后统一测新挂载卡片 */
  const hs=[];
  for(const s of unmountQ){
    const c=s.querySelector('.card');
    if(c&&s.isConnected)hs.push([s,c.offsetHeight]);
  }
  unmountQ.clear();
  for(const [s,h] of hs){
    if(h)heights.set(s.dataset.id,h);
    s.innerHTML=phHtml(h);
  }
  for(const c of mountQ){if(c.isConnected)measureNow(c);}
  mountQ.clear();
}
function queueMeasure(card){mountQ.add(card);scheduleDomFlush();}
function measureNow(card){
  const h=card.offsetHeight;if(!h)return;
  const id=card.dataset.id,prev=heights.get(id);
  heights.set(id,h);
  if(prev===undefined||Math.abs(prev-h)>4)scheduleRebalance();
}

/* ===== 等宽瀑布流布局：列数随宽度取整，槽位放入当前最短列 → 铺满整行不留空 ===== */
let wallW=0,colW=320,colEls=[],rbTimer=0;
function colCountFor(w){return Math.max(1,Math.min(6,Math.floor(w/300)||1));}
/* 估高：封面按类型比例 + 正文常量；首次实测后以 heights 缓存为准 */
function estimateH(it){
  const cover=it.kind==='video'?colW*9/16:colW*3/4;
  return Math.round(cover+240);
}
function sigOfItem(i){
  return [i.status,i.title||'',i.idea,i.error||'',i.cover&&i.cover.file,i.coverError||'',i.prompt?i.prompt.length:0,(i.pictures||[]).map(p=>p.index+(p.imagePrompt?1:0)).join(',')].join('|');
}
function phHtml(h){return '<div class="ph-card" style="height:'+Math.max(80,Math.round(h||estimateH({kind:'image'})))+'px"></div>';}
function slotFor(it){
  let s=slots.get(it.id);
  if(s)return s;
  s=document.createElement('div');s.className='slot';s.dataset.id=it.id;s.dataset.sig=sigOfItem(it);
  s.innerHTML=phHtml(heights.get(it.id));
  slots.set(it.id,s);
  if(mountIO)mountIO.observe(s);
  if(unmountIO)unmountIO.observe(s);
  return s;
}
function place(items){
  const n=colEls.length;if(!n)return;
  const hs=colEls.map(()=>0),want=colEls.map(()=>[]);
  for(const it of items){
    let mi=0;for(let i=1;i<n;i++)if(hs[i]<hs[mi])mi=i;
    want[mi].push(slotFor(it).dataset.id);
    hs[mi]+=heights.get(it.id)||estimateH(it);
  }
  /* 逐列做前缀对比，只挪动缺失/换列的槽位；appendChild 顺序即目标顺序 */
  for(let ci=0;ci<n;ci++){
    const col=colEls[ci],desired=want[ci],cur=[...col.children].map(c=>c.dataset.id);
    let k=0;while(k<cur.length&&k<desired.length&&cur[k]===desired[k])k++;
    if(k===cur.length&&k===desired.length)continue;
    for(let i=k;i<desired.length;i++){const s=slots.get(desired[i]);if(s)col.appendChild(s);}
  }
}
/* 高度漂移的重新均衡：去抖到滚动停歇后执行，避免滚动期间反复全量重排 */
function scheduleRebalance(){clearTimeout(rbTimer);rbTimer=setTimeout(()=>{if(colEls.length&&!document.hidden)place(list);},500);}
function layout(){
  wallW=wall.clientWidth||innerWidth-44;
  const n=colCountFor(wallW);
  colW=n?(wallW-14*(n-1))/n:320;
  /* 列数不变时复用列容器；列数变化才重建（槽位节点常驻，appendChild 移动即可） */
  if(colEls.length!==n){
    for(const c of colEls)c.remove();
    colEls=[];
    for(let i=0;i<n;i++){const c=document.createElement('div');c.className='col';wall.appendChild(c);colEls.push(c);}
  }
  if(!list.length){
    for(const [,s] of slots){if(mountIO)mountIO.unobserve(s);if(unmountIO)unmountIO.unobserve(s);}
    slots.clear();
    for(const c of colEls)c.remove();
    colEls=[];
    wall.innerHTML='<div class="empty">暂无灵感<br><small>管理员登录「管理后台」后点击立即生成，或等待定时任务</small></div>';
    return;
  }
  const ids=new Set(list.map(x=>x.id));
  for(const [id,s] of slots){
    if(!ids.has(id)){if(mountIO)mountIO.unobserve(s);if(unmountIO)unmountIO.unobserve(s);s.remove();slots.delete(id);}
  }
  place(list);
  if(!mountIO)sweepSlots();
}

/* ===== 视窗挂载/卸载：进入视窗 MOUNT_MARGIN 内挂载真实卡片，离开 UNMOUNT_MARGIN 外卸载 ===== */
function mountSlot(s){
  if(s.querySelector('.card'))return;
  const it=list.find(x=>x.id===s.dataset.id);if(!it)return;
  s.innerHTML='';
  s.appendChild(makeCard(it));
  queueMeasure(s.firstElementChild);
  scheduleDomFlush();
}
function unmountSlot(s){
  if(!s.querySelector('.card'))return;
  unmountQ.add(s);
  scheduleDomFlush();
}
const hasIO='IntersectionObserver' in window;
const mountIO=hasIO?new IntersectionObserver(es=>{
  for(const e of es)if(e.isIntersecting)mountSlot(e.target);
},{rootMargin:MOUNT_MARGIN+'px 0px'}):null;
const unmountIO=hasIO?new IntersectionObserver(es=>{
  for(const e of es)if(!e.isIntersecting)unmountSlot(e.target);
},{rootMargin:UNMOUNT_MARGIN+'px 0px'}):null;
/* 无 IntersectionObserver 的兜底：按滚动位置扫描（节流） */
function sweepSlots(){
  for(const s of slots.values()){
    const r=s.getBoundingClientRect();
    if(r.top<innerHeight+MOUNT_MARGIN&&r.bottom>-MOUNT_MARGIN)mountSlot(s);
    else if(r.top>innerHeight+UNMOUNT_MARGIN||r.bottom<-UNMOUNT_MARGIN)unmountSlot(s);
  }
}
if(!hasIO){
  let fbTimer=0;
  const sweep=()=>{clearTimeout(fbTimer);fbTimer=setTimeout(sweepSlots,150);};
  window.addEventListener('scroll',sweep,{passive:true});
  window.addEventListener('resize',sweep);
}

/* ===== 单条内容变化（状态翻转 / 封面就绪 / 提示词更新）：已挂载时只重建那张卡片 ===== */
function refreshSlot(s,it){
  s.dataset.sig=sigOfItem(it);
  if(!s.querySelector('.card'))return;
  s.innerHTML='';
  s.appendChild(makeCard(it));
  queueMeasure(s.firstElementChild);
  scheduleDomFlush();
}

/* ===== 数据加载：服务端分页窗口 + 5s 轮询（仅当前窗口、页面隐藏时跳过） ===== */
function windowUrl(){
  const q=new URLSearchParams();
  if(filter!=='all')q.set('kind',filter);
  q.set('offset',String(winStart));
  q.set('limit',String(Math.max(1,winEnd-winStart)));
  return '/api/inspirations?'+q.toString();
}
async function fetchWindow(){
  const res=await fetch(windowUrl());
  total=Number(res.headers.get('X-Total-Count'))||0;
  return res.json();
}
function updateCount(){
  let t=total+' 条提示词';
  if(total>0&&(winStart>0||winEnd<total))t+=' · 已载 '+(winStart+1)+'–'+winEnd;
  if(count.textContent!==t)count.textContent=t;
}
async function loadWindow(reset){
  if(loading)return;loading=true;
  if(!list.length)sentLoad.classList.add('on'); // 仅首屏无数据时显示加载指示，避免轮询时闪烁
  try{
    if(reset){
      winStart=0;winEnd=PAGE*2;
      for(const [,s] of slots){if(mountIO)mountIO.unobserve(s);if(unmountIO)unmountIO.unobserve(s);}
      slots.clear();lastIds='';
    }
    let data=await fetchWindow();
    if(!Array.isArray(data))return;
    if(reset)winEnd=Math.min(winEnd,total);
    /* 窗口越界（记录被删）：窗口回缩后重取一次 */
    if(!data.length&&total>0&&winStart>0){
      winStart=Math.max(0,total-(winEnd-winStart));winEnd=total;
      data=await fetchWindow();
      if(!Array.isArray(data))return;
    }
    list=data;
    const ids=list.map(x=>x.id).join(',');
    if(ids!==lastIds||list.some(x=>{const s=slots.get(x.id);return !s||s.dataset.sig!==sigOfItem(x);})){
      lastIds=ids;
      for(const x of list){const s=slots.get(x.id);if(s&&s.dataset.sig!==sigOfItem(x))refreshSlot(s,x);}
      layout();
    }
    updateCount();
  }catch(e){}finally{loading=false;sentLoad.classList.remove('on');}
}

/* ===== 翻页换窗：用「锚点槽位」补偿滚动位置（内容上方增删时不跳动） ===== */
function anchorTop(){
  for(const it of list){
    const s=slots.get(it.id);if(!s)continue;
    const r=s.getBoundingClientRect();
    if(r.bottom>60)return{id:it.id,top:r.top};
  }
  return null;
}
function restoreAnchor(a,compensate){
  if(!a||!compensate)return;
  const el=slots.get(a.id);
  if(!el||!el.isConnected)return;
  const d=el.getBoundingClientRect().top-a.top;
  if(Math.abs(d)>1)window.scrollTo(0,window.scrollY+d);
}
/* 换窗泵：只要哨兵仍在触达范围（含「钉在页底/页顶」的持续状态）就连续换窗，
   直到哨兵远离或数据到底；有加载进行中（如 5s 轮询）时等待其完成而不是放弃，
   避免「加载期间到达的触发被丢弃 + 哨兵无新交叉事件」导致的停摆 */
let pumpingDown=false,pumpingUp=false;
async function pumpBottom(){
  if(pumpingDown)return;pumpingDown=true;
  try{
    for(let guard=0;guard<60;guard++){
      if(loading){await new Promise(r=>setTimeout(r,100));continue;}
      if(winEnd>=total||sentB.getBoundingClientRect().top>=innerHeight+400)break;
      const newEnd=Math.min(total,winEnd+PAGE);
      let newStart=winStart;
      if(newEnd-newStart>MAX_WIN)newStart=newEnd-MAX_WIN;
      winStart=newStart;winEnd=newEnd;
      const a=anchorTop();
      await loadWindow(false);
      restoreAnchor(a,true);
    }
  }finally{pumpingDown=false;}
}
async function pumpTop(){
  if(pumpingUp)return;pumpingUp=true;
  try{
    for(let guard=0;guard<60;guard++){
      if(loading){await new Promise(r=>setTimeout(r,100));continue;}
      if(winStart<=0||sentT.getBoundingClientRect().bottom<=-400)break;
      const size=winEnd-winStart,newStart=Math.max(0,winStart-PAGE);
      winStart=newStart;winEnd=Math.min(total,newStart+Math.max(size,PAGE));
      const a=anchorTop();
      await loadWindow(false);
      /* 已在页面顶部附近时不补偿：让用户直达最新的记录 */
      restoreAnchor(a,window.scrollY>=120);
    }
  }finally{pumpingUp=false;}
}
function extend(){pumpBottom();}
function retract(){pumpTop();}
const io='IntersectionObserver' in window?new IntersectionObserver(es=>{
  for(const e of es){
    if(!e.isIntersecting)continue;
    if(e.target===sentB)extend();else if(e.target===sentT)retract();
  }
},{rootMargin:'400px'}):null;
if(io){io.observe(sentB);io.observe(sentT);}
else window.addEventListener('scroll',()=>{
  if(scrollY+innerHeight>document.documentElement.scrollHeight-400)extend();
  if(scrollY<80&&winStart>0)retract();
},{passive:true});
/* 兜底邻近检查：IO 只在交叉状态跃迁时回调，快速滚动或钉在页底/页顶时可能错过跃迁；
   滚动事件本身不会丢，配合泵循环（钉住时自持）覆盖全部到达路径 */
let proxTimer=0;
function proximityCheck(){
  if(winEnd<total&&sentB.getBoundingClientRect().top<innerHeight+400)extend();
  else if(winStart>0&&sentT.getBoundingClientRect().bottom>-400)retract();
}
window.addEventListener('scroll',()=>{clearTimeout(proxTimer);proxTimer=setTimeout(proximityCheck,120);},{passive:true});
window.addEventListener('resize',()=>{clearTimeout(proxTimer);proxTimer=setTimeout(proximityCheck,120);});

let rsTimer=0;
window.addEventListener('resize',()=>{
  clearTimeout(rsTimer);
  rsTimer=setTimeout(()=>{wallW=0;layout();},150);
});

document.querySelector('.filters').addEventListener('click',e=>{
  const ch=e.target.closest('.chip');if(!ch)return;
  document.querySelectorAll('.filters .chip').forEach(x=>x.classList.remove('on'));
  ch.classList.add('on');filter=ch.dataset.f;loadWindow(true);});
wall.addEventListener('click',e=>{
  const cov=e.target.closest&&e.target.closest('.cover.zoom');
  if(!cov)return;
  const card=cov.closest('.card');if(card)openLb(card.dataset.id);
});

loadWindow(true);
setInterval(()=>{if(!document.hidden)loadWindow(false);},5000);
</script>
</body></html>`;
}
