// What the TV shows while music plays and nobody touches the remote: the
// panel switched off (screen-timer.js), the cover with the track, or bars
// that move with the music. Any key brings back the app.
export function createIdleView(options) {
  const doc = options.document || document, audio = options.audio;
  let root = null, canvas = null, mode = null, frame = null, analyser = null, data = null, context = null;
  function build() {
    if (root) return;
    root = doc.createElement("div");
    root.id = "idle-view";
    root.hidden = true;
    root.innerHTML = '<div class="idle-backdrop"></div><canvas width="1920" height="1080"></canvas><div class="idle-now"><img alt=""><div><strong></strong><span></span></div></div>';
    canvas = root.querySelector("canvas");
    (options.parent || doc.body).appendChild(root);
  }
  // The element goes through Web Audio only the first time bars are asked
  // for: from then on it plays through the AudioContext, which must keep
  // running. The bridge answers with CORS headers, or the analyser hears only
  // silence.
  function listen() {
    if (analyser) return true;
    const Ctx = options.AudioContext || window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    try {
      context = new Ctx();
      const source = context.createMediaElementSource(audio);
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyser.connect(context.destination);
      data = new Uint8Array(analyser.frequencyBinCount);
      return true;
    } catch (_) {
      analyser = null;
      return false;
    }
  }
  function draw() {
    frame = requestAnimationFrame(draw);
    if (context && context.state === "suspended") context.resume();
    analyser.getByteFrequencyData(data);
    const g = canvas.getContext("2d"), w = canvas.width, h = canvas.height, bars = 48, gap = 10;
    const width = (w - 160 - gap * (bars - 1)) / bars;
    g.clearRect(0, 0, w, h);
    // Low notes on the left, as on a stereo; the top of the range is mostly
    // empty in music, so only the first two thirds of the bins are drawn.
    const used = Math.floor(data.length * 0.66);
    for (let i = 0; i < bars; i++) {
      const from = Math.floor(i * used / bars), to = Math.max(from + 1, Math.floor((i + 1) * used / bars));
      let sum = 0;
      for (let j = from; j < to; j++) sum += data[j];
      const level = sum / (to - from) / 255, bar = Math.max(6, level * (h - 420));
      const x = 80 + i * (width + gap), y = h - 260 - bar;
      g.fillStyle = "hsl(" + (330 - i * 4) + ",80%," + (55 + level * 20) + "%)";
      g.fillRect(x, y, width, bar);
    }
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
      mode = kind === "visual" && listen() ? "visual" : "cover";
      root.className = mode;
      root.hidden = false;
      if (mode === "visual" && frame === null) draw();
      return mode;
    },
    hide() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      mode = null;
      if (root) root.hidden = true;
    },
    update,
    get mode() { return mode; },
    resume() { if (context && context.state === "suspended") context.resume(); }
  };
}
