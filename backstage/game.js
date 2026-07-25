// 楽屋RPG - 銀幕一楼とTIMECAFE
// 256x176 の楽屋を歩き回ってメンバーと会話・家具を調べる
// セリフは scenario.json（editor.html で編集可能）

let W = 256, H = 176, WALL = 48; // 部屋（ワールド）サイズ（scenario.json の layout.room で上書き）
const VW = 176, VH = 144; // 画面（ビューポート）サイズ。マップが広がってもここは固定＝操作感が変わらない
const S = 3; // 内部解像度倍率。文字をくっきり描くためキャンバスは論理サイズのS倍で持つ
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VW * S;
canvas.height = VH * S;

function resetTransform() {
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
resetTransform();

// カメラ: 主人公を中心に、マップ端では止まる。マップが画面より小さい軸は中央寄せ
function cameraPos() {
  const cx = W <= VW ? (W - VW) / 2 : Math.min(W - VW, Math.max(0, player.x + 8 - VW / 2));
  const cy = H <= VH ? (H - VH) / 2 : Math.min(H - VH, Math.max(0, player.y + 8 - VH / 2));
  return { cx: Math.round(cx), cy: Math.round(cy) };
}

// ---- アセット読み込み ----
const ROOM_IMGS = ['tile_floor','tile_wall','door','sofa','tv','arcade','fridge','mirror','rack','poster_a','poster_b','setlist','table','amp','rug'];
const MEMBER_IMGS = ['ginmaku','kenta','takashi','ayako','saeko','you'];
const img = {};
let loaded = 0, total = ROOM_IMGS.length + MEMBER_IMGS.length;
function load(name, src) {
  const im = new Image();
  im.src = src;
  im.onload = () => { loaded++; };
  img[name] = im;
}
ROOM_IMGS.forEach(n => load(n, `assets/room/${n}.png`));
MEMBER_IMGS.forEach(n => load(n, `assets/member/${n}.png`));

// ---- シナリオ読み込み ----
// 優先順: ?draft=1 → 管理画面の下書き(KV) / 通常 → ローカル下書き(開発用) → KV公開版 → 同梱scenario.json
const DRAFT_KEY = 'gakuya_scenario_draft';
const SCENARIO_API = 'https://admin.ginmakuichiro.net/data/backstage/scenario.json';
let scenario = null;
let usingDraft = false;
(function loadScenario() {
  const preview = new URLSearchParams(location.search).get('draft') === '1';
  if (!preview) {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      try {
        const d = JSON.parse(draft);
        if (d.layout) { // 旧形式（配置データなし）の下書きは無視
          scenario = d;
          usingDraft = true;
          return;
        }
      } catch (e) { /* 壊れた下書きは無視 */ }
    }
  }
  const fallback = () =>
    fetch('scenario.json', { cache: 'no-cache' })
      .then(r => r.json())
      .then(d => { scenario = d; });
  fetch(SCENARIO_API + (preview ? '?draft=1' : ''), { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('not published'); return r.json(); })
    .then(d => { scenario = d; usingDraft = preview; })
    .catch(fallback);
})();

