/**
 * 銀幕一楼とTIMECAFE スケジュール管理画面 (Cloudflare Worker + KV)
 *
 * - admin.ginmakuichiro.net       … 管理画面（共有パスワードでログイン）
 * - GET /data/schedule.json       … 公開API（サイトが読む。公開日時前の公演は含まれない）
 *
 * Secrets: ADMIN_PASSWORD（ログイン用）, SESSION_SECRET（Cookie署名用）
 * KV: DATA（key "schedule" に全公演の配列を保存）
 */

const COOKIE = 'gnk_session';
const SESSION_DAYS = 60;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/data/schedule.json') return publicSchedule(env);
    if (p === '/api/login' && req.method === 'POST') return login(req, env);
    if (p.startsWith('/api/')) {
      if (!(await authed(req, env))) return json({ error: 'unauthorized' }, 401);
      if (p === '/api/schedule' && req.method === 'GET') return json(await load(env));
      if (p === '/api/schedule' && req.method === 'POST') return upsert(req, env, null);
      const m = p.match(/^\/api\/schedule\/([\w-]+)$/);
      if (m && req.method === 'PUT') return upsert(req, env, m[1]);
      if (m && req.method === 'DELETE') return remove(env, m[1]);
      return json({ error: 'not found' }, 404);
    }
    return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
};

/* ---------- data ---------- */

async function load(env) {
  return JSON.parse((await env.DATA.get('schedule')) || '[]');
}
async function save(env, list) {
  list.sort((a, b) => (a.date < b.date ? -1 : 1));
  await env.DATA.put('schedule', JSON.stringify(list));
}

async function publicSchedule(env) {
  const now = Date.now();
  const list = (await load(env))
    .filter(e => !e.publishAt || new Date(e.publishAt).getTime() <= now)
    .map(({ id, publishAt, ...rest }) => rest);
  return json(list, 200, {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=60'
  });
}

async function upsert(req, env, id) {
  const b = await req.json();
  if (!b.date || !b.title || !b.venue) return json({ error: 'date/title/venue は必須です' }, 400);
  const entry = {
    id: id || crypto.randomUUID().slice(0, 8),
    date: b.date, title: b.title, venue: b.venue,
    type: b.type === 'solo' ? 'solo' : 'band',
    open: b.open || '', start: b.start || '',
    adv: String(b.adv || '').replace(/[^0-9]/g, ''),
    door: String(b.door || '').replace(/[^0-9]/g, ''),
    note: b.note || '', link: b.link || '',
    publishAt: b.publishAt || ''
  };
  const list = await load(env);
  const i = list.findIndex(e => e.id === entry.id);
  if (i >= 0) list[i] = entry; else list.push(entry);
  await save(env, list);
  return json(entry);
}

async function remove(env, id) {
  const list = await load(env);
  await save(env, list.filter(e => e.id !== id));
  return json({ ok: true });
}

/* ---------- auth ---------- */

async function login(req, env) {
  const { password } = await req.json().catch(() => ({}));
  if (!password || password !== env.ADMIN_PASSWORD) return json({ error: 'パスワードが違います' }, 401);
  const ts = Date.now().toString(36);
  const token = ts + '.' + (await hmac(env, ts));
  return json({ ok: true }, 200, {
    'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
  });
}

async function authed(req, env) {
  const c = (req.headers.get('cookie') || '').match(new RegExp(COOKIE + '=([^;]+)'));
  if (!c) return false;
  const [ts, sig] = c[1].split('.');
  if (!ts || !sig || sig !== (await hmac(env, ts))) return false;
  return Date.now() - parseInt(ts, 36) < SESSION_DAYS * 86400 * 1000;
}

async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

/* ---------- admin UI ---------- */

