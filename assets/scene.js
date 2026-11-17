// Procedural LiDAR-style street scene with 3D detection boxes, drawn on a 2D canvas.
// The scene is generated in the browser from a fixed seed by ray-casting a simulated
// 40-beam sensor against simple geometry. No real sensor data is involved.
(() => {
  const canvas = document.getElementById('scene');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const pointsLabel = document.getElementById('scene-points');
  const objectsLabel = document.getElementById('scene-objects');
  const hint = document.getElementById('scene-hint');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = !reduceMotion && !('static' in canvas.dataset);

  // ---------- Deterministic randomness ----------
  let seed = 20201116;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const TAU = Math.PI * 2;

  // ---------- Scene (x forward, y left, z up; metres) ----------
  const SENSOR_H = 1.9;
  const MAX_RANGE = 48;
  const KIND = { ground: 0, marking: 1, structure: 2, foliage: 3, car: 4, ped: 5, cyc: 6 };
  const CLASSES = {
    car: { kind: KIND.car, color: '#38d6ee', name: 'car', size: [4.5, 1.9, 1.55] },
    ped: { kind: KIND.ped, color: '#fbbf24', name: 'pedestrian', size: [0.6, 0.6, 1.75] },
    cyc: { kind: KIND.cyc, color: '#f472b6', name: 'cyclist', size: [1.8, 0.65, 1.7] },
  };

  // [class, x, y, yaw, score, show label]
  const agents = [
    ['car', 11, 0.1, 0, 0.98, true],
    ['car', 23.5, -3.5, 0.02, 0.96, true],
    ['car', 16, 3.6, Math.PI, 0.97, true],
    ['car', -9.5, -3.5, 0, 0.94, false],
    ['car', 33, 3.5, Math.PI - 0.03, 0.88, false],
    ['car', 4.5, -6.6, 0, 0.95, false],
    ['car', -2.5, -6.7, 0.03, 0.93, false],
    ['car', 21, 6.8, Math.PI, 0.91, false],
    ['car', -15, 3.5, Math.PI, 0.9, false],
    ['ped', 8, -9.4, 0.3, 0.91, true],
    ['ped', 14.5, 9.6, 2, 0.89, true],
    ['ped', 27, -9.2, -1.2, 0.84, false],
    ['cyc', 18, -6, 0.04, 0.92, true],
  ].map(([cls, x, y, yaw, score, label]) => {
    const { kind, color, name, size: [l, w, h] } = CLASSES[cls];
    return { kind, color, name, x, y, yaw, l, w, h, score, label };
  });

  const boxes = [...agents];
  const blocks = [
    [1, [[-48, -30], [-25, -5], [-1, 17], [22, 48]]],
    [-1, [[-48, -20], [-15, 7], [12, 29], [34, 48]]],
  ];
  for (const [side, spans] of blocks) {
    for (const [x0, x1] of spans) {
      boxes.push({ kind: KIND.structure, x: (x0 + x1) / 2, y: side * 18, yaw: 0, l: x1 - x0, w: 11, h: 7 + rand() * 9 });
    }
  }
  for (const b of boxes) {
    b.cos = Math.cos(b.yaw);
    b.sin = Math.sin(b.yaw);
    b.radius = Math.hypot(b.l, b.w) / 2;
  }

  const cylinders = [];
  const spheres = [];
  for (const side of [1, -1]) {
    for (let x = -42; x <= 44; x += 9) {
      const tx = x + (rand() - 0.5) * 2;
      const ty = side * (10.6 + rand() * 0.4);
      if (agents.some((a) => Math.hypot(a.x - tx, a.y - ty) < 2)) continue;
      cylinders.push({ kind: KIND.foliage, x: tx, y: ty, r: 0.2, z0: 0, z1: 3 });
      spheres.push({ kind: KIND.foliage, x: tx, y: ty, z: 4.4, r: 1.7 + rand() * 0.6 });
    }
    for (let x = -32; x <= 44; x += 19) {
      cylinders.push({ kind: KIND.structure, x, y: side * 8.7, r: 0.12, z0: 0, z1: 7 });
    }
  }

  // Painted road markings show up as high-intensity returns.
  const isMarking = (x, y) => {
    const ay = Math.abs(y);
    if (Math.abs(y - 1.75) < 0.12) return true; // centre line
    if (Math.abs(y + 1.75) < 0.12 && ((x % 9) + 9) % 9 < 3) return true; // dashed lane divider
    if (Math.abs(ay - 5.25) < 0.12) return true; // edge lines
    if (x > 40 && x < 43.5 && ay < 8 && ((y + 8) % 1.2) < 0.6) return true; // crosswalk
    return false;
  };

  // ---------- Simulated sensor sweep ----------
  const BEAMS = 40;
  const azStep = ((window.innerWidth < 600 ? 0.8 : 0.5) * Math.PI) / 180;
  const px = [], py = [], pz = [], pKind = [], pAz = [], pRange = [];

  for (let i = 0; i < BEAMS; i++) {
    const slope = Math.tan(((-24 + (36 * i) / (BEAMS - 1)) * Math.PI) / 180);
    for (let az = -Math.PI; az < Math.PI; az += azStep) {
      const dx = Math.cos(az);
      const dy = Math.sin(az);
      let best = slope < 0 ? SENSOR_H / -slope : Infinity;
      let kind = KIND.ground;

      for (const b of boxes) {
        const along = dx * b.x + dy * b.y;
        if (along < -b.radius || along - b.radius > best) continue;
        if (Math.abs(dx * b.y - dy * b.x) > b.radius) continue;
        // Slab test in the box frame.
        const ox = -b.x * b.cos - b.y * b.sin;
        const oy = b.x * b.sin - b.y * b.cos;
        const lx = dx * b.cos + dy * b.sin;
        const ly = -dx * b.sin + dy * b.cos;
        let tmin = -Infinity;
        let tmax = Infinity;
        for (const [o, d, half] of [[ox, lx, b.l / 2], [oy, ly, b.w / 2]]) {
          if (Math.abs(d) < 1e-9) {
            if (Math.abs(o) > half) tmin = Infinity;
            continue;
          }
          const t1 = (-half - o) / d;
          const t2 = (half - o) / d;
          tmin = Math.max(tmin, Math.min(t1, t2));
          tmax = Math.min(tmax, Math.max(t1, t2));
        }
        if (tmax < tmin || tmax <= 0) continue;
        const tIn = Math.max(tmin, 0);
        const zIn = SENSOR_H + slope * tIn;
        let t = -1;
        if (zIn >= 0 && zIn <= b.h) t = tIn;
        else if (zIn > b.h && slope < 0) {
          const tTop = (SENSOR_H - b.h) / -slope;
          if (tTop >= tIn && tTop <= tmax) t = tTop;
        }
        if (t > 0 && t < best) { best = t; kind = b.kind; }
      }

      for (const c of cylinders) {
        const along = dx * c.x + dy * c.y;
        const perp2 = c.x * c.x + c.y * c.y - along * along;
        if (along <= 0 || perp2 > c.r * c.r) continue;
        const t = along - Math.sqrt(c.r * c.r - perp2);
        const z = SENSOR_H + slope * t;
        if (t > 0 && t < best && z >= c.z0 && z <= c.z1) { best = t; kind = c.kind; }
      }

      for (const s of spheres) {
        const lz = s.z - SENSOR_H;
        const a = 1 + slope * slope;
        const bq = dx * s.x + dy * s.y + slope * lz;
        const disc = bq * bq - a * (s.x * s.x + s.y * s.y + lz * lz - s.r * s.r);
        if (disc < 0) continue;
        const t = (bq - Math.sqrt(disc)) / a;
        if (t > 0 && t < best && rand() > 0.35) { best = t; kind = s.kind; }
      }

      if (best > MAX_RANGE || rand() < 0.04) continue;
      const range = best + gauss() * 0.015;
      let x = dx * range;
      let y = dy * range;
      let z = SENSOR_H + slope * range;
      if (kind === KIND.ground) {
        z = gauss() * 0.01;
        if (isMarking(x, y)) kind = KIND.marking;
      } else if (kind === KIND.foliage) {
        x += gauss() * 0.12;
        y += gauss() * 0.12;
        z += gauss() * 0.12;
      }
      px.push(x); py.push(y); pz.push(z); pKind.push(kind); pAz.push(az); pRange.push(best);
    }
  }

  const count = px.length;
  if (pointsLabel) pointsLabel.textContent = `${count.toLocaleString('en-US')} pts`;
  if (objectsLabel) objectsLabel.textContent = `${agents.length} objects`;

  // ---------- Styling ----------
  const BUCKETS = [
    'rgba(110,170,195,0.40)', // 0 ground, near
    'rgba(100,155,185,0.32)', // 1 ground, mid
    'rgba(90,135,170,0.24)',  // 2 ground, far
    'rgba(225,245,255,0.85)', // 3 road marking
    'rgba(125,135,210,0.42)', // 4 structure
    'rgba(95,200,150,0.40)',  // 5 foliage
    CLASSES.car.color,        // 6
    CLASSES.ped.color,        // 7
    CLASSES.cyc.color,        // 8
    'rgba(200,250,255,0.95)', // 9 sweep head
    'rgba(150,225,245,0.55)', // 10 sweep trail
  ];
  const baseBucket = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const k = pKind[i];
    if (k === KIND.ground) baseBucket[i] = pRange[i] < 14 ? 0 : pRange[i] < 28 ? 1 : 2;
    else if (k === KIND.marking) baseBucket[i] = 3;
    else if (k === KIND.structure) baseBucket[i] = 4;
    else if (k === KIND.foliage) baseBucket[i] = 5;
    else baseBucket[i] = 2 + k; // car 6, ped 7, cyc 8
  }

  const boxCorners = (b, pad = 0.12) => {
    const hl = b.l / 2 + pad;
    const hw = b.w / 2 + pad;
    const out = [];
    for (const z of [0, b.h + pad * 0.7]) {
      for (const [u, v] of [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]]) {
        out.push([b.x + u * b.cos - v * b.sin, b.y + u * b.sin + v * b.cos, z]);
      }
    }
    return out;
  };
  for (const a of agents) a.corners = boxCorners(a);
  const ego = { x: 0, y: 0, l: 4.6, w: 1.95, h: 1.5, cos: 1, sin: 0 };
  ego.corners = boxCorners(ego, 0);
  const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

  // ---------- Camera & drawing ----------
  const view = { yaw: 0, pitch: 0 };
  let dpr = 1;
  let cam;

  function setCamera(time) {
    const W = canvas.width;
    const H = canvas.height;
    const az = (200 * Math.PI) / 180 + view.yaw + (animate ? 0.32 * Math.sin(time / 7000) : 0);
    const el = clamp(0.62 + view.pitch, 0.2, 1.3);
    const dist = W / H < 1 ? 52 : 46;
    const target = [10, 0, 0];
    const pos = [
      target[0] + dist * Math.cos(el) * Math.cos(az),
      target[1] + dist * Math.cos(el) * Math.sin(az),
      target[2] + dist * Math.sin(el),
    ];
    const f = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
    const fl = Math.hypot(...f);
    f[0] /= fl; f[1] /= fl; f[2] /= fl;
    const rl = Math.hypot(f[1], f[0]);
    const r = [f[1] / rl, -f[0] / rl, 0];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    cam = { pos, f, r, u, focal: Math.min(W, H) * 1.35, cx: W / 2, cy: H * 0.5 };
  }

  // Projects a world point; returns [sx, sy, depth] or null when behind the camera.
  function project(x, y, z) {
    const dx = x - cam.pos[0];
    const dy = y - cam.pos[1];
    const dz = z - cam.pos[2];
    const zc = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    if (zc < 1) return null;
    const xc = dx * cam.r[0] + dy * cam.r[1];
    const yc = dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2];
    return [cam.cx + (cam.focal * xc) / zc, cam.cy - (cam.focal * yc) / zc, zc];
  }

  function strokePolyline(pts, close) {
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(p[0], p[1]);
      else { ctx.moveTo(p[0], p[1]); pen = true; }
    }
    if (close) ctx.closePath();
    ctx.stroke();
  }

  function drawBox(b, color, alpha) {
    const p = b.corners.map((c) => project(...c));
    if (p.some((q) => !q)) return null;
    ctx.globalAlpha = alpha * 0.12;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const i of [0, 1, 2, 3]) ctx.lineTo(p[i][0], p[i][1]);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.22; // front face marks heading
    ctx.beginPath();
    for (const i of [0, 1, 5, 4]) ctx.lineTo(p[i][0], p[i][1]);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [i, j] of EDGES) {
      ctx.moveTo(p[i][0], p[i][1]);
      ctx.lineTo(p[j][0], p[j][1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    return p;
  }

  const LABEL_FONT = () => `500 ${10 * dpr}px "Geist Mono", ui-monospace, monospace`;

  // Places labels nearest-first and drops any that would overlap one already placed.
  function placeLabels(candidates) {
    ctx.font = LABEL_FONT();
    const placed = [];
    for (const { text, x, y, color } of candidates) {
      const w = ctx.measureText(text).width + 10 * dpr;
      const h = 16 * dpr;
      const rect = { text, color, left: x - w / 2, top: y - h - 6 * dpr, w, h };
      const gap = 3 * dpr;
      const hits = placed.some((o) =>
        rect.left < o.left + o.w + gap && o.left < rect.left + rect.w + gap &&
        rect.top < o.top + o.h + gap && o.top < rect.top + rect.h + gap);
      if (!hits) placed.push(rect);
    }
    return placed;
  }

  function drawLabel({ text, color, left, top, w, h }) {
    ctx.font = LABEL_FONT();
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, top, w, h, 4 * dpr);
    else ctx.rect(left, top, w, h);
    ctx.fill();
    ctx.fillStyle = '#05121a';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 5 * dpr, top + h / 2 + 0.5 * dpr);
  }

  function draw(time) {
    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return;
    setCamera(time);

    ctx.globalCompositeOperation = 'source-over';
    const bg = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#0c161e');
    bg.addColorStop(1, '#05080b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Range rings around the ego vehicle.
    ctx.lineWidth = dpr;
    ctx.strokeStyle = 'rgba(120,170,200,0.12)';
    ctx.fillStyle = 'rgba(140,180,205,0.45)';
    ctx.font = `${9.5 * dpr}px "Geist Mono", ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    for (const radius of [10, 20, 30, 40]) {
      const ring = [];
      for (let k = 0; k <= 120; k++) {
        const a = (k / 120) * TAU;
        ring.push(project(radius * Math.cos(a), radius * Math.sin(a), 0));
      }
      strokePolyline(ring, false);
      if (radius % 20) continue;
      const tag = project(radius * Math.cos(2.45), radius * Math.sin(2.45), 0);
      if (tag) ctx.fillText(`${radius} m`, tag[0] + 4 * dpr, tag[1]);
    }

    // Point cloud, batched into one path per colour.
    const sweep = animate ? (time / 4200) * TAU : null;
    const paths = BUCKETS.map(() => new Path2D());
    for (let i = 0; i < count; i++) {
      const p = project(px[i], py[i], pz[i]);
      if (!p || p[0] < -4 || p[1] < -4 || p[0] > W + 4 || p[1] > H + 4) continue;
      let b = baseBucket[i];
      if (sweep !== null && b < 6) {
        const lag = (((sweep - pAz[i]) % TAU) + TAU) % TAU;
        if (lag < 0.1) b = 9;
        else if (lag < 0.55) b = 10;
      }
      const size = dpr * clamp(52 / p[2], 0.9, 2.2) * (b >= 6 && b <= 8 ? 1.25 : 1);
      paths[b].rect(p[0] - size / 2, p[1] - size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'lighter';
    BUCKETS.forEach((color, b) => {
      ctx.fillStyle = color;
      ctx.fill(paths[b]);
    });
    ctx.globalCompositeOperation = 'source-over';

    // Ego vehicle and sensor.
    ctx.lineWidth = 1.2 * dpr;
    drawBox(ego, '#e6f0f5', 0.55);
    const sensor = project(0, 0, SENSOR_H);
    if (sensor) {
      ctx.fillStyle = '#e6f0f5';
      ctx.beginPath();
      ctx.arc(sensor[0], sensor[1], 2.2 * dpr, 0, TAU);
      ctx.fill();
    }

    // Detections, far to near so nearer labels sit on top.
    const ordered = agents
      .map((a) => ({ a, c: project(a.x, a.y, a.h / 2) }))
      .filter((o) => o.c)
      .sort((m, n) => n.c[2] - m.c[2]);
    ctx.lineWidth = 1.3 * dpr;
    const candidates = [];
    for (const { a } of ordered) {
      const p = drawBox(a, a.color, 0.95);
      if (p && a.label) {
        const top = p.slice(4).reduce((m, q) => (q[1] < m[1] ? q : m));
        candidates.push({ text: `${a.name} ${a.score.toFixed(2)}`, x: (p[4][0] + p[6][0]) / 2, y: top[1], color: a.color });
      }
    }
    placeLabels(candidates.reverse()).reverse().forEach(drawLabel);
  }

  // ---------- Sizing, animation, interaction ----------
  let lastTime = 0;
  const redraw = () => draw(lastTime);

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
    redraw();
  }
  new ResizeObserver(resize).observe(canvas);
  document.fonts?.ready.then(redraw);

  let visible = true;
  let running = false;
  let lastFrame = 0;
  function loop(now) {
    if (!visible || document.hidden) { running = false; return; }
    if (now - lastFrame >= 33) {
      lastFrame = now;
      lastTime = now;
      draw(now);
    }
    requestAnimationFrame(loop);
  }
  function start() {
    if (!animate || running || !visible || document.hidden) return;
    running = true;
    requestAnimationFrame(loop);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', start);
  start();

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
    hint?.classList.add('is-hidden');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw = drag.yaw - (e.clientX - drag.x) * 0.008;
    view.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.005, -0.42, 0.68);
    if (!animate) redraw();
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('is-dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
})();
