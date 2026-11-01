// What the TV shows while music plays and nobody touches the remote: the
// panel switched off (screen-timer.js), the cover with the track, or a
// MilkDrop visualiser (Butterchurn, WebGL 2), slow and dark enough for a
// bedroom. Any key brings back the app.
//
// LG plays <audio> in its own hardware pipeline: Web Audio attached to the
// element hears only silence. So the visualiser listens to a second copy of
// the track, fetched from the bridge, decoded, and played silently in step
// with the element.
import butterchurnModule from "butterchurn";
import presetModule from "butterchurn-presets/lib/butterchurnPresets.min.js";

// Both are UMD bundles built with Babel: the API sits on .default.
const butterchurn = butterchurnModule.default || butterchurnModule;
const presetPack = presetModule.default || presetModule;

const RATE = 22050;
// Soft, slow presets from the MilkDrop classics: no strobes, no white
// flashes, nothing that lights the room.
const CALM = [
  "Flexi + Martin - astral projection",
  "martin - castle in the air",
  "TonyMilkdrop - Magellan's Nebula [Flexi - you enter first + multiverse]",
  "Geiss - Cauldron - painterly 2 (saturation remix)",
  "Martin - liquid arrows",
  "martin - stormy sea (2010 update)",
  "cope + martin - mother-of-pearl",
  "Rovastar - Oozing Resistance",
  "Flexi - mindblob [shiny mix]",
  "Geiss - Reaction Diffusion 2"
];
const PRESET_SECONDS = 90, BLEND_SECONDS = 10;

export function createIdleView(options) {
  const doc = options.document || document, audio = options.audio;
  let root = null, canvas = null, mode = null, frame = null;
  let ctx = null, viz = null, feed = null, source = null, startedAt = 0, startedFrom = 0;
  let buffer = null, bufferFor = null, loading = null, presets = null, presetAt = 0, ticks = 0;

  function build() {
    if (root) return;
    root = doc.createElement("div");
    root.id = "idle-view";
    root.hidden = true;
    root.innerHTML = '<div class="idle-backdrop"></div><canvas width="960" height="540"></canvas><div class="idle-now"><img alt=""><div><strong></strong><span></span></div></div>';
    canvas = root.querySelector("canvas");
    (options.parent || doc.body).appendChild(root);
  }
  // The track decoded once, mono at 22 kHz: some MB for a song.
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
  function setup() {
    if (viz) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctx();
      // The copy plays into the visualiser and, at zero volume, to the
      // speakers: a node nobody pulls is never processed.
      feed = ctx.createGain();
      const silent = ctx.createGain();
      silent.gain.value = 0;
      feed.connect(silent);
      silent.connect(ctx.destination);
      viz = butterchurn.createVisualizer(ctx, canvas, { width: canvas.width, height: canvas.height, pixelRatio: 1, textureRatio: 1, meshWidth: 32, meshHeight: 24 });
      viz.connectAudio(feed);
      const all = presetPack.getPresets();
      presets = CALM.filter((name) => all[name]).map((name) => all[name]);
      if (!presets.length) presets = Object.keys(all).map((k) => all[k]);
      viz.loadPreset(presets[Math.floor(Math.random() * presets.length)], 0);
      return true;
    } catch (e) {
      console.warn("Visualizzatore non disponibile: " + (e && e.stack || e));
      viz = null;
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
  function draw(now) {
    frame = requestAnimationFrame(draw);
    if (ticks++ % 20 === 0) {
      if (ctx.state === "suspended") ctx.resume();
      sync();
    }
    if (now - presetAt > PRESET_SECONDS * 1000) {
      if (presetAt) viz.loadPreset(presets[Math.floor(Math.random() * presets.length)], BLEND_SECONDS);
      presetAt = now;
    }
    viz.render();
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
      mode = kind === "visual" && setup() ? "visual" : "cover";
      if (mode === "visual") prepare(audio.currentSrc);
      root.className = mode;
      root.hidden = false;
      if (mode === "visual" && frame === null) frame = requestAnimationFrame(draw);
      return mode;
    },
    hide() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      mode = null;
      if (viz) {
        stopCopy();
        ctx.suspend();
      }
      if (root) root.hidden = true;
    },
    update,
    prepare,
    get mode() { return mode; },
    get ready() { return !!buffer && bufferFor === audio.currentSrc; }
  };
}