const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>スケジュール管理 | 銀幕一楼とTIMECAFE</title>
<style>
:root{--curtain:#7C2128;--dark:#241012;--screen:#F4EDDD;--gold:#B98F24;--ink:#26201A;--soft:#7C7263;--line:#D8CCB2}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Kaku Gothic ProN',sans-serif;background:var(--screen);color:var(--ink);font-size:15px;line-height:1.7}
header{background:var(--dark);color:var(--screen);padding:14px 20px;border-bottom:3px double var(--gold);display:flex;justify-content:space-between;align-items:center}
header h1{font-size:1rem;letter-spacing:.1em}
header small{color:var(--gold);letter-spacing:.2em}
main{max-width:860px;margin:0 auto;padding:24px 16px 80px}
.card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px;margin-bottom:20px}
h2{font-size:1.05rem;margin-bottom:14px;border-bottom:2px solid var(--ink);padding-bottom:6px;letter-spacing:.08em}
label{display:block;font-size:.8rem;font-weight:700;margin:10px 0 2px}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:4px;font-size:16px;font-family:inherit;background:#fff}
.row{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
button{font-family:inherit;cursor:pointer;border-radius:4px;font-size:.9rem;padding:10px 22px;border:1px solid var(--ink);background:#fff}
button.primary{background:var(--curtain);border-color:var(--curtain);color:#fff;font-weight:700;letter-spacing:.1em}
button.small{padding:5px 12px;font-size:.78rem}
button.danger{border-color:#a33;color:#a33}
.item{display:flex;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.item .d{font-weight:700;white-space:nowrap}
.item .t{flex:1;min-width:180px}
.item .t small{color:var(--soft);display:block}
.badge{font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:2px;white-space:nowrap}
.badge.band{background:var(--curtain);color:#fff}
.badge.solo{border:1px solid var(--curtain);color:var(--curtain)}
.badge.wait{background:var(--gold);color:#fff}
.badge.past{background:var(--soft);color:#fff}
.msg{padding:10px 14px;border-radius:4px;margin-bottom:14px;font-size:.85rem;display:none}
.msg.ok{display:block;background:#e7f0e0;color:#2c5e2e}
.msg.ng{display:block;background:#f7e2e2;color:#8c2b2b}
#login{max-width:360px;margin:80px auto}
.hint{font-size:.75rem;color:var(--soft);margin-top:2px}
@media(max-width:600px){.row{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>銀幕一楼とTIMECAFE <small>SCHEDULE 管理</small></h1><button class="small" id="logout" hidden>ログアウト</button></header>
<main>
<div id="msg" class="msg"></div>

<div id="login" class="card" hidden>
  <h2>ログイン</h2>
  <label>共有パスワード</label>
  <input type="password" id="pw" autocomplete="current-password">
  <div style="margin-top:14px"><button class="primary" id="doLogin">ログイン</button></div>
</div>

<div id="app" hidden>
  <div class="card">
    <h2 id="formTitle">公演を追加</h2>
    <form id="f">
      <input type="hidden" id="id">
      <div class="row">
        <div><label>公演日 *</label><input type="date" id="date" required></div>
        <div><label>出演形態 *</label><select id="type"><option value="band">バンド</option><option value="solo">銀幕一楼ソロ</option></select></div>
      </div>
      <label>タイトル *</label><input id="title" required>
      <label>会場 *</label><input id="venue">
      <div class="row">
        <div><label>OPEN</label><input id="open" placeholder="18:30"></div>
        <div><label>START</label><input id="start" placeholder="19:00"></div>
      </div>
      <div class="row">
        <div><label>前売（円）</label><input id="adv" inputmode="numeric" placeholder="3000"></div>
        <div><label>当日（円）</label><input id="door" inputmode="numeric" placeholder="3500"></div>
      </div>
      <label>チケット/詳細リンク</label><input id="link" type="url" placeholder="https://">
      <label>備考</label><input id="note" placeholder="+1drink / 学割あり など">
      <label>公開日時（情報解禁）</label><input type="datetime-local" id="publishAt">
      <p class="hint">空欄なら即公開。指定するとその時刻までサイトに表示されません。</p>
      <div style="margin-top:16px;display:flex;gap:10px">
        <button type="submit" class="primary" id="submitBtn">追加する</button>
        <button type="button" id="cancelEdit" hidden>編集をやめる</button>
      </div>
    </form>
  </div>
  <div class="card">
    <h2>登録済み公演</h2>
    <div id="list"></div>
  </div>
</div>
</main>
<script>
const $ = id => document.getElementById(id);
const FIELDS = ['date','title','venue','type','open','start','adv','door','link','note','publishAt'];
let entries = [];

function msg(text, ok){ const m=$('msg'); m.textContent=text; m.className='msg '+(ok?'ok':'ng'); setTimeout(()=>m.className='msg',4000); }

async function api(path, opt={}){
  const r = await fetch(path, {headers:{'content-type':'application/json'}, ...opt});
  if(r.status===401){ show(false); throw new Error('unauthorized'); }
  const d = await r.json();
  if(!r.ok) throw new Error(d.error||'エラー');
  return d;
}

function show(loggedIn){ $('login').hidden=loggedIn; $('app').hidden=!loggedIn; $('logout').hidden=!loggedIn; }

async function refresh(){
  entries = await api('/api/schedule');
  const now = Date.now(); const today = new Date().toISOString().slice(0,10);
  $('list').innerHTML = entries.map(e=>{
    const waiting = e.publishAt && new Date(e.publishAt).getTime() > now;
    const past = e.date < today;
    return '<div class="item">'
      + '<span class="d">'+e.date.replaceAll('-','.')+'</span>'
      + '<span class="badge '+e.type+'">'+(e.type==='solo'?'ソロ':'バンド')+'</span>'
      + '<div class="t">'+esc(e.title)+'<small>'+esc(e.venue)
      + (e.open?' ｜ OPEN '+e.open:'')+(e.start?' / START '+e.start:'')
      + (e.adv?' ｜ 前売¥'+e.adv:'')+(e.door?' / 当日¥'+e.door:'')+'</small></div>'
      + (waiting?'<span class="badge wait">'+e.publishAt.replace('T',' ')+' 解禁</span>':'')
      + (past?'<span class="badge past">終了</span>':'')
      + '<button class="small" onclick="edit(\\''+e.id+'\\')">編集</button>'
      + '<button class="small danger" onclick="del(\\''+e.id+'\\')">削除</button>'
      + '</div>';
  }).join('') || '<p class="hint">まだ登録がありません。</p>';
}

function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

window.edit = id => {
  const e = entries.find(x=>x.id===id); if(!e) return;
  FIELDS.forEach(k=>$(k).value = e[k]||'');
  $('id').value = e.id;
  $('formTitle').textContent = '公演を編集'; $('submitBtn').textContent = '保存する'; $('cancelEdit').hidden = false;
  window.scrollTo({top:0,behavior:'smooth'});
};
window.del = async id => {
  const e = entries.find(x=>x.id===id);
  if(!confirm((e?e.date+' '+e.title:'この公演')+' を削除しますか？')) return;
  await api('/api/schedule/'+id, {method:'DELETE'});
  msg('削除しました', true); refresh();
};

function resetForm(){ $('f').reset(); $('id').value=''; $('formTitle').textContent='公演を追加'; $('submitBtn').textContent='追加する'; $('cancelEdit').hidden=true; }
$('cancelEdit').onclick = resetForm;

$('f').onsubmit = async ev => {
  ev.preventDefault();
  const body = {}; FIELDS.forEach(k=>body[k]=$(k).value.trim());
  const id = $('id').value;
  try{
    await api(id ? '/api/schedule/'+id : '/api/schedule', {method: id?'PUT':'POST', body: JSON.stringify(body)});
    msg(id?'保存しました':'追加しました', true); resetForm(); refresh();
  }catch(e){ msg(e.message, false); }
};

$('doLogin').onclick = async () => {
  try{ await api('/api/login',{method:'POST',body:JSON.stringify({password:$('pw').value})}); $('pw').value=''; show(true); refresh(); }
  catch(e){ msg(e.message,false); }
};
$('pw').addEventListener('keydown', e=>{ if(e.key==='Enter') $('doLogin').click(); });
$('logout').onclick = () => { document.cookie='gnk_session=; Path=/; Max-Age=0'; show(false); };

(async ()=>{ try{ await refresh(); show(true); } catch(e){ show(false); } })();
</script>
</body>
</html>`;
