/** 后台管理控制台（/admin，需登录；admin / viewer 两级角色，见 src/auth.ts）。
 *  布局：左侧导航 + 顶栏（用户/角色/修改密码/退出）+ 内容区各区块：
 *  总览 / 灵感 / 生成设置 / LLM 配置 / 采集源 /（admin）账号与权限。
 *  全部控件自绘（txtbox/stepper/switch/select/seg），无原生控件外观；所有动态注入经 esc() 转义。 */
import type { PublicUser } from './types.js';
import { DEFAULT_STYLES } from './store.js';
import { uiCss, utilClientJs } from './ui.js';

function authStyle(): string {
  return `
html,body{height:100%}
.auth{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
.auth .modal{max-width:380px}
.auth .brand{margin:0 0 18px;justify-content:center}
.auth .err{display:none;margin:0 0 12px}
.auth .err.show{display:block}
.auth .foot{display:flex;justify-content:space-between;align-items:center;margin-top:16px;color:var(--faint);font-size:12px}
`;
}

function authPageHtml(title: string, sub: string, mode: 'login' | 'setup'): string {
  const isSetup = mode === 'setup';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Inspira 后台</title>
<style>
${uiCss}
${authStyle()}
</style>
</head>
<body>
<div class="auth">
  <div class="modal">
    <div class="brand"><span class="dot"></span>Inspira <span style="color:var(--faint);font-size:12px">后台管理</span></div>
    <div class="cb-hint" style="margin:0 0 18px;font-size:12px;color:var(--muted)">${sub}</div>
    <div class="err" id="err"></div>
    <div class="field">
      <label class="f">用户名</label>
      <div class="txtbox" id="u" contenteditable="true" role="textbox" data-placeholder="管理员账号" aria-label="用户名"></div>
    </div>
    <div class="field">
      <label class="f">密码</label>
      <div class="secret">
        <div class="txtbox keyed" id="p" contenteditable="true" role="textbox" data-placeholder="••••••••" aria-label="密码"></div>
        <button class="seye" id="eye" type="button" aria-label="显示或隐藏密码" aria-pressed="false">👁</button>
      </div>
    </div>
    ${isSetup ? `<div class="field">
      <label class="f">确认密码</label>
      <div class="txtbox keyed" id="p2" contenteditable="true" role="textbox" data-placeholder="再次输入密码" aria-label="确认密码"></div>
    </div>` : ''}
    <div class="mfoot">
      <button class="btn ghost" id="back" type="button">返回画廊</button>
      <span class="grow"></span>
      <button class="btn" id="go" type="button">${isSetup ? '创建管理员' : '登 录'}</button>
    </div>
  </div>
</div>
<script>
${utilClientJs}
const $=s=>document.querySelector(s),go=$('#go'),err=$('#err');
function msg(t){err.textContent=t;err.classList.add('show');}
function tx(el){
  el.addEventListener('paste',e=>{e.preventDefault();
    const t=((e.clipboardData||window.clipboardData).getData('text/plain')||'').trim();
    document.execCommand('insertText',false,t);});
  el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Escape')e.preventDefault();});
  const get=()=>el.textContent.replace(/\\u00A0/g,' ').trim();
  const set=v=>{el.textContent=String(v??'');};
  return {el,get,set};
}
const u=tx($('#u')),p=tx($('#p'));
const p2=${isSetup ? 'tx($(\'#p2\'))' : 'null'};
let masked=${isSetup ? 'true' : 'true'};
const eye=$('#eye');
eye.addEventListener('click',()=>{masked=!masked;
  const on=masked&&CSS.supports('-webkit-text-security','disc');
  $('#p').classList.toggle('keyed',on);
  const p2El=$('#p2');if(p2El)p2El.classList.toggle('keyed',on);
  eye.textContent=masked?'👁':'🙈';eye.setAttribute('aria-pressed',String(!masked));});
async function submit(){
  const username=u.get(),password=p.get();
  if(!username){msg('请输入用户名');return;}
  if(password.length<8){msg('密码至少 8 位');return;}
  ${isSetup ? `if(password!==p2.get()){msg('两次输入的密码不一致');return;}` : ''}
  go.disabled=true;go.textContent='${isSetup ? '创建中…' : '登录中…'}';
  try{
    const r=await fetch('${isSetup ? '/api/auth/setup' : '/api/auth/login'}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){msg(d.error||('请求失败（HTTP '+r.status+'）'));go.disabled=false;go.textContent='${isSetup ? '创建管理员' : '登 录'}';return;}
    location.href='/admin';
  }catch(e){msg('网络错误，请重试');go.disabled=false;go.textContent='${isSetup ? '创建管理员' : '登 录'}';}
}
go.addEventListener('click',submit);
u.el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();p.el.focus();}});
p.el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();${isSetup ? 'p2.el.focus();' : 'submit();'}}});
${isSetup ? `p2.el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submit();}});` : ''}
document.addEventListener('keydown',e=>{if(e.key==='Escape')location.href='/';});
$('#back').onclick=()=>location.href='/';
setTimeout(()=>u.el.focus(),60);
</script>
</body></html>`;
}

export function adminLoginHtml(): string {
  return authPageHtml('登录', '登录后进入管理后台。匿名访客只能浏览公开画廊。', 'login');
}

export function adminSetupHtml(): string {
  return authPageHtml('初始化管理员', '首次使用：创建管理员账号（至少 8 位密码）。创建后需登录才能管理。', 'setup');
}

export function adminPageHtml(user: PublicUser): string {
  const can = user.role === 'admin';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>后台管理 · Inspira</title>
<style>
${uiCss}
/* ===== 后台布局：左侧导航 + 内容区 ===== */
body{overflow:hidden}
.adm{display:flex;height:100vh}
.anav{width:208px;flex:none;background:#0d0d0f;border-right:1px solid var(--bd);display:flex;flex-direction:column;min-height:0}
.alogo{display:flex;align-items:center;gap:9px;padding:16px 16px 12px;font-size:15px;font-weight:700}
.alogo .dot{width:8px;height:8px;border-radius:50%;background:var(--acc-deep);box-shadow:0 0 10px var(--acc-deep)}
.alogo em{font-style:normal;font-size:11px;color:var(--faint);font-weight:500}
.anav .ai{display:flex;align-items:center;gap:10px;margin:2px 10px;padding:9px 12px;border-radius:9px;background:transparent;border:1px solid transparent;color:var(--muted);font-size:13px;font-weight:500;text-align:left}
.anav .ai:hover{background:var(--card2);color:#fff}
.anav .ai.on{background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.35);color:var(--fg)}
.anav .ai.on b{color:var(--acc)}
.anav .ai .aico{width:16px;text-align:center;font-size:13px;flex:none}
.anav .asp{flex:1}
.anav .ai.out{margin-top:auto;border-top:1px solid var(--bd);border-radius:0;padding:12px;color:var(--faint);text-decoration:none}
.anav .ai.out:hover{color:var(--acc);background:transparent}
.amain{flex:1;min-width:0;display:flex;flex-direction:column}
.atop{flex:none;display:flex;align-items:center;gap:14px;padding:0 24px;height:56px;border-bottom:1px solid var(--bd);background:rgba(10,10,10,.7)}
.atop h1{font-size:15px;font-weight:700;margin:0}
.atop .asub{margin-left:10px;font-size:11.5px;color:var(--faint);font-weight:400}
.atop .auser{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:13px}
.rolbadge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;letter-spacing:.4px}
.rolbadge.admin{background:rgba(139,92,246,.2);color:var(--acc)}
.rolbadge.viewer{background:rgba(251,191,36,.14);color:var(--warn)}
.abody{flex:1;overflow-y:auto;padding:20px 24px 60px}
.sec{display:none}
.sec.on{display:block}
.box{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px 18px;margin-bottom:16px}
.sec-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.sec-h h2{font-size:14px;font-weight:700}
.sec-h .rh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* 总览 */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.stat{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px 16px;cursor:pointer;transition:border-color .15s}
.stat:hover{border-color:#41414a}
.stat .v{font-size:26px;font-weight:700;line-height:1.1;color:var(--fg)}
.stat .v.warn{color:var(--bad)}
.stat .k{font-size:11.5px;color:var(--faint);margin-top:6px}
.ocard{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px 16px}
.ocard+.ocard{margin-top:12px}
.ocard h3{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);font-weight:600;margin:0 0 10px;display:flex;align-items:center;gap:8px}
.ocard .rowline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin:4px 0}
.ocard .rowline b{color:#d4d4d8;font-weight:600}
.kv{display:flex;align-items:baseline;gap:8px;font-size:12.5px;margin:5px 0}
.kv .k{color:var(--faint);flex:none;min-width:70px}
.kv .v2{color:#d4d4d8}
.tasklist{display:flex;flex-direction:column;gap:5px;font-size:12px}
.tasklist .trow{display:flex;gap:8px;align-items:baseline}
.tasklist .tk{color:var(--faint);width:52px;flex:none}
.tasklist .tm{color:#c9c9ce;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}
.health-mini{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.hchip{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--bd-2);color:var(--muted)}
.hchip i{width:6px;height:6px;border-radius:50%;background:#3f3f46;flex:none}
.hchip.ok i{background:var(--ok)}
.hchip.bad i{background:var(--bad);box-shadow:0 0 6px rgba(248,113,113,.6)}
.hchip .e{color:var(--bad)}

/* 灵感列表表格 */
.box .filters{padding:0 0 10px}
.tbl .act{white-space:nowrap}
.tbl .tt{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c9c9ce}
.noteline{font-size:11px;color:#52525b;margin-top:10px}

/* LLM 面板（内嵌区块，固定高度内部滚动） */
.llmbox{display:flex;flex-direction:column;padding:0;overflow:hidden;height:calc(100vh - 210px);min-height:430px}
.llmbox .mhead{padding:12px 16px;border-bottom:1px solid var(--bd);margin-bottom:0;flex:none;display:flex;align-items:center;gap:10px}
.llmbox .mhead h2{font-size:14px}
.locked{pointer-events:none;opacity:.72;position:relative}
.ro-banner{display:flex;align-items:center;gap:8px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);color:#fcd34d;font-size:12px;padding:7px 12px;border-radius:9px;margin-bottom:14px}
.pw{color:var(--faint);font-size:12px}
.askbar{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);display:none;align-items:center;gap:12px;background:#0d0d13;border:1px solid rgba(167,139,250,.5);border-radius:12px;padding:9px 10px 9px 16px;box-shadow:0 12px 32px rgba(0,0,0,.6);z-index:99;max-width:min(86vw,560px);font-size:12.5px;color:#d4d4d8}
.askbar.show{display:flex;animation:askpop .18s ease}
@keyframes askpop{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.askbar .askmsg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 用户/会话/审计 */
.urow{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--bd)}
.urow:last-child{border-bottom:0}
.urow .un{font-weight:600;min-width:120px}
.urow .me{font-size:10px;color:var(--acc);border:1px solid rgba(167,139,250,.4);border-radius:999px;padding:0 6px}
.audit{display:flex;flex-direction:column;gap:2px;font-size:11.5px;color:var(--muted)}
.audit .aline{display:flex;gap:10px;padding:4px 2px;border-bottom:1px dashed var(--bd);align-items:baseline}
.audit .at{color:var(--faint);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px}
.audit .aa{color:#c9c9ce;flex:none}
.audit .ad{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmodal-meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}
.dcover{max-width:240px;border-radius:10px;margin-bottom:10px;display:block}
.mono-pane{max-height:48vh;overflow-y:auto}
</style>
</head>
<body data-role="${user.role}">

<div class="adm">
  <aside class="anav">
    <div class="alogo"><span class="dot"></span>Inspira <em>后台管理</em></div>
    <button class="ai on" data-sec="overview" type="button"><span class="aico">◉</span>总览</button>
    <button class="ai" data-sec="insp" type="button"><span class="aico">🖼</span>灵感</button>
    <button class="ai" data-sec="gen" type="button"><span class="aico">⚙</span>生成设置</button>
    ${can ? '<button class="ai" data-sec="llm" type="button"><span class="aico">▦</span>LLM 配置</button>' : ''}
    <button class="ai" data-sec="src" type="button"><span class="aico">⇅</span>采集源</button>
    ${can ? '<button class="ai" data-sec="users" type="button"><span class="aico">👤</span>账号与权限</button>' : ''}
    <div class="asp"></div>
    <a class="ai out" href="/"><span class="aico">←</span>返回公开画廊</a>
  </aside>

  <div class="amain">
    <header class="atop">
      <h1 id="atitle">总览</h1><span class="asub" id="asub"></span>
      <div class="auser">
        <span class="rolbadge ${user.role}">${can ? '管理员' : '只读'}</span>
        <b id="uname">${user.username}</b>
        <button class="btn ghost sm" id="pwBtn" type="button">修改密码</button>
        <button class="btn ghost sm" id="logoutBtn" type="button">退出登录</button>
      </div>
    </header>

    <div class="abody" id="abody">

      <!-- ==================== 总览 ==================== -->
      <section class="sec on" id="sec-overview">
        <div class="stats" id="ovStats"></div>
        <div class="ocard" data-jump="gen">
          <h3>生成调度</h3>
          <div class="kv"><span class="k">自动生成</span><span class="v2" id="ovSched"></span></div>
          <div class="kv"><span class="k">下次运行</span><span class="v2" id="ovNext"></span></div>
          ${can ? '<div style="margin-top:10px"><button class="btn" id="ovGen" type="button">立即生成一条</button></div>' : ''}
        </div>
        <div class="ocard" data-jump="llm" id="ovLlmCard" style="display:none">
          <h3>LLM 生效目标（按任务）</h3>
          <div class="tasklist" id="ovTasks"></div>
          <div class="cb-hint" style="margin-top:8px">详情与调整在「LLM 配置」</div>
        </div>
        <div class="ocard" data-jump="src">
          <h3>采集源健康</h3>
          <div class="health-mini" id="ovHealth"></div>
          <div class="cb-hint" style="margin-top:8px">完整状态在「采集源」</div>
        </div>
      </section>

      <!-- ==================== 灵感管理 ==================== -->
      <section class="sec" id="sec-insp">
        <div class="box">
          <div class="sec-h">
            <h2>灵感记录</h2>
            <div class="rh">
              <button class="btn ghost sm" id="inspRefresh" type="button">刷新</button>
              ${can ? '<button class="btn ghost sm danger" id="inspClear" type="button">清空历史</button>' : ''}
            </div>
          </div>
          <div class="filters" id="inspFilter"></div>
          <div id="inspWrap"></div>
          <div class="noteline">列表仅展示最新 100 条；库上限 300 条。详情弹窗可查看完整提示词与 &lt;Picture N&gt; 参考画面。</div>
        </div>
      </section>

      <!-- ==================== 生成设置 ==================== -->
      <section class="sec" id="sec-gen">
        ${!can ? '<div class="ro-banner">🔒 只读模式：您是 viewer 角色，设置修改仅管理员可用</div>' : ''}
        <div class="box ${can ? '' : 'locked'}">
          <div class="sec-h"><h2>主题 · 风格库与自动生成</h2><span class="pw">主题/风格可配 override 提示词（图像灵感命中即跳过图像提示词请求直接生图）· 保存后即时生效并重排定时任务</span></div>
          <div class="row">
            <div class="field">
              <label class="f">主题库（每次生成随机取一个）</label>
              <div class="themes" id="themeList" role="list" aria-label="主题列表"></div>
              <div class="txtbox tnew" id="themeNew" contenteditable="true" role="textbox" data-placeholder="输入新主题，回车添加…" aria-label="新主题"></div>
              <div class="cb-hint" id="themeHint">点击 ○ 勾选参与随机 · 点击主题名改名 · ✎ 编辑 override 提示词 · ✕ 删除 · 回车添加</div>
            </div>
            <div class="field">
              <label class="f">风格库（每次生成随机取一个）</label>
              <div class="themes" id="styleList" role="list" aria-label="风格列表"></div>
              <div class="txtbox tnew" id="styleNew" contenteditable="true" role="textbox" data-placeholder="输入新风格，回车添加…" aria-label="新风格"></div>
              <div class="cb-hint" id="styleHint">点击 ○ 勾选参与随机 · 可全部取消 = 不指定风格 · 点击风格名改名 · ✎ 编辑 override 提示词 · ✕ 删除 · 回车添加</div>
            </div>
          </div>
          <div class="row">
            <div class="field" style="flex:0 0 148px">
              <label class="f">间隔（分钟）</label>
              <div class="stepper" id="intervalStepper">
                <button class="step" data-d="-5" type="button" aria-label="减少 5 分钟">−</button>
                <div class="step-val" contenteditable="true" role="textbox" aria-label="间隔分钟"></div>
                <button class="step" data-d="5" type="button" aria-label="增加 5 分钟">+</button>
              </div>
              <div class="cb-hint">1–10080 分钟，步进 5</div>
            </div>
            <div class="field" style="flex:0 0 148px">
              <label class="f">封面补图间隔（分钟）</label>
              <div class="stepper" id="coverRetryStepper">
                <button class="step" data-d="-5" type="button" aria-label="减少 5 分钟">−</button>
                <div class="step-val" contenteditable="true" role="textbox" aria-label="封面补图间隔分钟"></div>
                <button class="step" data-d="5" type="button" aria-label="增加 5 分钟">+</button>
              </div>
              <div class="cb-hint">封面生图失败自动重试的检查间隔，也是退避基准</div>
            </div>
            <div class="field" style="flex:0 0 148px">
              <label class="f">补图间隔（秒）</label>
              <div class="stepper" id="coverDelayStepper">
                <button class="step" data-d="-5" type="button" aria-label="减少 10 秒">−</button>
                <div class="step-val" contenteditable="true" role="textbox" aria-label="补图间隔秒"></div>
                <button class="step" data-d="5" type="button" aria-label="增加 10 秒">+</button>
              </div>
              <div class="cb-hint">轮内相邻两张封面间的等待，0–3600 秒，步进 10</div>
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
          <div class="mfoot">
            <span class="pw" style="margin-right:auto">修改后自动询问 保存 / 取消</span>
            <button class="btn ghost" id="genReload" type="button">重新加载</button>
          </div>
        </div>
      </section>

      <!-- ==================== LLM 配置（仅 admin） ==================== -->
      ${can ? `<section class="sec" id="sec-llm">
        <div class="box llmbox">
          <div class="mhead">
            <h2>LLM 配置</h2>
            <span class="lsub">生成统一走各协议的 OpenAI 兼容接口 · 可为点子/图像/视频/生图分配不同模型</span>
          </div>
          <div class="lbody">
            <aside class="lside">
              <div class="lside-head"><span>提供商</span><button class="btn ghost sm" id="llmAdd" type="button">+ 添加</button></div>
              <div class="plist" id="providerList"></div>
              <div class="lside-foot">
                <div class="pitem" id="assignNav" role="button" tabindex="0" aria-label="模型分配">
                  <span class="pinfo"><span class="pname">⚖ 模型分配</span><span class="pmeta">点子 / 图像 / 视频 / 生图</span></span>
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
                  <span class="mcount" id="modelCount"></span>
                  <span style="flex:1"></span>
                  <button class="btn ghost sm" id="fetchModels" type="button">获取模型列表</button>
                </div>
                <div class="mtool" id="modelTools" style="display:none">
                  <div class="txtbox tsearch" id="modelSearch" contenteditable="true" role="textbox" data-placeholder="筛选模型…" aria-label="筛选模型"></div>
                  <button class="btn ghost sm danger" id="modelRemoveSel" type="button" style="display:none"></button>
                </div>
                <div id="modelEmpty" class="mempty"></div>
                <div id="modelGrid" class="mgrid" style="display:none"></div>
                <div class="txtbox tnew" id="modelNew" contenteditable="true" role="textbox" data-placeholder="手动添加模型 ID，回车添加…" aria-label="手动添加模型"></div>
                <div class="cb-hint">点击模型卡片取消勾选并移除 · 多模型时上方可按关键字筛选并「移除匹配」批量调整 · 未分配任务的生成使用列表中第一个可用提供商的第一个模型</div>
              </div>
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
                <div class="field">
                  <label class="f">生图（图像灵感封面 · images 端点优先，自动兼容对话端点图像模型）</label>
                  <div class="cselect" id="asgImagegen"></div>
                  <div class="cb-hint">图像提示词就绪后自动调用该模型生成封面图并展示在卡片上；留空 = 不生图</div>
                </div>
                <div class="cb-hint">删除提供商或从列表移除模型后，对应分配自动失效并回退为自动</div>
              </div>
              <div class="lbar" id="llmBar" style="display:none">
                <span class="lstat" id="llmStat">新建提供商</span>
                <span class="pw">修改后自动询问 保存 / 取消</span>
                <span style="flex:1"></span>
                <button class="btn ghost" id="pDelete" type="button" style="display:none">删除提供商</button>
              </div>
              <div class="lbar" id="assignBar" style="display:none">
                <span class="lstat" id="assignStat">自动分配</span>
                <span class="pw">修改后自动询问 保存 / 取消</span>
                <span style="flex:1"></span>
                <button class="btn ghost" id="asgReset" type="button">全部设为自动</button>
              </div>
            </section>
          </div>
        </div>
      </section>` : ''}

      <!-- ==================== 采集源 ==================== -->
      <section class="sec" id="sec-src">
        ${!can ? '<div class="ro-banner">🔒 只读模式：您是 viewer 角色，采集源修改仅管理员可用</div>' : ''}
        <div class="box ${can ? '' : 'locked'}">
          <div class="sec-h"><h2>采集数据源（图像聚合抓取）</h2><span class="pw">保存后即时生效</span></div>
          <div class="chips" id="srcChips"></div>
          <div class="cb-hint" id="srcHint">google 常被反爬（可能 0 结果）；x 需 X_BEARER_TOKEN（环境变量）才生效；custom 需填写下方 URL</div>
          <div class="row">
            <div class="field"><label class="f">自定义热点 JSON URL（可选）</label><div id="topicsUrl" class="txtbox" contenteditable="true" role="textbox" data-placeholder="留空 = 内置 GitHub 热门" aria-label="热点 JSON URL"></div></div>
          </div>
          <div class="row" style="margin-top:10px">
            <div class="field"><label class="f">自定义热图 JSON URL（可选，供 custom 源）</label><div id="imagesUrl" class="txtbox" contenteditable="true" role="textbox" data-placeholder="如 https://example.com/images.json" aria-label="热图 JSON URL"></div></div>
          </div>
          <div class="mfoot">
            <span class="pw" style="margin-right:auto">修改后自动询问 保存 / 取消</span>
            <button class="btn ghost" id="srcReload" type="button">重新加载</button>
          </div>
        </div>
        <div class="box">
          <div class="sec-h">
            <h2>健康状态</h2>
            <div class="rh"><button class="btn ghost sm" id="healthRefresh" type="button">刷新</button></div>
          </div>
          <div class="src-health" id="srcHealth"></div>
        </div>
      </section>

      <!-- ==================== 账号与权限（仅 admin） ==================== -->
      ${can ? `<section class="sec" id="sec-users">
        <div class="box">
          <div class="sec-h">
            <h2>用户管理</h2>
            <div class="rh"><button class="btn" id="userAdd" type="button">+ 添加用户</button></div>
          </div>
          <div id="usersWrap"></div>
        </div>
        <div class="box">
          <div class="sec-h">
            <h2>在线会话</h2>
            <div class="rh"><button class="btn ghost sm" id="sessRefresh" type="button">刷新</button></div>
          </div>
          <div class="cb-hint" style="margin-bottom:8px">会话存于内存：服务重启后全部失效需重新登录；删除账号会立即登出其全部会话</div>
          <div id="sessWrap"></div>
        </div>
        <div class="box">
          <div class="sec-h">
            <h2>安全审计</h2>
            <div class="rh"><button class="btn ghost sm" id="auditRefresh" type="button">刷新</button></div>
          </div>
          <div id="auditWrap" class="audit"></div>
        </div>
      </section>` : ''}
    </div>
  </div>
</div>

<!-- 灵感详情弹窗 -->
<div class="overlay" id="dmodal">
  <div class="modal wide">
    <div class="mhead"><h2 id="dtitle">灵感详情</h2><button class="x" id="dclose" type="button" aria-label="关闭">✕</button></div>
    <div class="dmodal-meta" id="dmeta"></div>
    <div id="didea" style="display:none"></div>
    <img class="dcover" id="dcover" style="display:none" alt="封面">
    <div class="err" id="derr" style="display:none"></div>
    <div class="mono mono-pane" id="dprompt" style="display:none"></div>
    <div class="mfoot">
      <span class="grow"></span>
      <button class="btn ghost" id="dcopy" type="button" style="display:none">复制提示词</button>
      <button class="btn" id="dok" type="button">关闭</button>
    </div>
  </div>
</div>

<!-- 添加/编辑用户弹窗 -->
<div class="overlay" id="umodal">
  <div class="modal">
    <div class="mhead"><h2 id="utitle">添加用户</h2><button class="x" id="uclose" type="button" aria-label="关闭">✕</button></div>
    <div class="field">
      <label class="f">用户名</label>
      <div class="txtbox" id="uName" contenteditable="true" role="textbox" data-placeholder="2–32 位字母/数字/点/下划线/连字符" aria-label="用户名"></div>
    </div>
    <div class="field">
      <label class="f">角色</label>
      <div class="seg" id="uRoleSeg" role="radiogroup" aria-label="角色">
        <button class="seg-btn" type="button" role="radio" aria-checked="false" data-r="viewer">viewer · 只读</button>
        <button class="seg-btn on" type="button" role="radio" aria-checked="true" data-r="admin">admin · 全部权限</button>
      </div>
    </div>
    <div class="field">
      <label class="f" id="upwLabel">初始密码（至少 8 位）</label>
      <div class="secret">
        <div class="txtbox keyed" id="uPass" contenteditable="true" role="textbox" data-placeholder="••••••••" aria-label="密码"></div>
        <button class="seye" id="upwEye" type="button" aria-label="显示或隐藏密码" aria-pressed="false">👁</button>
      </div>
      <div class="cb-hint" id="upwHint"></div>
    </div>
    <div class="mfoot">
      <span class="grow"></span>
      <button class="btn ghost" id="uCancel" type="button">取消</button>
      <button class="btn" id="uSave" type="button">保存</button>
    </div>
  </div>
</div>

<!-- 修改自己的密码弹窗 -->
<div class="overlay" id="pwmodal">
  <div class="modal">
    <div class="mhead"><h2>修改密码</h2><button class="x" id="pwclose" type="button" aria-label="关闭">✕</button></div>
    <div class="field">
      <label class="f">当前密码</label>
      <div class="secret">
        <div class="txtbox keyed" id="pwCur" contenteditable="true" role="textbox" data-placeholder="••••••••" aria-label="当前密码"></div>
        <button class="seye" id="pwCurEye" type="button" aria-label="显示或隐藏密码" aria-pressed="false">👁</button>
      </div>
    </div>
    <div class="field">
      <label class="f">新密码（至少 8 位）</label>
      <div class="txtbox keyed" id="pwNew" contenteditable="true" role="textbox" data-placeholder="••••••••" aria-label="新密码"></div>
    </div>
    <div class="field">
      <label class="f">确认新密码</label>
      <div class="txtbox keyed" id="pwNew2" contenteditable="true" role="textbox" data-placeholder="••••••••" aria-label="确认新密码"></div>
    </div>
    <div class="mfoot">
      <span class="grow"></span>
      <button class="btn ghost" id="pwCancel" type="button">取消</button>
      <button class="btn" id="pwSave" type="button">更新密码</button>
    </div>
  </div>
</div>

<!-- 挑选模型弹窗（拉取后先挑选再添加） -->
<div class="overlay" id="mfetch">
  <div class="modal wide">
    <div class="mhead"><h2>选择要添加的模型</h2><button class="x" id="mfclose" type="button" aria-label="关闭">✕</button></div>
    <div class="mtool">
      <div class="txtbox tsearch" id="mfSearch" contenteditable="true" role="textbox" data-placeholder="筛选模型…" aria-label="筛选模型"></div>
      <button class="btn ghost sm" id="mfAll" type="button">全选</button>
      <button class="btn ghost sm" id="mfNone" type="button">清空</button>
    </div>
    <div class="cb-hint" id="mfCount" style="margin:0 0 8px"></div>
    <div id="mfList" class="mgrid"></div>
    <div class="mempty" id="mfEmpty" style="display:none"></div>
    <div class="mfoot">
      <span class="pw" id="mfHint">勾选需要加入列表的模型，确认后才会合并</span>
      <span class="grow"></span>
      <button class="btn ghost" id="mfCancel" type="button">取消</button>
      <button class="btn" id="mfAdd" type="button">添加所选</button>
    </div>
  </div>
</div>

<!-- override 提示词编辑弹窗（主题/风格库共用：图像灵感命中即直出，跳过图像提示词 LLM 请求） -->
<div class="overlay" id="ovrmodal">
  <div class="modal wide">
    <div class="mhead"><h2 id="ovrTitle">override 提示词</h2><button class="x" id="ovrClose" type="button" aria-label="关闭">✕</button></div>
    <div class="ovr-place">图像灵感选中该主题时直接以这段文案作为最终图像提示词并生图，<b>跳过「图像提示词」LLM 请求</b>（点子步骤仍照常生成）；主题未配置时回退到本次命中的风格 override。可引用占位符：<code>{theme}</code> <code>{style}</code> <code>{aspect}</code> <code>{title}</code> <code>{idea}</code>（取不到值的替换为空）；<b>模板未写 <code>{idea}</code> 时系统会把本次点子自动追加到末尾</b>，保证画面随灵感变化——显式写了 <code>{idea}</code> 则完全按模板。视频灵感不受影响。</div>
    <div class="field">
      <label class="f">自定义图像提示词模板（≤ 5000 字符；留空 = 不使用 override）</label>
      <div class="txtarea" id="ovrText" contenteditable="true" role="textbox" data-placeholder="例如：Cinematic wide shot of {idea}, drenched in {style} lighting…" aria-label="override 提示词模板"></div>
    </div>
    <div class="mfoot">
      <span class="pw" id="ovrMeta" style="margin-right:auto"></span>
      <button class="btn ghost" id="ovrClear" type="button" style="display:none">清除</button>
      <button class="btn ghost" id="ovrCancel" type="button">取消</button>
      <button class="btn" id="ovrSave" type="button">保存</button>
    </div>
  </div>
</div>

<script>
${utilClientJs}
const $=s=>document.querySelector(s);
const ROLE='${user.role}';
const CAN=ROLE==='admin';
const ME='${user.username}';

/* ===== 轻量 toast ===== */
const toastEl=document.createElement('div');toastEl.className='toast';document.body.appendChild(toastEl);
let toastTimer=0;
function toast(msg,ok){toastEl.className='toast show'+(ok===false?' bad':'');toastEl.textContent=msg;
  toastEl.style.bottom=(askEl&&askEl.classList.contains('show'))?'86px':'';
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2600);}

/* ===== 未保存更改：检测脏配置 → toast 询问 保存/取消（替代各区块的独立保存键） ===== */
const askEl=document.createElement('div');askEl.className='askbar';
askEl.innerHTML='<span class="askmsg" id="askMsg"></span><span style="flex:1"></span><button class="btn ghost sm" id="askNo" type="button">取消</button><button class="btn sm" id="askYes" type="button">保存</button>';
document.body.appendChild(askEl);
const askMsgEl=$('#askMsg'),askNoEl=$('#askNo'),askYesEl=$('#askYes');
let askKind=null,askBusy=false;
const ASK_MSG={gen:'生成设置有未保存的更改',src:'采集源配置有未保存的更改',llmProv:'提供商配置有未保存的更改',llmAsg:'模型分配有未保存的更改'};
function showAsk(k){askKind=k;askMsgEl.textContent=ASK_MSG[k]||'';askEl.classList.add('show');}
function hideAsk(){askKind=null;askEl.classList.remove('show');}
function dirtyKind(){
  if(cur==='gen'&&genDirty())return 'gen';
  if(cur==='src'&&srcDirty())return 'src';
  if(cur==='llm'){
    if(llmView==='provider'){
      if(llmIsNew){if(pIdV.get().trim()||pNameV.get().trim()||keyReal.trim()||pBaseUrlV.get().trim()||editing.models.length)return 'llmProv';}
      else if(hasChanges())return 'llmProv';
    }
    if(llmView==='assign'&&hasAssignChanges())return 'llmAsg';
  }
  return null;
}
function refreshAsk(){const k=dirtyKind();if(k)showAsk(k);else if(askKind)hideAsk();}
function askBusyUI(){askYesEl.disabled=askBusy;askNoEl.disabled=askBusy;askYesEl.textContent=askBusy?'保存中…':'保存';}
function guardAsk(){if(askKind){toast('请先保存或取消未保存的更改',false);return true;}return false;}
askYesEl.addEventListener('click',async()=>{
  if(!askKind||askBusy)return;
  askBusy=true;askBusyUI();let ok=false;
  try{
    if(askKind==='gen')ok=await saveGenAsk();
    else if(askKind==='src')ok=await saveSrcAsk();
    else if(askKind==='llmProv')ok=await saveLlmProvAsk();
    else if(askKind==='llmAsg')ok=await saveLlmAsgAsk();
  }catch(e){toast('保存失败：'+e.message,false);}
  finally{askBusy=false;askBusyUI();}
  if(ok)hideAsk();
});
askNoEl.addEventListener('click',()=>{
  if(!askKind||askBusy)return;
  if(askKind==='gen')applyGenBase();
  else if(askKind==='src')applySrcBase();
  else if(askKind==='llmProv'){if(llmIsNew)showLlmEmpty();else if(llmSelected)selectProvider(llmSelected);}
  else if(askKind==='llmAsg'){for(const k of ASG_KEYS)asgSelects[k].set(asgVal(savedAssignments[k]));renderAssignBar();}
  hideAsk();refreshAsk();
});

/* ===== 通用请求：401/403 统一跳登录，防止会话过期后界面假死 ===== */
async function jf(url,opts){
  const r=await fetch(url,opts);
  if(r.status===401){toast('登录已过期，请重新登录',false);setTimeout(()=>location.href='/admin/login',700);throw new Error('unauthorized');}
  if(r.status===403){toast('没有权限执行该操作',false);throw new Error('forbidden');}
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||('请求失败（HTTP '+r.status+')'));
  return d;
}

/* ===== 导航（区块切换 + 懒加载） ===== */
const NAV={overview:['总览','运行状态 / 统计与快捷操作'],
  insp:['灵感','记录浏览 / 复制与删除'],
  gen:['生成设置','主题库 · 生成/补图间隔 · 类型 / 来源'],
  llm:['LLM 配置','提供商与任务级模型分配'],
  src:['采集源','provider 白名单与健康状态'],
  users:['账号与权限','用户 · 会话 · 审计']};
let cur='overview';
function switchSec(id){
  if(guardAsk())return;
  cur=id;
  document.querySelectorAll('.anav .ai').forEach(b=>b.classList.toggle('on',b.dataset.sec===id));
  document.querySelectorAll('.sec').forEach(s=>s.classList.toggle('on',s.id==='sec-'+id));
  const t=NAV[id]||[id,''];
  $('#atitle').textContent=t[0];$('#asub').textContent=t[1];
  if(id==='overview')loadOverview();
  else if(id==='insp')loadInsp();
  else if(id==='gen')loadSettings();
  else if(id==='src'){loadSourceConfig();refreshHealth();}
  else if(id==='llm'){if(!llmInited){llmInited=true;showLlmEmpty();}reloadProviders();}
  else if(id==='users')loadUsersAll();
}
document.querySelector('.anav').addEventListener('click',e=>{
  const b=e.target.closest('.ai');
  if(b&&b.dataset.sec)switchSec(b.dataset.sec);
});
$('#uname').textContent=ME;

/* ===== 自定义组件（内容全部自绘，见 AGENTS.md UI 规范） ===== */
function makeTextField(el,opts={}){
  if(opts.placeholder!==undefined)el.dataset.placeholder=opts.placeholder;
  const refresh=()=>{
    el.classList.toggle('ph',!el.textContent.replace(/\\u00A0/g,' ').trim());
    if(opts.maxlength&&el.textContent.length>opts.maxlength)el.textContent=el.textContent.slice(0,opts.maxlength);
  };
  el.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key==='Escape')e.preventDefault();
    if(opts.digits&&e.key.length===1&&!/[0-9]/.test(e.key)&&!e.ctrlKey&&!e.metaKey)e.preventDefault();
  });
  el.addEventListener('paste',e=>{
    e.preventDefault();
    const t=((e.clipboardData||window.clipboardData).getData('text/plain')||'').trim();
    document.execCommand('insertText',false,t);
  });
  el.addEventListener('input',()=>{
    let t=el.textContent.replace(/\\u00A0/g,' ');
    if(opts.digits)t=t.replace(/[^0-9]/g,'');
    if(t!==el.textContent)el.textContent=t;
    refresh();
    opts.onInput&&opts.onInput();
  });
  const set=v=>{el.textContent=String(v??'');refresh();};
  const get=()=>el.textContent.replace(/\\u00A0/g,' ').trim();
  set(opts.initial??'');
  return {el,get,set};
}
function makeStepper(comp,opts={}){
  const {step=5,min=1,max=10080}=opts;
  const minus=comp.querySelector('[data-d="-5"]'),plus=comp.querySelector('[data-d="5"]');
  const valV=makeTextField(comp.querySelector('.step-val'),{digits:true,maxlength:5,initial:60});
  const val=valV.el;
  const clamp=n=>Math.max(min,Math.min(max,Math.round(n)));
  const read=()=>{const n=parseInt(valV.get(),10);return Number.isFinite(n)?clamp(n):60;};
  const set=n=>{valV.set(String(clamp(n)));};
  minus.addEventListener('click',()=>set(read()-step));
  plus.addEventListener('click',()=>set(read()+step));
  val.addEventListener('blur',()=>set(read()));
  val.addEventListener('keydown',e=>{if(e.key==='Enter'){set(read());val.blur();}});
  return {get:()=>read(),set};
}
function makeSwitch(sw){
  const paint=()=>{sw.classList.toggle('on',enabled);sw.setAttribute('aria-checked',String(enabled));};
  const toggle=()=>{enabled=!enabled;paint();};
  sw.addEventListener('click',toggle);
  sw.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();toggle();}});
  paint();
  return {get:()=>enabled,set:v=>{enabled=!!v;paint();}};
}
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

/* ===== 顶栏：修改密码 / 退出 ===== */
function eyeFor(el,eyeBtn){
  const b=eyeBtn;
  b.addEventListener('click',()=>{
    const masked=el.classList.toggle('keyed');
    b.textContent=masked?'👁':'🙈';
  });
}
$('#logoutBtn').addEventListener('click',async()=>{
  try{await fetch('/api/auth/logout',{method:'POST'});}catch(e){}
  location.href='/';
});
$('#pwBtn').addEventListener('click',()=>{
  pwCurV.set('');pwNewV.set('');pwNew2V.set('');
  $('#pwmodal').classList.add('show');
});
const pwCurV=makeTextField($('#pwCur'),{placeholder:'••••••••'});
const pwNewV=makeTextField($('#pwNew'),{placeholder:'••••••••'});
const pwNew2V=makeTextField($('#pwNew2'),{placeholder:'••••••••'});
eyeFor($('#pwCur'),$('#pwCurEye'));
$('#pwSave').addEventListener('click',async()=>{
  const currentPassword=pwCurV.get(),nextPassword=pwNewV.get();
  if(nextPassword.length<8){toast('新密码至少 8 位',false);return;}
  if(nextPassword!==pwNew2V.get()){toast('两次输入的新密码不一致',false);return;}
  try{
    await jf('/api/auth/change-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({currentPassword,nextPassword})});
    toast('密码已更新');
    $('#pwmodal').classList.remove('show');
  }catch(e){toast(e.message,false);}
});
function closeModal(id){$(id).classList.remove('show');}
$('#pwclose').onclick=()=>closeModal('#pwmodal');
$('#pwCancel').onclick=()=>closeModal('#pwmodal');
['#pwmodal','#dmodal','#umodal','#mfetch','#ovrmodal'].forEach(id=>{
  $(id).addEventListener('click',e=>{if(e.target===$(id))closeModal(id);});
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(SELECTS.some(s=>s.isOpen()))return; // Esc 只关下拉，不关面板
  ['#pwmodal','#dmodal','#umodal','#mfetch','#ovrmodal'].forEach(id=>{if($(id).classList.contains('show'))closeModal(id);});
});

/* ===== 总览 ===== */
const KIND={image:{n:'图像'},video:{n:'视频'}};
const SRC={hot_topic:'热点',hot_image:'热图',original_idea:'原创点子'};
const ST={queued:'排队中',running:'生成中',ready:'就绪',failed:'失败'};
let inspAll=[]; // 全库统计用（stats 接口）
function statTile(k,v,warn){
  return '<div class="stat" data-jump="insp"><div class="v'+(warn?' warn':'')+'">'+v+'</div><div class="k">'+k+'</div></div>';
}
let lastHealth=null,lastSrcHealth=[];
async function loadOverview(){
  try{
    const [h,stats]=await Promise.all([
      jf('/api/health').catch(()=>null),
      jf('/api/inspirations/stats').catch(()=>({total:0,image:0,video:0,queued:0,running:0,ready:0,failed:0})),
    ]);
    lastHealth=h;
    const st=stats;
    $('#ovStats').innerHTML=
      statTile('灵感总数',st.total)+
      statTile('图像',st.image)+
      statTile('视频',st.video)+
      statTile('失败',st.failed,st.failed>0);
    if(h){
      $('#ovSched').innerHTML=h.scheduler.enabled?'<b style="color:var(--ok)">开启</b> · 间隔 '+h.scheduler.intervalMinutes+' 分钟':'<b style="color:var(--bad)">已关闭</b>';
      $('#ovNext').textContent=h.scheduler.nextRunAt?fmt(h.scheduler.nextRunAt):'—';
      const per=h.llmTasks||{};
      const T={idea:['点子',per.idea],image:['图像',per.image],video:['视频',per.video],imagegen:['生图',per.imagegen]};
      const any=Object.keys(T).some(k=>T[k][1]);
      const tasksEl=$('#ovTasks');
      tasksEl.innerHTML=any?Object.keys(T).map(k=>{
        const t=T[k][1];
        return '<div class="trow"><span class="tk">'+T[k][0]+'</span><span class="tm">'+esc(t?(t.label+' · '+t.model):'（自动回退或未分配）')+'</span></div>';
      }).join(''):'<div class="trow"><span class="tk">提示</span><span class="tm" style="color:var(--faint)">LLM 未配置 — 在「LLM 配置」添加提供商后自动调度才会运行</span></div>';
      $('#ovLlmCard').style.display='';
    }
    const sh=await jf('/api/source-health').catch(()=>null);
    if(sh)lastSrcHealth=sh.providers||[];
    renderOvHealth();
  }catch(e){}
}
function renderOvHealth(){
  const prov=lastSrcHealth;
  const el=$('#ovHealth');
  if(!prov||!prov.length){el.innerHTML='<span class="hchip">暂无数据</span>';return;}
  el.innerHTML=prov.filter(p=>p.enabled).map(p=>{
    const bad=p.coolingDown||p.consecutiveFailures>0;
    const st=bad?'bad':(p.lastSuccessAt?'ok':'idle');
    return '<span class="hchip '+st+'" title="'+esc(p.lastError||'')+'"><i></i>'+esc(p.label)+
      (bad?'<span class="e">⚠</span>':'')+'</span>';
  }).join('');
}
$('#ovStats').addEventListener('click',e=>{const s=e.target.closest('.stat');if(s)switchSec('insp');});
document.querySelector('#sec-overview').addEventListener('click',e=>{
  const c=e.target.closest('.ocard');
  if(c&&!e.target.closest('button')){const j=c.dataset.jump;if(j&&NAV[j]&&document.getElementById('sec-'+j))switchSec(j);}
});
const ovGenEl=$('#ovGen');
if(ovGenEl)ovGenEl.addEventListener('click',async()=>{
  const b=$('#ovGen');b.disabled=true;b.textContent='生成中…';
  try{
    const r=await fetch('/api/generate',{method:'POST'});
    const d=await r.json().catch(()=>({}));
    if(r.status===409){toast(d.error||'生成进行中或自动生成已关闭',false);}
    else{toast('已提交生成');setTimeout(()=>{loadOverview();},1500);}
  }catch(e){toast('请求失败：网络错误',false);}
  finally{b.disabled=false;b.textContent='立即生成一条';}
});
/* ===== 灵感管理 ===== */
let inspKind='all',inspSt='all',inspSrc='all';
const inspFilterEl=$('#inspFilter');
function renderInspFilter(){
  const mk=(arr,cur,fn)=>{const base=[['all','全部']].concat(arr);
    return base.map(x=>'<span class="chip'+(cur===x[0]?' on':'')+'" data-v="'+x[0]+'" data-fn="'+fn+'">'+esc(x[1])+'</span>').join('');};
  inspFilterEl.innerHTML=
    mk([['image','图像'],['video','视频']],inspKind,'k')+
    mk([['queued','排队'],['running','生成中'],['ready','就绪'],['failed','失败']],inspSt,'s')+
    mk([['hot_topic','热点'],['hot_image','热图'],['original_idea','原创点子']],inspSrc,'c');
}
inspFilterEl.addEventListener('click',e=>{
  const ch=e.target.closest('.chip');
  if(!ch)return;
  const fn=ch.dataset.fn,v=ch.dataset.v;
  if(fn==='k')inspKind=v;
  else if(fn==='s')inspSt=v;
  else inspSrc=v;
  renderInspFilter();renderInspRows();
});
let inspItems=[];
async function loadInsp(){
  try{inspItems=await jf('/api/inspirations?limit=100');}catch(e){return;}
  renderInspRows();
}
function filteredInsp(){
  return inspItems.filter(i=>
    (inspKind==='all'||i.kind===inspKind)&&
    (inspSt==='all'||i.status===inspSt)&&
    (inspSrc==='all'||i.source===inspSrc));
}
function renderInspRows(){
  const list=filteredInsp();
  const el=$('#inspWrap');
  if(!list.length){el.innerHTML='<div class="empty" style="padding:30px">没有符合条件的记录</div>';return;}
  el.innerHTML='<table class="tbl"><thead><tr><th>时间</th><th>类型</th><th>来源</th><th>主题 / 风格</th><th>点子</th><th>状态</th><th class="act">操作</th></tr></thead><tbody>'+
  list.map(i=>
    '<tr data-id="'+esc(i.id)+'">'+
    '<td class="num">'+fmt(i.createdAt)+'</td>'+
    '<td>'+esc(KIND[i.kind]?KIND[i.kind].n:i.kind)+'</td>'+
    '<td>'+esc(SRC[i.source]||i.source)+'</td>'+
    '<td><span class="tag acc">'+esc(i.theme||'')+'</span>'+(i.style?'<span class="tag">'+esc(i.style)+'</span>':'')+'</td>'+
    '<td class="tt" title="'+esc(i.idea||'')+'">'+esc(i.title||i.idea||'—')+'</td>'+
    '<td><span class="st-dot '+esc(i.status)+'"><i></i>'+esc(ST[i.status]||i.status)+'</span></td>'+
    '<td class="act"><button class="btn sm ghost" data-a="view">查看</button>'+
    (i.prompt?'<button class="btn sm ghost" data-a="copy">复制</button>':'')+
    (CAN?'<button class="btn sm ghost" data-a="del" style="color:#fca5a5">删除</button>':'')+
    '</td></tr>').join('')+
  '</tbody></table>';
}
$('#inspWrap').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  const tr=b.closest('tr');if(!tr)return;
  const item=inspItems.find(x=>x.id===tr.dataset.id);if(!item)return;
  const a=b.dataset.a;
  if(a==='view')openDetail(item);
  else if(a==='copy'){copyText(item.prompt,b);}
  else if(a==='del'){
    if(!confirm('确认删除该条灵感？封面图会一并回收。'))return;
    try{
      await jf('/api/inspirations/'+encodeURIComponent(item.id),{method:'DELETE'});
      toast('已删除');
      inspItems=inspItems.filter(x=>x.id!==item.id);
      renderInspRows();loadOverview();
    }catch(e){toast(e.message,false);}
  }
});
function copyText(text,btn){
  const done=()=>{if(btn){btn.textContent='已复制';setTimeout(()=>btn.textContent='复制',1200);}};
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();done();};
  if(navigator.clipboard){navigator.clipboard.writeText(text).then(done).catch(fallback);}else{fallback();}
}
$('#inspRefresh').addEventListener('click',()=>{loadInsp();loadOverview();});
const inspClearEl=$('#inspClear');
if(inspClearEl)inspClearEl.addEventListener('click',async()=>{
  if(!confirm('确认清空全部灵感历史？此操作不可恢复。'))return;
  try{await jf('/api/inspirations',{method:'DELETE'});toast('已清空历史');loadInsp();loadOverview();}catch(e){toast(e.message,false);}
});
$('#dok').addEventListener('click',()=>closeModal('#dmodal'));
$('#dclose').addEventListener('click',()=>closeModal('#dmodal'));

/* ===== 灵感详情弹窗（含 <Picture N> 悬停浮层） ===== */
let curDetail=null;
function promptHtml(i){
  const text=esc(i.prompt);
  if(!i.pictures||!i.pictures.length)return text;
  return text.replace(/&lt;Picture *([0-9]+) *&gt;/gi,(all,n)=>{
    const p=(i.pictures||[]).find(x=>x.index===parseInt(n,10));
    if(!p)return all;
    return '<span class="pcref" tabindex="0" data-idx="'+esc(n)+'">Picture '+esc(n)+'</span>';
  });
}
function openDetail(item){
  curDetail=item;
  $('#dtitle').textContent=(KIND[item.kind]?KIND[item.kind].n:item.kind)+'灵感 · '+fmt(item.createdAt);
  const meta=['<span class="tag acc">'+esc(item.theme||'')+'</span>',
    (item.style?'<span class="tag">'+esc(item.style)+'</span>':''),
    (item.aspect?'<span class="tag">'+esc(item.aspect)+'</span>':''),
    '<span class="tag">'+esc(SRC[item.source]||item.source)+'</span>',
    '<span class="tag">'+esc(ST[item.status]||item.status)+'</span>'].join('');
  $('#dmeta').innerHTML=meta;
  const didea=$('#didea');
  if(item.title||item.idea){didea.style.display='';didea.innerHTML='<div style="font-weight:600;margin-bottom:2px">'+esc(item.title||'')+'</div><div class="desc">'+esc(item.idea||'')+'</div>';}
  else{didea.style.display='none';didea.innerHTML='';}
  const cov=$('#dcover');
  if(item.kind==='image'&&item.cover&&item.cover.file){cov.style.display='block';cov.src='/api/images/'+esc(item.cover.file);}
  else{cov.style.display='none';cov.src='';}
  const derr=$('#derr');
  const errTxt=[item.error,item.coverError].filter(Boolean).join(' · ');
  derr.style.display=errTxt?'':'none';
  derr.textContent='✕ '+errTxt;
  const dp=$('#dprompt');
  if(item.prompt){dp.style.display='';dp.innerHTML=promptHtml(item);}
  else{dp.style.display='none';dp.innerHTML='';}
  $('#dcopy').style.display=item.prompt?'':'none';
  $('#dmodal').classList.add('show');
}
$('#dcopy').addEventListener('click',()=>{if(curDetail&&curDetail.prompt)copyText(curDetail.prompt,$('#dcopy'));});

/* ===== <Picture N> 悬停浮层（详情弹窗内容区） ===== */
const ptip=document.createElement('div');ptip.className='ptip';document.body.appendChild(ptip);
function hideTip(){ptip.style.display='none';}
function tipFor(r){
  const item=curDetail;
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
const dpm=$('#dprompt');
dpm.addEventListener('mouseover',e=>{const r=e.target.closest&&e.target.closest('.pcref');if(r)tipFor(r);});
dpm.addEventListener('mouseout',e=>{const r=e.target.closest&&e.target.closest('.pcref');
  if(r){const rt=e.relatedTarget;if(!(rt&&rt.closest&&(rt.closest('.pcref')===r||rt.closest('.ptip'))))hideTip();}});
window.addEventListener('scroll',hideTip,true);

/* ===== 生成设置（主题/风格库 + 间隔 + 开关 + 类型/来源） ===== */
let enabled=true;
/* 标签编辑器工厂：○/● 勾选参与随机、contenteditable 改名、✎ override 提示词、✕ 删除、回车添加（大小写不敏感去重）。
 * minActive=激活子集下限：主题 1（至少 1 个参与随机）；风格 0（允许全部取消 = 本次生成不注入风格行）。
 * override 映射（键=库内条目名）随条目维护：改名时迁移到新名，删除时同步清除；cfg.onEditOvr(name,editor) 打开编辑弹窗。 */
function makeTagEditor(cfg){
  const list=cfg.list,hintEl=cfg.hint;
  let items=[],active=[],overrides={},api;
  const isActive=v=>active.some(x=>x.toLowerCase()===v.toLowerCase());
  const hasOvr=v=>Object.prototype.hasOwnProperty.call(overrides,v);
  function flash(msg){hintEl.textContent=msg;setTimeout(()=>{hintEl.textContent=cfg.hintBase;},1800);}
  function render(){
    list.innerHTML=items.map((t,i)=>
      '<span class="tchip'+(isActive(t)?' on':'')+'" data-i="'+i+'" role="listitem">'+
      '<span class="tdot" role="checkbox" aria-checked="'+(isActive(t)?'true':'false')+'" tabindex="0" aria-label="勾选参与随机：'+esc(t)+'">'+(isActive(t)?'●':'○')+'</span>'+
      '<span class="tname">'+esc(t)+'</span>'+
      '<button class="tovr'+(hasOvr(t)?' on':'')+'" type="button" aria-label="编辑'+cfg.noun+'的 override 提示词：'+esc(t)+'" title="'+(hasOvr(t)?'已设置 override 提示词 · 点击编辑':'设置 override 提示词')+'">✎</button>'+
      '<button class="tdel" type="button" aria-label="删除'+cfg.noun+' '+esc(t)+'"'+(items.length<2?' disabled':'')+'">✕</button></span>'
    ).join('');
  }
  function commitEdit(nm,orig){
    nm.removeAttribute('contenteditable');
    const v=nm.textContent.replace(/\\u00A0/g,' ').trim().slice(0,100);
    if(!v||(v.toLowerCase()!==orig.toLowerCase()&&items.some(t=>t.toLowerCase()===v.toLowerCase()))){nm.textContent=orig;return;}
    const i=+nm.parentElement.dataset.i;
    if(!Number.isFinite(i)||items[i]===undefined)return;
    const wasActive=isActive(items[i]);
    const wasOvr=hasOvr(orig);
    items[i]=v;
    if(wasOvr){overrides[v]=overrides[orig];delete overrides[orig];}
    render();
    if(wasActive){
      const ai=active.findIndex(x=>x.toLowerCase()===orig.toLowerCase());
      if(ai>-1)active[ai]=v;
    }
  }
  list.addEventListener('click',e=>{
    const dot=e.target.closest('.tdot');
    if(dot){
      const i=+dot.closest('.tchip').dataset.i;
      if(!Number.isFinite(i)||items[i]===undefined)return;
      const v=items[i];
      if(isActive(v)){
        if(active.length<=cfg.minActive){flash('至少需要 '+cfg.minActive+' 个参与随机的'+cfg.noun);return;}
        active=active.filter(x=>x.toLowerCase()!==v.toLowerCase());
      }else{
        active.push(v);
      }
      render();
      return;
    }
    const ov=e.target.closest('.tovr');
    if(ov){
      const i=+ov.closest('.tchip').dataset.i;
      if(Number.isFinite(i)&&api&&items[i]!==undefined&&cfg.onEditOvr)cfg.onEditOvr(items[i],api);
      return;
    }
    const del=e.target.closest('.tdel');
    if(del&&!del.disabled){
      const i=+del.closest('.tchip').dataset.i;
      if(items.length>1){
        const v=items[i];
        items.splice(i,1);
        active=active.filter(x=>x.toLowerCase()!==v.toLowerCase());
        delete overrides[v];
        if(cfg.minActive>0&&!active.length)active=[...items];
        render();
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
  list.addEventListener('keydown',e=>{
    const nm=e.target.closest('.tname');
    if(nm&&nm.isContentEditable){
      if(e.key==='Enter'){e.preventDefault();nm.blur();}
      else if(e.key==='Escape'){nm.textContent=nm.dataset.orig??'';nm.removeAttribute('contenteditable');}
      return;
    }
    const dot=e.target.closest('.tdot');
    if(dot&&(e.key===' '||e.key==='Enter')){e.preventDefault();dot.click();}
  });
  list.addEventListener('blur',e=>{
    const nm=e.target.closest('.tname');
    if(!nm)return;
    commitEdit(nm,nm.dataset.orig??'');
  },{capture:true});
  function add(){
    const v=cfg.input.get();
    if(!v)return;
    if(items.some(t=>t.toLowerCase()===v.toLowerCase())){flash(cfg.noun+'已存在：'+v);cfg.input.set('');return;}
    items.push(v.slice(0,40));
    // 新条目默认激活；但风格库在「全部取消（不指定风格）」状态下添加时不自动激活，保持用户选择
    if(cfg.minActive>0||active.length)active.push(v.slice(0,40));
    else flash('已加入风格库，点击 ○ 勾选参与随机');
    cfg.input.set('');render();
  }
  cfg.input.el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add();}});
  api={
    get noun(){return cfg.noun;},
    get items(){return items.slice();},
    get active(){return active.slice();},
    get overrides(){return {...overrides};},
    set(it,ac,ov){items=it.slice();active=ac.slice();overrides=(ov&&typeof ov==='object')?{...ov}:{};render();},
    setOvr(name,text){const t=String(text||'').trim().slice(0,5000);if(t)overrides[name]=t;else delete overrides[name];render();},
  };
  return api;
}
const themeNew=makeTextField($('#themeNew'),{placeholder:'输入新主题，回车添加…',maxlength:40});
const styleNew=makeTextField($('#styleNew'),{placeholder:'输入新风格，回车添加…',maxlength:40});
const THEME_HINT='点击 ○ 勾选参与随机 · 点击主题名改名 · ✎ 编辑 override 提示词 · ✕ 删除 · 回车添加';
const STYLE_HINT='点击 ○ 勾选参与随机 · 可全部取消 = 不指定风格 · 点击风格名改名 · ✎ 编辑 override 提示词 · ✕ 删除 · 回车添加';
const themeEd=makeTagEditor({list:$('#themeList'),input:themeNew,hint:$('#themeHint'),hintBase:THEME_HINT,noun:'主题',minActive:1,onEditOvr:(name,ed)=>openOvr(ed,name)});
const styleEd=makeTagEditor({list:$('#styleList'),input:styleNew,hint:$('#styleHint'),hintBase:STYLE_HINT,noun:'风格',minActive:0,onEditOvr:(name,ed)=>openOvr(ed,name)});

const intervalStepper=makeStepper($('#intervalStepper'));
const coverRetryStepper=makeStepper($('#coverRetryStepper'));
const coverDelayStepper=makeStepper($('#coverDelayStepper'),{step:10,min:0,max:3600});
const enabledSw=makeSwitch($('#enabledSw'));
let kinds=['image','video'],sources=['hot_topic','hot_image','original_idea'];
function renderKindsChips(){document.querySelectorAll('#sec-gen .chip[data-g]').forEach(ch=>{
  const g=ch.dataset.g,arr=g==='kinds'?kinds:sources;
  ch.classList.toggle('on',arr.includes(ch.dataset.v));});}
$('#sec-gen').addEventListener('click',e=>{
  const ch=e.target.closest('.chip');
  if(!ch||!ch.dataset.g)return;
  const g=ch.dataset.g,v=ch.dataset.v,arr=g==='kinds'?kinds:sources;
  const next=arr.includes(v)?arr.filter(x=>x!==v):[...arr,v];
  if(g==='kinds'){kinds=next.length?next:['image'];}else{sources=next.length?next:['original_idea'];}
  renderKindsChips();});
let genBase=null;
function arrEq(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function setEq(a,b){if(a.length!==b.length)return false;
  const n=x=>JSON.stringify(x.map(v=>String(v).toLowerCase()).sort());
  return n(a)===n(b);}
function ovrEq(a,b){const ka=Object.keys(a),kb=Object.keys(b);if(ka.length!==kb.length)return false;return ka.every(k=>a[k]===b[k]);}
function captureGenBase(){genBase={interval:intervalStepper.get(),coverRetry:coverRetryStepper.get(),coverDelay:coverDelayStepper.get(),enabled:enabledSw.get(),themes:themeEd.items,activeThemes:themeEd.active,styles:styleEd.items,activeStyles:styleEd.active,themeOverrides:themeEd.overrides,styleOverrides:styleEd.overrides,kinds:kinds.slice(),sources:sources.slice()};}
function genDirty(){
  if(!genBase)return false;
  return genBase.interval!==intervalStepper.get()||genBase.coverRetry!==coverRetryStepper.get()||genBase.coverDelay!==coverDelayStepper.get()||genBase.enabled!==enabledSw.get()||
    !arrEq(genBase.themes,themeEd.items)||!setEq(genBase.activeThemes,themeEd.active)||
    !arrEq(genBase.styles,styleEd.items)||!setEq(genBase.activeStyles,styleEd.active)||
    !ovrEq(genBase.themeOverrides,themeEd.overrides)||!ovrEq(genBase.styleOverrides,styleEd.overrides)||
    !setEq(genBase.kinds,kinds)||!setEq(genBase.sources,sources);
}
function applyGenBase(){
  if(!genBase)return;
  intervalStepper.set(genBase.interval);coverRetryStepper.set(genBase.coverRetry);coverDelayStepper.set(genBase.coverDelay);enabledSw.set(genBase.enabled);
  themeEd.set(genBase.themes,genBase.activeThemes,genBase.themeOverrides);
  styleEd.set(genBase.styles,genBase.activeStyles,genBase.styleOverrides);
  kinds=genBase.kinds.slice();sources=genBase.sources.slice();
  renderKindsChips();
}
async function saveGenAsk(){
  try{
    await jf('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify({intervalMinutes:intervalStepper.get(),coverRetryIntervalMinutes:coverRetryStepper.get(),coverRetryDelaySeconds:coverDelayStepper.get(),enabled:enabledSw.get(),themes:themeEd.items,activeThemes:themeEd.active,styles:styleEd.items,activeStyles:styleEd.active,themeOverrides:themeEd.overrides,styleOverrides:styleEd.overrides,kinds,sources})});
    toast('已保存设置');
    captureGenBase();refreshAsk();
    return true;
  }catch(e){toast('保存失败：'+e.message,false);return false;}
}
async function loadSettings(){
  try{
    const s=await jf('/api/settings');
    const th=s.themes&&s.themes.length?s.themes.slice():['general'];
    let thA=(s.activeThemes&&s.activeThemes.length)?s.activeThemes.filter(t=>th.includes(t)):[...th];
    if(!thA.length)thA=[...th];
    const ovTh=(s.themeOverrides&&typeof s.themeOverrides==='object')?Object.fromEntries(Object.entries(s.themeOverrides).filter(([k])=>th.includes(k))):{};
    themeEd.set(th,thA,ovTh);
    const st=(s.styles&&s.styles.length)?s.styles.slice():${JSON.stringify(DEFAULT_STYLES)};
    // activeStyles 字段缺失（旧版数据）→ 全激活；显式空数组 → 保持空（= 不指定风格）
    const stA=Array.isArray(s.activeStyles)?s.activeStyles.filter(t=>st.includes(t)):[...st];
    const ovSt=(s.styleOverrides&&typeof s.styleOverrides==='object')?Object.fromEntries(Object.entries(s.styleOverrides).filter(([k])=>st.includes(k))):{};
    styleEd.set(st,stA,ovSt);
    intervalStepper.set(s.intervalMinutes);coverRetryStepper.set(s.coverRetryIntervalMinutes||15);coverDelayStepper.set(s.coverRetryDelaySeconds??30);enabledSw.set(s.enabled);
    kinds=s.kinds.slice();sources=s.sources.slice();
    renderKindsChips();
    captureGenBase();refreshAsk();
  }catch(e){}
}
$('#genReload').addEventListener('click',()=>{if(guardAsk())return;loadSettings();toast('已重新加载当前设置');});
['click','input','keydown','focusout'].forEach(ev=>$('#sec-gen').addEventListener(ev,refreshAsk));

/* ===== 主题/风格 override 提示词编辑（图像灵感命中即直出：跳过「图像提示词」LLM 请求，模板渲染后直接生图） ===== */
function makeArea(el){
  const NBSP=String.fromCharCode(160);
  el.addEventListener('paste',e=>{
    e.preventDefault();
    const t=(((e.clipboardData||window.clipboardData).getData('text/plain')||'').split(NBSP).join(' '));
    document.execCommand('insertText',false,t);
  });
  el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();el.blur();}});
  const val=()=>{const t=el.innerText!=null?el.innerText:el.textContent;return String(t||'').split(NBSP).join(' ');};
  const set=v=>{el.textContent=String(v??'');};
  return {el,get:()=>val().trim(),set};
}
const ovrArea=makeArea($('#ovrText'));
let ovrEd=null,ovrName='';
function openOvr(ed,name){
  ovrEd=ed;ovrName=name;
  $('#ovrTitle').textContent=ed.noun+' override 提示词';
  const cur=ed.overrides[name]||'';
  ovrArea.set(cur);
  $('#ovrMeta').textContent=cur?'已设置 · 条目：'+name:'条目：'+name+'（未设置）';
  $('#ovrClear').style.display=cur?'':'none';
  $('#ovrmodal').classList.add('show');
  setTimeout(()=>ovrArea.el.focus(),50);
}
function closeOvr(){ovrEd=null;ovrName='';ovrArea.set('');$('#ovrmodal').classList.remove('show');}
$('#ovrSave').addEventListener('click',()=>{
  if(!ovrEd)return;
  let v=ovrArea.get();
  if(v.length>5000){toast('提示词过长，已截断为 5000 字符',false);v=v.slice(0,5000);}
  const nm=ovrName;
  ovrEd.setOvr(nm,v);
  toast(v?('已为「'+nm+'」设置 override 提示词'):('已清除「'+nm+'」的 override 提示词'));
  closeOvr();refreshAsk();
});
$('#ovrClear').addEventListener('click',()=>{ovrArea.set('');$('#ovrClear').style.display='none';ovrArea.el.focus();});
$('#ovrCancel').addEventListener('click',closeOvr);
$('#ovrClose').addEventListener('click',closeOvr);

/* ===== 采集源（provider 白名单 + 自定义 URL + 健康） ===== */
const SRC_PROVIDERS=[
  {id:'wikimedia',n:'Wikimedia'},{id:'bing',n:'Bing'},{id:'openverse',n:'Openverse'},
  {id:'danbooru',n:'Danbooru'},{id:'rule34',n:'Rule34'},
  {id:'google',n:'Google'},{id:'custom',n:'自定义JSON'},{id:'x',n:'X/Twitter'},
];
let scrapeProviders=[];
const topicsUrlV=makeTextField($('#topicsUrl'),{placeholder:'留空 = 内置 GitHub 热门'});
const imagesUrlV=makeTextField($('#imagesUrl'),{placeholder:'如 https://example.com/images.json'});
$('#srcChips').innerHTML=SRC_PROVIDERS.map(p=>'<span class="chip" data-p="'+p.id+'">'+esc(p.n)+'</span>').join('');
function renderSrcChips(){document.querySelectorAll('#srcChips .chip').forEach(ch=>{
  ch.classList.toggle('on',scrapeProviders.includes(ch.dataset.p));});}
$('#srcChips').addEventListener('click',e=>{
  const ch=e.target.closest('.chip');if(!ch||!ch.dataset.p)return;
  const v=ch.dataset.p;
  scrapeProviders=scrapeProviders.includes(v)?scrapeProviders.filter(x=>x!==v):[...scrapeProviders,v];
  if(!scrapeProviders.length)scrapeProviders=['wikimedia'];
  renderSrcChips();});
let srcBase=null;
function captureSrcBase(){srcBase={providers:scrapeProviders.slice(),topics:topicsUrlV.get(),images:imagesUrlV.get()};}
function srcDirty(){
  if(!srcBase)return false;
  return !setEq(srcBase.providers,scrapeProviders)||srcBase.topics!==topicsUrlV.get()||srcBase.images!==imagesUrlV.get();
}
function applySrcBase(){
  if(!srcBase)return;
  scrapeProviders=srcBase.providers.slice();
  topicsUrlV.set(srcBase.topics);imagesUrlV.set(srcBase.images);
  renderSrcChips();
}
async function saveSrcAsk(){
  try{
    await jf('/api/source-config',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify({providers:scrapeProviders,hotTopicsUrl:topicsUrlV.get()||undefined,hotImagesUrl:imagesUrlV.get()||undefined})});
    toast('已保存采集源配置');
    captureSrcBase();refreshAsk();
    return true;
  }catch(e){toast('保存失败：'+e.message,false);return false;}
}
async function loadSourceConfig(){
  try{
    const s=await jf('/api/source-config');
    scrapeProviders=s.providers.length?s.providers.slice():['wikimedia'];
    topicsUrlV.set(s.hotTopicsUrl||'');imagesUrlV.set(s.hotImagesUrl||'');
    renderSrcChips();
    captureSrcBase();refreshAsk();
  }catch(e){}
}
$('#srcReload').addEventListener('click',()=>{if(guardAsk())return;loadSourceConfig();toast('已重新加载当前配置');});
['click','input','keydown','focusout'].forEach(ev=>$('#sec-src').addEventListener(ev,refreshAsk));
function renderSrcHealth(){
  const el=$('#srcHealth');
  if(!lastSrcHealth||!lastSrcHealth.length){el.innerHTML='<div class="hrow"><span class="hstat">（暂无抓取记录）</span></div>';return;}
  el.innerHTML=lastSrcHealth.map(p=>{
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
    stat+=' · '+(p.enabled?'已启用':'已停用');
    const err=bad&&p.lastError?'<span class="herr" title="'+esc(p.lastError)+'">'+esc(p.lastError.length>70?p.lastError.slice(0,70)+'…':p.lastError)+'</span>':'';
    return '<div class="hrow"><span class="hdot '+dot+'"></span><span class="hname">'+esc(p.label)+'</span><span class="hstat">'+esc(stat)+'</span>'+err+'</div>';
  }).join('');
}
async function refreshHealth(){
  try{
    const sh=await jf('/api/source-health');
    lastSrcHealth=sh.providers||[];
    renderSrcHealth();renderOvHealth();
  }catch(e){}
}
$('#healthRefresh').addEventListener('click',refreshHealth);

/* ===== LLM 配置面板（master-detail，仅 admin） ===== */
${can ? `let llmProviders=[],llmSelected=null,llmIsNew=false,llmSaving=false,llmFetching=false;
let llmView='empty';
let llmInited=false;
const ASG_KEYS=['idea','image','video','imagegen'];
let savedAssignments={idea:null,image:null,video:null,imagegen:null};
let asgSaving=false;
let editing={kind:'openai',models:[]};
const KINDN={openai:'OpenAI',anthropic:'Anthropic',gemini:'Gemini',openai_compat:'OpenAI 兼容'};
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function isMaskedKey(k){k=String(k||'');return k.indexOf('***')>=0||(k.length>0&&k.split('').every(c=>c==='*'));}
const pIdV=makeTextField($('#pId'),{placeholder:'例如：my-openai',maxlength:64,onInput:renderBar});
const pNameV=makeTextField($('#pName'),{placeholder:'例如：GPT-4o',maxlength:60,onInput:renderBar});
const pBaseUrlV=makeTextField($('#pBaseUrl'),{placeholder:'https://api.openai.com/v1',onInput:renderBar});
const modelNewV=makeTextField($('#modelNew'),{placeholder:'手动添加模型 ID，回车添加…',maxlength:200});
const MODEL_TOOLS_MIN=12; // 模型数超过该值才显示筛选工具行
let modelQ='';
const modelSearchV=makeTextField($('#modelSearch'),{placeholder:'筛选模型…',onInput:()=>{modelQ=modelSearchV.get();renderModels();}});
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
  refreshAsk();
}
function paintKind(k){
  document.querySelectorAll('#kindSeg .seg-btn').forEach(b=>{
    const on=b.dataset.k===k;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));});
  $('#baseUrlWrap').style.display=k==='openai_compat'?'':'none';
}
function setKind(k){
  if(editing.kind==='openai_compat'&&k!=='openai_compat')pBaseUrlV.set('');
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
  const assigned=ASG_KEYS.filter(k=>savedAssignments[k]).length;
  const badge=$('#asgBadge');
  badge.style.display=assigned?'':'none';
  badge.textContent=String(assigned);
}
$('#providerList').addEventListener('click',e=>{
  const item=e.target.closest('.pitem');if(!item)return;
  if(e.target.closest('.pdel')){e.stopPropagation();delProvider(item.dataset.id);return;}
  if(guardAsk())return;
  selectProvider(item.dataset.id);
});
$('#providerList').addEventListener('keydown',e=>{
  const item=e.target.closest('.pitem');
  if(item&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(guardAsk())return;selectProvider(item.dataset.id);}
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
  modelQ='';modelSearchV.set('');
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
  modelQ='';modelSearchV.set('');
  pIdV.set('');pNameV.set('');setKey('');pBaseUrlV.set('');
  $('#pId').setAttribute('contenteditable','true');$('#pId').classList.remove('ro');
  $('#pIdHint').textContent='创建后不可修改 · 仅限字母/数字/连字符/下划线';
  paintKind('openai');
  showPane('provider');
  renderProviders();renderModels();renderBar();
  $('#pId').focus();
}
function renderModels(){
  const grid=$('#modelGrid'),empty=$('#modelEmpty'),tools=$('#modelTools'),count=$('#modelCount'),rm=$('#modelRemoveSel');
  const total=editing.models.length;
  const q=modelQ.trim().toLowerCase();
  const shown=q?editing.models.filter(m=>m.toLowerCase().indexOf(q)>=0):editing.models;
  // 计数 + 工具行可见性：模型较多（或正在筛选）时显示
  count.textContent=total?(q?('共 '+total+' 个 · 匹配 '+shown.length):'共 '+total+' 个'):'';
  const showTools=total>MODEL_TOOLS_MIN||q!=='';
  tools.style.display=(total&&showTools)?'':'none';
  if(!total){
    grid.style.display='none';grid.innerHTML='';empty.style.display='';
    empty.textContent=(editing.kind==='openai_compat'&&!pBaseUrlV.get().trim())?'请先填写 Base URL 和 API Key'
      :(!keyReal.trim()||isMaskedKey(keyReal))?'请先填写有效的 API Key'
      :'点击「获取模型列表」从提供商拉取，或在下方手动输入模型 ID';
    rm.style.display='none';
    return;
  }
  empty.style.display='none';
  if(!shown.length){
    grid.style.display='none';grid.innerHTML='';empty.style.display='';
    empty.textContent='没有匹配「'+esc(modelQ.trim())+'」的模型，可修改筛选词后重试';
    rm.style.display='none';
    return;
  }
  grid.style.display='';rm.style.display=q?'':'none';
  if(q)rm.textContent='移除匹配的 '+shown.length+' 个';
  grid.innerHTML=shown.map(m=>
    '<span class="mcard" role="checkbox" aria-checked="true" tabindex="0" data-m="'+esc(m)+'" title="取消勾选并移除 '+esc(m)+'">'+
    '<span class="mk">✓</span><span class="mname">'+esc(m)+'</span></span>').join('');
}
function removeModels(list){
  if(!list.length)return;
  for(const m of list){const i=editing.models.indexOf(m);if(i>=0)editing.models.splice(i,1);}
  if(!editing.models.length){modelQ='';modelSearchV.set('');}
  renderModels();renderBar();
}
$('#modelGrid').addEventListener('click',e=>{const c=e.target.closest('.mcard');if(c)removeModels([c.dataset.m]);});
$('#modelGrid').addEventListener('keydown',e=>{const c=e.target.closest('.mcard');
  if(c&&(e.key===' '||e.key==='Enter')){e.preventDefault();removeModels([c.dataset.m]);}});
$('#modelRemoveSel').addEventListener('click',()=>{
  const q=modelQ.trim().toLowerCase();if(!q)return;
  const doomed=editing.models.filter(m=>m.toLowerCase().indexOf(q)>=0);
  if(doomed.length)removeModels(doomed);
});
$('#modelNew').addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;e.preventDefault();
  const v=modelNewV.get();if(!v)return;
  if(editing.models.includes(v)){toast('模型已存在：'+v);modelNewV.set('');return;}
  editing.models.push(v);modelNewV.set('');renderModels();renderBar();
});
function renderFetchBtn(){$('#fetchModels').disabled=llmFetching;
  $('#fetchModels').innerHTML=llmFetching?'<span class="spin">◌</span> 获取中…':'获取模型列表';}
