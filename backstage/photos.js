// 楽屋のノートパソコン ＝ アー写ギャラリー
// 一定の条件を満たすと1枚ずつ解放される。未解放の枠は「？」で見えているので
// あと何枚あるか分かる（集めたくなる仕掛け）。
// game.js からは window.Photos.start(onExit) / press() / step(keys, ctx) だけ使う。
(function () {
  const VW = 176, VH = 144;          // game.js と同じ論理画面サイズ
  const OPEN_KEY = 'gakuya_photos_v1'; // 解放済みIDの保存先

  // ---- 写真データ ----
  // src に画像のパスを入れると実写真を表示する。空（null）の間は「NO IMAGE」の
  // ダミーが出るだけで、枠・解放条件・キャプションはそのまま働く。
  // 写真を入れるときは assets/photo/ に置いて src: 'assets/photo/p1.jpg' と書く。
  // cond: { flag: 'フラグ名' } … そのフラグが立っていれば解放。省略で最初から解放。
  const PHOTOS = [
    {
      id: 'p1',
      caption: '全員そろったアー写。',
      cond: { flag: 'met_all' },
      hint: '楽屋にいる全員と話す',
      src: null, tint: '#8e2a20',
    },
    {
      id: 'p2',
      caption: '樽をかこんで一枚。',
      cond: { flag: 'played_galaxy' },
      hint: 'ゲーム機で遊ぶ',
      src: null, tint: '#2b3a5c',
    },
    {
      id: 'p3',
      caption: 'きれいに整列した図。',
      cond: { flag: 'galaxy_20000' },
      hint: 'ゲームで20000点',
      src: null, tint: '#3d2b5c',
    },
  ];

  // ---- 状態 ----
  const P = { idx: 0, opened: new Set(), t: 0, toast: '', toastT: 0 };
  let onExitCb = null;
  let lastPress = 0;
  let flagsRef = null;   // game.js の flags をそのまま参照する
  const imgs = {};       // src を読み込んだ Image

  function loadOpened() {
    try {
      const raw = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]');
      if (Array.isArray(raw)) raw.forEach(id => P.opened.add(id));
    } catch (e) { /* 壊れていたら初期化扱い */ }
  }
  function saveOpened() {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...P.opened])); } catch (e) { /* 保存できなくても続行 */ }
  }
  loadOpened();

  function isOpen(p) {
    if (P.opened.has(p.id)) return true;             // 一度解放したら以後ずっと見られる
    if (!p.cond) return true;
    if (p.cond.flag && flagsRef && flagsRef[p.cond.flag]) return true;
    return false;
  }

  // 条件を満たした写真を解放し、新規に開いた枚数を返す
  function syncOpened() {
    let fresh = 0;
    for (const p of PHOTOS) {
      if (P.opened.has(p.id)) continue;
      if (isOpen(p)) { P.opened.add(p.id); fresh++; }
    }
    if (fresh) saveOpened();
    return fresh;
  }

  function txt(ctx, s, x, y, col, font, align) {
    ctx.fillStyle = col;
    ctx.font = font;
    ctx.textAlign = align || 'left';
    ctx.fillText(s, x, y);
    ctx.textAlign = 'left';
  }
  const F = {
    small: '7px sans-serif',
    mid: 'bold 9px sans-serif',
    big: 'bold 12px sans-serif',
    huge: 'bold 30px sans-serif',
    mono: 'bold 8px monospace',
  };

  // ---- 描画 ----
  // 写真は3:2。枠もぴったり同じ比率にして余白（黒帯）が出ないようにしてある。
  // 画面ほぼいっぱいに使う（156x104 = 3:2）
  const PW = 156, PH = 104;
  const PX = Math.round((VW - PW) / 2), PY = 16;

  function drawFrame(ctx) {
    // ノートパソコンの画面に見えるよう、全体を暗い青で塗ってふちを付ける
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#1b2030';
    ctx.fillRect(0, 0, VW, 12);
    txt(ctx, 'PHOTO ALBUM', 5, 9, '#b8c2c8', F.mono);
    const n = PHOTOS.filter(p => P.opened.has(p.id)).length;
    txt(ctx, `${n} / ${PHOTOS.length}`, VW - 5, 9, n === PHOTOS.length ? '#e3b23c' : '#6b7488', F.mono, 'right');
  }

  function drawDummy(ctx, p, x, y, w, h) {
    // 実画像が入るまでのダミー。差し替えたときと同じ枠に収まるようにしてある
    ctx.fillStyle = p.tint || '#2b2b2b';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = -h; i < w; i += 8) {
      ctx.fillRect(x + Math.max(0, i), y, 3, h);   // 斜めっぽい帯でダミーと分かるように
    }
    txt(ctx, 'NO IMAGE', x + w / 2, y + h / 2 + 2, 'rgba(255,255,255,0.45)', F.mono, 'center');
  }

  function drawPhoto(ctx) {
    const p = PHOTOS[P.idx];
    const open = P.opened.has(p.id);

    // 細い外枠だけ（写真を大きく見せたいのでフチは最小限）
    ctx.fillStyle = open ? '#dde4e8' : '#22262f';
    ctx.fillRect(PX - 2, PY - 2, PW + 4, PH + 4);

    if (!open) {
      ctx.fillStyle = '#14171f';
      ctx.fillRect(PX, PY, PW, PH);
      txt(ctx, '?', VW / 2, PY + PH / 2 + 4, '#39415a', F.huge, 'center');
      txt(ctx, p.hint || '？？？', VW / 2, PY + PH / 2 + 26, '#7d8aa4', F.mid, 'center');
      txt(ctx, '- LOCKED -', VW / 2, PY + 16, '#4a5268', F.mid, 'center');
    } else {
      if (p.src && imgs[p.id] && imgs[p.id].complete && imgs[p.id].naturalWidth) {
        ctx.drawImage(imgs[p.id], PX, PY, PW, PH);
      } else {
        drawDummy(ctx, p, PX, PY, PW, PH);
      }
      // 白背景のアー写は白フチと溶けてしまうので、輪郭を1本入れて写真の範囲を見せる
      ctx.strokeStyle = '#8c94a4';
      ctx.lineWidth = 1;
      ctx.strokeRect(PX + 0.5, PY + 0.5, PW - 1, PH - 1);

      // 説明は写真の上に半透明の帯で重ねる（写真を小さくしないため）
      if (p.caption) {
        ctx.fillStyle = 'rgba(10,13,22,0.66)';
        ctx.fillRect(PX, PY + PH - 13, PW, 13);
        txt(ctx, p.caption.split('\n')[0], VW / 2, PY + PH - 4, '#dde4e8', F.small, 'center');
      }
    }

    // 現在位置のドット
    const dw = PHOTOS.length * 6;
    PHOTOS.forEach((q, i) => {
      ctx.fillStyle = i === P.idx ? '#e3b23c' : (P.opened.has(q.id) ? '#5a6070' : '#2b3040');
      ctx.fillRect(Math.round(VW / 2 - dw / 2) + i * 6, VH - 17, 3, 3);
    });
    txt(ctx, '← → で送る / Z で閉じる', VW / 2, VH - 5, '#4a5268', F.small, 'center');
  }

  function drawToast(ctx) {
    if (P.toastT <= 0) return;
    P.toastT--;
    const a = Math.min(1, P.toastT / 20);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#e3b23c';
    ctx.fillRect(0, VH / 2 - 10, VW, 18);
    txt(ctx, P.toast, VW / 2, VH / 2 + 2, '#241012', F.mid, 'center');
    ctx.globalAlpha = 1;
  }

  // ---- 解像度の切り替え ----
  // ゲーム本体は 176x144 を3倍したキャンバスに描いているが、それだと写真がその
  // 解像度に縛られて粗くなる。写真を見ている間だけキャンバスを6倍にして、
  // 論理座標（176x144）はそのままに実ピクセルだけ倍にする。閉じるときに元に戻す。
  const HS = 6;
  let savedCv = null, savedW = 0, savedH = 0;

  function hiRes(ctx) {
    const cv = ctx.canvas;
    if (cv.width === VW * HS && cv.height === VH * HS) {
      ctx.setTransform(HS, 0, 0, HS, 0, 0);
      return;
    }
    savedCv = cv; savedW = cv.width; savedH = cv.height;
    cv.width = VW * HS; cv.height = VH * HS;   // サイズ変更で状態がリセットされる
    ctx.setTransform(HS, 0, 0, HS, 0, 0);
  }

  function restoreRes() {
    if (!savedCv) return;
    savedCv.width = savedW; savedCv.height = savedH;
    savedCv = null;
  }

  // ---- 入力 ----
  let navHeld = false;
  function nav(keys) {
    const l = keys['arrowleft'] || keys['a'];
    const r = keys['arrowright'] || keys['d'];
    if (!l && !r) { navHeld = false; return; }
    if (navHeld) return;
    navHeld = true;
    P.idx = (P.idx + (r ? 1 : PHOTOS.length - 1)) % PHOTOS.length;
  }

  const api = {
    active: false,
    get photos() { return PHOTOS; },      // デバッグ用
    get state() { return P; },
    // game.js の flags を渡してもらう（解放条件の判定に使う）
    bind(flags) { flagsRef = flags; },
    start(onExit) {
      onExitCb = onExit || null;
      api.active = true;
      lastPress = Date.now();
      P.t = 0;
      const fresh = syncOpened();
      // 未解放の写真があればそこではなく、解放済みの先頭から見せる
      P.idx = 0;
      if (fresh) {
        P.toast = fresh === 1 ? '写真が1枚とどいた' : `写真が${fresh}枚とどいた`;
        P.toastT = 90;
        const first = PHOTOS.findIndex(p => P.opened.has(p.id));
        if (first >= 0) P.idx = first;
      }
      // 実画像があるものを読み込んでおく
      for (const p of PHOTOS) {
        if (p.src && !imgs[p.id]) { const im = new Image(); im.src = p.src; imgs[p.id] = im; }
      }
    },
    exit() {
      api.active = false;
      restoreRes();
      const cb = onExitCb; onExitCb = null;
      if (cb) cb();   // game.js 側で元の変換行列に戻してもらう
    },
    press() {
      const now = Date.now();
      if (now - lastPress < 180) return;  // 起動時のキーを拾わない
      lastPress = now;
      api.exit();
    },
    step(keys, ctx) {
      P.t++;
      hiRes(ctx);                       // 写真の間だけ高解像度に切り替える
      ctx.imageSmoothingEnabled = false;
      nav(keys);
      drawFrame(ctx);
      drawPhoto(ctx);
      drawToast(ctx);
    },
  };

  window.Photos = api;
})();
