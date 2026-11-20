/* =========================================================
   シャボン玉タスク
   - やることを「漂うシャボン玉」として表示
   - 締切の7日前から膨らみ、当日に最大。超過すると薄い赤
   - データは端末の localStorage（キー: bubbleTask.v1）
   ========================================================= */
'use strict';

(() => {
  // ---------- 設定値 ----------
  const STORAGE_KEY = 'bubbleTask.v1';
  const MAX_TITLE = 15;          // タスク名の最大文字数
  const MIN_RATIO = 0.20;        // 直径の最小（画面幅に対する割合）
  const MAX_RATIO = 0.50;        // 直径の最大
  const GROW_DAYS = 7;           // 何日前から膨らみ始めるか
  const AREA_LIMIT = 0.70;       // 玉の合計面積がこれを超えたら全体を縮める
  const TOTAL_BUBBLES = 10;      // タスク玉＋飾り玉の目安
  const MAX_DECOR = 6;           // 飾り玉の最大数
  const DECOR_MIN = 0.08;        // 飾り玉の直径（画面幅に対する割合）
  const DECOR_MAX = 0.15;
  const SIZE_TAU = 0.9;          // 大きさが変わるときのなめらかさ（秒）
  const DAY_MS = 86400000;

  // ---------- 小さな道具 ----------
  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const chars = (s) => Array.from(s);            // 絵文字なども1文字として数える

  function ymd(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);                // 端末のローカル時刻の0時
  }
  function localIso(d = new Date()) {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const a = Math.abs(off);
    return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseYmd(s).getTime());

  // ---------- データ保存 ----------
  function emptyState() {
    return { tasks: [], todayCount: { date: ymd(), count: 0 } };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const data = JSON.parse(raw);
      const seen = new Set();
      const tasks = (Array.isArray(data && data.tasks) ? data.tasks : [])
        .filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string' && t.title.trim() !== '')
        .filter((t) => (seen.has(t.id) ? false : seen.add(t.id)))
        .map((t) => ({
          id: t.id,
          title: chars(t.title.trim()).slice(0, MAX_TITLE).join(''),
          deadline: isYmd(t.deadline) ? t.deadline : null,
          createdAt: typeof t.createdAt === 'string' ? t.createdAt : localIso(),
        }));
      const tc = data && data.todayCount;
      const todayCount = (tc && typeof tc.date === 'string' && Number.isFinite(tc.count))
        ? { date: tc.date, count: Math.max(0, Math.floor(tc.count)) }
        : { date: ymd(), count: 0 };
      return { tasks, todayCount };
    } catch (e) {
      // 壊れていても止まらず、空の状態で起動
      return emptyState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  const state = loadState();

  function newId() {
    let id = 't_' + Date.now();
    while (state.tasks.some((t) => t.id === id)) id = 't_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    return id;
  }

  // ---------- 要素 ----------
  const decorLayer = $('#decorLayer');
  const taskLayer = $('#taskLayer');
  const fxLayer = $('#fxLayer');
  const counterEl = $('#counter');
  const countNum = $('#countNum');
  const emptyHint = $('#emptyHint');
  const addBtn = $('#addBtn');
  const menu = $('#menu');
  const menuBackdrop = $('#menuBackdrop');
  const menuTitle = $('#menuTitle');
  const menuDeadline = $('#menuDeadline');
  const sheet = $('#sheet');
  const sheetPanel = $('#sheetPanel');
  const sheetTitle = $('#sheetTitle');
  const titleInput = $('#titleInput');
  const charCount = $('#charCount');
  const dateInput = $('#dateInput');
  const dateWrap = dateInput.parentElement;
  const dateClear = $('#dateClear');
  const submitBtn = $('#submitBtn');
  const confirmEl = $('#confirm');
  const confirmName = $('#confirmName');
  const safeProbe = $('#safeProbe');

  // ---------- 画面サイズ ----------
  function viewport() {
    return { W: window.innerWidth, H: window.innerHeight };
  }
  // 「画面幅」＝縦置きスマホの横幅。PCで横長に開いた場合は短い辺を使う
  function baseWidth() {
    const { W, H } = viewport();
    return Math.min(W, H);
  }
  function safeInsets() {
    const cs = getComputedStyle(safeProbe);
    return {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
  }

  // ---------- 締切 → 大きさ・色 ----------
  function deadlineInfo(task, now = Date.now()) {
    if (!task.deadline) return { ratio: MIN_RATIO, overdue: false };
    const due = parseYmd(task.deadline);
    const next = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
    const overdue = now >= next.getTime();
    const d = clamp((due.getTime() - now) / DAY_MS, 0, GROW_DAYS);
    return { ratio: MIN_RATIO + (MAX_RATIO - MIN_RATIO) * (GROW_DAYS - d) / GROW_DAYS, overdue };
  }

  function deadlineLabel(task) {
    if (!task.deadline) return '締切なし';
    const due = parseYmd(task.deadline);
    const md = `${due.getMonth() + 1}/${due.getDate()}`;
    return (due.getFullYear() === new Date().getFullYear() ? md : `${due.getFullYear()}/${md}`) + 'まで';
  }

  // 大きい玉ほどゆっくり
  function cruiseSpeed(d) {
    return 10 + 1500 / Math.max(d, 20);
  }

  // ---------- シャボン玉 ----------
  const bubbles = [];
  let globalScale = 1;

  class Bubble {
    constructor(kind, task) {
      this.kind = kind;                 // 'task' | 'decor'
      this.task = task || null;
      this.x = 0; this.y = 0;
      const a = rand(0, Math.PI * 2);
      this.vx = Math.cos(a); this.vy = Math.sin(a);
      this.curD = 0; this.targetD = 0; this.renderedD = -1;
      this.phase = rand(0, Math.PI * 2);
      this.wobFreq = rand(0.18, 0.3) * Math.PI * 2;
      this.wobAmp = rand(3, 7);
      this.frozen = false;              // メニュー表示中など
      this.gone = false;                // 割った・削除・消えかけ
      this.overdue = false;
      this.decorRatio = kind === 'decor' ? rand(DECOR_MIN, DECOR_MAX) : 0;

      this.el = document.createElement('div');
      this.el.className = 'bubble ' + kind;
      this.body = document.createElement('div');
      this.body.className = 'bubble-body';
      this.el.appendChild(this.body);

      if (kind === 'task') {
        this.label = document.createElement('span');
        this.label.className = 'label';
        this.body.appendChild(this.label);
        this.setTitle(task.title);
        this.el.addEventListener('click', (e) => {
          e.stopPropagation();
          openMenu(this);
        });
        taskLayer.appendChild(this.el);
      } else {
        decorLayer.appendChild(this.el);
      }
      bubbles.push(this);
    }

    get r() { return this.curD / 2; }

    setTitle(title) {
      this.label.textContent = title;
      this.el.setAttribute('aria-label', title);
    }

    setOverdue(v) {
      if (v === this.overdue) return;
      this.overdue = v;
      this.el.classList.toggle('overdue', v);
    }

    setSpeed(scale = 1) {
      const s = cruiseSpeed(this.curD) * scale;
      const len = Math.hypot(this.vx, this.vy) || 1;
      this.vx = (this.vx / len) * s;
      this.vy = (this.vy / len) * s;
    }

    render() {
      const d = this.curD;
      if (Math.abs(d - this.renderedD) > 0.25) {
        this.el.style.width = d + 'px';
        this.el.style.height = d + 'px';
        if (this.label) this.label.style.fontSize = Math.max(10, d * 0.12).toFixed(1) + 'px';
        this.renderedD = d;
      }
      this.el.style.transform = `translate3d(${(this.x - d / 2).toFixed(2)}px, ${(this.y - d / 2).toFixed(2)}px, 0)`;
    }

    remove() {
      this.el.remove();
      const i = bubbles.indexOf(this);
      if (i >= 0) bubbles.splice(i, 1);
    }
  }

  const liveTasks = () => bubbles.filter((b) => b.kind === 'task' && !b.gone);
  const liveDecor = () => bubbles.filter((b) => b.kind === 'decor' && !b.gone);
  const findTaskBubble = (id) => bubbles.find((b) => b.kind === 'task' && !b.gone && b.task.id === id);

  // 締切と画面サイズから、全部の玉の目標の大きさを決め直す
  function recalcTargets(immediate = false) {
    const bw = baseWidth();
    const { W, H } = viewport();
    const now = Date.now();
    const tasks = liveTasks();
    let area = 0;
    for (const b of tasks) {
      const info = deadlineInfo(b.task, now);
      b.rawD = bw * info.ratio;
      b.setOverdue(info.overdue);
      area += Math.PI * (b.rawD / 2) ** 2;
    }
    const limit = W * H * AREA_LIMIT;
    globalScale = area > limit ? Math.sqrt(limit / area) : 1;
    for (const b of tasks) {
      b.targetD = b.rawD * globalScale;
      if (immediate) b.curD = b.targetD;
    }
    for (const b of liveDecor()) {
      b.targetD = bw * b.decorRatio * globalScale;
      if (immediate) b.curD = b.targetD;
    }
  }

  function overlapsPlaced(x, y, r) {
    return bubbles.some((o) => o.placed && o.kind === 'task' && !o.gone &&
      Math.hypot(o.x - x, o.y - y) < o.r + r + 4);
  }

  function placeRandom(b) {
    const { W, H } = viewport();
    const r = b.r;
    for (let i = 0; i < 60; i++) {
      const x = rand(r, Math.max(r, W - r));
      const y = rand(r, Math.max(r, H - r));
      if (b.kind === 'decor' || !overlapsPlaced(x, y, r)) {
        b.x = x; b.y = y; b.placed = true;
        return;
      }
    }
    b.x = rand(r, Math.max(r, W - r));
    b.y = rand(r, Math.max(r, H - r));
    b.placed = true;
  }

  function fadeIn(b, rise = false) {
    const from = rise ? 'translateY(35%) scale(0.55)' : 'scale(0.5)';
    b.body.animate(
      [{ opacity: 0, transform: from }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
      { duration: rise ? 750 : 900, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' }
    );
  }

  function fadeOutAndRemove(b, duration = 450) {
    b.gone = true;
    const anim = b.body.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9)' }],
      { duration, easing: 'ease-out', fill: 'forwards' }
    );
    anim.onfinish = () => b.remove();
  }

  // 飾り玉の数をタスク数に合わせる
  function syncDecor(animate) {
    const n = state.tasks.length;
    const want = n >= TOTAL_BUBBLES ? 0 : Math.min(MAX_DECOR, TOTAL_BUBBLES - n);
    const decor = liveDecor();
    if (decor.length < want) {
      const bw = baseWidth();
      for (let i = decor.length; i < want; i++) {
        const b = new Bubble('decor');
        b.targetD = b.curD = bw * b.decorRatio * globalScale;
        placeRandom(b);
        b.setSpeed();
        b.render();
        if (animate) fadeIn(b);
      }
    } else if (decor.length > want) {
      decor.slice(0, decor.length - want).forEach((b) => fadeOutAndRemove(b, 600));
    }
  }

  function updateEmptyHint() {
    emptyHint.classList.toggle('hide', state.tasks.length > 0);
  }

  function afterTasksChanged() {
    recalcTargets(false);
    syncDecor(true);
    updateEmptyHint();
  }

  // ---------- 動き ----------
  function keepInside(b, W, H) {
    const r = b.r;
    if (b.x < r) { b.x = r; if (b.vx < 0) b.vx = -b.vx; }
    else if (b.x > W - r) { b.x = W - r; if (b.vx > 0) b.vx = -b.vx; }
    if (b.y < r) { b.y = r; if (b.vy < 0) b.vy = -b.vy; }
    else if (b.y > H - r) { b.y = H - r; if (b.vy > 0) b.vy = -b.vy; }
  }

  function step(dt, t) {
    const { W, H } = viewport();
    const k = 1 - Math.exp(-dt / SIZE_TAU);

    for (const b of bubbles) {
      b.curD += (b.targetD - b.curD) * k;
      if (b.frozen) {
        if (!b.gone) keepInside(b, W, H);
        continue;
      }
      // 巡航速度へゆっくり戻す（ぶつかって速くなったり遅くなったりしても落ち着く）
      const target = cruiseSpeed(b.curD);
      let s = Math.hypot(b.vx, b.vy);
      if (s < 0.001) {
        const a = rand(0, Math.PI * 2);
        b.vx = Math.cos(a); b.vy = Math.sin(a); s = 1;
      }
      const f = 1 + (target / s - 1) * Math.min(1, dt * 1.2);
      b.vx *= f; b.vy *= f;

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // ゆらゆら
      b.y += Math.cos(t * b.wobFreq + b.phase) * b.wobFreq * b.wobAmp * dt;
      b.x += Math.cos(t * b.wobFreq * 0.7 + b.phase * 1.3) * b.wobFreq * 0.35 * b.wobAmp * dt;

      if (!b.gone) keepInside(b, W, H);
    }

    // タスク玉どうしの衝突（飾り玉はすり抜ける）
    const tasks = liveTasks();
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < tasks.length; i++) {
        const a = tasks[i];
        for (let j = i + 1; j < tasks.length; j++) {
          const b = tasks[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          const minDist = a.r + b.r;
          if (dist >= minDist) continue;
          if (dist < 0.001) { dx = rand(-1, 1); dy = rand(-1, 1); dist = Math.hypot(dx, dy) || 1; }
          const nx = dx / dist, ny = dy / dist;
          const invA = a.frozen ? 0 : 1 / (a.curD * a.curD);
          const invB = b.frozen ? 0 : 1 / (b.curD * b.curD);
          const sum = invA + invB;
          if (sum === 0) continue;
          // 重なりをほどく（止まっている玉は押されない）
          const overlap = minDist - dist;
          a.x -= nx * overlap * (invA / sum);
          a.y -= ny * overlap * (invA / sum);
          b.x += nx * overlap * (invB / sum);
          b.y += ny * overlap * (invB / sum);
          // 跳ね返り
          if (iter === 0) {
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              const j2 = (-2 * rv) / sum;
              a.vx -= j2 * invA * nx; a.vy -= j2 * invA * ny;
              b.vx += j2 * invB * nx; b.vy += j2 * invB * ny;
            }
          }
        }
      }
      for (const b of tasks) if (!b.frozen) keepInside(b, W, H);
    }
  }

  let rafId = 0;
  let lastTs = 0;
  function frame(ts) {
    const t = ts / 1000;
    const dt = lastTs ? Math.min(0.05, t - lastTs) : 0;
    lastTs = t;
    step(dt, t);
    for (const b of bubbles) b.render();
    rafId = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (rafId) return;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ---------- 効果音（Web Audio APIで合成） ----------
  const audio = {
    ctx: null,
    unlocked: false,
    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
        }
        if (this.ctx.state !== 'running') this.ctx.resume();
        if (!this.unlocked) {
          // iPhoneは最初のタップで無音を鳴らしておくと、以後鳴らせる
          const buf = this.ctx.createBuffer(1, 1, 22050);
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.ctx.destination);
          src.start(0);
          this.unlocked = true;
        }
      } catch (e) { /* 音が出せなくても動作は続ける */ }
    },
    pop(d, delay = 0) {
      try {
        this.unlock();
        const ctx = this.ctx;
        if (!ctx) return;
        const t = ctx.currentTime + delay;
        const size = clamp((d - 60) / 160, 0, 1);    // 大きい玉ほど低い音

        const out = ctx.createGain();
        out.gain.value = 0.55;
        out.connect(ctx.destination);

        // 「ポン」：音程がすっと下がる短い音
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1150 - 480 * size, t);
        osc.frequency.exponentialRampToValueAtTime(210 - 70 * size, t + 0.075);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(og);
        og.connect(out);
        osc.start(t);
        osc.stop(t + 0.16);

        // 「パチ」：はじける瞬間のノイズ
        const len = Math.floor(ctx.sampleRate * 0.045);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2600 - 900 * size;
        bp.Q.value = 0.9;
        const ng = ctx.createGain();
        ng.gain.value = 0.32;
        src.connect(bp);
        bp.connect(ng);
        ng.connect(out);
        src.start(t);
      } catch (e) { /* 無視 */ }
    },
  };
  ['touchend', 'click', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => audio.unlock(), { capture: true, passive: true })
  );

  // ---------- 破裂の演出 ----------
  const RIM_COLORS = ['#ff9ad5', '#8fd3ff', '#ffe07a', '#9ff0d2', '#c7a6ff'];
  const RED_COLORS = ['#ff97a6', '#ffb39e', '#ff8fb6', '#ffc0c0'];

  function burst(x, y, d, overdue) {
    // フチが輪のように広がる
    const ring = document.createElement('div');
    ring.className = 'pop-ring' + (overdue ? ' overdue' : '');
    ring.style.width = ring.style.height = d + 'px';
    ring.style.left = (x - d / 2) + 'px';
    ring.style.top = (y - d / 2) + 'px';
    fxLayer.appendChild(ring);
    ring.animate(
      [{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(1.45)', opacity: 0 }],
      { duration: 420, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'forwards' }
    ).onfinish = () => ring.remove();

    // しぶき
    const colors = overdue ? RED_COLORS : RIM_COLORS;
    const n = 10 + Math.floor(Math.random() * 6);
    const g = d * 0.45;                      // 落ちる量
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const dist = d * rand(0.4, 0.8);
      const size = Math.max(4, d * rand(0.035, 0.07));
      const sx = cos * d * 0.42, sy = sin * d * 0.42;
      const p = document.createElement('div');
      p.className = 'drop';
      p.style.width = p.style.height = size + 'px';
      p.style.background = colors[i % colors.length];
      p.style.left = (x - size / 2) + 'px';
      p.style.top = (y - size / 2) + 'px';
      fxLayer.appendChild(p);
      const frames = [];
      for (let s = 0; s <= 6; s++) {
        const f = s / 6;
        const e = 1 - Math.pow(1 - f, 2.2);  // 最初は速く、だんだんゆっくり
        const px = sx + cos * dist * e;
        const py = sy + sin * dist * e + g * f * f;
        frames.push({
          transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) scale(${(1 - 0.5 * f).toFixed(2)})`,
          opacity: f < 0.45 ? 1 : 1 - (f - 0.45) / 0.55,
        });
      }
      p.animate(frames, { duration: rand(430, 520), easing: 'linear', fill: 'forwards' })
        .onfinish = () => p.remove();
    }
  }

  // ---------- 今日割った数 ----------
  function syncToday() {
    const t = ymd();
    if (state.todayCount.date !== t) {
      state.todayCount = { date: t, count: 0 };
      saveState();
      renderCount(false);
    }
  }
  function renderCount(bump) {
    countNum.textContent = String(state.todayCount.count);
    if (bump) {
      counterEl.classList.remove('bump');
      void counterEl.offsetWidth;
      counterEl.classList.add('bump');
    }
  }

  // ---------- 操作：割る・削除 ----------
  function removeTaskData(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
  }

  function popTask(b) {
    if (!b || b.gone) return;
    b.gone = true;
    b.frozen = true;
    const POP_DELAY = 110;
    audio.pop(b.curD, POP_DELAY / 1000);

    // ぷるっと震えて少し膨らむ
    b.body.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.07, 0.95)', offset: 0.35 },
        { transform: 'scale(0.97, 1.06)', offset: 0.7 },
        { transform: 'scale(1.1)' },
      ],
      { duration: POP_DELAY, easing: 'ease-in-out', fill: 'forwards' }
    );
    setTimeout(() => {
      burst(b.x, b.y, b.curD, b.overdue);
      b.remove();
    }, POP_DELAY);

    removeTaskData(b.task.id);
    syncToday();
    state.todayCount.count += 1;
    saveState();
    renderCount(true);
    afterTasksChanged();
  }

  function deleteTask(b) {
    if (!b || b.gone) return;
    b.frozen = true;
    fadeOutAndRemove(b, 450);
    removeTaskData(b.task.id);
    saveState();
    afterTasksChanged();
  }

  // ---------- 玉のメニュー ----------
  let menuBubble = null;

  function openMenu(b) {
    if (b.gone || sheetOpen || confirmTarget) return;
    if (menuBubble) closeMenu();
    menuBubble = b;
    b.frozen = true;
    b.el.classList.add('selected');

    menuTitle.textContent = b.task.title;
    menuDeadline.textContent = deadlineLabel(b.task);
    menuDeadline.classList.toggle('overdue', b.overdue);

    menuBackdrop.hidden = false;
    menu.hidden = false;
    menu.classList.remove('show');
    positionMenu(b);
    void menu.offsetWidth;
    menu.classList.add('show');
  }

  function positionMenu(b) {
    const { W, H } = viewport();
    const safe = safeInsets();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const margin = 12, gap = 10;
    const minLeft = safe.left + margin, maxLeft = W - safe.right - margin - mw;
    const minTop = safe.top + margin, maxTop = H - safe.bottom - margin - mh;
    const left = clamp(b.x - mw / 2, minLeft, Math.max(minLeft, maxLeft));
    const below = b.y + b.r + gap;
    const above = b.y - b.r - gap - mh;
    let top;
    let origin;
    if (below <= maxTop) { top = below; origin = 'top'; }
    else if (above >= minTop) { top = above; origin = 'bottom'; }
    else { top = clamp(b.y - mh / 2, minTop, Math.max(minTop, maxTop)); origin = 'center'; }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.transformOrigin = `${clamp(b.x - left, 0, mw)}px ${origin}`;
  }

  function closeMenu() {
    if (!menuBubble) return;
    const b = menuBubble;
    menuBubble = null;
    b.el.classList.remove('selected');
    if (!b.gone && b !== confirmTarget) b.frozen = false;
    menu.classList.remove('show');
    menu.hidden = true;
    menuBackdrop.hidden = true;
  }

  menuBackdrop.addEventListener('click', closeMenu);

  $('#popBtn').addEventListener('click', () => {
    const b = menuBubble;
    closeMenu();
    popTask(b);
  });
  $('#editBtn').addEventListener('click', () => {
    const b = menuBubble;
    closeMenu();
    if (b && !b.gone) openSheet('edit', b.task);
  });
  $('#deleteBtn').addEventListener('click', () => {
    const b = menuBubble;
    if (!b) return;
    openConfirm(b);
    closeMenu();
  });

  // ---------- 削除の確認 ----------
  let confirmTarget = null;

  function openConfirm(b) {
    confirmTarget = b;
    b.frozen = true;
    confirmName.textContent = `「${b.task.title}」`;
    confirmEl.hidden = false;
    void confirmEl.offsetWidth;
    confirmEl.classList.add('open');
  }
  function closeConfirm() {
    const b = confirmTarget;
    confirmTarget = null;
    if (b && !b.gone) b.frozen = false;
    confirmEl.classList.remove('open');
    setTimeout(() => { if (!confirmTarget) confirmEl.hidden = true; }, 200);
  }
  $('#confirmOk').addEventListener('click', () => {
    const b = confirmTarget;
    closeConfirm();
    deleteTask(b);
  });
  confirmEl.querySelectorAll('[data-close="confirm"]').forEach((el) => el.addEventListener('click', closeConfirm));

  // ---------- 入力シート ----------
  let sheetOpen = false;
  let sheetMode = 'add';
  let editingId = null;
  let composing = false;
  let compositionEndedAt = 0;

  function titleValue() {
    return chars(titleInput.value.trim()).slice(0, MAX_TITLE).join('');
  }

  function enforceMax() {
    const a = chars(titleInput.value);
    if (a.length > MAX_TITLE) titleInput.value = a.slice(0, MAX_TITLE).join('');
  }

  function updateForm() {
    const len = chars(titleInput.value).length;
    charCount.textContent = `${Math.min(len, MAX_TITLE)}/${MAX_TITLE}`;
    charCount.classList.toggle('full', len >= MAX_TITLE);
    submitBtn.disabled = titleValue() === '';
    const hasDate = dateInput.value !== '';
    dateWrap.classList.toggle('empty', !hasDate);
    dateClear.disabled = !hasDate;
  }

  function openSheet(mode, task) {
    sheetMode = mode;
    editingId = task ? task.id : null;
    sheetTitle.textContent = mode === 'add' ? 'やることを追加' : 'やることを編集';
    submitBtn.textContent = mode === 'add' ? '追加' : '保存';
    titleInput.value = task ? task.title : '';
    dateInput.value = task && task.deadline ? task.deadline : '';
    composing = false;
    updateForm();

    sheetOpen = true;
    sheet.hidden = false;
    void sheet.offsetWidth;
    sheet.classList.add('open');
    // タップ操作の中で focus しないと iPhone でキーボードが出ない
    try { titleInput.focus({ preventScroll: true }); } catch (e) { titleInput.focus(); }
    if (mode === 'edit') {
      const n = titleInput.value.length;
      try { titleInput.setSelectionRange(n, n); } catch (e) { /* 無視 */ }
    }
  }

  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    titleInput.blur();
    dateInput.blur();
    sheet.classList.remove('open');
    setTimeout(() => {
      if (!sheetOpen) sheet.hidden = true;
      window.scrollTo(0, 0);
    }, 300);
  }

  function submitSheet() {
    enforceMax();
    const title = titleValue();
    if (!title) return;
    const deadline = isYmd(dateInput.value) ? dateInput.value : null;

    if (sheetMode === 'add') {
      const task = { id: newId(), title, deadline, createdAt: localIso() };
      state.tasks.push(task);
      saveState();
      spawnNewTask(task);
    } else {
      const task = state.tasks.find((t) => t.id === editingId);
      if (task) {
        task.title = title;
        task.deadline = deadline;
        saveState();
        const b = findTaskBubble(task.id);
        if (b) b.setTitle(title);
      }
    }
    closeSheet();
    afterTasksChanged();     // 大きさ・色はなめらかに変わる
  }

  function spawnNewTask(task) {
    const b = new Bubble('task', task);
    recalcTargets(false);
    b.curD = b.targetD;
    const { W, H } = viewport();
    const r = b.r;
    b.x = rand(r, Math.max(r, W - r));
    b.y = H - r;
    b.placed = true;
    const s = cruiseSpeed(b.curD);
    b.vx = rand(-0.4, 0.4) * s;
    b.vy = -s * 1.4;           // 下からふわっと上がってくる
    b.render();
    fadeIn(b, true);
  }

  titleInput.addEventListener('compositionstart', () => { composing = true; });
  titleInput.addEventListener('compositionend', () => {
    composing = false;
    compositionEndedAt = performance.now();
    enforceMax();
    updateForm();
  });
  titleInput.addEventListener('input', (e) => {
    if (!composing && !e.isComposing) enforceMax();
    updateForm();
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // 変換確定のEnterでは送信しない
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (performance.now() - compositionEndedAt < 80) return;
    if (!submitBtn.disabled) submitSheet();
  });

  dateInput.addEventListener('input', updateForm);
  dateInput.addEventListener('change', updateForm);
  dateClear.addEventListener('click', () => {
    dateInput.value = '';
    updateForm();
  });

  sheetPanel.addEventListener('submit', (e) => {
    e.preventDefault();
    submitSheet();
  });
  sheet.querySelectorAll('[data-close="sheet"]').forEach((el) => el.addEventListener('click', closeSheet));

  addBtn.addEventListener('click', () => {
    closeMenu();
    openSheet('add', null);
  });

  // キーボードが出たとき、シートをキーボードの上に置く
  function updateKeyboardOffset() {
    const vv = window.visualViewport;
    if (!vv) return;
    const off = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    document.documentElement.style.setProperty('--kb', off + 'px');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateKeyboardOffset);
    window.visualViewport.addEventListener('scroll', updateKeyboardOffset);
  }

  // ---------- iPhone向けの細かい対策 ----------
  // ピンチ拡大・画面の引っぱりを無効化
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
  }, { passive: false });

  // 画面サイズが変わったら計算し直す
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      recalcTargets(false);
      if (menuBubble) positionMenu(menuBubble);
    }, 100);
  });

  // 裏に回っている間は止め、戻ったら計算し直す
  function onResume() {
    syncToday();
    recalcTargets(false);
    startLoop();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else onResume();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) onResume(); });

  // 1分ごとに締切の大きさと日付を見直す
  setInterval(() => {
    syncToday();
    recalcTargets(false);
  }, 60 * 1000);

  // ---------- 起動 ----------
  function init() {
    syncToday();
    renderCount(false);

    for (const t of state.tasks) new Bubble('task', t);
    recalcTargets(true);
    // 大きい玉から順に、重ならない位置へ置く
    liveTasks()
      .sort((a, b) => b.curD - a.curD)
      .forEach((b) => { placeRandom(b); b.setSpeed(); });

    syncDecor(false);
    updateEmptyHint();
    for (const b of bubbles) b.render();
    startLoop();
  }

  init();
})();