/* ---- 拉取后的「挑选模型」弹窗 ---- */
let pickAll=[],pickSel=[],pickQ='';
function pickShown(){const q=pickQ.trim().toLowerCase();return q?pickAll.filter(m=>m.toLowerCase().indexOf(q)>=0):pickAll;}
function renderPick(){
  const shown=pickShown(),listEl=$('#mfList');
  $('#mfCount').textContent='已选 '+pickSel.length+' · 共 '+pickAll.length+(pickQ.trim()?(' · 匹配 '+shown.length):'');
  $('#mfEmpty').style.display=shown.length?'none':'';
  $('#mfEmpty').textContent=pickAll.length?(pickQ.trim()?('没有匹配「'+esc(pickQ.trim())+'」的模型'):''):'没有可添加的模型';
  listEl.style.display=shown.length?'':'none';
  listEl.innerHTML=shown.map(m=>{
    const on=pickSel.indexOf(m)>=0;
    return '<span class="mcard'+(on?'':' off')+'" role="checkbox" aria-checked="'+on+'" tabindex="0" data-m="'+esc(m)+'" title="'+(on?'取消勾选':'勾选')+' '+esc(m)+'">'+
    '<span class="mk">'+(on?'✓':'')+'</span><span class="mname">'+esc(m)+'</span></span>';}).join('');
  const addBtn=$('#mfAdd');addBtn.disabled=!pickSel.length;
  addBtn.textContent=pickSel.length?('添加所选 ('+pickSel.length+')'):'添加所选';
}
function togglePick(m){const i=pickSel.indexOf(m);if(i>=0)pickSel.splice(i,1);else pickSel.push(m);renderPick();}
$('#mfList').addEventListener('click',e=>{const c=e.target.closest('.mcard');if(c)togglePick(c.dataset.m);});
$('#mfList').addEventListener('keydown',e=>{const c=e.target.closest('.mcard');
  if(c&&(e.key===' '||e.key==='Enter')){e.preventDefault();togglePick(c.dataset.m);}});
