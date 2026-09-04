/** 公开画廊页（只读）：瀑布式提示词画廊。管理功能（设置 / LLM 配置 / 生成 / 清理）全部移至 /admin（需登录）。 */
import { uiCss, utilClientJs } from './ui.js';

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inspira · 灵感画廊</title>
<style>
${uiCss}
/* 画廊专有：瀑布流卡片与封面占位 */
a.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
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
.cover .cimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
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
.body .tags{margin-top:auto}
.card.failed .mono{display:none}
.foot{display:flex;align-items:center;gap:6px;padding:10px 14px 12px;border-top:1px solid var(--bd);margin-top:2px}
.foot .t{font-size:11px;color:var(--faint);margin-right:auto}
.soon{font-size:11.5px;color:#52525b}
@media(max-width:760px){.wall{columns:1}.top{flex-wrap:wrap;height:auto;padding:10px 16px}}
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

<div class="wall" id="wall"></div>

<script>
${utilClientJs}
const $=s=>document.querySelector(s),wall=$('#wall'),count=$('#count');
let items=[],filter='all';
const KIND={image:{n:'图像',ic:'image'},video:{n:'视频',ic:'video'}};
const SRC={hot_topic:'热点',hot_image:'热图',original_idea:'原创点子'};
const ST={queued:'排队中',running:'生成中',ready:'提示词就绪',failed:'失败'};

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
  if(!list.length){wall.innerHTML='<div class="empty">暂无灵感<br><small>管理员登录「管理后台」后点击立即生成，或等待定时任务</small></div>';return;}
  wall.innerHTML=list.map((i,idx)=>{
    const k=KIND[i.kind]||KIND.image,st=i.status;
    const isVid=i.kind==='video';
    const ribbon='<span class="ribbon"><b>'+esc(k.n)+'</b><b>'+esc(SRC[i.source]||i.source)+'</b></span>';
    const stLine='<span class="st '+st+'"><i></i>'+ST[st]+'</span>';
    const cover=isVid
      ? '<div class="cover video">'+ribbon+'<span class="dur">6 秒</span><div class="ph"><span class="ic"><img src="data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>')+'"></span><span class="t">视频提示词</span><span class="s">接 MiniMax H3 后在此展示成片</span></div>'+stLine+'<div class="glow"></div></div>'
      : i.cover&&i.cover.file
        ? '<div class="cover image">'+ribbon+'<img class="cimg" src="/api/images/'+esc(i.cover.file)+'" alt="AI 生成封面" loading="lazy">'+stLine+'<div class="glow"></div></div>'
        : '<div class="cover image">'+ribbon+'<div class="ph"'+(i.coverError?' title="'+esc(i.coverError)+'"':'')+'><span class="ic">🖼</span><span class="t">图像提示词</span><span class="s">'+(i.coverError?'⚠ 生图失败':'分配「生图」模型后自动出封面')+'</span></div>'+stLine+'<div class="glow"></div></div>';
    const srcNote=(i.material&&(i.material.label||i.material.note))?'<div class="desc">'+(i.material.url?'<a href="'+esc(i.material.url)+'" target="_blank" rel="noopener">'+esc(i.material.label)+' ↗</a>':'')+(i.material.label&&!i.material.url?esc(i.material.label):'')+(i.material.note?' <span style="opacity:.7">· '+esc(i.material.note)+'</span>':'')+'</div>':'';
    const isOpen=expanded.has(i.id);
    return '<div class="card '+st+'" data-id="'+esc(i.id)+'">'+cover+
      '<div class="body">'+(i.idea?'<h3>'+esc(i.idea)+'</h3>':'')+srcNote+
      (i.error?'<div class="err">✕ '+esc(i.error)+'</div>':'')+
      (i.prompt?'<div class="mono'+(isOpen?' open':'')+'">'+promptHtml(i)+'</div>':'')+
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
const expanded=new Set();
window.expand=(btn)=>{
  const card=btn.closest('.card');
  if(!card)return;
  const id=card.dataset.id;const m=card.querySelector('.mono');
  if(!m)return;
  if(expanded.has(id)){expanded.delete(id);m.classList.remove('open');btn.textContent='展开';}
  else{expanded.add(id);m.classList.add('open');btn.textContent='收起';}
};

document.querySelector('.filters').addEventListener('click',e=>{
  const ch=e.target.closest('.chip');
  if(!ch)return;
  document.querySelectorAll('.filters .chip').forEach(x=>x.classList.remove('on'));
  ch.classList.add('on');filter=ch.dataset.f;render();});

async function loadList(){try{items=await (await fetch('/api/inspirations?limit=60')).json();render();}catch(e){}}
loadList();
setInterval(loadList,5000);
</script>
</body></html>`;
}
