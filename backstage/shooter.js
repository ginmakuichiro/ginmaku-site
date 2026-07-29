// ギャラクシー☆銀河 - 楽屋のアーケード筐体で遊べる縦シューティング
// STAGE1 銀座（敵=寿司） / STAGE2 銀河（敵=UFO）
// game.js から Shooter.start() で起動し、毎フレーム Shooter.step(keys) を呼んでもらう
(function () {
  'use strict';

  const VW = 176, VH = 144;          // game.js と同じ論理画面サイズ
  const TOP = 12;                    // 上部HUDの高さ
  const HS_KEY = 'galaxy_ginga_scores_v1';
  const SND_KEY = 'galaxy_ginga_sound';
  const WAVES = 5;                   // 1ステージあたりのウェーブ数

  /* ============================ ドット絵 ============================ */
  // 文字1つ＝1ドット。'.' は透明。パレットで色を差し替えれば色違いが作れる
  function spr(rows, pal) {
    const w = rows[0].length, h = rows.length;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const col = pal[rows[y][x]];
        if (!col) continue;
        const i = (y * w + x) * 4;
        im.data[i] = parseInt(col.slice(1, 3), 16);
        im.data[i + 1] = parseInt(col.slice(3, 5), 16);
        im.data[i + 2] = parseInt(col.slice(5, 7), 16);
        im.data[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return cv;
  }

  const SHIP_ROWS = [
    '.....W.....',
    '....WCW....',
    '....WCW....',
    '...WCCCW...',
    '..WWCCCWW..',
    '.WBWCCCWBW.',
    'WBBWCCCWBBW',
    'WBB.WCW.BBW',
    '.B..WWW..B.',
    '....RYR....',
  ];
  const SHIP = spr(SHIP_ROWS, {
    W: '#e8f4ff', C: '#6fe0ff', B: '#2b6cd4', R: '#e8503a', Y: '#ffd166',
  });

  // 握り寿司。ネタの色（r/p）を変えるだけでマグロ・サーモン・タマゴ・イカになる
  const SUSHI_ROWS = [
    '...pppppp...',
    '..prrrrrrp..',
    '.prrrrrrrrp.',
    '.rrrrrrrrrr.',
    '.wwwwwwwwww.',
    'wwwwwwwwwwww',
    'wwwwwwwwwwww',
    '.gwwwwwwwwg.',
    '..gggggggg..',
  ];
  const RICE = { w: '#f7f1e4', g: '#cdbfa6' };
  const SUSHI = [
    spr(SUSHI_ROWS, { ...RICE, r: '#e0463a', p: '#ff8474' }), // マグロ
    spr(SUSHI_ROWS, { ...RICE, r: '#ef8438', p: '#ffb87a' }), // サーモン
    spr(SUSHI_ROWS, { ...RICE, r: '#efc23f', p: '#ffe490' }), // タマゴ
    spr(SUSHI_ROWS, { ...RICE, r: '#dcd8e6', p: '#ffffff' }), // イカ
  ];

  const UFO = spr([
    '.....ccc.....',
    '...cccCCCc...',
    '..cCCwCCCCc..',
    '.sssssssssss.',
    'sSSSSSSSSSSSs',
    'sSySSSySSSySs',
    '.dSSSSSSSSSd.',
    '..ddddddddd..',
    '...y..y..y...',
  ], {
    c: '#8ceaff', C: '#33b3e6', w: '#ffffff',
    s: '#c2ccd8', S: '#6c7c8d', d: '#39434f', y: '#ffd166',
  });

  // ステージ1ボス「大トロ将軍」
  const BOSS1 = spr([
    '......pppppppppppp......',
    '....pprrrrrrrrrrrrpp....',
    '..pprrrrrrrrrrrrrrrrpp..',
    '.prrrrrrrrrrrrrrrrrrrrp.',
    'prrkkkrrrrrrrrrrrrkkkrrp',
    'prrWWkrrrrrrrrrrrrkWWrrp',
    'prrrrrrrrrrrrrrrrrrrrrrp',
    'prrrrrrrrrkkkkrrrrrrrrrp',
    '.prrrrrrrrrrrrrrrrrrrrp.',
    '..wwwwwwwwwwwwwwwwwwww..',
    '.wwwwwwwwwwwwwwwwwwwwww.',
    'wwwwwwwwwwwwwwwwwwwwwwww',
    'wwwwwwwwwwwwwwwwwwwwwwww',
    'wwwwwwwwwwwwwwwwwwwwwwww',
    '.gwwwwwwwwwwwwwwwwwwwwg.',
    '..gggggggggggggggggggg..',
  ], { ...RICE, r: '#d63b30', p: '#ff7b68', k: '#241a1a', W: '#ffffff' });

  // ステージ2ボス「マザー銀河」
  const BOSS2 = spr([
    '.............cccccc.............',
    '..........cccCCCCCCccc..........',
    '........ccCCwwCCCCCCCCcc........',
    '.......cCCCCCCCCCCCCCCCCc.......',
    '...ssssssssssssssssssssssssss...',
    '.ssSSSSSSSSSSSSSSSSSSSSSSSSSSss.',
    'sSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSs',
    'sSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSs',
    'sddSSSSSSSSSSSSSSSSSSSSSSSSSSdds',
    '.dddddddddddddddddddddddddddddd.',
    '...dddddddddddddddddddddddddd...',
    '......dddddddddddddddddddd......',
    '.....dd.......yyyy.......dd.....',
    '.....yy........yy........yy.....',
  ], {
    c: '#8ceaff', C: '#33b3e6', w: '#ffffff',
    s: '#c2ccd8', S: '#6c7c8d', d: '#39434f', y: '#ff6fae',
  });

  /* ============================ 音 ============================ */
  // 効果音は WebAudio で合成（音声ファイルなし）。既定はOFF、タイトルで切り替え
  let sndOn = localStorage.getItem(SND_KEY) === '1';
  let ac = null;
  function beep(freq, dur, type, vol) {
    if (!sndOn) return;
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), ac.currentTime + dur);
      g.gain.setValueAtTime((vol || 0.05), ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + dur);
    } catch (e) { /* 音が出せない環境では黙って無視 */ }
  }
  const sndShot = () => beep(880, 0.06, 'square', 0.03);
  const sndHit = () => beep(220, 0.12, 'sawtooth', 0.05);
  const sndBoom = () => beep(120, 0.3, 'sawtooth', 0.07);
  const sndItem = () => beep(1320, 0.14, 'triangle', 0.05);

  /* ============================ ハイスコア ============================ */
  const DEFAULT_SCORES = [
    ['GIN', 30000], ['KEN', 26000], ['TAK', 22000], ['AYA', 18000], ['SAE', 15000],
    ['TCF', 12000], ['ARC', 9000], ['SUS', 6000], ['UFO', 3000], ['YOU', 1000],
  ];
  function loadScores() {
    try {
      const v = JSON.parse(localStorage.getItem(HS_KEY));
      if (Array.isArray(v) && v.length) return v;
    } catch (e) { /* 壊れていたら初期値 */ }
    return DEFAULT_SCORES.map(s => s.slice());
  }
  let scores = loadScores();
  function saveScores() {
    try { localStorage.setItem(HS_KEY, JSON.stringify(scores)); } catch (e) { /* 保存できなくても遊べる */ }
  }

  // ---- 全員共通のランキング ----
  // サーバー（Worker+KV）の記録を正とし、取れないときは手元の記録で遊べるようにする。
  const SCORE_API = 'https://admin.ginmakuichiro.net/api/backstage/scores';
  let syncState = 'local';   // 'local' | 'ok' | 'sending'
  function applyRemote(list) {
    if (!Array.isArray(list) || !list.length) return false;
    scores = list
      .filter(e => e && typeof e.name === 'string' && typeof e.score === 'number')
      .map(e => [e.name, e.score]);
    saveScores();            // 次回オフラインでも直近の順位表が出るように控えておく
    syncState = 'ok';
    return true;
  }
  function fetchScores() {
    return fetch(SCORE_API, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d ? applyRemote(d.scores) : false))
      .catch(() => false);   // 圏外でもゲームは続けられる
  }
  fetchScores();
  function rankOf(sc) {
    for (let i = 0; i < scores.length; i++) if (sc > scores[i][1]) return i;
    return scores.length < 10 ? scores.length : -1;
  }
  const hiScore = () => (scores[0] ? scores[0][1] : 0);

  /* ============================ 状態 ============================ */
  const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!☆ ';
  let S = null;
  function newState() {
    return {
      scene: 'title', t: 0, menu: 0,
      score: 0, lives: 3, stage: 1, loop: 1, level: 1,
      wave: 0, waveT: 0, clearT: 0,
      px: VW / 2 - 5, py: VH - 26, cool: 0, inv: 90, dead: 0,
      bul: [], ebul: [], en: [], items: [], parts: [],
      boss: null, msg: '', msgT: 0,
      name: [0, 0, 0], npos: 0, nrank: -1,
      stars: [], city: 0,
    };
  }

  const held = {};
  function tap(name, down) {
    if (!down) { held[name] = 0; return false; }
    const h = (held[name] = (held[name] || 0) + 1);
    return h === 1 || (h > 22 && h % 5 === 0); // 押しっぱなしでリピート
  }
  let lastPress = 0;

  /* ============================ 背景 ============================ */
  // 銀座: 夜の街を上空から見下ろした図。街区と道路の格子を縦につないで下へ流す
  // （帯の高さ160＝街区40×4なので、そのまま繰り返してもつなぎ目が出ない）
  const CITY_H = 160;
  let cityStrip = null;
  function buildCity() {
    const cv = document.createElement('canvas');
    cv.width = VW; cv.height = CITY_H;
    const g = cv.getContext('2d');
    g.fillStyle = '#080b1e';                 // 道路
    g.fillRect(0, 0, VW, CITY_H);
    const cols = [0, 32, 72, 100, 144, 176];
    const roof = ['#1b2149', '#222a58', '#171d40'];
    const neon = ['#ff5f8d', '#ffd166', '#6fe0ff', '#8affa0'];
    for (let r = 0; r < 4; r++) {
      const by = r * 40;
      for (let ci = 0; ci < cols.length - 1; ci++) {
        const bx = cols[ci], bw = cols[ci + 1] - cols[ci];
        const seed = r * 7 + ci * 13;
        g.fillStyle = roof[seed % 3];
        g.fillRect(bx + 3, by + 3, bw - 6, 34);
        g.fillStyle = '#2c3568';             // 屋上のふち
        g.fillRect(bx + 3, by + 3, bw - 6, 2);
        for (let wy = by + 8; wy < by + 35; wy += 5) {
          for (let wx = bx + 6; wx < bx + bw - 7; wx += 5) {
            if ((wx * 7 + wy * 13 + seed) % 5 < 2) continue;
            g.fillStyle = ((wx + wy + seed) % 9 === 0) ? '#ffe9a8' : '#333d73';
            g.fillRect(wx, wy, 2, 2);
          }
        }
        if (seed % 4 === 0) {                // ネオン看板（銀座らしさ担当）
          g.fillStyle = neon[(r + ci) % neon.length];
          g.fillRect(bx + 5, by + 10, 2, 11);
        }
      }
      // 交差点の信号・車のライト
      for (let ci = 1; ci < cols.length - 1; ci++) {
        g.fillStyle = (r + ci) % 2 ? '#e8a13a' : '#5d6a9c';
        g.fillRect(cols[ci] - 1, by + 20 + (ci * 7) % 14, 1, 2);
      }
    }
    return cv;
  }

  function drawBg(ctx) {
    if (S.stage === 1) {
      ctx.fillStyle = '#080b1e';
      ctx.fillRect(0, 0, VW, VH);
      if (!cityStrip) cityStrip = buildCity();
      const y = S.city % CITY_H;
      ctx.drawImage(cityStrip, 0, y);
      ctx.drawImage(cityStrip, 0, y - CITY_H);
      ctx.fillStyle = 'rgba(6,8,26,0.4)';    // 敵と自機を見やすくするため少し沈める
      ctx.fillRect(0, 0, VW, VH);
    } else {
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, VW, VH);
      for (const s of S.stars) {
        ctx.fillStyle = s.c;
        ctx.fillRect(s.x | 0, s.y | 0, s.z, s.z);
      }
    }
  }

  function initStars() {
    S.stars = [];
    const cols = ['#ffffff', '#9ec8ff', '#ffd8f0', '#c8b4ff'];
    for (let i = 0; i < 60; i++) {
      S.stars.push({
        x: Math.random() * VW, y: Math.random() * VH,
        v: 0.3 + Math.random() * 1.6, z: Math.random() < 0.25 ? 2 : 1,
        c: cols[(Math.random() * cols.length) | 0],
      });
    }
  }

  /* ============================ 生成 ============================ */
  function boom(x, y, n, col) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * 1.6;
      S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 14 + Math.random() * 14, c: col });
    }
  }

  function mkEnemy(x, y, pat, extra) {
    const stage2 = S.stage === 2;
    return Object.assign({
      x, y, x0: x, y0: y, t: 0, pat,
      w: stage2 ? 13 : 12, h: 9,
      hp: 1, kind: stage2 ? 'ufo' : (Math.random() * 4) | 0,
      sp: (stage2 ? 0.55 : 0.45) + S.wave * 0.045 + (S.loop - 1) * 0.2,
      amp: 12 + Math.random() * 14, ph: Math.random() * 60,
      fire: 0.0016 * (stage2 ? 2.2 : 1) * S.loop + S.wave * 0.0004,
      pts: stage2 ? 200 : 100,
    }, extra || {});
  }

  function startWave() {
    S.wave++;
    S.waveT = 0;
    if (S.wave > WAVES) { startBoss(); return; }
    const n = 6 + Math.min(4, S.wave);
    const form = (S.wave - 1) % 3;
    for (let i = 0; i < n; i++) {
      let e;
      if (form === 0) {           // 横一列でゆらゆら降下
        e = mkEnemy(16 + i * ((VW - 32) / (n - 1)), -12 - i * 5, 'sine');
      } else if (form === 1) {    // V字編隊
        const half = (n - 1) / 2;
        e = mkEnemy(VW / 2 - 6 + (i - half) * 15, -14 - Math.abs(i - half) * 9, 'sine');
      } else {                    // 左右から弧を描いて突っ込んでくる
        const left = i % 2 === 0;
        e = mkEnemy(left ? -14 : VW + 2, 18 + (i % 4) * 12, 'swoop', { vx: left ? 1.1 : -1.1 });
        e.dir = left ? 1 : -1;
      }
      if (S.wave >= 3 && i % 3 === 0) e.pat = 'dive';
      S.en.push(e);
    }
  }

  function startBoss() {
    const one = S.stage === 1;
    // ドット絵は2倍に引き伸ばして表示する（ボスらしい大きさに）
    S.boss = {
      img: one ? BOSS1 : BOSS2,
      x: VW / 2 - (one ? 24 : 32), y: -36,
      w: one ? 48 : 64, h: one ? 32 : 28,
      hp: (one ? 40 : 90) * S.loop, max: (one ? 40 : 90) * S.loop,
      t: 0, vx: one ? 0.7 : 0.9, entering: true, hurt: 0,
      pts: one ? 5000 : 10000,
      // 最初のボスなので銀座は手加減する（弾の間隔・本数・取り巻きの頻度）
      fanEvery: one ? 86 : 70, fanRage: one ? 62 : 46,
      fanN: one ? 3 : 5, fanNRage: one ? 5 : 7,
      aimEvery: one ? 72 : 55, aimRage: one ? 50 : 34,
      addEvery: one ? 260 : 190,
    };
    S.msg = 'WARNING!!'; S.msgT = 70;
    beep(160, 0.5, 'sawtooth', 0.06);
  }

  function startStage(n) {
    S.stage = n;
    S.wave = 0;
    S.waveT = 40;
    S.en = []; S.ebul = []; S.items = []; S.boss = null;
    if (n === 2) initStars();
    S.msg = `STAGE ${n} ${n === 1 ? '銀座' : '銀河'}`;
    S.msgT = 90;
  }

  function emit(name, value) {
    if (typeof api.onEvent === 'function') api.onEvent(name, value);
  }

  function startGame() {
    const keep = { scene: 'play' };
    S = Object.assign(newState(), keep);
    S.score = 0; S.lives = 3; S.loop = 1; S.level = 1;
    startStage(1);
    emit('play');
  }

  /* ============================ 更新 ============================ */
  function hit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function playerShoot() {
    const cx = S.px + 5;
    sndShot();
    if (S.level === 1) {
      S.bul.push({ x: cx - 1, y: S.py - 3, vx: 0, vy: -3.4 });
    } else if (S.level === 2) {
      S.bul.push({ x: cx - 4, y: S.py - 1, vx: 0, vy: -3.4 });
      S.bul.push({ x: cx + 2, y: S.py - 1, vx: 0, vy: -3.4 });
    } else {
      S.bul.push({ x: cx - 1, y: S.py - 3, vx: 0, vy: -3.6 });
      S.bul.push({ x: cx - 5, y: S.py, vx: -0.9, vy: -3.2 });
      S.bul.push({ x: cx + 3, y: S.py, vx: 0.9, vy: -3.2 });
    }
  }

  function damagePlayer() {
    if (S.inv > 0 || S.dead) return;
    S.dead = 60;
    S.lives--;
    S.level = Math.max(1, S.level - 1);
    boom(S.px + 5, S.py + 5, 26, '#ffd166');
    sndBoom();
  }

  function updatePlay(keys) {
    S.t++;
    S.city += S.stage === 1 ? 0.5 : 0;
    if (S.stage === 2) {
      for (const s of S.stars) { s.y += s.v; if (s.y > VH) { s.y = -2; s.x = Math.random() * VW; } }
    }
    if (S.msgT > 0) S.msgT--;

    // --- 自機 ---
    if (S.dead > 0) {
      S.dead--;
      if (S.dead === 0) {
        if (S.lives <= 0) { toGameOver(); return; }
        S.px = VW / 2 - 5; S.py = VH - 26; S.inv = 90;
      }
    } else {
      if (S.inv > 0) S.inv--;
      let dx = 0, dy = 0;
      if (keys['arrowleft'] || keys['a']) dx -= 1;
      if (keys['arrowright'] || keys['d']) dx += 1;
      if (keys['arrowup'] || keys['w']) dy -= 1;
      if (keys['arrowdown'] || keys['s']) dy += 1;
      if (dx && dy) { dx *= 0.707; dy *= 0.707; }
      S.px = Math.max(1, Math.min(VW - 12, S.px + dx * 1.7));
      S.py = Math.max(TOP + 4, Math.min(VH - 12, S.py + dy * 1.7));
      if (S.cool > 0) S.cool--;
      if ((keys['z'] || keys[' '] || keys['enter']) && S.cool === 0) { playerShoot(); S.cool = 9; }
    }

    // --- 自弾 ---
    for (const b of S.bul) { b.x += b.vx; b.y += b.vy; }
    S.bul = S.bul.filter(b => b.y > TOP - 6 && b.x > -4 && b.x < VW + 4);

    // --- ウェーブ進行 ---
    if (!S.boss) {
      if (S.waveT > 0) { S.waveT--; if (S.waveT === 0) startWave(); }
      else if (!S.en.length) S.waveT = 50;
    }

    // --- 敵 ---
    for (const e of S.en) {
      e.t++;
      if (e.pat === 'sine') {
        e.y += e.sp;
        e.x = e.x0 + Math.sin((e.t + e.ph) / 20) * e.amp;
      } else if (e.pat === 'swoop') {
        e.x += e.vx * (1 + S.wave * 0.06);
        e.y = e.y0 + Math.sin(e.t / 26) * 26 + e.t * 0.16;
      } else { // dive: しばらく漂ってから自機めがけて急降下
        if (e.t < 70) {
          e.y += e.sp * 0.55;
          e.x = e.x0 + Math.sin((e.t + e.ph) / 18) * e.amp;
        } else {
          if (e.t === 70) {
            const a = Math.atan2(S.py - e.y, S.px - e.x);
            e.dvx = Math.cos(a) * 1.7; e.dvy = Math.max(0.7, Math.sin(a) * 1.7);
          }
          e.x += e.dvx; e.y += e.dvy;
        }
      }
      if (Math.random() < e.fire && e.y > TOP && e.y < VH - 40) enemyShoot(e);
    }
    S.en = S.en.filter(e => e.y < VH + 16 && e.x > -30 && e.x < VW + 30);

    // --- ボス ---
    if (S.boss) updateBoss();

    // --- 敵弾 ---
    for (const b of S.ebul) { b.x += b.vx; b.y += b.vy; }
    S.ebul = S.ebul.filter(b => b.y > TOP - 8 && b.y < VH + 8 && b.x > -8 && b.x < VW + 8);

    // --- アイテム ---
    for (const it of S.items) { it.y += 0.6; it.t++; }
    S.items = S.items.filter(it => it.y < VH + 8);

    // --- 破片 ---
    for (const p of S.parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.life--; }
    S.parts = S.parts.filter(p => p.life > 0);

    collide();
  }

  function enemyShoot(e) {
    const cx = e.x + e.w / 2, cy = e.y + e.h;
    if (S.stage === 1) {
      // 醤油の雫（まっすぐ落ちてくる）。暗い背景に埋もれないよう明るめの琥珀色
      S.ebul.push({ x: cx - 1, y: cy, vx: 0, vy: 1.2 + S.loop * 0.2, c: '#f0a94b', r: 3 });
    } else {
      // UFOのビーム（自機を狙う）
      const a = Math.atan2(S.py + 5 - cy, S.px + 5 - cx);
      const sp = 1.3 + S.loop * 0.25;
      S.ebul.push({ x: cx - 1, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: '#ff6fae', r: 2 });
    }
  }

  function updateBoss() {
    const b = S.boss;
    b.t++;
    if (b.hurt > 0) b.hurt--;
    if (b.entering) {
      b.y += 0.8;
      if (b.y >= 20) { b.y = 20; b.entering = false; b.t = 0; }
      return;
    }
    b.x += b.vx;
    if (b.x < 2) { b.x = 2; b.vx *= -1; }
    if (b.x + b.w > VW - 2) { b.x = VW - 2 - b.w; b.vx *= -1; }
    b.y = 20 + Math.sin(b.t / 70) * 5;

    const rage = b.hp < b.max * 0.45;
    const cx = b.x + b.w / 2, cy = b.y + b.h;
    // 弾幕1: 扇状にばらまく
    if (b.t % (rage ? b.fanRage : b.fanEvery) === 0) {
      const n = rage ? b.fanNRage : b.fanN;
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.3;
        const sp = 1.2 + S.loop * 0.2;
        S.ebul.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: S.stage === 1 ? '#f0a94b' : '#ff6fae', r: 3 });
      }
      beep(200, 0.08, 'square', 0.03);
    }
    // 弾幕2: 自機狙いの速い弾
    if (b.t % (rage ? b.aimRage : b.aimEvery) === 20) {
      const a = Math.atan2(S.py + 5 - cy, S.px + 5 - cx);
      const sp = 1.9 + S.loop * 0.25;
      S.ebul.push({ x: cx - 1, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: '#ffd166', r: 3 });
    }
    // ボスは取り巻きも呼ぶ
    if (b.t % b.addEvery === 0) {
      S.en.push(mkEnemy(20 + Math.random() * (VW - 50), -12, 'sine'));
    }
  }

  function dropItem(x, y) {
    S.items.push({ x, y, w: 8, h: 8, t: 0 });
  }

  function collide() {
    // 自弾 → 敵
    for (const bl of S.bul) {
      if (bl.dead) continue;
      for (const e of S.en) {
        if (e.dead) continue;
        if (bl.x < e.x + e.w - 1 && bl.x + 2 > e.x + 1 && bl.y < e.y + e.h - 1 && bl.y + 4 > e.y + 1) {
          bl.dead = true; e.dead = true;
          S.score += e.pts * S.loop;
          boom(e.x + e.w / 2, e.y + e.h / 2, 10, S.stage === 1 ? '#ffd9c0' : '#9ee1ff');
          sndHit();
          if (Math.random() < 0.06 && S.level < 3) dropItem(e.x + e.w / 2 - 4, e.y);
          break;
        }
      }
      // 自弾 → ボス
      const b = S.boss;
      if (!bl.dead && b && !b.entering &&
        bl.x < b.x + b.w - 2 && bl.x + 2 > b.x + 2 && bl.y < b.y + b.h && bl.y + 4 > b.y) {
        bl.dead = true; b.hp--; b.hurt = 4;
        S.score += 10 * S.loop;
        if (b.hp <= 0) bossDown();
        else if (b.hp % 6 === 0) sndHit();
      }
    }
    S.bul = S.bul.filter(b => !b.dead);
    S.en = S.en.filter(e => !e.dead);

    if (S.dead || S.inv > 0) {
      // 無敵中でもアイテムは拾える
      pickItems();
      return;
    }
    const pb = { x: S.px + 3, y: S.py + 3, w: 5, h: 5 };
    for (const b of S.ebul) {
      if (b.x < pb.x + pb.w && b.x + b.r > pb.x && b.y < pb.y + pb.h && b.y + b.r > pb.y) {
        b.dead = true; damagePlayer(); break;
      }
    }
    S.ebul = S.ebul.filter(b => !b.dead);
    if (!S.dead) {
      for (const e of S.en) if (hit(pb, { x: e.x + 1, y: e.y + 1, w: e.w - 2, h: e.h - 2 })) { damagePlayer(); break; }
    }
    if (!S.dead && S.boss && !S.boss.entering && hit(pb, S.boss)) damagePlayer();
    pickItems();
  }

  function pickItems() {
    if (S.dead) return;
    const pb = { x: S.px, y: S.py, w: 11, h: 10 };
    for (const it of S.items) {
      if (hit(pb, it)) {
        it.y = VH + 99;
        if (S.level < 3) { S.level++; S.msg = 'POWER UP!'; S.msgT = 50; }
        else S.score += 500;
        sndItem();
      }
    }
  }

  function bossDown() {
    const b = S.boss;
    S.score += b.pts * S.loop;
    for (let i = 0; i < 5; i++) {
      boom(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 14, i % 2 ? '#ffd166' : '#ff8474');
    }
    sndBoom();
    S.boss = null;
    S.ebul = [];
    S.msgT = 0;          // クリア表示と重ならないよう途中のメッセージは消す
    S.scene = 'clear';
    S.clearT = 170;
  }

  function updateClear() {
    S.clearT--;
    for (const p of S.parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.life--; }
    S.parts = S.parts.filter(p => p.life > 0);
    if (S.clearT > 0) return;
    S.score += 1000 * S.stage * S.loop + S.lives * 500; // クリアボーナス
    S.scene = 'play';
    if (S.stage === 1) startStage(2);
    else {
      emit('allclear', S.score);   // 銀河のボスまで倒した ＝ 1周クリア
      emit('score', S.score);
      S.loop++; startStage(1); S.msg = `${S.loop}周目！`; S.msgT = 100;
    }
  }

  function toGameOver() {
    emit('score', S.score);
    S.nrank = rankOf(S.score);
    S.scene = S.nrank >= 0 ? 'entry' : 'over';
    S.clearT = 150;
    S.name = [0, 0, 0]; S.npos = 0;
  }

  function updateEntry(keys) {
    const up = tap('u', keys['arrowup'] || keys['w']);
    const dn = tap('d', keys['arrowdown'] || keys['s']);
    const lf = tap('l', keys['arrowleft'] || keys['a']);
    const rt = tap('r', keys['arrowright'] || keys['d']);
    const n = NAME_CHARS.length;
    if (up) S.name[S.npos] = (S.name[S.npos] + n - 1) % n;
    if (dn) S.name[S.npos] = (S.name[S.npos] + 1) % n;
    if (lf) S.npos = (S.npos + 2) % 3;
    if (rt) S.npos = (S.npos + 1) % 3;
  }

  function commitEntry() {
    const nm = S.name.map(i => NAME_CHARS[i]).join('').trim() || 'YOU';
    // まず手元で反映して待たせない。サーバーの返事が来たら本当の順位に差し替える
    scores.splice(S.nrank, 0, [nm, S.score]);
    scores = scores.slice(0, 10);
    saveScores();
    S.scene = 'rank';
    syncState = 'sending';
    fetch(SCORE_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: nm, score: S.score }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d && applyRemote(d.scores)) {
          if (typeof d.rank === 'number') S.nrank = d.rank;
        } else {
          syncState = 'local';
        }
      })
      .catch(() => { syncState = 'local'; });
  }

  /* ============================ 描画 ============================ */
  function txt(ctx, s, x, y, col, font, align) {
    ctx.fillStyle = col;
    ctx.font = font;
    ctx.textAlign = align || 'left';
    ctx.fillText(s, x, y);
    ctx.textAlign = 'left';
  }
  const F = {
    small: '7px sans-serif',
    hud: 'bold 8px monospace',
    mid: 'bold 10px sans-serif',
    big: 'bold 14px sans-serif',
    mono: 'bold 9px monospace',
  };

  function drawShip(ctx, x, y, flame) {
    ctx.drawImage(SHIP, Math.round(x), Math.round(y));
    if (flame) {
      ctx.fillStyle = (S.t % 6 < 3) ? '#ffd166' : '#ff8a3d';
      ctx.fillRect(Math.round(x) + 5, Math.round(y) + 10, 1, 1 + (S.t % 6 < 3 ? 1 : 0));
    }
  }

  function drawEnemy(ctx, e) {
    const im = e.kind === 'ufo' ? UFO : SUSHI[e.kind];
    ctx.drawImage(im, Math.round(e.x), Math.round(e.y));
  }

  function drawHud(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, VW, TOP);
    txt(ctx, String(S.score).padStart(6, '0'), 3, 8, '#ffffff', F.hud);
    txt(ctx, 'HI ' + String(Math.max(hiScore(), S.score)).padStart(6, '0'), VW - 3, 8, '#f2d178', F.hud, 'right');
    // 残機
    for (let i = 0; i < Math.max(0, S.lives - 1) && i < 4; i++) {
      ctx.drawImage(SHIP, 2, 1, 11, 10, VW / 2 - 22 + i * 10, 2, 8, 7);
    }
    txt(ctx, `${S.stage}-${S.boss ? 'B' : Math.min(S.wave, WAVES)}`, VW / 2 + 24, 8, '#9ee1ff', F.hud);
    // 右下の閉じるボタン（いつでも楽屋にもどれる脱出口）
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(VW - 20, VH - 13, 18, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(VW - 19.5, VH - 12.5, 17, 11);
    txt(ctx, '✕', VW - 11, VH - 4, 'rgba(255,255,255,0.55)', F.small, 'center');
  }

  function drawBossBar(ctx) {
    const b = S.boss;
    if (!b || b.entering) return;
    const w = VW - 24;
    ctx.fillStyle = '#2a1520';
    ctx.fillRect(12, TOP + 2, w, 3);
    ctx.fillStyle = b.hp < b.max * 0.45 ? '#ff5f5f' : '#ff9f43';
    ctx.fillRect(12, TOP + 2, w * Math.max(0, b.hp / b.max), 3);
  }

  function drawPlay(ctx) {
    drawBg(ctx);
    for (const it of S.items) {
      const on = (it.t % 20) < 14;
      ctx.fillStyle = on ? '#ffd166' : '#ffffff';
      ctx.fillRect(it.x, it.y, 8, 8);
      ctx.fillStyle = '#1a1720';
      ctx.fillRect(it.x + 1, it.y + 1, 6, 6);
      txt(ctx, 'P', it.x + 4, it.y + 7, on ? '#ffd166' : '#ffffff', 'bold 7px monospace', 'center');
    }
    for (const e of S.en) drawEnemy(ctx, e);
    if (S.boss) {
      const b = S.boss;
      if (b.hurt > 0) ctx.globalAlpha = 0.6;
      ctx.drawImage(b.img, Math.round(b.x), Math.round(b.y), b.w, b.h);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#9ef7ff';
    for (const b of S.bul) ctx.fillRect(Math.round(b.x), Math.round(b.y), 2, 5);
    for (const b of S.ebul) {
      ctx.fillStyle = b.c;
      ctx.fillRect(Math.round(b.x), Math.round(b.y), b.r, b.r);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
    }
    for (const p of S.parts) {
      ctx.fillStyle = p.life > 8 ? p.c : '#ffffff';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    if (!S.dead && (S.inv <= 0 || (S.t % 8) < 4)) drawShip(ctx, S.px, S.py, true);
    drawHud(ctx);
    drawBossBar(ctx);
    if (S.msgT > 0) {
      const a = Math.min(1, S.msgT / 20);
      ctx.globalAlpha = a;
      txt(ctx, S.msg, VW / 2, VH / 2 - 18, '#ffd166', F.mid, 'center');
      ctx.globalAlpha = 1;
    }
  }

  function drawTitle(ctx) {
    S.t++;
    S.city += 0.35;
    drawBg(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, VW, VH);
    txt(ctx, 'ギャラクシー', VW / 2, 32, '#ffffff', F.big, 'center');
    // 「☆銀河」は星だけ色を変えたいので2つに分けて中央そろえで並べる
    ctx.font = F.big;
    const wStar = ctx.measureText('☆').width, wGin = ctx.measureText('銀河').width;
    const sx = VW / 2 - (wStar + wGin) / 2;
    txt(ctx, '☆', sx, 50, (S.t % 40 < 20) ? '#ffd166' : '#fff3c4', F.big);
    txt(ctx, '銀河', sx + wStar, 50, '#ffd166', F.big);
    txt(ctx, 'GINMAKU ICHIRO & TIMECAFE', VW / 2, 62, '#8fb4d8', F.small, 'center');

    const items = ['ゲームスタート', 'ランキング', 'サウンド ' + (sndOn ? 'ON' : 'OFF'), '楽屋にもどる'];
    items.forEach((s, i) => {
      const y = 84 + i * 12;
      const on = i === S.menu;
      if (on) txt(ctx, '▶', VW / 2 - 48, y, '#ffd166', F.small, 'left');
      txt(ctx, s, VW / 2 - 34, y, on ? '#ffd166' : '#dde4e8', F.small, 'left');
    });
    txt(ctx, 'HI-SCORE ' + String(hiScore()).padStart(6, '0'), VW / 2, VH - 5, '#8fb4d8', F.small, 'center');
  }

  function drawClear(ctx) {
    drawPlay(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, VW, VH);
    if (S.stage === 1) {
      txt(ctx, 'STAGE 1 CLEAR', VW / 2, VH / 2 - 8, '#ffd166', F.mid, 'center');
      txt(ctx, '銀座を抜けた。次は…銀河だ。', VW / 2, VH / 2 + 8, '#ffffff', F.small, 'center');
    } else {
      txt(ctx, 'ALL CLEAR!!', VW / 2, VH / 2 - 12, '#ffd166', F.big, 'center');
      txt(ctx, '銀座から銀河まで', VW / 2, VH / 2 + 6, '#ffffff', F.small, 'center');
      txt(ctx, '連れて行ってやったぜ', VW / 2, VH / 2 + 17, '#ffffff', F.small, 'center');
    }
  }

  function drawOver(ctx) {
    drawBg(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, VW, VH);
    txt(ctx, 'GAME OVER', VW / 2, VH / 2 - 6, '#ff6f6f', F.big, 'center');
    txt(ctx, 'SCORE ' + String(S.score).padStart(6, '0'), VW / 2, VH / 2 + 12, '#ffffff', F.small, 'center');
    if (S.clearT < 110) txt(ctx, 'Zキー / Aボタン', VW / 2, VH - 10, '#8fb4d8', F.small, 'center');
  }

  function drawEntry(ctx) {
    drawBg(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, VW, VH);
    txt(ctx, 'ランクイン！', VW / 2, 28, '#ffd166', F.mid, 'center');
    txt(ctx, `${S.nrank + 1}位  ${String(S.score).padStart(6, '0')}`, VW / 2, 44, '#ffffff', F.small, 'center');
    txt(ctx, 'なまえを いれてね', VW / 2, 62, '#8fb4d8', F.small, 'center');
    for (let i = 0; i < 3; i++) {
      const x = VW / 2 - 26 + i * 26;
      const sel = i === S.npos;
      ctx.strokeStyle = sel ? '#ffd166' : '#4c5570';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 8.5, 71.5, 17, 20);
      txt(ctx, NAME_CHARS[S.name[i]], x, 86, sel ? '#ffd166' : '#ffffff', F.big, 'center');
      if (sel && S.t % 30 < 18) {
        txt(ctx, '▲', x, 70, '#ffd166', F.small, 'center');
        txt(ctx, '▼', x, 100, '#ffd166', F.small, 'center');
      }
    }
    S.t++;
    txt(ctx, '↑↓ もじ  ←→ いち  Z/A けってい', VW / 2, VH - 8, '#8fb4d8', F.small, 'center');
  }

  function drawRank(ctx) {
    drawBg(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, VW, VH);
    txt(ctx, 'RANKING', VW / 2, 16, '#ffd166', F.mid, 'center');
    // 通信できていないときは、これが自分だけの記録だと分かるようにしておく
    if (syncState === 'local') txt(ctx, 'この端末の記録', VW - 4, 10, '#6b7488', F.small, 'right');
    scores.slice(0, 10).forEach((s, i) => {
      const y = 30 + i * 10;
      const me = S.scene === 'rank' && i === S.nrank;
      const c = me ? '#ffd166' : (i === 0 ? '#ffffff' : '#c6d0dc');
      txt(ctx, String(i + 1).padStart(2, ' '), 24, y, c, F.mono, 'right');
      txt(ctx, s[0], 34, y, c, F.mono);
      txt(ctx, String(s[1]).padStart(7, '0'), VW - 16, y, c, F.mono, 'right');
    });
    txt(ctx, 'Zキー / Aボタンで もどる', VW / 2, VH - 6, '#8fb4d8', F.small, 'center');
  }

  /* ============================ 入口 ============================ */
  let onExitCb = null;
  let tapBound = false;

  function bindTap() {
    if (tapBound) return;
    tapBound = true;
    const cv = document.getElementById('game');
    if (!cv) return;
    const onTap = ev => {
      if (!api.active) return;
      const r = cv.getBoundingClientRect();
      const pt = ev.changedTouches ? ev.changedTouches[0] : ev;
      const x = (pt.clientX - r.left) / r.width * VW;
      const y = (pt.clientY - r.top) / r.height * VH;
      // 右下すみの「✕」でいつでも楽屋にもどれる
      if (x > VW - 22 && y > VH - 18) { ev.preventDefault(); api.exit(); }
    };
    cv.addEventListener('touchend', onTap, { passive: false });
    cv.addEventListener('mousedown', onTap);
  }

  const api = {
    active: false,
    get state() { return S; }, // デバッグ用
    // 遊んだ・得点した・クリアした を外（game.js）に知らせる差込口。
    // ここでフラグを立てて写真の解放条件に使う
    onEvent: null,

    start(onExit) {
      onExitCb = onExit || null;
      fetchScores();          // 遊ぶたびに最新の順位表を取りに行く
      S = newState();
      S.scene = 'title';
      initStars();
      api.active = true;
      bindTap();
      for (const k in held) held[k] = 0;
      lastPress = Date.now();
    },

    exit() {
      api.active = false;
      const cb = onExitCb;
      onExitCb = null;
      if (cb) cb();
    },

    // Z / スペース / Aボタンが押された
    press() {
      if (!api.active) return;
      const now = Date.now();
      if (now - lastPress < 180) return; // キーリピートで飛ばされないように
      lastPress = now;
      if (S.scene === 'title') {
        if (S.menu === 0) startGame();
        else if (S.menu === 1) { S.nrank = -1; S.scene = 'rank'; }
        else if (S.menu === 2) { sndOn = !sndOn; localStorage.setItem(SND_KEY, sndOn ? '1' : '0'); beep(660, 0.08); }
        else api.exit();
      } else if (S.scene === 'over') {
        if (S.clearT < 120) { S.scene = 'title'; S.menu = 0; }
      } else if (S.scene === 'entry') {
        if (S.npos < 2) S.npos++;
        else commitEntry();
      } else if (S.scene === 'rank') {
        S.scene = 'title'; S.menu = 0;
      }
      // play / clear 中は押しっぱなしのショット（keys）で処理するので何もしない
    },

    // 毎フレーム game.js から呼ばれる（更新＋描画）
    step(keys, ctx) {
      ctx.imageSmoothingEnabled = false; // 拡大表示するボスをぼかさない
      if (S.scene === 'title') { drawTitle(ctx); menuMove(keys); return; }
      if (S.scene === 'play') { updatePlay(keys); drawPlay(ctx); return; }
      if (S.scene === 'clear') { updateClear(); drawClear(ctx); return; }
      if (S.scene === 'over') { if (S.clearT > 0) S.clearT--; drawOver(ctx); return; }
      if (S.scene === 'entry') { updateEntry(keys); drawEntry(ctx); return; }
      if (S.scene === 'rank') { drawRank(ctx); return; }
    },
  };

  function menuMove(keys) {
    const up = tap('u', keys['arrowup'] || keys['w']);
    const dn = tap('d', keys['arrowdown'] || keys['s']);
    if (up) S.menu = (S.menu + 3) % 4;
    if (dn) S.menu = (S.menu + 1) % 4;
  }

  window.Shooter = api;
})();
