// What the TV shows while music plays and nobody touches the remote: the
// panel switched off (screen-timer.js), the cover with the track, or bars
// that move with the music. Any key brings back the app.
//
// LG plays <audio> in its own hardware pipeline: Web Audio attached to the
// element hears only silence. So the bars come from a second copy of the
// track, fetched from the bridge and decoded at a low rate, read at the
// element's current position.
const RATE = 11025, SIZE = 1024, BARS = 48;

export function createIdleView(options) {
  const doc = options.document || document, audio = options.audio;
  let root = null, canvas = null, mode = null, frame = null;
  let pcm = null, pcmFor = null, loading = null, levels = new Float32Array(BARS);
  const window_ = new Float32Array(SIZE), re = new Float32Array(SIZE), im = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) window_[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1));
  // Bars on a logarithmic scale from 40 Hz to 5 kHz, as the ear hears them.
  const edges = [];
  for (let i = 0; i <= BARS; i++) edges.push(Math.max(1, Math.round(40 * Math.pow(5000 / 40, i / BARS) * SIZE / RATE)));

  function build() {
    if (root) return;
    root = doc.createElement("div");
    root.id = "idle-view";
    root.hidden = true;
    root.innerHTML = '<div class="idle-backdrop"></div><canvas width="480" height="270"></canvas><div class="idle-now"><img alt=""><div><strong></strong><span></span></div></div>';
    canvas = root.querySelector("canvas");
    (options.parent || doc.body).appendChild(root);
  }
  // The track decoded once, mono at 11 kHz: a few MB for a song.
  function prepare(src) {
    if (!src || src === pcmFor || (loading && loading.src === src)) return;
    pcm = null;
    pcmFor = null;
    const job = loading = { src };
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return;
    fetch(src).then((r) => r.arrayBuffer()).then((buf) => new Promise((ok, ko) => {
      new Offline(1, RATE, RATE).decodeAudioData(buf, ok, ko);
    })).then((decoded) => {
      if (loading !== job) return;
      const ch = decoded.numberOfChannels, n = decoded.length, mono = new Float32Array(n);
      for (let c = 0; c < ch; c++) {
        const d = decoded.getChannelData(c);
        for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
      }
      pcm = mono;
      pcmFor = src;
      loading = null;
    }).catch(() => {
      if (loading === job) loading = null;
    });
  }
  function fft() {
    const n = SIZE;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  }
  function measure() {
    const ready = pcm && pcmFor === audio.currentSrc && !audio.paused;
    if (ready) {
      const at = Math.floor(audio.currentTime * RATE) - SIZE / 2;
      for (let i = 0; i < SIZE; i++) {
        const k = at + i;
        re[i] = (k >= 0 && k < pcm.length ? pcm[k] : 0) * window_[i];
        im[i] = 0;
      }
      fft();
    }
    for (let b = 0; b < BARS; b++) {
      let level = 0;
      if (ready) {
        let sum = 0;
        const from = edges[b], to = Math.max(from + 1, edges[b + 1]);
        for (let k = from; k < to; k++) sum += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        // Decibels over a 60 dB range, so quiet passages still move.
        const db = 20 * Math.log10(sum / (to - from) / (SIZE / 4) + 1e-9);
        level = Math.max(0, Math.min(1, (db + 60) / 60));
      }
      // Up quickly, down slowly, like the needle of a meter.
      levels[b] += (level - levels[b]) * (level > levels[b] ? 0.55 : 0.12);
    }
  }
  // A ring of light that breathes with the music, drawn on a small canvas
  // stretched to the screen (soft for free, light for the TV's GPU). Every
  // frame starts from the previous one slightly zoomed and turned, so what
  // was drawn drifts outwards in trails: a tunnel of colour. The bass drives
  // the pulse: a kick swells the ring, pushes the zoom and turns the hue.
  let hue = 300, bass = 0, avg = 0.2, kick = 0, spin = 0, last = 0;
  function draw(now) {
    frame = requestAnimationFrame(draw);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    measure();
    const g = canvas.getContext("2d"), w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
    let low = 0;
    for (let b = 0; b < 8; b++) low += levels[b];
    low /= 8;
    bass += (low - bass) * 0.5;
    avg += (bass - avg) * 0.02;
    if (bass > avg * 1.25 && bass > 0.25 && kick < 0.3) {
      kick = 1;
      hue += 40;
    }
    kick *= Math.pow(0.04, dt);
    hue += dt * (12 + 40 * bass);
    spin += dt * (0.15 + 0.6 * kick);
    // The previous frame, a little larger and turned: the trails.
    const zoom = 1.025 + 0.05 * kick;
    g.globalCompositeOperation = "source-over";
    g.save();
    g.globalAlpha = 0.9;
    g.translate(cx, cy);
    g.rotate(0.006 + 0.02 * kick);
    g.scale(zoom, zoom);
    g.drawImage(canvas, -cx, -cy);
    g.restore();
    g.fillStyle = "rgba(4,0,10,0.10)";
    g.fillRect(0, 0, w, h);
    // The ring: the spectrum wrapped round the centre, mirrored so it closes,
    // three times with shifted colours and sizes.
    g.globalCompositeOperation = "lighter";
    const points = BARS * 2, base = h * (0.16 + 0.07 * kick + 0.06 * bass);
    // Each point averages its neighbours: a soft wave, not a saw.
    const soft = (k) => {
      let sum = 0;
      for (let d = -2; d <= 2; d++) {
        const m = ((k + d) % points + points) % points, idx = m < BARS ? m : points - m - 1;
        sum += levels[idx];
      }
      return sum / 5;
    };
    for (let layer = 0; layer < 3; layer++) {
      const xy = [];
      for (let k = 0; k < points; k++) {
        const a = spin * (layer % 2 ? -1 : 1) + layer * 0.7 + k / points * Math.PI * 2;
        const r = base * (1 + layer * 0.35) + soft(k) * h * (0.2 - layer * 0.05);
        xy.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      // Curves through the midpoints between the points: a closed smooth line.
      g.beginPath();
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      let start = mid(xy[points - 1], xy[0]);
      g.moveTo(start[0], start[1]);
      for (let k = 0; k < points; k++) {
        const m = mid(xy[k], xy[(k + 1) % points]);
        g.quadraticCurveTo(xy[k][0], xy[k][1], m[0], m[1]);
      }
      g.closePath();
      g.lineWidth = 2.2 + 3 * kick;
      g.strokeStyle = "hsla(" + ((hue + layer * 60) % 360) + ",95%," + (55 + 15 * kick) + "%,0.85)";
      g.stroke();
    }
    // A glow at the centre on every kick.
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, base * 1.6);
    glow.addColorStop(0, "hsla(" + ((hue + 180) % 360) + ",100%,60%," + (0.02 + 0.10 * kick) + ")");
    glow.addColorStop(1, "hsla(" + ((hue + 180) % 360) + ",100%,50%,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
  }
  function update() {
    if (!root) return;
    const now = options.now();
    root.querySelector(".idle-now img").src = now.art || "placeholder.svg";
    root.querySelector(".idle-backdrop").style.backgroundImage = now.art ? 'url("' + now.art + '")' : "none";
    root.querySelector("strong").textContent = now.title || "";
    root.querySelector("span").textContent = now.artist || "";
  }
  return {
    show(kind) {
      build();
      update();
      mode = kind === "visual" ? "visual" : "cover";
      if (mode === "visual") prepare(audio.currentSrc);
      root.className = mode;
      root.hidden = false;
      if (mode === "visual" && frame === null) frame = requestAnimationFrame(draw);
      return mode;
    },
    hide() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      last = 0;
      mode = null;
      if (root) root.hidden = true;
    },
    update,
    prepare,
    get mode() { return mode; },
    get ready() { return !!pcm && pcmFor === audio.currentSrc; }
  };
}
