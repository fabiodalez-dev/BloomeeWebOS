// What the TV shows while music plays and nobody touches the remote: the
// panel switched off (screen-timer.js), the cover with the track, or a
// visualiser, slow and dark enough for a bedroom: soft gradients of our own, or
// a MilkDrop preset (Butterchurn, WebGL 2). Any key brings back the app.
//
// LG plays <audio> in its own hardware pipeline: Web Audio attached to the
// element hears only silence. So the visualisers listen to a second copy of
// the track, fetched from the bridge, decoded, and played silently in step
// with the element.
import butterchurnModule from "butterchurn";
import { PRESETS } from "./visual-presets.js";
import { createSoftGradient, BANDS } from "./soft-gradient.js";

// A UMD bundle built with Babel: the API sits on .default.
const butterchurn = butterchurnModule.default || butterchurnModule;
// 11 kHz is plenty for the bass and the mids that drive the pictures, and
// keeps a song to a few MB: the TV has 1 GB, and once the web apps passed
// 350 MB webOS reloaded Bloomee.
const RATE = 11025;
const CHANGE_SECONDS = 90, BLEND_SECONDS = 10;
const SOFT = [
  { id: "soft-violet", label: "Viola e pesca", soft: { base: [0.043, 0.027, 0.086], colors: [[0.482, 0.247, 0.894], [0.886, 0.333, 0.604], [1.0, 0.604, 0.42], [0.294, 0.169, 0.702], [0.784, 0.427, 0.843]] } },
  { id: "soft-ocean", label: "Oceano", soft: { base: [0.012, 0.039, 0.078], colors: [[0.122, 0.435, 0.82], [0.098, 0.702, 0.788], [0.353, 0.275, 0.839], [0.051, 0.247, 0.561], [0.498, 0.839, 0.91]] } },
  { id: "soft-aurora", label: "Aurora", soft: { base: [0.012, 0.063, 0.051], colors: [[0.075, 0.639, 0.49], [0.247, 0.82, 0.627], [0.176, 0.373, 0.827], [0.424, 0.247, 0.769], [0.608, 0.89, 0.478]] } },
  { id: "soft-sunset", label: "Tramonto", soft: { base: [0.078, 0.02, 0.027], colors: [[0.941, 0.455, 0.243], [0.851, 0.267, 0.427], [0.949, 0.698, 0.361], [0.541, 0.165, 0.42], [1.0, 0.561, 0.561]] } }
];
// The same colours with the spectrum wave: a choice of their own.
const SPECTRA = SOFT.map((v) => ({ id: v.id.replace("soft-", "wave-"), label: "Spettro " + v.label.toLowerCase(), soft: Object.assign({ wave: true }, v.soft) }));
const ALL = SOFT.concat(SPECTRA, PRESETS.map((p) => ({ id: p.id, label: p.label, milk: p })));
export const VISUALS = ALL.map((v) => ({ id: v.id, label: v.label }));

