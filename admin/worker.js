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

const TYPES = ['band', 'band_support', 'solo_acoustic', 'solo', 'other'];

async function upsert(req, env, id) {
  const b = await req.json();
  if (!b.date || !b.title || !b.venue) return json({ error: 'date/title/venue は必須です' }, 400);
  const entry = {
    id: id || crypto.randomUUID().slice(0, 8),
    date: b.date, title: b.title, venue: b.venue,
    type: TYPES.includes(b.type) ? b.type : 'band',
    typeLabel: b.type === 'other' ? String(b.typeLabel || '').trim() : '',
    open: b.open || '', start: b.start || '',
    tickets: Array.isArray(b.tickets)
      ? b.tickets.map(t => ({ name: String(t.name || '').trim(), price: String(t.price || '').replace(/[^0-9]/g, '') }))
                 .filter(t => t.name && t.price)
      : [],
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
main{max-width:920px;margin:0 auto;padding:24px 16px 80px}
.card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px;margin-bottom:20px}
h2{font-size:1.05rem;margin-bottom:14px;border-bottom:2px solid var(--ink);padding-bottom:6px;letter-spacing:.08em;display:flex;justify-content:space-between;align-items:baseline}
label{display:block;font-size:.8rem;font-weight:700;margin:10px 0 2px}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:4px;font-size:16px;font-family:inherit;background:#fff}
.row{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
button{font-family:inherit;cursor:pointer;border-radius:4px;font-size:.9rem;padding:10px 22px;border:1px solid var(--ink);background:#fff}
button.primary{background:var(--curtain);border-color:var(--curtain);color:#fff;font-weight:700;letter-spacing:.1em}
button.small{padding:5px 12px;font-size:.78rem}
button.danger{border-color:#a33;color:#a33}
button.ghost{border-style:dashed;color:var(--soft);width:100%;margin-top:8px}
.trow{display:grid;grid-template-columns:1fr 130px 40px;gap:8px;margin-top:8px;align-items:center}
.trow button{padding:8px 0;color:#a33;border-color:var(--line)}
.item{display:flex;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.item .d{font-weight:700;white-space:nowrap}
.item .t{flex:1;min-width:180px}
.item .t small{color:var(--soft);display:block}
.badge{font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:2px;white-space:nowrap}
.badge.fill{background:var(--curtain);color:#fff}
.badge.line{border:1px solid var(--curtain);color:var(--curtain)}
.badge.wait{background:var(--gold);color:#fff}
.badge.past{background:var(--soft);color:#fff}
.msg{padding:10px 14px;border-radius:4px;margin-bottom:14px;font-size:.85rem;display:none}
.msg.ok{display:block;background:#e7f0e0;color:#2c5e2e}
.msg.ng{display:block;background:#f7e2e2;color:#8c2b2b}
#login{max-width:360px;margin:80px auto}
.hint{font-size:.75rem;color:var(--soft);margin-top:2px}
/* プレビュー: サイトの見た目を再現 */
#preview{background:var(--screen);border:1px dashed var(--gold);border-radius:6px;padding:14px 16px}
#preview .p-item{display:grid;grid-template-columns:96px 1fr;gap:0 18px;align-items:center}
#preview .p-date{font-family:'Hiragino Mincho ProN',serif;display:flex;align-items:baseline;gap:5px;border-right:1px dashed var(--line);padding-right:12px}
#preview .p-date .d{font-size:1.6rem;font-weight:800}
#preview .p-date .m{font-size:.75rem;color:var(--soft)}
#preview .p-date .w{font-size:.7rem;color:var(--curtain);font-weight:700}
#preview .p-title{font-weight:700}
#preview .p-venue{font-size:.8rem;color:var(--soft)}
#preview .p-detail{font-size:.76rem;color:var(--soft);margin-top:2px}
#preview .tag{display:inline-block;font-size:.64rem;font-weight:700;letter-spacing:.1em;padding:1px 9px;border-radius:2px;vertical-align:middle}
#preview .tag.fill{background:var(--curtain);color:var(--screen)}
#preview .tag.line{background:transparent;color:var(--curtain);border:1px solid var(--curtain)}
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
    <h2><span id="formTitle">公演を追加</span>
      <button type="button" class="small" id="importBtn">概要ジェネレータJSONを読み込む</button>
    </h2>
    <input type="file" id="importFile" accept=".json,application/json" hidden>
    <form id="f">
      <input type="hidden" id="id">
      <div class="row">
        <div><label>公演日 *</label><input type="date" id="date" required></div>
        <div><label>出演形態 *</label>
          <select id="type">
            <option value="band">バンド（フルメンバー）</option>
            <option value="band_support">バンド（サポートメンバー）</option>
            <option value="solo_acoustic">ソロ弾き語り</option>
            <option value="solo">ソロ</option>
            <option value="other">その他（自由入力）</option>
          </select>
        </div>
      </div>
      <div id="typeLabelWrap" hidden><label>出演形態（自由入力）</label><input id="typeLabel" placeholder="例: DJ出演 / トークゲスト"></div>
      <label>タイトル *</label><input id="title" list="dl-title" autocomplete="off" required>
      <label>会場 *</label><input id="venue" list="dl-venue" autocomplete="off">
      <div class="row">
        <div><label>OPEN</label><input id="open" list="dl-open" autocomplete="off" placeholder="18:30"></div>
        <div><label>START</label><input id="start" list="dl-start" autocomplete="off" placeholder="19:00"></div>
      </div>
      <label>チケット料金</label>
      <div id="tickets"></div>
      <button type="button" class="ghost" id="addTicket">＋ 料金項目を追加（学割・配信など）</button>
      <label>チケット/詳細リンク</label><input id="link" type="url" placeholder="https://（毎回貼り付け。候補保存はされません）">
      <label>備考</label><input id="note" placeholder="+1drink / 入場順 など">
      <label>公開日時（情報解禁）</label><input type="datetime-local" id="publishAt">
      <p class="hint">空欄なら即公開。指定するとその時刻までサイトに表示されません。</p>

      <label style="margin-top:16px">サイトでの見え方プレビュー</label>
      <div id="preview"></div>

      <div style="margin-top:16px;display:flex;gap:10px">
        <button type="submit" class="primary" id="submitBtn">追加する</button>
        <button type="button" id="cancelEdit" hidden>編集をやめる</button>
      </div>
    </form>
    <datalist id="dl-title"></datalist>
    <datalist id="dl-venue"></datalist>
    <datalist id="dl-open"></datalist>
    <datalist id="dl-start"></datalist>
  </div>
  <div class="card">
    <h2>登録済み公演</h2>
    <div id="list"></div>
  </div>
</div>
</main>
<script>
const $ = id => document.getElementById(id);
const TYPE_LABELS = {band:'バンド', band_support:'バンド(サポート)', solo_acoustic:'ソロ弾き語り', solo:'ソロ'};
const DOW = ['日','月','火','水','木','金','土'];
let entries = [];

function msg(text, ok){ const m=$('msg'); m.textContent=text; m.className='msg '+(ok?'ok':'ng'); setTimeout(()=>m.className='msg',4000); }
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function typeLabelOf(e){ return e.type==='other' ? (e.typeLabel||'出演') : (TYPE_LABELS[e.type]||'バンド'); }
function isFill(t){ return t==='band' || t==='band_support'; }

async function api(path, opt={}){
  const r = await fetch(path, {headers:{'content-type':'application/json'}, ...opt});
  if(r.status===401){ show(false); throw new Error('unauthorized'); }
  const d = await r.json();
  if(!r.ok) throw new Error(d.error||'エラー');
  return d;
}
function show(loggedIn){ $('login').hidden=loggedIn; $('app').hidden=!loggedIn; $('logout').hidden=!loggedIn; }

/* ---- チケット行 ---- */
function ticketRow(name='', price=''){
  const div = document.createElement('div');
  div.className = 'trow';
  div.innerHTML = '<input class="tname" placeholder="項目名（前売/当日/学割…）" value="'+esc(name)+'">'
    + '<input class="tprice" inputmode="numeric" placeholder="金額" value="'+esc(price)+'">'
    + '<button type="button" title="削除">×</button>';
  div.querySelector('button').onclick = ()=>{ div.remove(); preview(); };
  div.querySelectorAll('input').forEach(i=>i.addEventListener('input', preview));
  $('tickets').appendChild(div);
}
function getTickets(){
  return [...document.querySelectorAll('#tickets .trow')].map(r=>({
    name: r.querySelector('.tname').value.trim(),
    price: r.querySelector('.tprice').value.replace(/[^0-9]/g,'')
  })).filter(t=>t.name&&t.price);
}
$('addTicket').onclick = ()=>ticketRow();

/* ---- プレビュー ---- */
function detailText(e){
  const parts=[];
  if(e.open||e.start) parts.push([e.open?'OPEN '+e.open:'', e.start?'START '+e.start:''].filter(Boolean).join(' / '));
  const fee=(e.tickets||[]).map(t=>t.name+' ¥'+Number(t.price).toLocaleString()).join(' / ');
  if(fee) parts.push(fee);
  if(e.note) parts.push(e.note);
  return parts.join('　｜　');
}
function formEntry(){
  return { date:$('date').value, title:$('title').value.trim(), venue:$('venue').value.trim(),
    type:$('type').value, typeLabel:$('typeLabel').value.trim(),
    open:$('open').value.trim(), start:$('start').value.trim(),
    tickets:getTickets(), note:$('note').value.trim(), link:$('link').value.trim(), publishAt:$('publishAt').value };
}
function preview(){
  const e = formEntry();
  const d = e.date ? new Date(e.date+'T00:00') : null;
  const tag = '<span class="tag '+(isFill(e.type)?'fill':'line')+'">'+esc(typeLabelOf(e))+'</span>';
  $('preview').innerHTML = '<div class="p-item">'
    + '<div class="p-date">'+(d?'<span class="d">'+d.getDate()+'</span><span class="m">'+d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'</span><span class="w">'+DOW[d.getDay()]+'</span>':'<span class="m">日付未定</span>')+'</div>'
    + '<div><div class="p-title">'+esc(e.title||'タイトル')+'　'+tag+'</div>'
    + '<div class="p-venue">'+esc(e.venue||'会場')+'</div>'
    + (detailText(e)?'<div class="p-detail">'+esc(detailText(e))+'</div>':'')
    + '</div></div>';
}
['date','title','venue','open','start','note','link','typeLabel','publishAt'].forEach(id=>$(id).addEventListener('input', preview));
$('type').addEventListener('change', ()=>{ $('typeLabelWrap').hidden = $('type').value!=='other'; preview(); });

/* ---- 入力候補（過去の登録から） ---- */
function fillDatalists(){
  const set = (id, vals)=>{ $(id).innerHTML=[...new Set(vals.filter(Boolean))].map(v=>'<option value="'+esc(v)+'">').join(''); };
  set('dl-title', entries.map(e=>e.title));
  set('dl-venue', entries.map(e=>e.venue));
  set('dl-open', entries.map(e=>e.open));
  set('dl-start', entries.map(e=>e.start));
}

/* ---- 概要ジェネレータJSON読み込み ---- */
$('importBtn').onclick = ()=>$('importFile').click();
$('importFile').addEventListener('change', ev=>{
  const file = ev.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const j = JSON.parse(reader.result);
      const o = j.overview || j;
      if(o.eventDate) $('date').value = o.eventDate;
      if(o.eventTitle) $('title').value = o.eventTitle;
      if(o.eventPlace) $('venue').value = o.eventPlace;
      if(o.openTime) $('open').value = o.openTime;
      if(o.startTime) $('start').value = o.startTime;
      $('tickets').innerHTML='';
      (o.tickets||[]).forEach(t=>ticketRow(t.name, String(t.price)));
      if(!(o.tickets||[]).length){ ticketRow('前売',''); ticketRow('当日',''); }
      if(o.playguides && o.playguides[0] && o.playguides[0].url) $('link').value = o.playguides[0].url;
      if(o.otherInfo) $('note').value = String(o.otherInfo).split('\\n')[0];
      preview();
      msg('ジェネレータJSONを読み込みました。内容を確認して追加してください', true);
    }catch(e){ msg('JSONを読み込めませんでした: '+e.message, false); }
  };
  reader.readAsText(file);
  ev.target.value='';
});

/* ---- 一覧 ---- */
async function refresh(){
  entries = await api('/api/schedule');
  fillDatalists();
  const now = Date.now(); const today = new Date().toISOString().slice(0,10);
  $('list').innerHTML = entries.map(e=>{
    const waiting = e.publishAt && new Date(e.publishAt).getTime() > now;
    const past = e.date < today;
    const fee = (e.tickets||[]).map(t=>t.name+'¥'+t.price).join('/');
    return '<div class="item">'
      + '<span class="d">'+e.date.replaceAll('-','.')+'</span>'
      + '<span class="badge '+(isFill(e.type)?'fill':'line')+'">'+esc(typeLabelOf(e))+'</span>'
      + '<div class="t">'+esc(e.title)+'<small>'+esc(e.venue)
      + (e.open?' ｜ OPEN '+e.open:'')+(e.start?' / START '+e.start:'')
      + (fee?' ｜ '+esc(fee):'')+'</small></div>'
      + (waiting?'<span class="badge wait">'+e.publishAt.replace('T',' ')+' 解禁</span>':'')
      + (past?'<span class="badge past">終了</span>':'')
      + '<button class="small" onclick="edit(\\''+e.id+'\\')">編集</button>'
      + '<button class="small danger" onclick="del(\\''+e.id+'\\')">削除</button>'
      + '</div>';
  }).join('') || '<p class="hint">まだ登録がありません。</p>';
}

window.edit = id => {
  const e = entries.find(x=>x.id===id); if(!e) return;
  ['date','title','venue','type','typeLabel','open','start','note','link','publishAt'].forEach(k=>$(k).value=e[k]||'');
  $('typeLabelWrap').hidden = e.type!=='other';
  $('tickets').innerHTML='';
  (e.tickets&&e.tickets.length ? e.tickets : [{name:'前売',price:''},{name:'当日',price:''}]).forEach(t=>ticketRow(t.name,t.price));
  $('id').value = e.id;
  $('formTitle').textContent='公演を編集'; $('submitBtn').textContent='保存する'; $('cancelEdit').hidden=false;
  preview();
  window.scrollTo({top:0,behavior:'smooth'});
};
window.del = async id => {
  const e = entries.find(x=>x.id===id);
  if(!confirm((e?e.date+' '+e.title:'この公演')+' を削除しますか？')) return;
  await api('/api/schedule/'+id, {method:'DELETE'});
  msg('削除しました', true); refresh();
};

function resetForm(){
  $('f').reset(); $('id').value='';
  $('typeLabelWrap').hidden=true;
  $('tickets').innerHTML=''; ticketRow('前売',''); ticketRow('当日','');
  $('formTitle').textContent='公演を追加'; $('submitBtn').textContent='追加する'; $('cancelEdit').hidden=true;
  preview();
}
$('cancelEdit').onclick = resetForm;

$('f').onsubmit = async ev => {
  ev.preventDefault();
  const id = $('id').value;
  try{
    await api(id?'/api/schedule/'+id:'/api/schedule', {method:id?'PUT':'POST', body:JSON.stringify(formEntry())});
    msg(id?'保存しました':'追加しました', true); resetForm(); refresh();
  }catch(e){ msg(e.message, false); }
};

$('doLogin').onclick = async () => {
  try{ await api('/api/login',{method:'POST',body:JSON.stringify({password:$('pw').value})}); $('pw').value=''; show(true); refresh(); }
  catch(e){ msg(e.message,false); }
};
$('pw').addEventListener('keydown', e=>{ if(e.key==='Enter') $('doLogin').click(); });
$('logout').onclick = () => { document.cookie='gnk_session=; Path=/; Max-Age=0'; show(false); };

resetForm();
(async ()=>{ try{ await refresh(); show(true); } catch(e){ show(false); } })();
</script>
</body>
</html>`;
