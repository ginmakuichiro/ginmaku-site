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
    if (p === '/data/news.json') return publicNews(env);
    if (p.startsWith('/img/')) return serveImage(env, p.slice(5));
    if (p === '/api/count') {
      const cors = { 'access-control-allow-origin': '*' };
      if (req.method === 'POST') {
        const n = parseInt((await env.DATA.get('visitors')) || '0', 10) + 1;
        await env.DATA.put('visitors', String(n));
        return json({ count: n }, 200, cors);
      }
      return json({ count: parseInt((await env.DATA.get('visitors')) || '0', 10) }, 200, cors);
    }
    if (p === '/api/login' && req.method === 'POST') return login(req, env);
    if (p.startsWith('/api/')) {
      if (!(await authed(req, env))) return json({ error: 'unauthorized' }, 401);
      if (p === '/api/schedule' && req.method === 'GET') return json(await load(env));
      if (p === '/api/schedule' && req.method === 'POST') return upsert(req, env, null);
      if (p === '/api/parse' && req.method === 'POST') return aiParse(req, env);
      if (p === '/api/count/reset' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const n = Math.max(0, parseInt(b.value, 10) || 0);
        await env.DATA.put('visitors', String(n));
        return json({ count: n });
      }
      if (p === '/api/image' && req.method === 'POST') return uploadImage(req, env);
      const mi = p.match(/^\/api\/image\/(img_[\w-]+)$/);
      if (mi && req.method === 'DELETE') { await env.DATA.delete(mi[1]); return json({ ok: true }); }
      const m = p.match(/^\/api\/schedule\/([\w-]+)$/);
      if (m && req.method === 'PUT') return upsert(req, env, m[1]);
      if (m && req.method === 'DELETE') return remove(env, m[1]);
      if (p === '/api/news' && req.method === 'GET') return json(await loadNews(env));
      if (p === '/api/news' && req.method === 'POST') return upsertNews(req, env, null);
      const mn = p.match(/^\/api\/news\/([\w-]+)$/);
      if (mn && req.method === 'PUT') return upsertNews(req, env, mn[1]);
      if (mn && req.method === 'DELETE') {
        const nl = await loadNews(env);
        const tgt = nl.find(e => e.id === mn[1]);
        for (const img of (tgt?.images || [])) await env.DATA.delete(img);
        await saveNews(env, nl.filter(e => e.id !== mn[1]));
        return json({ ok: true });
      }
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
    .map(({ publishAt, ...rest }) => rest);
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
    drink: String(b.drink || '').trim(),
    pref: String(b.pref || '').trim(),
    lineup: String(b.lineup || '').trim(),
    reserve: !!b.reserve,
    note: b.note || '', link: b.link || '',
    images: Array.isArray(b.images)
      ? b.images.filter(s => typeof s === 'string' && /^img_[\w-]+$/.test(s)).slice(0, 4)
      : [],
    publishAt: b.publishAt || ''
  };
  const list = await load(env);
  const i = list.findIndex(e => e.id === entry.id);
  if (i >= 0) {
    // 編集で外された画像は削除
    for (const old of (list[i].images || [])) {
      if (!entry.images.includes(old)) await env.DATA.delete(old);
    }
    list[i] = entry;
  } else list.push(entry);
  await save(env, list);
  return json(entry);
}

async function remove(env, id) {
  const list = await load(env);
  const target = list.find(e => e.id === id);
  for (const img of (target?.images || [])) await env.DATA.delete(img);
  await save(env, list.filter(e => e.id !== id));
  return json({ ok: true });
}

/* ---------- news ---------- */

async function loadNews(env) {
  return JSON.parse((await env.DATA.get('news')) || '[]');
}
async function saveNews(env, list) {
  list.sort((a, b) => (a.date > b.date ? -1 : 1));
  await env.DATA.put('news', JSON.stringify(list));
}

async function publicNews(env) {
  const now = Date.now();
  const list = (await loadNews(env))
    .filter(e => !e.publishAt || new Date(e.publishAt).getTime() <= now)
    .map(({ publishAt, ...rest }) => rest);
  return json(list, 200, {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=60'
  });
}

async function upsertNews(req, env, id) {
  const b = await req.json();
  if (!b.date || !b.title) return json({ error: 'date/title は必須です' }, 400);
  const entry = {
    id: id || crypto.randomUUID().slice(0, 8),
    date: b.date,
    category: String(b.category || 'NEWS').trim().toUpperCase() || 'NEWS',
    title: String(b.title).trim(),
    body: String(b.body || '').trim(),
    link: b.link || '',
    images: Array.isArray(b.images)
      ? b.images.filter(s => typeof s === 'string' && /^img_[\w-]+$/.test(s)).slice(0, 4)
      : [],
    publishAt: b.publishAt || ''
  };
  const list = await loadNews(env);
  const i = list.findIndex(e => e.id === entry.id);
  if (i >= 0) {
    for (const old of (list[i].images || [])) {
      if (!entry.images.includes(old)) await env.DATA.delete(old);
    }
    list[i] = entry;
  } else list.push(entry);
  await saveNews(env, list);
  return json(entry);
}