// ---- ライブ情報（公式サイトと同じAPIから取得）----
// セリフ中の {{next_live}} が直近のライブ情報（最大3件）に展開される
const SCHEDULE_URL = 'https://admin.ginmakuichiro.net/data/schedule.json';
let upcomingLives = null; // null=取得中/失敗, []=公演なし
fetch(SCHEDULE_URL)
  .then(r => r.json())
  .then(list => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    upcomingLives = list
      .filter(s => s.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3);
    // ライブまでの日数 → カウントダウンとフラグ
    if (upcomingLives.length) {
      const [y, m, d] = upcomingLives[0].date.split('-').map(Number);
      const diff = Math.round((new Date(y, m - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
      liveDays = diff;
      if (diff === 0) flags.live_today = true;
      if (diff === 1) flags.live_tomorrow = true;
      if (diff <= 7) flags.live_soon = true;
    }
  })
  .catch(() => { upcomingLives = null; });
let liveDays = null; // 次のライブまでの日数（0=今日）

// ---- 最新ニュース ----
let latestNews = null;
fetch('https://admin.ginmakuichiro.net/data/news.json')
  .then(r => r.json())
  .then(list => { latestNews = list.slice(0, 3); })
  .catch(() => {});

// ---- 訪問者カウンター（トップページと同じ数字）----
let visitors = null;
fetch('https://admin.ginmakuichiro.net/api/count')
  .then(r => r.json())
  .then(d => { visitors = d.count; })
  .catch(() => {});

// ---- 天気（東京・Open-Meteo）----
let weatherWord = null;
fetch('https://api.open-meteo.com/v1/forecast?latitude=35.69&longitude=139.69&current=weather_code')
  .then(r => r.json())
  .then(d => {
    const c = d.current.weather_code;
    if (c === 0) { weatherWord = '快晴'; flags.weather_clear = true; }
    else if (c <= 2) { weatherWord = '晴れ'; flags.weather_clear = true; }
    else if (c === 3) { weatherWord = 'くもり'; flags.weather_cloudy = true; }
    else if (c === 45 || c === 48) { weatherWord = '霧'; flags.weather_cloudy = true; }
    else if (c >= 71 && c <= 77 || c === 85 || c === 86) { weatherWord = '雪'; flags.weather_snow = true; }
    else if (c >= 95) { weatherWord = '雷雨'; flags.weather_rain = true; }
    else { weatherWord = '雨'; flags.weather_rain = true; }
  })
  .catch(() => {});

function formatLive(s) {
  const [y, m, d] = s.date.split('-').map(Number);
  const wd = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  let t = `${m}月${d}日(${wd})`;
  if (s.title) t += ` 「${s.title}」`;
  if (s.venue) t += ` ${s.venue}`;
  if (s.open || s.start) t += ` 開場${s.open || '-'} / 開演${s.start || '-'}`;
  return t;
}

function formatNews(n) {
  const [y, m, d] = n.date.split('-').map(Number);
  return `【${n.category}】${n.title}（${m}月${d}日）`;
}

function countdownText() {
  if (liveDays === null) return '未定';
  if (liveDays === 0) return 'なんと今日';
  return `あと${liveDays}日`;
}

function expandLines(lines) {
  return lines.flatMap(l => {
    // 複数行に展開されるプレースホルダ
    if (l.includes('{{next_live}}')) {
      if (!upcomingLives) return ['（ライブ情報がうまく取れなかったみたい。公式サイトを見てね！）'];
      if (!upcomingLives.length) return ['次のライブは準備中！発表を楽しみに待っててね。'];
      return upcomingLives.map(formatLive);
    }
    if (l.includes('{{news}}')) {
      if (!latestNews || !latestNews.length) return ['（最近のニュースは公式サイトでチェックしてね！）'];
      return latestNews.map(formatNews);
    }
    // 文中に埋め込むプレースホルダ
    return [l
      .replace(/\{\{visitors\}\}/g, visitors !== null ? visitors.toLocaleString() : 'たくさん')
      .replace(/\{\{live_countdown\}\}/g, countdownText())
      .replace(/\{\{weather\}\}/g, weatherWord || 'どんな天気か分からない')
    ];
  });
}

// ---- 配置（scenario.json の layout から構築）----
// 衝突判定と「調べる」ポイントはスプライトの位置・サイズから自動生成
let furniture = [];
let solids = [];
let objectSpots = [];
let npcs = [];
const player = { id: 'you', x: 16, y: 120, speed: 1.2 };
let layoutReady = false;

function applyLayout() {
  const L = scenario.layout;
  const room = L.room || { w: 256, h: 176, wall: 48 };
  W = room.w; H = room.h; WALL = room.wall;
  furniture = L.furniture;
  npcs = L.npcs.map(n => ({ ...n }));
  player.x = L.player.x;
  player.y = L.player.y;

  solids = [{ x: 0, y: 0, w: W, h: WALL }]; // 壁
  objectSpots = [];
  for (const f of furniture) {
    const im = img[f.n];
    const bottom = f.y + im.height;
    if (!f.walkable && bottom > WALL + 2) {
      // 足元だけ通れなくする（ポスター等、壁の上で完結するものは対象外）
      solids.push({ x: f.x + 1, y: bottom - 6, w: im.width - 2, h: 6 });
    }
    if (f.examine && scenario.objects && scenario.objects[f.n]) {
      objectSpots.push({
        id: f.n,
        x: f.x + im.width / 2,
        y: Math.max(bottom + 4, WALL + 6),
      });
    }
  }
  layoutReady = true;
}

// ---- ゲーム状態 ----
const flags = {};            // シナリオのフラグ
// 時間帯フラグ（表示条件に使える）: time_morning 5-10時 / time_day 11-17時 / time_evening 18-22時 / time_night 23-4時
{
  const h = new Date().getHours();
  if (h >= 5 && h <= 10) flags.time_morning = true;
  else if (h >= 11 && h <= 17) flags.time_day = true;
  else if (h >= 18 && h <= 22) flags.time_evening = true;
  else flags.time_night = true;
}
const usedOnce = new Set();  // 一度きりのトピック消化記録 "speakerId:topicIdx"
const talkCount = {};        // speakerId -> 話しかけた回数（ローテーション用）

// ---- 会話状態 ----
const dialog = {
  active: false,
  name: '',
  lines: [],
  lineIdx: 0,
  chars: 0,
  phase: 'lines',   // 'lines' | 'choice'
  choices: null,
  choiceIdx: 0,
  pendingSet: null, // トピック終了時に立てるフラグ
};

function checkCond(cond) {
  if (!cond) return true;
  if (cond.startsWith('!')) return !flags[cond.slice(1)];
  return !!flags[cond];
}

// 話しかけ/調べた時のトピック選択：
// 「一度だけ」のトピック（イベント）が最優先。
// それ以外は条件を満たすもの全部を、話しかけるたびに上から順にローテーション
function pickTopic(speakerId, topics) {
  const eligible = [];
  topics.forEach((t, i) => {
    if (t.once && usedOnce.has(`${speakerId}:${i}`)) return;
    if (!checkCond(t.if)) return;
    eligible.push({ t, i });
  });
  if (!eligible.length) return null;
  const onceTopic = eligible.find(e => e.t.once);
  if (onceTopic) return onceTopic;
  const count = talkCount[speakerId] || 0;
  return eligible[count % eligible.length];
}

function startDialog(speakerId, data) {
  const picked = pickTopic(speakerId, data.topics || []);
  if (!picked) return;
  const { t, i } = picked;
  if (t.once) usedOnce.add(`${speakerId}:${i}`);
  talkCount[speakerId] = (talkCount[speakerId] || 0) + 1;
  dialog.active = true;
  dialog.name = data.name || speakerId;
  dialog.lines = t.lines && t.lines.length ? expandLines(t.lines) : ['……'];
  dialog.lineIdx = 0;
  dialog.chars = 0;
  dialog.phase = 'lines';
  dialog.choices = t.choices && t.choices.length ? t.choices : null;
  dialog.choiceIdx = 0;
  dialog.pendingSet = t.set || null;
  dialog.pendingUrl = t.url || null;
}

function endDialog() {
  if (dialog.pendingSet) flags[dialog.pendingSet] = true;
  dialog.active = false;
  dialog.choices = null;
  dialog.pendingSet = null;
  if (dialog.pendingUrl) {
    const url = dialog.pendingUrl;
    dialog.pendingUrl = null;
    window.location.href = url; // 会話を終えてからページ移動（例: ドアから退出）
  }
}

// ---- 対象検索 ----
function nearestNpc() {
  let best = null, bestD = 22;
  for (const n of npcs) {
    const d = Math.hypot(n.x - player.x, n.y - player.y);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}
function nearestObject() {
  let best = null, bestD = 20;
  for (const o of objectSpots) {
    const d = Math.hypot(o.x - player.x, o.y - player.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

// ---- アクション（Z/スペース/話すボタン）----
function action() {
  if (!scenario) return;
  if (dialog.active) {
    if (dialog.phase === 'choice') {
      const c = dialog.choices[dialog.choiceIdx];
      if (c.set) flags[c.set] = true;
      if (c.url) dialog.pendingUrl = c.url;
      dialog.choices = null;
      if (c.lines && c.lines.length) {
        dialog.lines = expandLines(c.lines);
        dialog.lineIdx = 0;
        dialog.chars = 0;
        dialog.phase = 'lines';
      } else {
        endDialog();
      }
      return;
    }
    const line = dialog.lines[dialog.lineIdx];
    if (dialog.chars < line.length) {
      dialog.chars = line.length;
    } else if (dialog.lineIdx < dialog.lines.length - 1) {
      dialog.lineIdx++; dialog.chars = 0;
    } else if (dialog.choices) {
      dialog.phase = 'choice';
      dialog.choiceIdx = 0;
    } else {
      endDialog();
    }
    return;
  }
  const npc = nearestNpc();
  if (npc && scenario.npcs[npc.id]) { startDialog(npc.id, scenario.npcs[npc.id]); return; }
  const obj = nearestObject();
  if (obj && scenario.objects[obj.id]) startDialog(obj.id, scenario.objects[obj.id]);
}

function moveCursor(dir) {
  if (!(dialog.active && dialog.phase === 'choice')) return false;
  const n = dialog.choices.length;
  if (dir === 'up') dialog.choiceIdx = (dialog.choiceIdx + n - 1) % n;
  if (dir === 'down') dialog.choiceIdx = (dialog.choiceIdx + 1) % n;
  return true;
}

// ---- 入力 ----
const keys = {};
addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
  if (dialog.active && dialog.phase === 'choice') {
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { moveCursor('up'); return; }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { moveCursor('down'); return; }
  }
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'z' || e.key === 'Z' || e.key === ' ' || e.key === 'Enter') action();
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// モバイルパッド
document.querySelectorAll('#dpad .pbtn').forEach(b => {
  const dir = b.dataset.dir;
  const map = { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };
  const on = e => {
    e.preventDefault();
    if ((dir === 'up' || dir === 'down') && moveCursor(dir)) return;
    keys[map[dir]] = true;
  };
  const off = e => { e.preventDefault(); keys[map[dir]] = false; };
  b.addEventListener('touchstart', on); b.addEventListener('touchend', off);
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off);
});
const btnA = document.getElementById('btnA');
btnA.addEventListener('touchstart', e => { e.preventDefault(); action(); });
btnA.addEventListener('mousedown', e => { e.preventDefault(); action(); });

// ---- 更新 ----
function collides(x, y) {
  const fx = x + 4, fy = y + 12, fw = 8, fh = 4;
  if (fx < 0 || fx + fw > W || fy + fh > H) return true;
  for (const s of solids) {
    if (fx < s.x + s.w && fx + fw > s.x && fy < s.y + s.h && fy + fh > s.y) return true;
  }
  for (const n of npcs) {
    if (fx < n.x + 12 && fx + fw > n.x + 4 && fy < n.y + 16 && fy + fh > n.y + 10) return true;
  }
  return false;
}

function update() {
  if (dialog.active) {
    if (dialog.phase === 'lines' && dialog.chars < dialog.lines[dialog.lineIdx].length) dialog.chars += 0.5;
    return;
  }
  let dx = 0, dy = 0;
  if (keys['arrowup'] || keys['w']) dy = -1;
  if (keys['arrowdown'] || keys['s']) dy = 1;
  if (keys['arrowleft'] || keys['a']) dx = -1;
  if (keys['arrowright'] || keys['d']) dx = 1;
  if (dx && dy) { dx *= 0.707; dy *= 0.707; }
  const nx = player.x + dx * player.speed;
  const ny = player.y + dy * player.speed;
  if (!collides(nx, player.y)) player.x = nx;
  if (!collides(player.x, ny)) player.y = ny;
}

// ---- 描画 ----
function drawRoom() {
  for (let x = 0; x < W; x += 16) {
    for (let y = 0; y < WALL; y += 16) ctx.drawImage(img.tile_wall, x, y);
    for (let y = WALL; y < H; y += 16) ctx.drawImage(img.tile_floor, x, y);
  }
  for (const f of furniture) ctx.drawImage(img[f.n], f.x, f.y);
}

function drawSprites() {
  const all = [...npcs, player].sort((a, b) => a.y - b.y);
  for (const s of all) ctx.drawImage(img[s.id], Math.round(s.x), Math.round(s.y));
  if (!dialog.active) {
    const npc = nearestNpc();
    if (npc) {
      ctx.fillStyle = '#f2d178';
      ctx.font = 'bold 8px monospace';
      ctx.fillText('!', Math.round(npc.x) + 7, Math.round(npc.y) - 2);
    } else {
      const obj = nearestObject();
      if (obj) {
        ctx.fillStyle = '#9ee1ff';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('?', obj.x - 2, obj.y - 8);
      }
    }
  }
}

function wrapText(text, maxW, x, yStart, lineH) {
  let line = '', ty = yStart;
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW) {
      ctx.fillText(line, x, ty);
      ty += lineH; line = ch;
    } else line += ch;
  }
  ctx.fillText(line, x, ty);
  return ty;
}

function drawDialog() {
  if (!dialog.active) return;
  const bx = 6, by = VH - 52, bw = VW - 12, bh = 46;
  ctx.fillStyle = 'rgba(17,17,17,0.92)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#dde4e8';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
  ctx.fillStyle = '#f2d178';
  ctx.font = 'bold 8px sans-serif';
  ctx.fillText(dialog.name, bx + 7, by + 11);
  ctx.fillStyle = '#ffffff';
  ctx.font = '7px sans-serif';
  const text = dialog.lines[dialog.lineIdx].slice(0, Math.floor(dialog.chars));
  wrapText(text, bw - 18, bx + 7, by + 21, 9);
  const lineDone = Math.floor(dialog.chars) >= dialog.lines[dialog.lineIdx].length;
  if (dialog.phase === 'lines' && lineDone && (Date.now() / 400 | 0) % 2) {
    ctx.fillStyle = '#f2d178';
    ctx.fillText('▼', bx + bw - 12, by + bh - 6);
  }
  // 選択肢ウィンドウ
  if (dialog.phase === 'choice') {
    const ch = dialog.choices.length * 13 + 8;
    const cw = Math.max(...dialog.choices.map(c => ctx.measureText(c.label).width)) + 26;
    const cx = bx + bw - cw - 4, cy = by - ch - 2;
    ctx.fillStyle = 'rgba(17,17,17,0.95)';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = '#f2d178';
    ctx.strokeRect(cx + 1.5, cy + 1.5, cw - 3, ch - 3);
    dialog.choices.forEach((c, i) => {
      const ty = cy + 13 + i * 13;
      ctx.fillStyle = i === dialog.choiceIdx ? '#f2d178' : '#ffffff';
      if (i === dialog.choiceIdx) ctx.fillText('▶', cx + 5, ty);
      ctx.fillText(c.label, cx + 15, ty);
    });
  }
}

function drawBadge() {
  if (!usingDraft) return;
  ctx.fillStyle = 'rgba(192,57,43,0.9)';
  ctx.fillRect(VW - 58, 2, 56, 10);
  ctx.fillStyle = '#fff';
  ctx.font = '7px sans-serif';
  ctx.fillText('下書きデータ', VW - 54, 10);
}

function frame() {
  if (loaded < total || !scenario) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#b8c2c8';
    ctx.font = '10px monospace';
    ctx.fillText('Loading...', VW / 2 - 25, VH / 2);
  } else {
    if (!layoutReady) applyLayout();
    update();
    // ワールド描画（カメラ分ずらす）
    const { cx, cy } = cameraPos();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VW, VH);
    ctx.save();
    ctx.translate(-cx, -cy);
    drawRoom();
    drawSprites();
    ctx.restore();
    // UIはスクリーン座標で描画
    drawDialog();
    drawBadge();
  }
  requestAnimationFrame(frame);
}
frame();

// デバッグ・拡張用フック
window.__game = { player, dialog, action, flags, moveCursor, get scenario() { return scenario; }, get npcs() { return npcs; } };
