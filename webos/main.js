import { chooseRemoteTarget } from "./remote-focus.js";
import { createScreenTimer } from "./screen-timer.js";
(function() {
  "use strict";
  const $ = (s) => document.querySelector(s), content = $("#content"), audio = $("#audio");
  let bridge = null, page = "albums", history = [], currentItems = [], queue = [], current = -1, shuffle = false, repeat = false, generation = 0, loaded = 0, total = 0;
  let settingsChoice = null;
  let prefs = { screenOff: 0 };
  try {
    prefs = Object.assign(prefs, JSON.parse(localStorage.getItem("bloomee.preferences") || "{}"));
  } catch (_) {
  }
  function notify(text) {
    $("#notice").textContent = text;
    $("#notice").hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => $("#notice").hidden = true, 5500);
  }
  function fit() {
    const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
    $("#app").style.transform = "scale(" + scale + ")";
    $("#app").style.left = (innerWidth - 1920 * scale) / 2 + "px";
    $("#app").style.top = (innerHeight - 1080 * scale) / 2 + "px";
  }
  fit();
  addEventListener("resize", fit);
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    n.className = cls || "";
    if (text) n.textContent = text;
    return n;
  }
  function button(text, fn, cls) {
    const n = node("button", cls, text);
    n.type = "button";
    n.onclick = fn;
    return n;
  }
  const rootBridges = /* @__PURE__ */ new Set();
  function root(command) {
    return new Promise((resolve, reject) => {
      if (!window.PalmServiceBridge) return reject(Error("Serve una TV webOS con Homebrew Channel e root."));
      const b = new PalmServiceBridge();
      rootBridges.add(b);
      const t = setTimeout(() => {
        b.cancel();
        rootBridges.delete(b);
        reject(Error("Homebrew Channel non risponde"));
      }, 8e3);
      b.onservicecallback = (raw) => {
        clearTimeout(t);
        rootBridges.delete(b);
        try {
          const r = JSON.parse(raw);
          if (r.returnValue === false) throw Error(r.errorText || "Root non disponibile");
          resolve(r.stdoutString || (r.stdoutBytes ? atob(r.stdoutBytes) : ""));
        } catch (e) {
          reject(e);
        }
      };
      b.call("luna://org.webosbrew.hbchannel.service/exec", JSON.stringify({ command }));
    });
  }
  function url(path, args) {
    if (!bridge) throw Error("Collegamento non pronto");
    const q = new URLSearchParams(args || {});
    q.set("key", bridge.key);
    return "http://127.0.0.1:" + bridge.port + path + "?" + q.toString();
  }
  async function api(path, args, method) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2e4);
    try {
      const r = await fetch(url(path, args), { method: method || "GET", signal: controller.signal });
      const data = await r.json();
      if (!r.ok || data.ok === false) throw Error(data.error || "Richiesta non riuscita");
      return data;
    } finally {
      clearTimeout(t);
    }
  }
  const screen = createScreenTimer({ off: () => api("/panel/off", null, "POST"), on: () => api("/panel/on", null, "POST"), error: (e) => notify(e.message) });
  screen.configure(prefs.screenOff);
  function image(item) {
    const id = item.ImageTags && item.ImageTags.Primary ? item.Id : item.AlbumId || item.PrimaryImageItemId || item.Id;
    return url("/image/" + id);
  }
  function art(item) {
    const img = node("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = image(item);
    img.onerror = () => {
      img.onerror = null;
      img.src = "placeholder.svg";
    };
    return img;
  }
  function artist(item) {
    return (item.Artists || item.AlbumArtists || []).join(", ") || item.AlbumArtist || "Artista";
  }
  function duration(ticks) {
    const s = Math.max(0, Math.floor(Number(ticks) || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function focusFirst() {
    const n = content.querySelector("button,input,select");
    if (n) n.focus();
  }
  function setHeading(title, sub) {
    $("#heading").textContent = title;
    $("#eyebrow").textContent = sub || "JELLYFIN";
  }
  function loading() {
    content.textContent = "";
    content.appendChild(node("p", "empty", "Caricamento della libreria\u2026"));
  }
  function empty(text) {
    content.textContent = "";
    content.appendChild(node("p", "empty", text));
  }
  function remember(next) {
    if (page !== next) history.push(page);
    page = next;
  }
  async function navigate(next, options) {
    if (!options || !options.back) remember(next);
    else page = next;
    generation++;
    const mark = generation;
    document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("selected", b.dataset.page === next));
    settingsChoice = null;
    if (next === "settings") return settings();
    if (next === "queue") return renderQueue();
    if (next === "search") return search();
    setHeading({ albums: "La tua musica", artists: "Artisti", tracks: "Tutti i brani", favorites: "I tuoi preferiti" }[next] || "Musica");
    loading();
    loaded = 0;
    currentItems = [];
    try {
      const data = await library(next, 0);
      if (mark !== generation) return;
      content.textContent = "";
      total = data.TotalRecordCount || data.Items.length;
      appendItems(data.Items, next);
      focusFirst();
    } catch (e) {
      if (mark === generation) {
        empty(e.message);
        content.appendChild(button("Riprova", () => navigate(next, { back: true })));
      }
    }
  }
  function library(next, start2, extra) {
    return api("/api/library", Object.assign({ kind: next === "artists" ? "MusicArtist" : next === "tracks" || next === "favorites" ? "Audio" : "MusicAlbum", start: start2, limit: 60 }, next === "favorites" ? { favorite: "true" } : {}, extra || {}));
  }
  function trackRow(item, i, items) {
    const n = button("", () => playList(items, i), "track");
    n.appendChild(node("span", "number", String(item.IndexNumber || i + 1)));
    const title = node("span", "track-title");
    title.appendChild(node("strong", "", item.Name));
    title.appendChild(node("small", "", artist(item)));
    n.appendChild(title);
    n.appendChild(node("span", "duration", duration(item.RunTimeTicks / 1e7)));
    return n;
  }
  function appendItems(items, next) {
    loaded += items.length;
    currentItems = currentItems.concat(items);
    if (!currentItems.length) return empty("Nessun elemento disponibile. Controlla la libreria musicale su Jellyfin.");
    const old = content.querySelector(".more");
    if (old) old.remove();
    let grid = content.querySelector(".grid");
    if (!grid && next !== "tracks" && next !== "favorites") {
      grid = node("div", "grid");
      content.appendChild(grid);
    }
    items.forEach((item) => {
      if (next === "tracks" || next === "favorites") {
        const track = trackRow(item, currentItems.indexOf(item), currentItems);
        track.onclick = () => playList(currentItems, currentItems.indexOf(item));
        content.appendChild(track);
      } else {
        const n = button("", () => next === "artists" ? openArtist(item) : openAlbum(item), "album");
        n.appendChild(art(item));
        n.appendChild(node("strong", "", item.Name));
        n.appendChild(node("span", "", next === "artists" ? "Artista" : artist(item)));
        grid.appendChild(n);
      }
    });
    if (loaded < total) {
      const more = button("Carica altri", async () => {
        more.disabled = true;
        try {
          const d = await library(next, loaded);
          appendItems(d.Items, next);
        } catch (e) {
          notify(e.message);
          more.disabled = false;
        }
      }, "more");
      content.appendChild(more);
    }
  }
  async function openArtist(item) {
    history.push(page);
    page = "artist:" + item.Id;
    generation++;
    setHeading(item.Name, "ARTISTA");
    loading();
    try {
      const d = await library("albums", 0, { artist: item.Id });
      content.textContent = "";
      loaded = 0;
      total = d.Items.length;
      currentItems = [];
      appendItems(d.Items, "albums");
      focusFirst();
    } catch (e) {
      empty(e.message);
    }
  }
  async function openAlbum(item) {
    history.push(page);
    page = "album:" + item.Id;
    const mark = ++generation;
    setHeading("Album", artist(item));
    loading();
    try {
      const d = await library("tracks", 0, { parent: item.Id, limit: 100 });
      if (mark !== generation) return;
      content.textContent = "";
      const detail = node("div", "detail"), cover = node("div", "cover-column"), list = node("div", "detail-list");
      cover.appendChild(art(item));
      cover.appendChild(node("h2", "", item.Name));
      cover.appendChild(node("p", "", artist(item) + (item.ProductionYear ? " \xB7 " + item.ProductionYear : "")));
      const actions = node("div", "actions");
      actions.appendChild(button("\u25B6 Ascolta", () => playList(d.Items, 0), "primary"));
      actions.appendChild(button("+ In coda", () => {
        queue = queue.concat(d.Items);
        notify(d.Items.length + " brani aggiunti alla coda");
      }));
      list.appendChild(actions);
      d.Items.forEach((track, i) => list.appendChild(trackRow(track, i, d.Items)));
      if (!d.Items.length) list.appendChild(node("p", "empty", "Questo album non contiene brani disponibili."));
      detail.appendChild(cover);
      detail.appendChild(list);
      content.appendChild(detail);
      focusFirst();
    } catch (e) {
      if (mark === generation) empty(e.message);
    }
  }
  function playList(items, index) {
    queue = items.slice();
    current = index;
    start();
  }
  async function start() {
    const item = queue[current];
    if (!item) return;
    $("#now-art").src = image(item);
    $("#now-title").textContent = item.Name;
    $("#now-artist").textContent = artist(item);
    audio.src = url("/audio/" + item.Id);
    try {
      await audio.play();
    } catch (e) {
      notify("Riproduzione non riuscita. Prova un altro brano o verifica Jellyfin.");
    }
    if (page === "queue") renderQueue();
  }
  function step(delta) {
    if (!queue.length) return;
    if (shuffle && queue.length > 1) {
      let next;
      do {
        next = Math.floor(Math.random() * queue.length);
      } while (next === current);
      current = next;
    } else {
      const next = current + delta;
      if (next >= queue.length && !repeat) {
        audio.pause();
        return;
      }
      current = (next + queue.length) % queue.length;
    }
    start();
  }
  $("#play").onclick = () => {
    if (current < 0) {
      notify("Scegli prima un album o un brano");
      return;
    }
    audio.paused ? audio.play().catch(() => notify("Impossibile riprendere il brano")) : audio.pause();
  };
  $("#previous").onclick = () => audio.currentTime > 3 ? audio.currentTime = 0 : step(-1);
  $("#next").onclick = () => step(1);
  $("#shuffle").onclick = () => {
    $("#shuffle").setAttribute("aria-pressed", String(shuffle = !shuffle));
  };
  $("#repeat").onclick = () => {
    $("#repeat").setAttribute("aria-pressed", String(repeat = !repeat));
  };
  audio.addEventListener("playing", () => {
    $("#play").textContent = "\u2161";
    screen.playing(true);
  });
  audio.addEventListener("pause", () => {
    $("#play").textContent = "\u25B6";
    screen.playing(false);
  });
  audio.addEventListener("ended", () => step(1));
  audio.addEventListener("error", () => {
    screen.playing(false);
    notify("Jellyfin non riesce a riprodurre questo brano.");
  });
  audio.addEventListener("timeupdate", () => {
    const d = audio.duration || 0;
    $("#seek").value = d ? Math.round(audio.currentTime / d * 1e3) : 0;
    $("#time").textContent = duration(audio.currentTime) + " / " + duration(d);
  });
  $("#seek").onchange = () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number($("#seek").value) / 1e3 * audio.duration;
  };
  function renderQueue() {
    setHeading("In coda", queue.length + " BRANI");
    content.textContent = "";
    if (!queue.length) return empty("La coda \xE8 vuota. Apri un album e scegli Ascolta oppure In coda.");
    queue.forEach((item, i) => {
      const n = trackRow(item, i, queue);
      if (i === current) n.classList.add("selected");
      content.appendChild(n);
    });
    focusFirst();
  }
  function search() {
    setHeading("Cerca nella tua musica");
    content.textContent = "";
    const row = node("div", "search-row"), input = node("input");
    input.placeholder = "Album, artista o brano";
    input.setAttribute("aria-label", "Cerca nella libreria");
    const results = node("div");
    async function run() {
      const q = input.value.trim();
      if (!q) return;
      results.textContent = "Caricamento\u2026";
      try {
        const responses = await Promise.all(["MusicAlbum", "MusicArtist", "Audio"].map((kind) => api("/api/library", { kind, search: q, limit: 20 })));
        results.textContent = "";
        responses.forEach((d, i) => {
          if (!d.Items.length) return;
          results.appendChild(node("h2", "", ["Album", "Artisti", "Brani"][i]));
          d.Items.forEach((item, j) => {
            const n = button(item.Name, () => i === 0 ? openAlbum(item) : i === 1 ? openArtist(item) : playList(d.Items, j), "track");
            results.appendChild(n);
          });
        });
        if (!results.children.length) results.appendChild(node("p", "empty", "Nessun risultato. Prova un titolo diverso."));
      } catch (e) {
        results.textContent = e.message;
      }
    }
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.stopPropagation();
        run();
      }
    };
    row.appendChild(input);
    row.appendChild(button("Cerca", run, "primary"));
    content.appendChild(row);
    content.appendChild(results);
    input.focus();
  }
  function settings() {
    setHeading("Impostazioni", "BLOOMEE SU LG");
    content.textContent = "";
    function row(title, description, control) {
      const n = node("div", "setting"), label = node("div", "label");
      label.appendChild(node("strong", "", title));
      label.appendChild(node("p", "", description));
      n.appendChild(label);
      if (control) n.appendChild(control);
      content.appendChild(n);
    }
    const choices = [[0, "Mai"], [15, "15 secondi"], [30, "30 secondi"], [60, "1 minuto"], [120, "2 minuti"], [300, "5 minuti"]];
    const valueLabel = () => {
      const choice = choices.find((c) => c[0] === prefs.screenOff);
      return choice ? choice[1] : "Mai";
    };
    const choiceButton = button(valueLabel() + "  \u203A", () => {
      choiceList.hidden = !choiceList.hidden;
      choiceButton.setAttribute("aria-expanded", String(!choiceList.hidden));
      if (!choiceList.hidden) {
        settingsChoice = { close: () => {
          choiceList.hidden = true;
          choiceButton.setAttribute("aria-expanded", "false");
          settingsChoice = null;
          choiceButton.focus();
        } };
        const current2 = choiceList.querySelector("[aria-pressed=true]") || choiceList.querySelector("button");
        current2.focus();
      } else settingsChoice = null;
    });
    choiceButton.id = "screen-delay";
    choiceButton.setAttribute("aria-expanded", "false");
    choiceButton.setAttribute("aria-controls", "screen-delay-choices");
    row("Spegni schermo dopo", "Dopo un periodo senza interazioni, solo mentre ascolti musica. La scelta viene salvata automaticamente.", choiceButton);
    const choiceList = node("div", "delay-choices");
    choiceList.id = "screen-delay-choices";
    choiceList.hidden = true;
    choiceList.setAttribute("role", "group");
    choiceList.setAttribute("aria-label", "Tempo prima dello spegnimento");
    choices.forEach(([value, label]) => {
      const b = button(label, () => {
        try {
          localStorage.setItem("bloomee.preferences", JSON.stringify(Object.assign({}, prefs, { screenOff: value })));
          prefs.screenOff = value;
          screen.configure(value);
          choiceButton.textContent = valueLabel() + "  \u203A";
          choiceList.querySelectorAll("button").forEach((n) => n.setAttribute("aria-pressed", String(n === b)));
          if (settingsChoice) settingsChoice.close();
          notify("Preferenza salvata");
        } catch (e) {
          notify("Impossibile salvare la preferenza");
        }
      });
      b.setAttribute("aria-pressed", String(prefs.screenOff === value));
      choiceList.appendChild(b);
    });
    content.appendChild(choiceList);
    row("Schermo spento, musica accesa", "Il pannello si spegne e la musica continua. Premi OK o una freccia per riaccenderlo.", button("Spegni ora", () => {
      if (audio.paused) return notify("Avvia prima la musica");
      screen.sleep();
    }));
    row("Jellyfin", "Collegamento alla tua libreria musicale. Le credenziali restano private sulla TV.", button("Verifica", async () => {
      try {
        await api("/api/library", { kind: "MusicAlbum", limit: 1 });
        notify("Jellyfin collegato");
      } catch (e) {
        notify(e.message);
      }
    }));
    const info = button("Informazioni su Bloomee", () => {
      showInfo();
    });
    info.id = "bloomee-info";
    row("Informazioni e compatibilit\xE0", "Funzioni disponibili su LG e differenze dalla versione Android TV.", info);
    focusFirst();
  }
  function showInfo() {
    setHeading("Informazioni", "BLOOMEE SU LG \xB7 0.1.1");
    content.textContent = "";
    const note = node("article", "info-copy");
    note.appendChild(node("h2", "", "La tua musica, sulla LG"));
    note.appendChild(node("p", "", "Album, artisti, brani, ricerca, preferiti Jellyfin, coda, riproduzione casuale e ripetizione."));
    note.appendChild(node("h2", "", "Schermo e ascolto"));
    note.appendChild(node("p", "", "Sulla LG viene spento solo il pannello. La musica continua e il televisore rimane acceso. Su Android TV si usa uno schermo nero e la luminosit\xE0 minima, perch\xE9 lo spegnimento fisico non \xE8 disponibile alle app su tutte le TV."));
    note.appendChild(node("h2", "", "Sorgenti"));
    note.appendChild(node("p", "", "Questa edizione usa Jellyfin. Plugin Android, accesso YouTube Music, Cast e download offline rimangono disponibili nella versione Android e non sono inclusi nel porting LG."));
    content.appendChild(note);
    const close = button("Torna alle impostazioni", settings);
    close.id = "settings-info-back";
    content.appendChild(close);
    close.focus();
    content.scrollTop = 0;
  }
  function back() {
    const next = history.pop() || "albums";
    if (next.indexOf("album:") === 0 || next.indexOf("artist:") === 0) return navigate("albums", { back: true });
    navigate(next, { back: true });
  }
  $("#back").onclick = back;
  $("#refresh").onclick = () => navigate(page.indexOf(":") >= 0 ? "albums" : page, { back: true });
  document.querySelectorAll("nav button").forEach((b) => b.onclick = () => navigate(b.dataset.page));
  function move(key) {
    const current2 = document.activeElement;
    if (!current2) return;
    const rect = current2.getBoundingClientRect();
    const within = content.contains(current2), inNav = !!current2.closest("nav");
    if (inNav && key === "ArrowRight") {
      focusFirst();
      return;
    }
    if (within && key === "ArrowLeft" && page === "settings") {
      const selected = document.querySelector("nav button.selected");
      if (selected) selected.focus();
      return;
    }
    const all = Array.from(document.querySelectorAll('button,input,[tabindex="0"]')).filter((n) => n !== current2 && !n.disabled && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0);
    let pool = all;
    if (within && (key === "ArrowDown" || key === "ArrowUp")) {
      const contentPool = all.filter((n) => content.contains(n));
      const target2 = chooseRemoteTarget(rect, contentPool.map((n) => ({ element: n, rect: n.getBoundingClientRect() })), key);
      if (target2) {
        target2.focus();
        target2.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }
    }
    const target = chooseRemoteTarget(rect, pool.map((n) => ({ element: n, rect: n.getBoundingClientRect() })), key);
    if (target) {
      target.focus();
      if (content.contains(target)) target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  document.addEventListener("keydown", (e) => {
    const nativeVolume = [447, 448, 449].indexOf(e.keyCode) >= 0;
    const media = [415, 19, 413, 417, 412].indexOf(e.keyCode) >= 0 || e.key === "MediaPlayPause";
    if (!nativeVolume && !media && screen.activity()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (media) {
      e.preventDefault();
      if (e.keyCode === 415) audio.play().catch(() => notify("Impossibile riprendere"));
      else if (e.keyCode === 19 || e.keyCode === 413) audio.pause();
      else if (e.keyCode === 417) audio.currentTime = Math.min(audio.duration || audio.currentTime, audio.currentTime + 30);
      else if (e.keyCode === 412) audio.currentTime = Math.max(0, audio.currentTime - 10);
      else $("#play").click();
      return;
    }
    if (e.target.tagName === "SELECT") return;
    if (e.key === "Escape" || e.keyCode === 461) {
      e.preventDefault();
      if (settingsChoice) settingsChoice.close();
      else if (page === "settings" && document.getElementById("settings-info-back")) settings();
      else back();
      return;
    }
    if (e.target.tagName === "INPUT" && e.target.type !== "range" && e.key !== "ArrowDown") return;
    if (/^Arrow/.test(e.key) && e.target.type !== "range") {
      e.preventDefault();
      move(e.key);
    }
    if (e.key === "MediaPlayPause") {
      e.preventDefault();
      $("#play").click();
    }
  }, true);
  let lastPointer = null;
  document.addEventListener("mousemove", (e) => {
    if (!lastPointer) {
      lastPointer = { x: e.clientX, y: e.clientY };
      return;
    }
    if (Math.abs(e.clientX - lastPointer.x) + Math.abs(e.clientY - lastPointer.y) > 28) {
      screen.activity();
      lastPointer = { x: e.clientX, y: e.clientY };
    }
  }, true);
  document.addEventListener("mousedown", (e) => {
    if (screen.activity()) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (!screen.isOff()) screen.active(!document.hidden);
  });
  addEventListener("pagehide", () => screen.dispose());
  addEventListener("webOSRelaunch", () => {
    screen.wake();
    screen.active(true);
  });
  async function boot() {
    try {
      let raw;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          raw = await root("python /media/developer/apps/usr/palm/applications/org.bloomee.webos/bridge.py");
          break;
        } catch (e) {
          if (attempt === 1) throw e;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      bridge = JSON.parse(raw.trim());
      await api("/api/library", { kind: "MusicAlbum", limit: 1 });
      $("#connection").textContent = "Jellyfin collegato";
      if (page !== "settings" && page !== "queue" && page !== "search") await navigate(page, { back: true });
    } catch (e) {
      $("#connection").textContent = "Collegamento non disponibile";
      empty("Collegamento alla musica non disponibile. Verifica il server Jellyfin e Homebrew Channel, poi scegli Riprova.");
      content.appendChild(button("Riprova", boot, "primary"));
    }
  }
  const iconPaths = { albums: "M4 4h16v16H4z M8 8h8v8H8z", artists: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87", tracks: "M9 18V5l12-2v13 M3 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M15 16a3 3 0 1 0 6 0 3 3 0 1 0-6 0", favorites: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8", search: "M21 21l-5-5 M18 10a8 8 0 1 0-16 0 8 8 0 1 0 16 0", queue: "M4 6h16 M4 12h16 M4 18h16", settings: "M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2" };
  document.querySelectorAll("nav button").forEach((b) => {
    b.removeChild(b.firstChild);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML = '<path d="' + iconPaths[b.dataset.page] + '"/>';
    b.insertBefore(svg, b.firstChild);
  });
  const transportPaths = { repeat: "M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3", shuffle: "M16 3h5v5 M4 20L21 3 M21 16v5h-5 M4 4l5 5 M15 15l6 6", next: "M18 4v16 M5 4l10 8L5 20z", previous: "M6 4v16 M19 4L9 12l10 8z" };
  Object.keys(transportPaths).forEach((id) => {
    $("#" + id).innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + transportPaths[id] + '"/></svg>';
  });
  $("#now-art").onerror = function() {
    this.onerror = null;
    this.src = "placeholder.svg";
  };
  $("#now-art").src = "placeholder.svg";
  window.bloomee = { screen, preferences: () => Object.assign({}, prefs) };
  boot();
})();