/* ---------- 画像 ---------- */

const IMG_MAX_BYTES = 2_500_000; // クライアント側で縮小済みの想定。サーバー側ガード

async function uploadImage(req, env) {
  const mime = req.headers.get('content-type') || 'image/jpeg';
  if (!/^image\//.test(mime)) return json({ error: '画像ファイルを送ってください' }, 400);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > IMG_MAX_BYTES) return json({ error: '画像が大きすぎます（2.5MBまで）' }, 413);
  const id = 'img_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await env.DATA.put(id, buf, { metadata: { mime } });
  return json({ id });
}

async function serveImage(env, key) {
  if (!/^img_[\w-]+$/.test(key)) return new Response('not found', { status: 404 });
  const { value, metadata } = await env.DATA.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!value) return new Response('not found', { status: 404 });
  return new Response(value, {
    headers: {
      'content-type': metadata?.mime || 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*'
    }
  });
}

/* ---------- AI解析 (Gemini) ---------- */

async function aiParse(req, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY が未設定です' }, 500);
  const { text, imageBase64, mimeType } = await req.json().catch(() => ({}));
  if (!text && !imageBase64) return json({ error: 'テキストか画像を渡してください' }, 400);

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const prompt = `あなたはライブイベント告知の解析係です。与えられたフライヤー画像や告知テキストから情報を抽出し、次のJSONだけを返してください。
{
 "date": "yyyy-MM-dd",          // 公演日。年の記載がなければ今日(${today})以降で最も近い年を補う
 "title": "イベントタイトル",
 "venue": "会場名",
 "open": "HH:MM",               // 開場時刻。不明なら空文字
 "start": "HH:MM",              // 開演時刻。不明なら空文字
 "tickets": [{"name": "前売", "price": "3000"}],  // 料金区分ごと。priceは数字のみの文字列
 "drink": "+1drink ¥600",       // ドリンク代の表記。不明なら空文字
 "pref": "東京都",              // 会場の都道府県。47都道府県の正式名称で。会場名や地名（例: 池袋→東京都、心斎橋→大阪府）から推測してよい。海外なら国名・都市名（例: 台湾・台北）。判断できなければ空文字
 "lineup": "",                  // 出演バンド・アーティストを全て改行(\\n)区切りで。銀幕一楼とTIMECAFE自身も含める。不明なら空文字
 "note": "",                    // 入場順・注意事項など。複数あれば改行(\\n)区切り。なければ空文字
 "link": ""                     // チケットURL等。なければ空文字
}
不明な項目は空文字または空配列にする。推測で埋めない。JSON以外の文字は出力しない。`;

  const parts = [{ text: prompt }];
  if (imageBase64) parts.push({ inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } });
  if (text) parts.push({ text: '--- 告知テキスト ---\n' + text });

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
    })
  });
  if (!res.ok) return json({ error: 'AI解析に失敗しました (' + res.status + ')' }, 502);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  try {
    return json(JSON.parse(raw));
  } catch (e) {
    return json({ error: 'AIの出力を解釈できませんでした' }, 502);
  }
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
.tabs{display:flex;gap:0;margin-bottom:18px}
.tabs button{flex:1;padding:11px 0;font-weight:700;letter-spacing:.12em;border:1px solid var(--line);background:#fff;color:var(--soft)}
.tabs button:first-child{border-radius:4px 0 0 4px}
.tabs button:last-child{border-radius:0 4px 4px 0;border-left:none}
.tabs button.on{background:var(--dark);border-color:var(--dark);color:var(--gold)}
.ai-box{background:var(--screen);border:1px solid var(--gold);border-radius:6px;padding:14px 16px;margin-bottom:18px}
.ai-title{font-size:.82rem;font-weight:700;margin-bottom:8px}
.ai-box textarea{resize:vertical}
.ai-actions{display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap}
.ai-actions .primary{margin-left:auto}
.chk{display:flex;align-items:center;gap:8px;font-weight:500;margin-top:12px;cursor:pointer}
.chk input{width:18px;height:18px;accent-color:var(--curtain)}
.img-thumbs{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.img-thumbs .th{position:relative;width:110px}
.img-thumbs img{width:110px;height:110px;object-fit:cover;border-radius:4px;border:1px solid var(--line);display:block}
.img-thumbs .rm{position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;background:#a33;color:#fff;border:none;font-size:.8rem;line-height:1;padding:0}
.img-thumbs .uploading{display:flex;align-items:center;justify-content:center;width:110px;height:110px;border:1px dashed var(--line);border-radius:4px;color:var(--soft);font-size:.7rem}
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
/* 詳細ページプレビュー */
#preview2 .e-ticket{border:1px dashed var(--gold);border-radius:6px;overflow:hidden;background:var(--screen)}
#preview2 .e-head{background:var(--dark);color:var(--screen);padding:14px 18px;position:relative;border-bottom:2px dashed var(--screen)}
#preview2 .e-stub{position:absolute;top:8px;right:12px;font-size:.6rem;letter-spacing:.3em;color:var(--gold);font-weight:700}
#preview2 .e-date{font-size:.85rem;color:var(--gold);letter-spacing:.12em}
#preview2 .e-head h3{font-size:1.15rem;margin-top:2px}
#preview2 .e-body{padding:14px 18px}
#preview2 .e-row{display:grid;grid-template-columns:90px 1fr;gap:4px 14px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:.85rem}
#preview2 .e-row dt{font-weight:700;font-size:.72rem;color:var(--soft);letter-spacing:.15em;padding-top:2px}
#preview2 .e-tk{display:flex;justify-content:space-between;max-width:240px}
#preview2 .e-btn{display:inline-block;margin-top:12px;background:var(--gold);color:var(--dark);font-weight:700;font-size:.78rem;letter-spacing:.12em;padding:8px 22px;border-radius:2px}
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
  <div class="tabs">
    <button id="tabSchedBtn" class="on">スケジュール</button>
    <button id="tabNewsBtn">ニュース</button>
  </div>

  <div id="tab-sched">
  <div class="card">
    <h2><span id="formTitle">公演を追加</span>
      <button type="button" class="small" id="importBtn">概要ジェネレータJSONを読み込む</button>
    </h2>
    <input type="file" id="importFile" accept=".json,application/json" hidden>

    <div class="ai-box">
      <p class="ai-title">🤖 AI解析 — フライヤー画像や告知テキストからフォームを自動入力</p>
      <textarea id="aiText" rows="3" placeholder="告知テキストを貼り付け（SNSの告知文・メールなど何でもOK）"></textarea>
      <div class="ai-actions">
        <button type="button" class="small" id="aiImageBtn">📷 フライヤー画像を選ぶ</button>
        <span id="aiImageName" class="hint"></span>
        <button type="button" class="primary small" id="aiRun">解析してフォームに反映</button>
      </div>
      <input type="file" id="aiImage" accept="image/*" hidden>
    </div>

    <form id="f">
      <input type="hidden" id="id">
      <div class="row">
        <div><label>公演日 *</label><input type="date" id="date" required></div>
        <div><label>出演形態 *</label>
          <select id="type">
            <option value="band">バンド（フルメンバー）</option>
            <option value="band_support">バンド（keyサポート）</option>
            <option value="solo_acoustic">銀幕一楼ソロ弾き語り</option>
            <option value="solo">銀幕一楼ソロ</option>
            <option value="other">その他（自由入力）</option>
          </select>
        </div>
      </div>
      <div id="typeLabelWrap" hidden><label>出演形態（自由入力）</label><input id="typeLabel" placeholder="例: DJ出演 / トークゲスト"></div>
      <label>タイトル *</label><input id="title" list="dl-title" autocomplete="off" required>
      <label>会場 *</label><input id="venue" list="dl-venue" autocomplete="off">
      <div class="row">
        <div><label>都道府県</label>
          <select id="pref"><option value="">未設定</option></select>
        </div>
        <div id="prefLabelWrap" hidden><label>地域（自由入力）</label><input id="prefLabel" placeholder="例: 台湾・台北 / ソウル"></div>
      </div>
      <div class="row">
        <div><label>OPEN</label><input id="open" list="dl-open" autocomplete="off" placeholder="18:30"></div>
        <div><label>START</label><input id="start" list="dl-start" autocomplete="off" placeholder="19:00"></div>
      </div>
      <label>チケット料金</label>
      <div id="tickets"></div>
      <button type="button" class="ghost" id="addTicket">＋ 料金項目を追加（学割・配信など）</button>
      <label>ドリンク代</label><input id="drink" list="dl-drink" autocomplete="off" placeholder="例: +1drink ¥600 / +2D">
      <label>出演（対バン含む全バンド・改行区切り）</label><textarea id="lineup" rows="4" placeholder="銀幕一楼とTIMECAFE&#10;○○バンド&#10;△△（O.A.）"></textarea>
      <label>チケット/詳細リンク</label><input id="link" type="url" placeholder="https://（毎回貼り付け。候補保存はされません）">
      <label class="chk"><input type="checkbox" id="reserve"> この公演ページに「チケット取り置きフォーム」のリンクを載せる</label>
      <label>備考（改行OK）</label><textarea id="note" rows="3" placeholder="入場順・注意事項など"></textarea>
      <label>フライヤー画像（最大4枚・自動で縮小されます）</label>
      <div id="imgThumbs" class="img-thumbs"></div>
      <button type="button" class="ghost" id="addImageBtn">＋ 画像を追加（フライヤー・タイムテーブルなど）</button>
      <input type="file" id="imgFile" accept="image/*" multiple hidden>

      <label>公開日時（情報解禁）</label><input type="datetime-local" id="publishAt">
      <p class="hint">空欄なら即公開。指定するとその時刻までサイトに表示されません。</p>

      <label style="margin-top:16px">サイトでの見え方プレビュー（一覧）</label>
      <div id="preview"></div>
      <label style="margin-top:14px">詳細ページのプレビュー（見出しクリック先）</label>
      <div id="preview2"></div>

      <div style="margin-top:16px;display:flex;gap:10px">
        <button type="submit" class="primary" id="submitBtn">追加する</button>
        <button type="button" id="cancelEdit" hidden>編集をやめる</button>
      </div>
    </form>
    <datalist id="dl-title"></datalist>
    <datalist id="dl-venue"></datalist>
    <datalist id="dl-open"></datalist>
    <datalist id="dl-start"></datalist>
    <datalist id="dl-drink"></datalist>
  </div>
  <div class="card">
    <h2>登録済み公演</h2>
    <div id="list"></div>
  </div>
  <div class="card">
    <h2>来訪者カウンター</h2>
    <p style="font-size:.95rem">現在のカウント: <b id="visitorCount" style="font-size:1.3rem">…</b> 人</p>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <input id="visitorSet" inputmode="numeric" placeholder="設定したい数値（空欄で0）" style="max-width:240px">
      <button type="button" class="danger" id="visitorReset">この数値にリセット</button>
    </div>
    <p class="hint">サイトのトップページが表示されるたびに1ずつ増えます。</p>
  </div>
  </div><!-- /tab-sched -->

  <div id="tab-news" hidden>
  <div class="card">
    <h2><span id="nFormTitle">ニュースを追加</span></h2>
    <form id="nf">
      <input type="hidden" id="nId">
      <div class="row">
        <div><label>日付 *</label><input type="date" id="nDate" required></div>
        <div><label>カテゴリ</label><input id="nCategory" list="dl-ncat" autocomplete="off" placeholder="NEWS" value="NEWS"></div>
      </div>
      <label>タイトル *</label><input id="nTitle" required>
      <label>本文（改行OK・URLは自動でリンクになります）</label><textarea id="nBody" rows="6" placeholder="お知らせの本文。URLを貼るとサイト上で自動的にリンクになります"></textarea>
      <label>画像（最大4枚・自動で縮小されます）</label>
      <div id="nImgThumbs" class="img-thumbs"></div>
      <button type="button" class="ghost" id="nAddImageBtn">＋ 画像を追加</button>
      <input type="file" id="nImgFile" accept="image/*" multiple hidden>
      <label>公開日時（情報解禁）</label><input type="datetime-local" id="nPublishAt">
      <p class="hint">空欄なら即公開。指定するとその時刻までサイトに表示されません。</p>
      <div style="margin-top:16px;display:flex;gap:10px">
        <button type="submit" class="primary" id="nSubmitBtn">追加する</button>
        <button type="button" id="nCancelEdit" hidden>編集をやめる</button>
      </div>
    </form>
    <datalist id="dl-ncat"><option value="NEWS"><option value="MEDIA"><option value="RELEASE"><option value="GOODS"><option value="INFO"></datalist>
  </div>
  <div class="card">
    <h2>登録済みニュース</h2>
    <div id="nList"></div>
  </div>
  </div><!-- /tab-news -->
</div>
</main>
<script>
const $ = id => document.getElementById(id);
const TYPE_LABELS = {band:'バンド（フルメンバー）', band_support:'バンド（keyサポート）', solo_acoustic:'銀幕一楼ソロ弾き語り', solo:'銀幕一楼ソロ'};
const DOW = ['日','月','火','水','木','金','土'];
const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
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

/* ---- 都道府県 ---- */
(function initPref(){
  const sel = $('pref');
  for(const p of PREFS){
    const o = document.createElement('option'); o.value = p; o.textContent = p; sel.appendChild(o);
  }
  const other = document.createElement('option'); other.value = 'other'; other.textContent = '海外・その他（自由入力）'; sel.appendChild(other);
})();
function prefVal(){
  return $('pref').value === 'other' ? $('prefLabel').value.trim() : $('pref').value;
}
function setPref(v){
  v = String(v || '').trim();
  if(!v){ $('pref').value = ''; $('prefLabel').value = ''; }
  else if(PREFS.includes(v)){ $('pref').value = v; $('prefLabel').value = ''; }
  else { $('pref').value = 'other'; $('prefLabel').value = v; }
  $('prefLabelWrap').hidden = $('pref').value !== 'other';
}

/* ---- プレビュー ---- */
function detailText(e){
  const parts=[];
  if(e.open||e.start) parts.push([e.open?'OPEN '+e.open:'', e.start?'START '+e.start:''].filter(Boolean).join(' / '));
  const fee=(e.tickets||[]).map(t=>t.name+' ¥'+Number(t.price).toLocaleString()).join(' / ');
  if(fee) parts.push(fee);
  if(e.drink) parts.push(e.drink);
  if(e.note) parts.push(String(e.note).split('\\n').join('　／　'));
  return parts.join('　｜　');
}
function formEntry(){
  return { date:$('date').value, title:$('title').value.trim(), venue:$('venue').value.trim(),
    type:$('type').value, typeLabel:$('typeLabel').value.trim(),
    open:$('open').value.trim(), start:$('start').value.trim(),
    tickets:getTickets(), images:images.slice(0,4), drink:$('drink').value.trim(), pref:prefVal(), lineup:$('lineup').value.trim(), reserve:$('reserve').checked, note:$('note').value.trim(), link:$('link').value.trim(), publishAt:$('publishAt').value };
}
function preview(){
  const e = formEntry();
  const d = e.date ? new Date(e.date+'T00:00') : null;
  const tag = '<span class="tag '+(isFill(e.type)?'fill':'line')+'">'+esc(typeLabelOf(e))+'</span>';
  $('preview').innerHTML = '<div class="p-item">'
    + '<div class="p-date">'+(d?'<span class="d">'+d.getDate()+'</span><span class="m">'+d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'</span><span class="w">'+DOW[d.getDay()]+'</span>':'<span class="m">日付未定</span>')+'</div>'
    + '<div><div class="p-title">'+esc(e.title||'タイトル')+'　'+tag+'</div>'
    + '<div class="p-venue">'+esc(e.venue||'会場')+(e.pref?'｜'+esc(e.pref):'')+'</div>'
    + (detailText(e)?'<div class="p-detail">'+esc(detailText(e))+'</div>':'')
    + '</div></div>';
  preview2(e);
}
function preview2(e){
  const d = e.date ? new Date(e.date+'T00:00') : null;
  const dateStr = d ? d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0')+' '+DOW[d.getDay()]+'曜日' : '日付未定';
  const tag = '<span class="tag '+(isFill(e.type)?'fill':'line')+'">'+esc(typeLabelOf(e))+'</span>';
  const rows = [];
  rows.push('<div class="e-row"><dt>出演</dt><dd>'+tag+'</dd></div>');
  rows.push('<div class="e-row"><dt>会場</dt><dd>'+esc(e.venue||'会場')+(e.pref?'　<span class="tag line">'+esc(e.pref)+'</span>':'')+'</dd></div>');
  if(e.open||e.start) rows.push('<div class="e-row"><dt>時間</dt><dd>'+[e.open?'OPEN '+e.open:'',e.start?'START '+e.start:''].filter(Boolean).join(' ／ ')+'</dd></div>');
  if((e.tickets||[]).length) rows.push('<div class="e-row"><dt>チケット</dt><dd>'+e.tickets.map(t=>'<span class="e-tk"><span>'+esc(t.name)+'</span><b>¥'+Number(t.price).toLocaleString()+'</b></span>').join('')+'</dd></div>');
  if(e.drink) rows.push('<div class="e-row"><dt>ドリンク</dt><dd>'+esc(e.drink)+'</dd></div>');
  if(e.lineup) rows.push('<div class="e-row"><dt>出演</dt><dd style="white-space:pre-wrap">'+esc(e.lineup)+'</dd></div>');
  if(e.note) rows.push('<div class="e-row"><dt>備考</dt><dd style="white-space:pre-wrap">'+esc(e.note)+'</dd></div>');
  $('preview2').innerHTML = '<div class="e-ticket">'
    + '<div class="e-head"><p class="e-date">'+dateStr+'</p><h3>'+esc(e.title||'タイトル')+'</h3></div>'
    + '<div class="e-body"><dl>'+rows.join('')+'</dl>'
    + ((e.images||[]).length?'<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">'+e.images.map(id=>'<img src="/img/'+id+'" style="width:90px;height:90px;object-fit:cover;border-radius:4px;border:1px solid var(--line)">').join('')+'</div>':'')
    + (e.link?'<span class="e-btn">チケット・詳細はこちら</span>':'')
    + (e.reserve?' <span class="e-btn" style="background:transparent;border:1px solid var(--gold);color:var(--ink)">チケット取り置きフォーム</span>':'')
    + '</div></div>';
}
['date','title','venue','open','start','drink','lineup','note','link','typeLabel','prefLabel','publishAt'].forEach(id=>$(id).addEventListener('input', preview));
$('type').addEventListener('change', ()=>{ $('typeLabelWrap').hidden = $('type').value!=='other'; preview(); });
$('pref').addEventListener('change', ()=>{ $('prefLabelWrap').hidden = $('pref').value!=='other'; preview(); });
$('reserve').addEventListener('change', preview);

/* ---- 入力候補（過去の登録から） ---- */
function fillDatalists(){
  const set = (id, vals)=>{ $(id).innerHTML=[...new Set(vals.filter(Boolean))].map(v=>'<option value="'+esc(v)+'">').join(''); };
  set('dl-title', entries.map(e=>e.title));
  set('dl-venue', entries.map(e=>e.venue));
  set('dl-open', entries.map(e=>e.open));
  set('dl-start', entries.map(e=>e.start));
  set('dl-drink', entries.map(e=>e.drink));
}

/* ---- フライヤー画像 ---- */
let images = [];        // 保存対象の画像ID配列（表示順）
let newImageIds = new Set();  // このセッションでアップロードした未保存ID

const IMG_MAX_SIDE = 1600, IMG_QUALITY = 0.82;

async function resizeImage(file){
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, IMG_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', IMG_QUALITY));
}

function renderThumbs(){
  $('imgThumbs').innerHTML = images.map((id,i)=>
    '<div class="th"><img src="/img/'+id+'" alt="フライヤー'+(i+1)+'">'
    + '<button type="button" class="rm" data-id="'+id+'" title="削除">×</button></div>').join('');
  $('imgThumbs').querySelectorAll('.rm').forEach(b=>b.onclick=async ()=>{
    const id = b.dataset.id;
    images = images.filter(x=>x!==id);
    if(newImageIds.has(id)){ newImageIds.delete(id); api('/api/image/'+id,{method:'DELETE'}).catch(()=>{}); }
    renderThumbs(); preview();
  });
  $('addImageBtn').hidden = images.length >= 4;
}

$('addImageBtn').onclick = ()=>$('imgFile').click();
$('imgFile').addEventListener('change', async ev=>{
  const files = [...ev.target.files].slice(0, 4 - images.length);
  ev.target.value='';
  for(const file of files){
    const ph = document.createElement('div'); ph.className='uploading'; ph.textContent='縮小中…';
    $('imgThumbs').appendChild(ph);
    try{
      const blob = await resizeImage(file);
      ph.textContent = 'アップロード中…';
      const r = await fetch('/api/image', {method:'POST', headers:{'content-type':'image/jpeg'}, body: blob});
      const d = await r.json();
      if(!r.ok) throw new Error(d.error||'アップロード失敗');
      images.push(d.id); newImageIds.add(d.id);
    }catch(e){ msg(file.name+': '+e.message, false); }
    ph.remove();
  }
  renderThumbs(); preview();
});

/* ---- AI解析 ---- */
let aiImageData = null;
$('aiImageBtn').onclick = ()=>$('aiImage').click();
$('aiImage').addEventListener('change', ev=>{
  const file = ev.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    aiImageData = { base64: reader.result.split(',')[1], mime: file.type || 'image/jpeg' };
    $('aiImageName').textContent = file.name;
  };
  reader.readAsDataURL(file);
  ev.target.value='';
});

function applyParsed(r){
  if(r.date) $('date').value = r.date;
  if(r.title) $('title').value = r.title;
  if(r.venue) $('venue').value = r.venue;
  if(r.open) $('open').value = r.open;
  if(r.start) $('start').value = r.start;
  if(r.drink) $('drink').value = r.drink;
  if(r.pref) setPref(r.pref);
  if(r.lineup) $('lineup').value = r.lineup;
  if(r.note) $('note').value = r.note;
  if(r.link) $('link').value = r.link;
  if(r.tickets && r.tickets.length){
    $('tickets').innerHTML='';
    r.tickets.forEach(t=>ticketRow(t.name, String(t.price)));
  }
  preview();
}

$('aiRun').onclick = async ()=>{
  const text = $('aiText').value.trim();
  if(!text && !aiImageData){ msg('テキストを貼るか画像を選んでください', false); return; }
  $('aiRun').disabled = true; $('aiRun').textContent = '解析中…';
  try{
    const r = await api('/api/parse', {method:'POST', body: JSON.stringify({
      text: text || undefined,
      imageBase64: aiImageData ? aiImageData.base64 : undefined,
      mimeType: aiImageData ? aiImageData.mime : undefined
    })});
    applyParsed(r);
    msg('解析結果をフォームに反映しました。内容を確認・修正してから追加してください', true);
    $('aiText').value=''; aiImageData=null; $('aiImageName').textContent='';
  }catch(e){ msg(e.message, false); }
  $('aiRun').disabled = false; $('aiRun').textContent = '解析してフォームに反映';
};

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
      if(o.drinks && o.drinks.length) $('drink').value = o.drinks.map(t=>t.name+' ¥'+t.price).join(' / ');
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
      + '<div class="t">'+esc(e.title)+'<small>'+esc(e.venue)+(e.pref?'（'+esc(e.pref)+'）':'')
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
  ['date','title','venue','type','typeLabel','open','start','drink','lineup','note','link','publishAt'].forEach(k=>$(k).value=e[k]||'');
  $('typeLabelWrap').hidden = e.type!=='other';
  setPref(e.pref);
  $('tickets').innerHTML='';
  (e.tickets&&e.tickets.length ? e.tickets : [{name:'前売',price:''},{name:'当日',price:''}]).forEach(t=>ticketRow(t.name,t.price));
  $('id').value = e.id;
  images = (e.images||[]).slice(); newImageIds = new Set(); renderThumbs();
  $('reserve').checked = !!e.reserve;
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
  $('prefLabelWrap').hidden=true;
  $('tickets').innerHTML=''; ticketRow('前売',''); ticketRow('当日','');
  images = []; newImageIds = new Set(); renderThumbs();
  $('formTitle').textContent='公演を追加'; $('submitBtn').textContent='追加する'; $('cancelEdit').hidden=true;
  preview();
}
$('cancelEdit').onclick = resetForm;

$('f').onsubmit = async ev => {
  ev.preventDefault();
  const id = $('id').value;
  try{
    await api(id?'/api/schedule/'+id:'/api/schedule', {method:id?'PUT':'POST', body:JSON.stringify(formEntry())});
    newImageIds = new Set();
    msg(id?'保存しました':'追加しました', true); resetForm(); refresh();
  }catch(e){ msg(e.message, false); }
};

/* ---- 来訪者カウンター ---- */
async function refreshCount(){
  try{ const d = await (await fetch('/api/count')).json(); $('visitorCount').textContent = d.count.toLocaleString(); }catch(e){}
}
$('visitorReset').onclick = async ()=>{
  const v = $('visitorSet').value.trim() || '0';
  if(!confirm('カウンターを '+v+' にリセットしますか？')) return;
  try{
    const d = await api('/api/count/reset',{method:'POST',body:JSON.stringify({value:v})});
    $('visitorCount').textContent = d.count.toLocaleString();
    $('visitorSet').value='';
    msg('カウンターを '+d.count+' にしました', true);
  }catch(e){ msg(e.message,false); }
};

/* ---- タブ ---- */
function setTab(sched){
  $('tab-sched').hidden = !sched; $('tab-news').hidden = sched;
  $('tabSchedBtn').classList.toggle('on', sched);
  $('tabNewsBtn').classList.toggle('on', !sched);
}
$('tabSchedBtn').onclick = ()=>setTab(true);
$('tabNewsBtn').onclick = ()=>setTab(false);

/* ---- ニュース ---- */
let newsEntries = [];

let nImages = [], nNewImageIds = new Set();

function renderNThumbs(){
  $('nImgThumbs').innerHTML = nImages.map((id,i)=>
    '<div class="th"><img src="/img/'+id+'" alt="画像'+(i+1)+'">'
    + '<button type="button" class="rm" data-id="'+id+'" title="削除">×</button></div>').join('');
  $('nImgThumbs').querySelectorAll('.rm').forEach(b=>b.onclick=async ()=>{
    const id = b.dataset.id;
    nImages = nImages.filter(x=>x!==id);
    if(nNewImageIds.has(id)){ nNewImageIds.delete(id); api('/api/image/'+id,{method:'DELETE'}).catch(()=>{}); }
    renderNThumbs();
  });
  $('nAddImageBtn').hidden = nImages.length >= 4;
}

$('nAddImageBtn').onclick = ()=>$('nImgFile').click();
$('nImgFile').addEventListener('change', async ev=>{
  const files = [...ev.target.files].slice(0, 4 - nImages.length);
  ev.target.value='';
  for(const file of files){
    const ph = document.createElement('div'); ph.className='uploading'; ph.textContent='縮小中…';
    $('nImgThumbs').appendChild(ph);
    try{
      const blob = await resizeImage(file);
      ph.textContent = 'アップロード中…';
      const r = await fetch('/api/image', {method:'POST', headers:{'content-type':'image/jpeg'}, body: blob});
      const d = await r.json();
      if(!r.ok) throw new Error(d.error||'アップロード失敗');
      nImages.push(d.id); nNewImageIds.add(d.id);
    }catch(e){ msg(file.name+': '+e.message, false); }
    ph.remove();
  }
  renderNThumbs();
});

async function refreshNews(){
  newsEntries = await api('/api/news');
  const now = Date.now();
  $('nList').innerHTML = newsEntries.map(e=>{
    const waiting = e.publishAt && new Date(e.publishAt).getTime() > now;
    return '<div class="item">'
      + '<span class="d">'+e.date.replaceAll('-','.')+'</span>'
      + '<span class="badge line">'+esc(e.category)+'</span>'
      + '<div class="t">'+esc(e.title)+(e.body?'<small>'+esc(e.body.split('\\n')[0].slice(0,60))+'</small>':'')+'</div>'
      + (waiting?'<span class="badge wait">'+e.publishAt.replace('T',' ')+' 解禁</span>':'')
      + '<button class="small" onclick="editNews(\\''+e.id+'\\')">編集</button>'
      + '<button class="small danger" onclick="delNews(\\''+e.id+'\\')">削除</button>'
      + '</div>';
  }).join('') || '<p class="hint">まだ登録がありません。</p>';
}

window.editNews = id => {
  const e = newsEntries.find(x=>x.id===id); if(!e) return;
  $('nId').value=e.id; $('nDate').value=e.date; $('nCategory').value=e.category;
  $('nTitle').value=e.title; $('nBody').value=e.body||''; $('nPublishAt').value=e.publishAt||'';
  nImages = (e.images||[]).slice(); nNewImageIds = new Set(); renderNThumbs();
  $('nFormTitle').textContent='ニュースを編集'; $('nSubmitBtn').textContent='保存する'; $('nCancelEdit').hidden=false;
  window.scrollTo({top:0,behavior:'smooth'});
};
window.delNews = async id => {
  const e = newsEntries.find(x=>x.id===id);
  if(!confirm((e?e.date+' '+e.title:'このニュース')+' を削除しますか？')) return;
  await api('/api/news/'+id,{method:'DELETE'});
  msg('削除しました', true); refreshNews();
};

function resetNewsForm(){
  $('nf').reset(); $('nId').value=''; $('nCategory').value='NEWS';
  nImages = []; nNewImageIds = new Set(); renderNThumbs();
  $('nFormTitle').textContent='ニュースを追加'; $('nSubmitBtn').textContent='追加する'; $('nCancelEdit').hidden=true;
}
$('nCancelEdit').onclick = resetNewsForm;

$('nf').onsubmit = async ev => {
  ev.preventDefault();
  const id = $('nId').value;
  const body = { date:$('nDate').value, category:$('nCategory').value.trim(),
    title:$('nTitle').value.trim(), body:$('nBody').value.trim(),
    images:nImages.slice(0,4), publishAt:$('nPublishAt').value };
  try{
    await api(id?'/api/news/'+id:'/api/news', {method:id?'PUT':'POST', body:JSON.stringify(body)});
    nNewImageIds = new Set();
    msg(id?'保存しました':'追加しました', true); resetNewsForm(); refreshNews();
  }catch(e){ msg(e.message, false); }
};

$('doLogin').onclick = async () => {
  try{ await api('/api/login',{method:'POST',body:JSON.stringify({password:$('pw').value})}); $('pw').value=''; show(true); refresh(); refreshNews(); refreshCount(); }
  catch(e){ msg(e.message,false); }
};
$('pw').addEventListener('keydown', e=>{ if(e.key==='Enter') $('doLogin').click(); });
$('logout').onclick = () => { document.cookie='gnk_session=; Path=/; Max-Age=0'; show(false); };

resetForm();
(async ()=>{ try{ await refresh(); refreshNews(); refreshCount(); show(true); } catch(e){ show(false); } })();
</script>
</body>
</html>`;