$('#mfAll').addEventListener('click',()=>{for(const m of pickShown())if(pickSel.indexOf(m)<0)pickSel.push(m);renderPick();});
$('#mfNone').addEventListener('click',()=>{const s=new Set(pickShown());pickSel=pickSel.filter(m=>!s.has(m));renderPick();});
const mfSearchV=makeTextField($('#mfSearch'),{placeholder:'筛选模型…',onInput:()=>{pickQ=mfSearchV.get();renderPick();}});
function openMfetch(list){
  // 少量新模型默认全勾（贴近旧行为）；大批量默认不勾选，便于只挑需要的模型
  pickAll=list.slice();pickSel=(list.length<=MODEL_TOOLS_MIN)?list.slice():[];
  pickQ='';mfSearchV.set('');
  $('#mfEmpty').textContent='没有匹配的模型';
  $('#mfHint').textContent=(list.length>MODEL_TOOLS_MIN&&!pickSel.length)?
    '拉取到 '+list.length+' 个模型，默认未勾选：请筛选后「全选」或逐个勾选需要加入列表的模型'
    :'勾选需要加入列表的模型，确认后才会合并';
  renderPick();
  $('#mfetch').classList.add('show');
}
$('#mfAdd').addEventListener('click',()=>{
  if(!pickSel.length)return;
  const fresh=pickSel.filter(m=>editing.models.indexOf(m)<0);
  if(fresh.length)editing.models=editing.models.concat(fresh);
  $('#mfetch').classList.remove('show');
  renderModels();renderBar();
  toast('已添加 '+fresh.length+' 个模型');
});
$('#mfCancel').addEventListener('click',()=>$('#mfetch').classList.remove('show'));
$('#mfclose').addEventListener('click',()=>$('#mfetch').classList.remove('show'));
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
    if(!fresh.length){toast('没有发现新模型，已保留现有列表');return;}
    openMfetch(fresh);
  }catch(e){toast('获取模型列表失败：网络错误',false);}
  finally{llmFetching=false;renderFetchBtn();}
});
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
  imagegen:makeSelect($('#asgImagegen'),{options:asgOptions,onChange:renderAssignBar}),
};
function currentAssignments(){
  return {idea:asgFromVal(asgSelects.idea.get()),image:asgFromVal(asgSelects.image.get()),video:asgFromVal(asgSelects.video.get()),imagegen:asgFromVal(asgSelects.imagegen.get())};
}
function hasAssignChanges(){
  const cur=currentAssignments();
  return ASG_KEYS.some(k=>JSON.stringify(cur[k]||null)!==JSON.stringify(savedAssignments[k]||null));
}
function renderAssignBar(){
  const custom=ASG_KEYS.some(k=>savedAssignments[k]);
  $('#assignStat').textContent=hasAssignChanges()?'有未保存的更改':(custom?'自定义分配':'自动分配');
  refreshAsk();
}
async function loadAssignments(){
  try{savedAssignments=await jf('/api/llm/assignments');}
  catch(e){savedAssignments={idea:null,image:null,video:null,imagegen:null};}
  for(const k of ASG_KEYS){asgSelects[k].refresh();asgSelects[k].set(asgVal(savedAssignments[k]));}
  renderProviders();renderAssignBar();
}
async function saveLlmAsgAsk(){
  if(asgSaving)return false;
  asgSaving=true;renderAssignBar();
  try{
    const data=await jf('/api/llm/assignments',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify(currentAssignments())});
    savedAssignments=data;
    for(const k of ASG_KEYS)asgSelects[k].set(asgVal(savedAssignments[k]));
    renderProviders();renderAssignBar();
    toast('已保存模型分配');
    return true;
  }catch(e){toast('保存失败：'+e.message,false);return false;}
  finally{asgSaving=false;renderAssignBar();}
}
$('#asgReset').addEventListener('click',()=>{
  for(const k of ASG_KEYS)asgSelects[k].set('');
  renderAssignBar();
});
$('#assignNav').addEventListener('click',e=>{if(guardAsk())return;showAssignView();});
$('#assignNav').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(guardAsk())return;showAssignView();}});
async function saveLlmProvAsk(){
  if(llmSaving)return false;
  const id=pIdV.get().trim(),name=pNameV.get().trim(),baseUrl=pBaseUrlV.get().trim();
  if(!id){toast('请填写提供商 ID',false);$('#pId').focus();return false;}
  if(!ID_RE.test(id)){toast('ID 仅限字母/数字/连字符/下划线，且以字母或数字开头',false);return false;}
  if(!name){toast('请填写提供商名称',false);$('#pName').focus();return false;}
  if(editing.kind==='openai_compat'&&!baseUrl){toast('OpenAI 兼容类型必须填写 Base URL',false);return false;}
  if(llmProviders.some(p=>p.id===id)&&!confirm('ID「'+id+'」已存在，确认覆盖该提供商？'))return false;
  llmSaving=true;renderBar();
  try{
    await jf('/api/llm/providers',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify({id,name,kind:editing.kind,apiKey:keyReal,baseUrl:baseUrl||undefined,models:editing.models.slice()})});
    await reloadProviders();
    llmIsNew=false;selectProvider(id);
    toast('已保存「'+name+'」');
    return true;
  }catch(e){toast('保存失败：'+e.message,false);return false;}
  finally{llmSaving=false;renderBar();}
}
async function delProvider(id){
  const p=llmProviders.find(x=>x.id===id);if(!p)return;
  if(!confirm('确认删除提供商「'+(p.name||p.id)+'」？此操作不可恢复。'))return;
  try{
    await jf('/api/llm/providers/'+encodeURIComponent(id),{method:'DELETE'});
    if(llmSelected===id)showLlmEmpty();
    await reloadProviders();
    toast('已删除「'+(p.name||p.id)+'」');
  }catch(e){toast('删除失败：'+e.message,false);}
}
$('#pDelete').addEventListener('click',()=>{if(llmSelected)delProvider(llmSelected);});
async function reloadProviders(){
  try{llmProviders=await jf('/api/llm/providers');}
  catch(e){llmProviders=[];}
  renderProviders();
  if(llmView==='assign')loadAssignments();
}
$('#llmAdd').addEventListener('click',e=>{if(guardAsk())return;startNew();});
$('#llmEmptyAdd').addEventListener('click',e=>{if(guardAsk())return;startNew();});` : ''}

/* ===== 账号与权限（仅 admin） ===== */
${can ? `let usersList=[],sessionsList=[];
function loadUsersAll(){loadUsers();loadSessions();loadAudit();}
async function loadUsers(){
  try{usersList=await jf('/api/admin/users');}catch(e){return;}
  renderUsers();
}
function renderUsers(){
  const el=$('#usersWrap');
  const admins=usersList.filter(u=>u.role==='admin').length;
  el.innerHTML='<table class="tbl"><thead><tr><th>用户名</th><th>角色</th><th>创建时间</th><th>上次登录</th><th class="act">操作</th></tr></thead><tbody>'+
  usersList.map(u=>
    '<tr data-id="'+esc(u.id)+'">'+
    '<td>'+esc(u.username)+(u.username===ME?' <span class="me">我</span>':'')+'</td>'+
    '<td><span class="rolbadge '+u.role+'">'+(u.role==='admin'?'管理员':'只读')+'</span></td>'+
    '<td class="num">'+fmt(u.createdAt)+'</td>'+
    '<td class="num">'+(u.lastLoginAt?ago(u.lastLoginAt):'从未登录')+'</td>'+
    '<td class="act"><button class="btn sm ghost" data-a="edit">编辑</button>'+
    (u.username===ME?'':'<button class="btn sm ghost" data-a="del" style="color:#fca5a5">删除</button>')+
    '</td></tr>').join('')+
  '</tbody></table>'+
  '<div class="cb-hint" style="margin-top:8px">管理员共 '+admins+' 人 · 最后一个管理员不可删除或降级 · 删除账号会立即登出其全部会话</div>';
}
$('#usersWrap').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  const tr=b.closest('tr');if(!tr)return;
  const user=usersList.find(u=>u.id===tr.dataset.id);if(!user)return;
  if(b.dataset.a==='edit')openUserModal(user);
  else if(b.dataset.a==='del'){
    if(!confirm('确认删除用户「'+user.username+'」？该用户的所有会话将立即失效。'))return;
    try{await jf('/api/admin/users/'+encodeURIComponent(user.id),{method:'DELETE'});toast('已删除用户');loadUsers();loadSessions();loadAudit();}
    catch(e){toast(e.message,false);}
  }
});
const uNameV=makeTextField($('#uName'),{placeholder:'2–32 位字母/数字/点/下划线/连字符',maxlength:32});
const uPassV=makeTextField($('#uPass'),{placeholder:'••••••••',maxlength:128});
let uRole='admin',editingUserId=null;
function paintRoleSeg(){
  document.querySelectorAll('#uRoleSeg .seg-btn').forEach(b=>{
    const on=b.dataset.r===uRole;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));});
}
$('#uRoleSeg').addEventListener('click',e=>{const b=e.target.closest('.seg-btn');if(b){uRole=b.dataset.r;paintRoleSeg();}});
eyeFor($('#uPass'),$('#upwEye'));
function openUserModal(user){
  editingUserId=user?user.id:null;
  uRole=user?user.role:'admin';
  uNameV.set(user?user.username:'');
  uPassV.set('');
  $('#utitle').textContent=user?'编辑用户：'+user.username:'添加用户';
  $('#upwLabel').textContent=user?'重置密码（留空则不修改）':'初始密码（至少 8 位）';
  $('#upwHint').textContent=user?'':'创建后该用户需登录后才能进入后台';
  paintRoleSeg();
  $('#umodal').classList.add('show');
}
$('#userAdd').addEventListener('click',()=>openUserModal(null));
$('#uCancel').onclick=()=>closeModal('#umodal');
$('#uclose').onclick=()=>closeModal('#umodal');
$('#uSave').addEventListener('click',async()=>{
  const username=uNameV.get(),password=uPassV.get();
  if(!username){toast('请填写用户名',false);return;}
  if(!editingUserId&&password.length<8){toast('密码至少 8 位',false);return;}
  if(password&&password.length<8){toast('密码至少 8 位',false);return;}
  const body={role:uRole};
  if(!editingUserId){body.username=username;body.password=password;}
  else{
    if(username!==(usersList.find(u=>u.id===editingUserId)||{}).username)body.username=username;
    if(password)body.password=password;
  }
  try{
    if(editingUserId)await jf('/api/admin/users/'+encodeURIComponent(editingUserId),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    else await jf('/api/admin/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    toast(editingUserId?'已保存用户':'已创建用户');
    closeModal('#umodal');loadUsers();loadAudit();
  }catch(e){toast(e.message,false);}
});
async function loadSessions(){
  try{sessionsList=await jf('/api/admin/sessions');}catch(e){return;}
  const el=$('#sessWrap');
  if(!sessionsList.length){el.innerHTML='<div class="empty" style="padding:20px">当前无在线会话</div>';return;}
  el.innerHTML='<table class="tbl"><thead><tr><th>用户</th><th>IP</th><th>登录时间</th><th>过期时间</th><th class="act">操作</th></tr></thead><tbody>'+
  sessionsList.map(s=>
    '<tr data-token="'+esc(s.token)+'">'+
    '<td>'+esc(s.username)+(s.current?' <span class="me">当前</span>':'')+'</td>'+
    '<td class="num">'+esc(s.ip||'—')+'</td>'+
    '<td class="num">'+fmt(s.createdAt)+'</td>'+
    '<td class="num">'+fmt(s.expiresAt)+'</td>'+
    '<td class="act">'+(s.current?'<span class="num">—</span>':'<button class="btn sm ghost" data-a="revoke">吊销</button>')+'</td></tr>').join('')+
  '</tbody></table>';
}
$('#sessWrap').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  const tr=b.closest('tr');if(!tr)return;
  const token=tr.dataset.token;
  if(b.dataset.a==='revoke'){
    if(!confirm('确认吊销该会话？对应用户将立即被登出。'))return;
    try{await jf('/api/admin/sessions/'+encodeURIComponent(token),{method:'DELETE'});toast('已吊销该会话');loadSessions();loadAudit();}
    catch(e){toast(e.message,false);}
  }
});
$('#sessRefresh').addEventListener('click',()=>{loadSessions();});
async function loadAudit(){
  try{
    const list=await jf('/api/admin/audit?limit=80');
    const el=$('#auditWrap');
    if(!list.length){el.innerHTML='<div class="aline"><span class="ad">（暂无审计事件）</span></div>';return;}
    el.innerHTML=list.map(a=>
      '<div class="aline"><span class="at">'+fmt(a.ts)+'</span>'+
      '<span class="aa">'+esc(a.actor||'系统')+' · '+esc(a.action)+'</span>'+
      '<span class="ad">'+esc(a.detail||'')+'</span></div>').join('');
  }catch(e){}
}
$('#auditRefresh').addEventListener('click',loadAudit);` : ''}

/* ===== 启动与轮询 ===== */
renderInspFilter();
loadOverview();
setInterval(()=>{
  if(cur==='overview')loadOverview();
  else if(cur==='insp')loadInsp();
  else if(cur==='src')refreshHealth();
},8000);
</script>
</body></html>`;
}