export function createIdleView(options) {
  const doc = options.document || document, audio = options.audio;
  let root = null, milkCanvas = null, lavaCanvas = null, mode = null, frame = null, last = 0;
  let ctx = null, feed = null, analyser = null, bins = null, source = null, startedAt = 0, startedFrom = 0;
  let viz = null, soft = null, shown = null, changedAt = 0, ticks = 0;
  let buffer = null, bufferFor = null, loading = null;
  let bass = 0, avg = 0.2, beat = 0, energy = 0;
  const spectrum = new Float32Array(BANDS);
  // The bands on a logarithmic scale, 40 Hz to 5 kHz, in bins of the 1024
  // point analysis at 11 kHz (about 11 Hz each).
  const edges = [];
  for (let i = 0; i <= BANDS; i++) edges.push(Math.max(2, Math.round(40 * Math.pow(5000 / 40, i / BANDS) / (RATE / 1024))));

  function build() {
    if (root) return;
    root = doc.createElement("div");
    root.id = "idle-view";
    root.hidden = true;
    root.innerHTML = '<div class="idle-backdrop"></div><canvas class="milk" width="960" height="540"></canvas><canvas class="lava" width="480" height="270"></canvas><div class="idle-now"><img alt=""><div><strong></strong><span></span></div></div>';
    milkCanvas = root.querySelector("canvas.milk");
    lavaCanvas = root.querySelector("canvas.lava");
    (options.parent || doc.body).appendChild(root);
  }
  // The track decoded once, mono at 11 kHz: a few MB for a song.
  function prepare(src) {
    if (!src || src === bufferFor || (loading && loading.src === src)) return;
    buffer = null;
    bufferFor = null;
    const job = loading = { src };
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return;
    const decoder = new Offline(1, RATE, RATE);
    fetch(src).then((r) => r.arrayBuffer()).then((raw) => new Promise((ok, ko) => decoder.decodeAudioData(raw, ok, ko))).then((decoded) => {
      if (loading !== job) return;
      const mono = decoder.createBuffer(1, decoded.length, decoded.sampleRate), out = mono.getChannelData(0);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const d = decoded.getChannelData(c);
        for (let i = 0; i < d.length; i++) out[i] += d[i] / decoded.numberOfChannels;
      }
      buffer = mono;
      bufferFor = src;
      loading = null;
    }).catch(() => {
      if (loading === job) loading = null;
    });
  }
  function setupAudio() {
    if (ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    // The copy plays into the visualisers and, at zero volume, to the
    // speakers: a node nobody pulls is never processed.
    feed = ctx.createGain();
    const silent = ctx.createGain();
    silent.gain.value = 0;
    feed.connect(silent);
    silent.connect(ctx.destination);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    feed.connect(analyser);
    bins = new Uint8Array(analyser.frequencyBinCount);
  }
  function setup(item) {
    try {
      setupAudio();
      if (item.milk && !viz) {
        viz = butterchurn.createVisualizer(ctx, milkCanvas, { width: milkCanvas.width, height: milkCanvas.height, pixelRatio: 1, textureRatio: 1, meshWidth: 32, meshHeight: 24 });
        viz.connectAudio(feed);
      }
      if (item.soft && !soft) soft = createSoftGradient(lavaCanvas);
      return item.milk ? !!viz : !!soft;
    } catch (e) {
      console.warn("Visualizzatore non disponibile: " + (e && e.stack || e));
      return false;
    }
  }
  function stopCopy() {
    if (source) {
      try {
        source.stop();
      } catch (_) {
      }
      source.disconnect();
    }
    source = null;
  }
  // The silent copy follows the element: started at its position, restarted
  // when it drifts, stopped when it pauses or the track is not ready.
  function sync() {
    const ready = buffer && bufferFor === audio.currentSrc && !audio.paused;
    if (!ready) return stopCopy();
    const position = startedFrom + (ctx.currentTime - startedAt);
    if (source && Math.abs(position - audio.currentTime) < 0.15) return;
    stopCopy();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(feed);
    startedFrom = Math.min(audio.currentTime, buffer.duration);
    startedAt = ctx.currentTime;
    source.start(0, startedFrom);
  }
  // The bass (up to about 150 Hz) against its own recent average: a beat
  // when it jumps above it.
  function listen(dt) {
    analyser.getByteFrequencyData(bins);
    let low = 0, all = 0;
    for (let i = 2; i < 15; i++) low += bins[i];
    for (let i = 2; i < 200; i++) all += bins[i];
    low /= 13 * 255;
    all /= 198 * 255;
    bass += (low - bass) * 0.5;
    for (let b = 0; b < BANDS; b++) {
      const from = edges[b], to = Math.max(from + 1, edges[b + 1]);
      let v = 0;
      for (let i = from; i < to; i++) v += bins[i];
      v /= (to - from) * 255;
      // Up quickly, down slowly: the wave settles instead of flickering.
      spectrum[b] += (v - spectrum[b]) * (v > spectrum[b] ? 0.5 : 0.12);
    }
    avg += (bass - avg) * 0.02;
    energy += (all - energy) * 0.05;
    if (bass > avg * 1.18 && bass > 0.2 && beat < 0.4) beat = 1;
    beat *= Math.pow(0.08, dt);
  }
  function chosenId() {
    const id = options.preset ? options.preset() : "auto";
    return ALL.some((v) => v.id === id) ? id : "auto";
  }
  function pickOther() {
    const others = ALL.filter((v) => v.id !== shown);
    return others[Math.floor(Math.random() * others.length)];
  }
  function use(item, blend) {
    if (!setup(item)) return false;
    if (item.milk) viz.loadPreset(item.milk.preset, blend);
    shown = item.id;
    root.className = "visual " + (item.milk ? "milk" : "lava");
    return true;
  }
  function draw(now) {
    frame = requestAnimationFrame(draw);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    if (ticks++ % 20 === 0) {
      if (ctx.state === "suspended") ctx.resume();
      sync();
    }
    // "Cambia da solo": another one every minute and a half.
    if (chosenId() === "auto" && now - changedAt > CHANGE_SECONDS * 1000) {
      if (changedAt) use(pickOther(), BLEND_SECONDS);
      changedAt = now;
    }
    listen(dt);
    const item = ALL.find((v) => v.id === shown);
    if (!item) return;
    if (item.milk) viz.render({ elapsedTime: dt * item.milk.speed });
    else soft.render(dt, energy, beat, bass, spectrum, item.soft);
  }
  // What the visualiser holds goes back as soon as it is hidden: the GPU
  // contexts and the AudioContext (the decoded copy, a few MB, stays for the
  // next time the screen rests). The TV has 1 GB, and
  // when the web apps passed 420 MB LG switched the TV off and on again.
  function release() {
    stopCopy();
    [milkCanvas, lavaCanvas].forEach((c) => {
      const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
      const lose = gl && gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    });
    if (ctx) ctx.close();
    ctx = feed = analyser = bins = null;
    viz = soft = null;
    shown = null;
    // A canvas whose context was lost cannot get a new one: the next show
    // builds the view again.
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = milkCanvas = lavaCanvas = null;
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
      mode = "cover";
      root.className = "cover";
      if (kind === "visual") {
        const id = chosenId(), item = id === "auto" ? (ALL.find((v) => v.id === shown) || pickOther()) : ALL.find((v) => v.id === id);
        if (shown === item.id && setup(item) || use(item, 0)) {
          mode = "visual";
          root.className = "visual " + (item.milk ? "milk" : "lava");
          prepare(audio.currentSrc);
        }
      }
      root.hidden = false;
      if (mode === "visual" && frame === null) frame = requestAnimationFrame(draw);
      return mode;
    },
    hide() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      last = 0;
      mode = null;
      release();
    },
    update,
    prepare,
    get mode() { return mode; },
    get ready() { return !!buffer && bufferFor === audio.currentSrc; }
  };
}
