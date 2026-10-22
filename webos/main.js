import { chooseRemoteTarget } from "./remote-focus.js";
import { createScreenTimer } from "./screen-timer.js";
import * as yt from "./youtube.js";
(function() {
  "use strict";
  const $ = (s) => document.querySelector(s), content = $("#content"), audio = $("#audio");
  let bridge = null, page = "home", view = null, history = [], currentItems = [], queue = [], current = -1, shuffle = false, repeat = false, generation = 0, loaded = 0, total = 0;
  let jellyfin = false, youtubeAccount = false, youtubeName = null, ytTab = "home", altTried = false;
  const ytCache = /* @__PURE__ */ new Map();
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
  async function ytApi(endpoint, body) {
    const key = endpoint + JSON.stringify(body);
    const hit = ytCache.get(key);
    if (hit && Date.now() - hit.at < 3e5) return hit.data;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3e4);
    try {
      const r = await fetch(url("/yt/api/" + endpoint), { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain" }, signal: controller.signal });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "YouTube Music non disponibile");
      if (ytCache.size > 40) ytCache.clear();
      ytCache.set(key, { at: Date.now(), data });
      return data;
    } catch (e) {
      throw e.name === "AbortError" ? Error("YouTube Music non risponde. Riprova tra poco.") : e;
    } finally {
      clearTimeout(t);
    }
  }
  // Elenco completo di una pagina YouTube, seguendo le pagine successive.
  async function ytAll(endpoint, body, maxPages) {
    let d = await ytApi(endpoint, body);
    const first = d, items = [], seen = {}, tokens = {};
    for (let n = 1; ; n++) {
      yt.flatItems(d).forEach((it) => {
        const k = it.videoId + "|" + it.browseId + "|" + it.title;
        if (!seen[k]) {
          seen[k] = true;
          items.push(it);
        }
      });
      const next = yt.continuation(d);
      if (!next || tokens[next.token] || n >= (maxPages || 20)) break;
      tokens[next.token] = true;
      d = await ytApi(endpoint, { continuation: next.token, legacy: next.legacy });
    }
    return { first, items };
  }
  const screen = createScreenTimer({ off: () => api("/panel/off", null, "POST"), on: () => api("/panel/on", null, "POST"), error: (e) => notify(e.message) });
  screen.configure(prefs.screenOff);
  function image(item) {
    if (item.source === "youtube") return item.thumb || "placeholder.svg";
    const id = item.ImageTags && item.ImageTags.Primary ? item.Id : item.AlbumId || item.PrimaryImageItemId || item.Id;
    return url("/image/" + id);
  }
  function art(item) {
    return picture(image(item));
  }
  function picture(src) {
    const img = node("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = src || "placeholder.svg";
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
  function loading(text) {
    content.textContent = "";
    content.appendChild(node("p", "empty", text || "Caricamento della libreria\u2026"));
  }
  function empty(text) {
    content.textContent = "";
    content.appendChild(node("p", "empty", text));
  }
  // Ogni pagina sa ridisegnarsi: Indietro e Aggiorna richiamano render.
  function show(id, render, options) {
    if ((!options || !options.back) && view && view.page !== id && history.push(view) > 50) history.shift();
    view = { page: id, render };
    page = id;
    settingsChoice = null;
    return ++generation;
  }
  async function navigate(next, options) {
    const mark = show(next, () => navigate(next, { back: true }), options);
    document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("selected", b.dataset.page === next));
    if (next === "settings") return settings();
    if (next === "queue") return renderQueue();
    if (next === "search") return search();
    if (next === "home") return ytHome(mark);
    if (next === "youtube") return ytLibrary(mark);
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
  async function openArtist(item, options) {
    const mark = show("artist:" + item.Id, () => openArtist(item, { back: true }), options);
    setHeading(item.Name, "ARTISTA");
    loading();
    try {
      const d = await library("albums", 0, { artist: item.Id });
      if (mark !== generation) return;
      content.textContent = "";
      loaded = 0;
      total = d.Items.length;
      currentItems = [];
      appendItems(d.Items, "albums");
      focusFirst();
    } catch (e) {
      if (mark === generation) empty(e.message);
    }
  }
  async function openAlbum(item, options) {
    const mark = show("album:" + item.Id, () => openAlbum(item, { back: true }), options);
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
    altTried = false;
    const src = item.source === "youtube" ? url("/yt/audio/" + item.videoId) : url("/audio/" + item.Id);
    audio.src = src;
    try {
      await audio.play();
    } catch (e) {
      // Gli errori del flusso li gestisce l'evento error, che può ripiegare su un altro formato.
      if (audio.src === src && e.name !== "AbortError" && !audio.error) notify("Riproduzione non riuscita. Prova un altro brano o verifica " + (item.source === "youtube" ? "la connessione." : "Jellyfin."));
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
    const item = queue[current];
    // Se la TV rifiuta l'AAC di YouTube, riprovo una volta con il formato Opus.
    if (item && item.source === "youtube" && !altTried) {
      altTried = true;
      audio.src = url("/yt/audio/" + item.videoId, { alt: "1" });
      audio.play().catch(() => {
      });
      return;
    }
    screen.playing(false);
    if (item && item.source === "youtube") api("/yt/stream/" + item.videoId).then(() => notify("La TV non riesce a riprodurre questo brano di YouTube."), (e) => notify("YouTube: " + e.message));
    else notify("Jellyfin non riesce a riprodurre questo brano.");
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
  let lastSearch = "";
  function search() {
    setHeading("Cerca", "JELLYFIN E YOUTUBE MUSIC");
    content.textContent = "";
    const row = node("div", "search-row"), input = node("input");
    input.placeholder = "Album, artista o brano";
    input.setAttribute("aria-label", "Cerca nella tua musica e su YouTube Music");
    input.value = lastSearch;
    const results = node("div");
    let runs = 0;
    function block(title) {
      const n = node("section", "search-block");
      n.appendChild(node("h2", "source-title", title));
      const body = node("div");
      body.appendChild(node("p", "hint", "Caricamento…"));
      n.appendChild(body);
      results.appendChild(n);
      return body;
    }
    async function searchLibrary(body, q, mark) {
      try {
        const responses = await Promise.all(["MusicAlbum", "MusicArtist", "Audio"].map((kind) => api("/api/library", { kind, search: q, limit: 20 })));
        if (mark !== runs) return;
        body.textContent = "";
        responses.forEach((d, i) => {
          if (!d.Items.length) return;
          body.appendChild(node("h3", "", ["Album", "Artisti", "Brani"][i]));
          d.Items.forEach((item, j) => {
            const n = button(item.Name, () => i === 0 ? openAlbum(item) : i === 1 ? openArtist(item) : playList(d.Items, j), "track");
            body.appendChild(n);
          });
        });
        if (!body.children.length) body.appendChild(node("p", "hint", "Nessun risultato nella tua libreria."));
      } catch (e) {
        if (mark === runs) body.textContent = e.message;
      }
    }
    async function youtube(body, q, mark) {
      try {
        const sections = yt.parseSections(await ytApi("search", { query: q }));
        if (mark !== runs) return;
        body.textContent = "";
        sections.forEach((section) => body.appendChild(ytSection(section, { limit: 8 })));
        if (!sections.length) body.appendChild(node("p", "hint", "Nessun risultato su YouTube Music."));
      } catch (e) {
        if (mark === runs) body.textContent = e.message;
      }
    }
    function run() {
      const q = input.value.trim();
      if (!q) return;
      lastSearch = q;
      const mark = ++runs;
      results.textContent = "";
      const local = jellyfin ? block("Nella tua libreria") : null, remote = block("Su YouTube Music");
      if (local) searchLibrary(local, q, mark);
      youtube(remote, q, mark);
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
    if (lastSearch) run();
  }
  // ── YouTube Music ───────────────────────────────────────────────────
  function ytFail(mark, e, retry) {
    if (mark !== generation) return;
    empty(e.message);
    if (retry) content.appendChild(button("Riprova", retry, "primary"));
    focusFirst();
  }
  function ytPlay(items, index, random) {
    const songs = items.filter((i) => i.videoId);
    if (!songs.length) return notify("Nessun brano da ascoltare");
    const start2 = Math.max(0, songs.indexOf(items[index]));
    if (random) $("#shuffle").setAttribute("aria-pressed", String(shuffle = true));
    playList(songs.map(yt.toTrack), random ? Math.floor(Math.random() * songs.length) : start2);
  }
  function openYt(it, list) {
    if (it.kind === "song") return ytPlay(list, list.indexOf(it));
    if (!it.browseId) return notify("Contenuto non disponibile");
    if (it.kind === "artist") return openYtArtist(it.browseId, it.title);
    if (it.kind === "album" || it.kind === "playlist") return openYtCollection(it.browseId, it.title);
    openYtBrowse(it.browseId, it.params, it.title);
  }
  function ytCard(it, list) {
    const n = button("", () => openYt(it, list), "album yt-card" + (it.kind === "artist" ? " circle" : ""));
    n.appendChild(picture(it.thumbnail));
    if (it.kind === "song") n.appendChild(node("i", "badge", "▶"));
    n.appendChild(node("strong", "", it.title));
    n.appendChild(node("span", "", it.kind === "artist" ? "Artista" : yt.artistNames(it) || it.subtitle));
    return n;
  }
  function ytTracks(items, into) {
    const songs = items.filter((i) => i.videoId), tracks = songs.map(yt.toTrack);
    tracks.forEach((t, i) => into.appendChild(trackRow(t, i, tracks)));
    return tracks;
  }
  function openSection(section) {
    if (section.search) return openYtSearch(section.search, section.title);
    if (section.more) openYtBrowse(section.more.browseId, section.more.params, section.title);
  }
  // Una riga: titolo (apre l'elenco completo quando esiste) e card in orizzontale.
  function ytSection(section, options) {
    const n = node("section", "yt-section");
    const head = section.more || section.search ? button(section.title + "  ›", () => openSection(section), "section-title") : node("h3", "", section.title);
    if (section.title || section.more || section.search) n.appendChild(head);
    const items = options && options.limit ? section.items.slice(0, options.limit) : section.items;
    if (section.shelf && items.every((i) => i.videoId)) {
      const list = node("div", "yt-list");
      ytTracks(items, list);
      n.appendChild(list);
    } else {
      const shelf = node("div", "shelf");
      items.forEach((it) => shelf.appendChild(ytCard(it, section.items)));
      n.appendChild(shelf);
    }
    return n;
  }
  function ytItems(items, into) {
    if (items.length && items.every((i) => i.videoId)) {
      const actions = node("div", "actions");
      actions.appendChild(button("▶ Ascolta", () => ytPlay(items, 0), "primary"));
      actions.appendChild(button("⇄ Casuale", () => ytPlay(items, 0, true)));
      actions.appendChild(button("+ In coda", () => {
        queue = queue.concat(items.filter((i) => i.videoId).map(yt.toTrack));
        notify(items.length + " brani aggiunti alla coda");
      }));
      into.appendChild(actions);
      ytTracks(items, into);
    } else {
      const grid = node("div", "grid");
      items.forEach((it) => grid.appendChild(ytCard(it, items)));
      into.appendChild(grid);
    }
  }
  async function ytHome(mark) {
    setHeading("Home", "YOUTUBE MUSIC");
    loading("Caricamento di YouTube Music…");
    try {
      const recent = youtubeAccount ? ytApi("browse", { browseId: "FEmusic_history" }).catch(() => null) : null;
      let d = await ytApi("browse", { browseId: "FEmusic_home" });
      const history2 = recent && await recent;
      if (mark !== generation) return;
      content.textContent = "";
      const played = history2 ? yt.flatItems(history2).slice(0, 20) : [];
      if (played.length) content.appendChild(ytSection({ title: "Ascoltati di recente", items: played, more: { browseId: "FEmusic_history", params: null }, search: null, shelf: false }));
      const explore = node("div", "actions explore");
      [["Novit\xE0 e tendenze", "FEmusic_explore"], ["Classifiche", "FEmusic_charts"], ["Generi e mood", "FEmusic_moods_and_genres"]].forEach(([label, id]) => explore.appendChild(button(label, () => openYtBrowse(id, null, label))));
      const sections = yt.parseSections(d);
      sections.forEach((s) => content.appendChild(ytSection(s)));
      // La home continua a pagine: le sezioni successive arrivano su richiesta.
      const more = (next) => {
        if (!next) return;
        const b = button("Altre sezioni", async () => {
          b.disabled = true;
          try {
            d = await ytApi("browse", { continuation: next.token, legacy: next.legacy });
            if (view.page !== "home") return;
            const added = yt.parseSections(d);
            b.remove();
            added.forEach((s) => explore.parentNode.insertBefore(ytSection(s), explore));
            more(yt.continuation(d));
          } catch (e) {
            notify(e.message);
            b.disabled = false;
          }
        }, "more");
        content.insertBefore(b, explore);
      };
      content.appendChild(explore);
      more(yt.continuation(d));
      if (!sections.length && !played.length) content.insertBefore(node("p", "empty", "YouTube Music non ha proposto contenuti. Prova Cerca o Classifiche."), explore);
      focusFirst();
    } catch (e) {
      ytFail(mark, e, () => navigate("home", { back: true }));
    }
  }
  const ytTabs = [["home", "Per te"], ["history", "Cronologia"], ["liked", "Mi piace"], ["playlists", "Playlist"], ["albums", "Album"], ["artists", "Artisti"]];
  async function ytLibrary(mark) {
    setHeading("Il mio YouTube", youtubeName ? youtubeName.toUpperCase() : "YOUTUBE MUSIC");
    content.textContent = "";
    if (!youtubeAccount) {
      const note = node("article", "info-copy");
      note.appendChild(node("h2", "", "Collega il tuo account"));
      note.appendChild(node("p", "", "Home, ricerca, artisti, album e playlist di YouTube Music funzionano anche senza account. Per cronologia, Mi piace, playlist, album e artisti salvati copia i cookie di music.youtube.com da un browser in cui hai effettuato l'accesso."));
      note.appendChild(node("p", "", "Sulla TV, come root, salvali in /var/lib/bloomee-webos/youtube.json con il campo cookie (facoltativi visitorData e dataSyncId), permessi 0600. Le istruzioni sono nel README di webOS."));
      content.appendChild(note);
      content.appendChild(button("Verifica di nuovo", async () => {
        await checkYouTube();
        if (view.page === "youtube") navigate("youtube", { back: true });
      }, "primary"));
      return focusFirst();
    }
    const tabs = node("div", "actions tabs"), body = node("div");
    ytTabs.forEach(([id, label]) => {
      const b = button(label, () => {
        ytTab = id;
        navigate("youtube", { back: true }).then(() => {
          const pressed = content.querySelector(".tabs [aria-pressed=true]");
          if (pressed) pressed.focus();
        });
      });
      b.setAttribute("aria-pressed", String(ytTab === id));
      tabs.appendChild(b);
    });
    content.appendChild(tabs);
    content.appendChild(body);
    body.appendChild(node("p", "empty", "Caricamento del tuo YouTube…"));
    try {
      if (ytTab === "home") {
        const sections = yt.parseSections(await ytApi("browse", { browseId: "FEmusic_home" }));
        if (mark !== generation) return;
        body.textContent = "";
        sections.forEach((s) => body.appendChild(ytSection(s)));
        if (!sections.length) body.appendChild(node("p", "empty", "Nessun suggerimento per ora."));
      } else {
        const browseId = { history: "FEmusic_history", liked: "VLLM", playlists: "FEmusic_liked_playlists", albums: "FEmusic_liked_albums", artists: "FEmusic_library_corpus_artists" }[ytTab];
        let items = (await ytAll("browse", { browseId })).items;
        if (mark !== generation) return;
        if (ytTab === "playlists") items = items.filter((i) => i.browseId);
        if (ytTab === "artists") items = items.filter((i) => i.kind === "artist");
        if (ytTab === "liked" || ytTab === "history") items = items.filter((i) => i.videoId);
        body.textContent = "";
        if (!items.length) body.appendChild(node("p", "empty", "Questo elenco \xE8 vuoto sul tuo account."));
        else ytItems(items, body);
      }
    } catch (e) {
      if (mark !== generation) return;
      body.textContent = "";
      body.appendChild(node("p", "empty", e.message));
    }
  }
  async function openYtArtist(browseId, name, options) {
    const mark = show("yt-artist:" + browseId, () => openYtArtist(browseId, name, { back: true }), options);
    setHeading(name || "Artista", "ARTISTA \xB7 YOUTUBE MUSIC");
    loading("Caricamento dell'artista…");
    try {
      const info = yt.artistInfo(await ytApi("browse", { browseId }));
      if (mark !== generation) return;
      content.textContent = "";
      setHeading(info.name || name || "Artista", "ARTISTA \xB7 YOUTUBE MUSIC");
      const head = node("div", "artist-head");
      head.appendChild(picture(info.banner));
      const about = node("div", "artist-about");
      const facts = [info.monthlyListeners, info.subscribers ? info.subscribers + " iscritti" : null].filter(Boolean).join(" \xB7 ");
      if (facts) about.appendChild(node("p", "facts", facts));
      if (info.description) about.appendChild(node("p", "bio", info.description));
      const songs = info.sections.filter((s) => s.items.some((i) => i.videoId))[0];
      const actions = node("div", "actions");
      if (songs) {
        actions.appendChild(button("▶ Ascolta", () => ytPlay(songs.items, 0), "primary"));
        actions.appendChild(button("⇄ Casuale", () => ytPlay(songs.items, 0, true)));
      }
      about.appendChild(actions);
      head.appendChild(about);
      content.appendChild(head);
      info.sections.forEach((s) => content.appendChild(ytSection(s)));
      if (!info.sections.length) content.appendChild(node("p", "empty", "YouTube Music non ha altri contenuti per questo artista."));
      focusFirst();
    } catch (e) {
      ytFail(mark, e, () => openYtArtist(browseId, name, { back: true }));
    }
  }
  async function openYtCollection(browseId, name, options) {
    const mark = show("yt-list:" + browseId, () => openYtCollection(browseId, name, { back: true }), options);
    const album = browseId.indexOf("MPREb") === 0;
    setHeading(album ? "Album" : "Playlist", "YOUTUBE MUSIC");
    loading();
    try {
      const all = await ytAll("browse", { browseId });
      if (mark !== generation) return;
      const info = yt.collectionInfo(all.first);
      const items = yt.fillCollectionTracks(all.items, info, browseId);
      content.textContent = "";
      const detail = node("div", "detail"), cover = node("div", "cover-column"), list = node("div", "detail-list");
      cover.appendChild(picture(info.thumbnail || items[0] && items[0].thumbnail));
      cover.appendChild(node("h2", "", info.title || name || ""));
      if (info.subtitle) cover.appendChild(node("p", "", info.subtitle));
      if (items.length) ytItems(items, list);
      else list.appendChild(node("p", "empty", "Nessun brano disponibile in questo elenco."));
      detail.appendChild(cover);
      detail.appendChild(list);
      content.appendChild(detail);
      focusFirst();
    } catch (e) {
      ytFail(mark, e, () => openYtCollection(browseId, name, { back: true }));
    }
  }
  // Pagine generiche: classifiche, generi, discografia completa, "Mostra tutti".
  async function openYtBrowse(browseId, params, name, options) {
    if (/^(VL|MPREb|OLAK|PL)/.test(browseId) && !params) return openYtCollection(browseId, name, options);
    if (browseId.indexOf("UC") === 0 && !params) return openYtArtist(browseId, name, options);
    const mark = show("yt-browse:" + browseId + ":" + (params || ""), () => openYtBrowse(browseId, params, name, { back: true }), options);
    setHeading(name || "YouTube Music", "YOUTUBE MUSIC");
    loading("Caricamento di YouTube Music…");
    try {
      const body = params ? { browseId, params } : { browseId };
      const d = await ytApi("browse", body);
      const sections = yt.parseSections(d);
      if (mark !== generation) return;
      content.textContent = "";
      if (sections.length > 1) sections.forEach((s) => content.appendChild(ytSection(s)));
      else {
        const all = await ytAll("browse", body);
        if (mark !== generation) return;
        content.textContent = "";
        ytItems(all.items, content);
      }
      if (!content.children.length) empty("Nessun contenuto disponibile.");
      focusFirst();
    } catch (e) {
      ytFail(mark, e, () => openYtBrowse(browseId, params, name, { back: true }));
    }
  }
  async function openYtSearch(searchEndpoint, name, options) {
    const mark = show("yt-search:" + searchEndpoint.query + ":" + searchEndpoint.params, () => openYtSearch(searchEndpoint, name, { back: true }), options);
    setHeading(name || "Risultati", "CERCA \xB7 " + searchEndpoint.query.toUpperCase());
    loading("Ricerca su YouTube Music…");
    try {
      let d = await ytApi("search", searchEndpoint.params ? { query: searchEndpoint.query, params: searchEndpoint.params } : { query: searchEndpoint.query });
      if (mark !== generation) return;
      content.textContent = "";
      const items = yt.flatItems(d);
      const list = node("div");
      ytItems(items, list);
      content.appendChild(list);
      const more = (next) => {
        if (!next) return;
        const b = button("Altri risultati", async () => {
          b.disabled = true;
          try {
            d = await ytApi("search", { continuation: next.token, legacy: next.legacy });
            const added = yt.flatItems(d).filter((it) => !items.some((o) => o.videoId === it.videoId && o.browseId === it.browseId));
            b.remove();
            items.push.apply(items, added);
            list.textContent = "";
            ytItems(items, list);
            more(yt.continuation(d));
          } catch (e) {
            notify(e.message);
            b.disabled = false;
          }
        }, "more");
        content.appendChild(b);
      };
      more(yt.continuation(d));
      if (!items.length) empty("Nessun risultato.");
      focusFirst();
    } catch (e) {
      ytFail(mark, e, () => openYtSearch(searchEndpoint, name, { back: true }));
    }
  }
  async function checkYouTube() {
    try {
      const health = await api("/health");
      youtubeAccount = !!health.youtube;
      youtubeName = null;
      if (youtubeAccount) youtubeName = yt.accountName(await ytApi("account/account_menu", {}));
    } catch (e) {
      if (youtubeAccount) notify(e.message);
    }
    updateConnection();
    return youtubeAccount;
  }
  function updateConnection() {
    const c = $("#connection");
    c.textContent = "";
    c.appendChild(node("span", "", jellyfin ? "Jellyfin collegato" : "Jellyfin non collegato"));
    c.appendChild(node("span", "", youtubeAccount ? "YouTube: " + (youtubeName || "account collegato") : "YouTube Music senza account"));
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
        jellyfin = true;
        notify("Jellyfin collegato");
      } catch (e) {
        jellyfin = false;
        notify(e.message);
      }
      updateConnection();
    }));
    row("YouTube Music", youtubeAccount ? "Account collegato" + (youtubeName ? ": " + youtubeName : "") + ". Cronologia, Mi piace e playlist sono in Il mio YouTube." : "Home, ricerca e riproduzione funzionano senza account. Per la tua libreria aggiungi i cookie in /var/lib/bloomee-webos/youtube.json.", button("Verifica", async () => {
      try {
        await ytApi("browse", { browseId: "FEmusic_home" });
        await checkYouTube();
        notify(youtubeAccount ? "YouTube Music collegato" + (youtubeName ? " come " + youtubeName : "") : "YouTube Music raggiungibile, senza account");
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
    setHeading("Informazioni", "BLOOMEE SU LG \xB7 0.2.0");
    content.textContent = "";
    const note = node("article", "info-copy");
    note.appendChild(node("h2", "", "La tua musica, sulla LG"));
    note.appendChild(node("p", "", "Home, ricerca, artisti, album e playlist di YouTube Music, con cronologia, Mi piace e libreria del tuo account se colleghi i cookie. Album, artisti, brani e preferiti Jellyfin, ricerca unificata, coda, riproduzione casuale e ripetizione."));
    note.appendChild(node("h2", "", "Schermo e ascolto"));
    note.appendChild(node("p", "", "Sulla LG viene spento solo il pannello. La musica continua e il televisore rimane acceso. Su Android TV si usa uno schermo nero e la luminosit\xE0 minima, perch\xE9 lo spegnimento fisico non \xE8 disponibile alle app su tutte le TV."));
    note.appendChild(node("h2", "", "Sorgenti"));
    note.appendChild(node("p", "", "Questa edizione usa Jellyfin e YouTube Music. L'accesso Google dalla TV, i Mi piace scritti sull'account, plugin Android, Cast e download offline rimangono disponibili nella versione Android e non sono inclusi nel porting LG."));
    content.appendChild(note);
    const close = button("Torna alle impostazioni", settings);
    close.id = "settings-info-back";
    content.appendChild(close);
    close.focus();
    content.scrollTop = 0;
  }
  function back() {
    const previous = history.pop();
    if (previous) previous.render();
    else navigate("home", { back: true });
  }
  $("#back").onclick = back;
  $("#refresh").onclick = () => {
    ytCache.clear();
    if (view) view.render();
  };
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
    // Nelle righe orizzontali destra e sinistra restano nella riga.
    const shelf = current2.closest(".shelf");
    if (shelf && (key === "ArrowRight" || key === "ArrowLeft")) {
      const cards = Array.from(shelf.querySelectorAll("button")).filter((n) => n !== current2);
      const next = chooseRemoteTarget(rect, cards.map((n) => ({ element: n, rect: n.getBoundingClientRect() })), key);
      if (next) {
        next.focus();
        next.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else if (key === "ArrowLeft" && document.querySelector("nav button.selected")) document.querySelector("nav button.selected").focus();
      return;
    }
    if (within && (key === "ArrowDown" || key === "ArrowUp" || key === "ArrowLeft")) {
      const contentPool = all.filter((n) => content.contains(n));
      const target2 = chooseRemoteTarget(rect, contentPool.map((n) => ({ element: n, rect: n.getBoundingClientRect() })), key);
      if (target2) {
        target2.focus();
        target2.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }
      // Dal bordo sinistro del contenuto si torna alla voce attiva del menu.
      const selected = key === "ArrowLeft" && document.querySelector("nav button.selected");
      if (selected) {
        selected.focus();
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
    } catch (e) {
      $("#connection").textContent = "Collegamento non disponibile";
      empty("Collegamento alla musica non disponibile. Verifica Homebrew Channel, poi scegli Riprova.");
      content.appendChild(button("Riprova", boot, "primary"));
      return focusFirst();
    }
    // Jellyfin e YouTube Music sono indipendenti: uno può mancare.
    const libraryCheck = api("/api/library", { kind: "MusicAlbum", limit: 1 }).then(() => jellyfin = true, () => jellyfin = false);
    await Promise.all([libraryCheck, checkYouTube()]);
    updateConnection();
    if (page !== "settings" && page !== "queue" && page !== "search") await navigate(page, { back: true });
  }
  const iconPaths = { home: "M3 11l9-8 9 8 M5 9.5V21h14V9.5 M10 21v-6h4v6", youtube: "M3 6.5a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z M10 9l5 3-5 3z", albums: "M4 4h16v16H4z M8 8h8v8H8z", artists: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87", tracks: "M9 18V5l12-2v13 M3 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M15 16a3 3 0 1 0 6 0 3 3 0 1 0-6 0", favorites: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8", search: "M21 21l-5-5 M18 10a8 8 0 1 0-16 0 8 8 0 1 0 16 0", queue: "M4 6h16 M4 12h16 M4 18h16", settings: "M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2" };
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
