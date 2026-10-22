import { chooseRemoteTarget } from "./remote-focus.js";
import { createScreenTimer } from "./screen-timer.js";
import * as yt from "./youtube.js";
import { createLibrary, homeRows, normalize } from "./library.js";
import { createSearch, filterHits, groupVariants } from "./search-model.js";
(function() {
  "use strict";
  const $ = (s) => document.querySelector(s), content = $("#content"), audio = $("#audio");
  let bridge = null, page = "home", view = null, history = [], currentItems = [], queue = [], current = -1, shuffle = false, repeat = false, generation = 0, loaded = 0, total = 0;
  let jellyfin = false, youtubeAccount = false, youtubeName = null, youtubeMessage = null, ytTab = "forYou", altTried = false;
  let dialog = null, press = null, lastKeyAt = 0, radioFor = null, recentFor = null;
  const ytCache = /* @__PURE__ */ new Map();
  // Elementi con menu di OK prolungato e informazioni per la testata della Home.
  const menus = /* @__PURE__ */ new WeakMap(), heroes = /* @__PURE__ */ new WeakMap();
  let settingsChoice = null;
  const memory = {};
  const store = {
    getItem(k) {
      try {
        return localStorage.getItem(k);
      } catch (_) {
        return memory[k] || null;
      }
    },
    setItem(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (_) {
        memory[k] = v;
      }
    }
  };
  const lib = createLibrary(store);
  let prefs = { screenOff: 0, autoPlay: true };
  try {
    prefs = Object.assign(prefs, JSON.parse(store.getItem("bloomee.preferences") || "{}"));
  } catch (_) {
  }
  function savePrefs(patch) {
    store.setItem("bloomee.preferences", JSON.stringify(Object.assign({}, prefs, patch)));
    Object.assign(prefs, patch);
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
  function button(text, fn, cls, key) {
    const n = node("button", cls, text);
    n.type = "button";
    n.onclick = fn;
    if (key) n.dataset.key = key;
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
    } catch (e) {
      throw e.name === "AbortError" ? Error("Il servizio non ha risposto in tempo. Riprova.") : e;
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
      if (ytCache.size > 60) ytCache.clear();
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
  // ── Riferimenti: fissati, preferiti, ricerca ────────────────────────
  function jfRef(item, kind) {
    const jf = {};
    ["Id", "Name", "Artists", "AlbumArtist", "AlbumArtists", "AlbumId", "Album", "ImageTags", "PrimaryImageItemId", "RunTimeTicks", "ProductionYear", "IndexNumber"].forEach((k) => {
      if (item[k] != null) jf[k] = item[k];
    });
    return { source: "jellyfin", kind, id: "jellyfin::" + item.Id, title: item.Name, subtitle: kind === "artist" ? "Artista" : artist(item), image: null, year: item.ProductionYear || null, duration: (item.RunTimeTicks || 0) / 1e7, jf, track: kind === "track" ? jf : null };
  }
  function trackRef(t) {
    if (t.source !== "youtube") return jfRef(t, "track");
    return { source: "youtube", kind: "track", id: "youtube::" + t.videoId, title: t.Name, subtitle: t.Artists.join(", "), image: t.thumb, year: null, duration: (t.RunTimeTicks || 0) / 1e7, browseId: null, params: null, track: t };
  }
  function refImage(ref) {
    return ref.source === "jellyfin" ? image(ref.jf) : ref.image;
  }
  function openRef(ref) {
    if (ref.kind === "track") return playList([ref.track], 0);
    if (ref.source === "jellyfin") return ref.kind === "artist" ? openArtist(ref.jf) : openAlbum(ref.jf);
    if (ref.kind === "artist") return openYtArtist(ref.browseId, ref.title);
    if (ref.kind === "album" || ref.kind === "playlist") return openYtCollection(ref.browseId, ref.title);
    openYtBrowse(ref.browseId, ref.params, ref.title);
  }
  // ── Focus da telecomando ────────────────────────────────────────────
  function focusables(scope) {
    return Array.from(scope.querySelectorAll('button,input,[tabindex="0"]')).filter((n) => !n.disabled && !n.closest("[hidden]") && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0);
  }
  function scrollTo(n) {
    n.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  // A pagina caricata il focus entra nel contenuto, salvo che l'utente stia
  // già usando il menu laterale o la barra del player.
  function focusFirst(force) {
    if (dialog) return;
    const a = document.activeElement;
    if (!force && a && a !== document.body && document.contains(a) && (a.closest("nav") && !a.classList.contains("selected") || a.closest("footer"))) return;
    const n = content.querySelector("[data-autofocus]:not([disabled])") || focusables(content)[0];
    if (n) {
      n.focus();
      scrollTo(n);
    } else if (force) {
      const selected = document.querySelector("nav button.selected");
      if (selected) selected.focus();
    }
  }
  function keyOf(n) {
    return n && n.dataset ? n.dataset.key : null;
  }
  // Ridisegna e rimette il focus sullo stesso controllo (stessa data-key).
  async function keep(render) {
    const key = keyOf(document.activeElement);
    await render();
    if (!key || dialog) return;
    const n = content.querySelector('[data-key="' + CSS.escape(key) + '"]');
    if (n && !n.disabled) {
      n.focus();
      scrollTo(n);
    }
  }
  function recover() {
    if (dialog) {
      const n = focusables(dialog.box)[0];
      if (n) n.focus();
      return;
    }
    focusFirst(true);
  }
  function move(key) {
    const cur = document.activeElement;
    const scope = dialog ? dialog.box : document;
    if (!cur || cur === document.body || !document.contains(cur) || !scope.contains(cur)) return recover();
    const rect = cur.getBoundingClientRect();
    const others = focusables(scope).filter((n) => n !== cur);
    const pick = (pool) => chooseRemoteTarget(rect, pool.map((n) => ({ element: n, rect: n.getBoundingClientRect() })), key);
    const go = (n) => {
      n.focus();
      scrollTo(n);
    };
    if (dialog) {
      const target2 = pick(others);
      if (target2) return go(target2);
      // Testi lunghi (biografia): su e giù scorrono il testo.
      const body = dialog.box.querySelector(".dialog-body");
      if (body && (key === "ArrowDown" || key === "ArrowUp")) body.scrollTop += key === "ArrowDown" ? 120 : -120;
      return;
    }
    const within = content.contains(cur), inNav = !!cur.closest("nav");
    const selected = document.querySelector("nav button.selected");
    if (inNav && key === "ArrowRight") return focusFirst(true);
    // Nelle righe orizzontali destra e sinistra restano nella riga.
    const shelf = cur.closest(".shelf");
    if (shelf && (key === "ArrowRight" || key === "ArrowLeft")) {
      const next = pick(focusables(shelf).filter((n) => n !== cur));
      if (next) go(next);
      else if (key === "ArrowLeft" && selected) selected.focus();
      return;
    }
    // Destra e sinistra restano sulla stessa riga visiva: niente salti in
    // diagonale verso altre righe. Dal bordo sinistro si torna al menu.
    if (within && (key === "ArrowLeft" || key === "ArrowRight")) {
      const cy = rect.top + rect.height / 2;
      const target2 = pick(others.filter((n) => {
        if (!content.contains(n)) return false;
        const r = n.getBoundingClientRect();
        return Math.abs(r.top + r.height / 2 - cy) < Math.max(r.height, rect.height) / 2;
      }));
      if (target2) return go(target2);
      if (key === "ArrowLeft" && selected) selected.focus();
      return;
    }
    if (within) {
      const target2 = pick(others.filter((n) => content.contains(n)));
      if (target2) return go(target2);
    }
    const target = pick(others);
    if (target) {
      target.focus();
      if (content.contains(target)) scrollTo(target);
    }
  }
  // ── Finestre di dialogo ─────────────────────────────────────────────
  // Modali: le frecce restano dentro, Indietro chiude e il focus torna
  // al controllo che le ha aperte.
  function openDialog(title, build, options) {
    if (dialog) dialog.close();
    const opener = document.activeElement;
    const backdrop = node("div", "dialog-backdrop"), box = node("div", "dialog"), body = node("div", "dialog-body"), actions = node("div", "dialog-actions");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", title);
    box.appendChild(node("h2", "", title));
    box.appendChild(body);
    box.appendChild(actions);
    backdrop.appendChild(box);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) d.close();
    };
    const d = {
      box,
      body,
      actions,
      closed: false,
      close() {
        if (d.closed) return;
        d.closed = true;
        backdrop.remove();
        if (dialog === d) dialog = null;
        if (options && options.onClose) options.onClose();
        if (opener && document.contains(opener) && !opener.disabled) opener.focus();
        else focusFirst(true);
      }
    };
    dialog = d;
    build(d);
    $("#app").appendChild(backdrop);
    const first = box.querySelector("[data-autofocus]") || focusables(box)[0];
    if (first) first.focus();
    return d;
  }
  function choose(title, options) {
    return new Promise((resolve) => {
      let value = null;
      openDialog(title, (d) => {
        d.box.classList.add("menu");
        options.forEach(([v, label]) => d.actions.appendChild(button(label, () => {
          value = v;
          d.close();
        })));
      }, { onClose: () => resolve(value) });
    });
  }
  function confirmDialog(title, text, ok) {
    return new Promise((resolve) => {
      let yes = false;
      openDialog(title, (d) => {
        d.body.appendChild(node("p", "", text));
        const cancel = button("Annulla", () => d.close());
        cancel.dataset.autofocus = "";
        d.actions.appendChild(cancel);
        d.actions.appendChild(button(ok, () => {
          yes = true;
          d.close();
        }, "primary"));
      }, { onClose: () => resolve(yes) });
    });
  }
  function promptDialog(title, initial) {
    return new Promise((resolve) => {
      let value = null;
      openDialog(title, (d) => {
        const input = node("input");
        input.value = initial || "";
        input.setAttribute("aria-label", title);
        input.dataset.autofocus = "";
        const done = () => {
          value = input.value.trim();
          d.close();
        };
        input.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            done();
          }
        };
        d.body.appendChild(input);
        d.actions.appendChild(button("Fatto", done, "primary"));
        d.actions.appendChild(button("Annulla", () => d.close()));
      }, { onClose: () => resolve(value) });
    });
  }
  // Menu di OK prolungato, come showTvReferenceMenu.
  async function openMenu(el) {
    const ref = menus.get(el);
    if (!ref) return;
    const options = [["pin", "Fissa / rimuovi dalla Home"], ["favorite", "Salva nei preferiti unificati"]];
    if (ref.kind === "track") options.push(["next", "Riproduci dopo"]);
    const action = await choose(ref.title, options);
    if (action === "pin") {
      notify(lib.togglePin(ref) ? "Fissato nella Home" : "Rimosso dalla Home");
      if (page === "home" && view) keep(view.render);
    } else if (action === "favorite") {
      lib.addFavorite(ref);
      notify("Salvato nei preferiti unificati");
      updateLike();
    } else if (action === "next") playNext(ref.track);
  }
  // ── Pagine ──────────────────────────────────────────────────────────
  function setHeading(title, sub) {
    $("main").classList.remove("hero");
    $("#heading").textContent = title;
    $("#eyebrow").textContent = sub || "JELLYFIN";
  }
  function setHero(h) {
    $("main").classList.add("hero");
    $("#eyebrow").textContent = h.kind ? h.kind.toUpperCase() : "BLOOMEE";
    $("#heading").textContent = h.title;
    $("#hero-sub").textContent = h.subtitle || "";
    $("#hero-art").hidden = !h.image;
    if (h.image) $("#hero-art").src = h.image;
  }
  function loading(text) {
    content.textContent = "";
    content.appendChild(node("p", "empty", text || "Caricamento della libreria…"));
  }
  function empty(text) {
    content.textContent = "";
    content.appendChild(node("p", "empty", text));
  }
  // Ogni pagina sa ridisegnarsi: Indietro e Aggiorna richiamano render.
  function show(id, render, options) {
    if (dialog) dialog.close();
    if ((!options || !options.back) && view && view.page !== id && history.push(view) > 50) history.shift();
    view = { page: id, render };
    page = id;
    settingsChoice = null;
    content.scrollTop = 0;
    return ++generation;
  }
  async function navigate(next, options) {
    const mark = show(next, () => navigate(next, { back: true }), options);
    document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("selected", b.dataset.page === next));
    if (next === "settings") return settings();
    if (next === "queue") return renderQueue();
    if (next === "search") return search();
    if (next === "home") return home(mark);
    if (next === "youtube") return ytLibrary(mark);
    setHeading({ albums: "La tua musica", artists: "Artisti", tracks: "Tutti i brani", favorites: "I tuoi preferiti" }[next] || "Musica");
    loading();
    loaded = 0;
    currentItems = [];
    try {
      const data = await library(next, 0);
      if (mark !== generation) return;
      content.textContent = "";
      if (next === "favorites") content.appendChild(favoritesBar());
      total = data.TotalRecordCount || data.Items.length;
      appendItems(data.Items, next);
      focusFirst();
    } catch (e) {
      if (mark === generation) {
        empty(e.message);
        if (next === "favorites") content.insertBefore(favoritesBar(), content.firstChild);
        content.appendChild(button("Riprova", () => navigate(next, { back: true })));
        focusFirst();
      }
    }
  }
  function favoritesBar() {
    const bar = node("div", "actions");
    bar.appendChild(button("♥ Preferiti unificati (" + lib.favorites().length + ")", () => favoritesPage(), "", "unified"));
    return bar;
  }
  function library(next, start2, extra) {
    return api("/api/library", Object.assign({ kind: next === "artists" ? "MusicArtist" : next === "tracks" || next === "favorites" ? "Audio" : "MusicAlbum", start: start2, limit: 60 }, next === "favorites" ? { favorite: "true" } : {}, extra || {}));
  }
  function trackRow(item, i, items, options) {
    const o = options || {};
    const n = button("", () => playList(items, i), "track", o.key);
    n.appendChild(node("span", "number", String(o.index != null ? o.index : item.IndexNumber || i + 1)));
    const title = node("span", "track-title");
    title.appendChild(node("strong", "", item.Name));
    const sub = o.subtitle !== void 0 ? o.subtitle : artist(item);
    if (sub) title.appendChild(node("small", "", sub));
    n.appendChild(title);
    if (item.RunTimeTicks) n.appendChild(node("span", "duration", duration(item.RunTimeTicks / 1e7)));
    if (o.onTap) n.onclick = o.onTap;
    menus.set(n, o.ref || trackRef(item));
    return n;
  }
  function appendItems(items, next) {
    loaded += items.length;
    currentItems = currentItems.concat(items);
    if (!currentItems.length) {
      if (next === "favorites") return content.appendChild(node("p", "empty", "Nessun preferito su Jellyfin."));
      return empty("Nessun elemento disponibile. Controlla la libreria musicale su Jellyfin.");
    }
    const old = content.querySelector(".more");
    if (old) old.remove();
    let grid = content.querySelector(".grid");
    if (!grid && next !== "tracks" && next !== "favorites") {
      grid = node("div", "grid");
      content.appendChild(grid);
    }
    let first = null;
    items.forEach((item) => {
      let n;
      if (next === "tracks" || next === "favorites") {
        n = trackRow(item, currentItems.indexOf(item), currentItems);
        n.onclick = () => playList(currentItems, currentItems.indexOf(item));
        content.appendChild(n);
      } else {
        n = jfCard(item, next === "artists" ? "artist" : "album");
        grid.appendChild(n);
      }
      first = first || n;
    });
    if (loaded < total) {
      const more = button("Carica altri", async () => {
        more.disabled = true;
        try {
          const d = await library(next, loaded);
          const added = appendItems(d.Items, next);
          if (added) {
            added.focus();
            scrollTo(added);
          }
        } catch (e) {
          notify(e.message);
          more.disabled = false;
          more.focus();
        }
      }, "more");
      content.appendChild(more);
    }
    return first;
  }
  function jfCard(item, kind, hero) {
    const n = button("", () => kind === "artist" ? openArtist(item) : openAlbum(item), "album");
    n.appendChild(art(item));
    n.appendChild(node("strong", "", item.Name));
    n.appendChild(node("span", "", kind === "artist" ? "Artista" : artist(item)));
    menus.set(n, jfRef(item, kind));
    if (hero) heroes.set(n, hero);
    return n;
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
      if (mark === generation) ytFail(mark, e, () => openArtist(item, { back: true }));
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
      actions.appendChild(button("▶ Ascolta", () => playList(d.Items, 0), "primary"));
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
      ytFail(mark, e, () => openAlbum(item, { back: true }));
    }
  }
  // ── Riproduzione ────────────────────────────────────────────────────
  function playList(items, index) {
    queue = items.slice();
    current = index;
    start();
  }
  function playNext(track) {
    if (!track) return;
    queue.splice(current < 0 ? 0 : current + 1, 0, track);
    notify(current < 0 ? "Aggiunto alla coda" : "Riprodotto dopo il brano corrente");
    if (page === "queue") keep(renderQueue);
  }
  async function start() {
    const item = queue[current];
    if (!item) return;
    $("#now-art").src = image(item);
    $("#now-title").textContent = item.Name;
    $("#now-artist").textContent = artist(item);
    updateLike();
    altTried = false;
    const src = item.source === "youtube" ? url("/yt/audio/" + item.videoId) : url("/audio/" + item.Id);
    audio.src = src;
    try {
      await audio.play();
    } catch (e) {
      // Gli errori del flusso li gestisce l'evento error, che può ripiegare su un altro formato.
      if (audio.src === src && e.name !== "AbortError" && !audio.error) notify("Riproduzione non riuscita. Prova un altro brano o verifica " + (item.source === "youtube" ? "la connessione." : "Jellyfin."));
    }
    if (page === "queue") keep(renderQueue);
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
  // Riproduzione automatica: verso la fine della coda accoda la radio di
  // YouTube Music del brano in ascolto, come i brani correlati su Android.
  async function radio() {
    const item = queue[current];
    if (!item || item.source !== "youtube" || prefs.autoPlay === false || repeat || queue.length - current > 2 || radioFor === item.videoId) return;
    radioFor = item.videoId;
    try {
      const songs = yt.radio(await ytApi("next", { videoId: item.videoId, playlistId: "RDAMVM" + item.videoId }));
      const known = {};
      queue.forEach((t) => known[t.videoId || t.Id] = true);
      const added = songs.filter((s) => !known[s.videoId]).map(yt.toTrack);
      if (!added.length) return;
      queue = queue.concat(added);
      if (page === "queue") keep(renderQueue);
    } catch (_) {
      radioFor = null;
    }
  }
  function updateLike() {
    const item = queue[current];
    const liked = !!(item && lib.favoriteOf(trackRef(item)));
    $("#like").setAttribute("aria-pressed", String(liked));
    $("#like").setAttribute("aria-label", liked ? "Nei preferiti" : "Mi piace");
  }
  $("#like").onclick = () => {
    const item = queue[current];
    if (!item) return notify("Scegli prima un brano");
    const ref = trackRef(item), group = lib.favoriteOf(ref);
    if (!group) {
      lib.addFavorite(ref);
      notify("Salvato nei preferiti unificati. Su YouTube non cambia nulla.");
    } else {
      if (group.variants.length > 1) {
        lib.split(group.identity, ref.id);
        lib.removeFavorite(group.identity + "|" + ref.id);
      } else lib.removeFavorite(group.identity);
      notify("Rimosso dai preferiti");
    }
    updateLike();
  };
  $("#play").onclick = () => {
    if (current < 0 && queue.length) return step(1);
    if (current < 0) return notify("Scegli prima un album o un brano");
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
    $("#play").textContent = "Ⅱ";
    screen.playing(true);
    const item = queue[current];
    if (item && recentFor !== item) {
      recentFor = item;
      lib.addRecent(trackRef(item));
    }
    radio();
  });
  audio.addEventListener("pause", () => {
    $("#play").textContent = "▶";
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
  function seekBy(seconds) {
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
  }
  function renderQueue() {
    setHeading("In coda", queue.length + " BRANI");
    content.textContent = "";
    if (!queue.length) return empty("La coda \xE8 vuota. Apri un album e scegli Ascolta oppure In coda.");
    queue.forEach((item, i) => {
      const n = trackRow(item, i, queue, { key: "queue:" + i, index: i + 1, onTap: () => {
        current = i;
        start();
      } });
      if (i === current) n.classList.add("selected");
      content.appendChild(n);
    });
    focusFirst();
  }
  // ── YouTube Music: elementi ─────────────────────────────────────────
  function ytFail(mark, e, retry) {
    if (mark !== generation) return;
    empty(e.message);
    if (retry) content.appendChild(button("Riprova", retry, "primary"));
    focusFirst();
  }
  // Come playYtItems: solo i brani, dal brano scelto; Casuale mescola la coda.
  function ytPlay(items, index, random) {
    const songs = items.filter((i) => i.videoId);
    if (!songs.length) return notify("Nessun brano da ascoltare");
    const first = Math.max(0, songs.indexOf(items[index]));
    $("#shuffle").setAttribute("aria-pressed", String(shuffle = !!random));
    playList(songs.map(yt.toTrack), random ? Math.floor(Math.random() * songs.length) : first);
  }
  function openYt(it, list) {
    if (it.kind === "song") return ytPlay(list, list.indexOf(it));
    if (!it.browseId) return notify("Contenuto non disponibile");
    if (it.kind === "artist") return openYtArtist(it.browseId, it.title);
    if (it.kind === "album" || it.kind === "playlist") return openYtCollection(it.browseId, it.title);
    openYtBrowse(it.browseId, it.params, it.title);
  }
  const kindName = { song: "Brano", album: "Album", artist: "Artista" };
  function card(o) {
    const n = button("", o.onTap, "album yt-card" + (o.circle ? " circle" : ""), o.key);
    n.appendChild(picture(o.image));
    if (o.badge) n.appendChild(node("i", "badge", "▶"));
    n.appendChild(node("strong", "", o.title));
    n.appendChild(node("span", "", o.subtitle || ""));
    if (o.ref) menus.set(n, o.ref);
    if (o.hero) heroes.set(n, o.hero);
    return n;
  }
  function ytCard(it, list, section, key) {
    const names = yt.artistNames(it);
    return card({
      title: it.title,
      subtitle: it.kind === "artist" ? "Artista" : names || it.subtitle,
      image: it.thumbnail,
      circle: it.kind === "artist",
      badge: it.kind === "song",
      onTap: () => openYt(it, list),
      ref: yt.toRef(it),
      hero: { kind: (kindName[it.kind] || "Playlist") + (section ? " \xB7 " + section : ""), title: it.title, subtitle: names || it.subtitle, image: it.thumbnail },
      key: key ? key + ":" + (it.videoId || it.browseId || it.title) : null
    });
  }
  function refCard(ref, onTap, section, key) {
    const img = refImage(ref);
    return card({ title: ref.title, subtitle: ref.subtitle, image: img, circle: ref.kind === "artist", badge: ref.kind === "track", onTap: onTap || (() => openRef(ref)), ref, hero: { kind: section, title: ref.title, subtitle: ref.subtitle, image: img }, key: key ? key + ":" + ref.id : null });
  }
  // Una riga come TvRow: titolo (apre l'elenco completo quando esiste),
  // eventuale sorgente accanto, copertine in orizzontale.
  function shelfRow(title, cards, o) {
    o = o || {};
    const n = node("section", "yt-section"), head = node("div", "row-head");
    head.appendChild(o.onTitle ? button(title + "  ›", o.onTitle, "section-title", o.key ? o.key + ":title" : null) : node("h3", "", title));
    if (o.subtitle) head.appendChild(node("span", "row-sub", o.subtitle));
    n.appendChild(head);
    const shelf = node("div", "shelf");
    cards.forEach((c) => shelf.appendChild(c));
    n.appendChild(shelf);
    return n;
  }
  function more(section, subtitle) {
    return section.more ? () => openYtAll(section.title, subtitle, section.more.browseId, section.more.params) : null;
  }
  function ytRow(section, o) {
    o = o || {};
    const key = o.key || "row:" + section.title;
    return shelfRow(section.title, section.items.map((it) => ytCard(it, section.items, section.title, key)), { onTitle: more(section, o.moreSubtitle), subtitle: o.subtitle, key });
  }
  function songSubtitle(t) {
    return [t.Artists.join(", "), t.Album].filter(Boolean).join(" \xB7 ");
  }
  // Brani: pulsanti fissi sopra, poi l'elenco (come _grid di TvYouTubeScreen).
  function ytSongs(items, into, label) {
    const songs = items.filter((i) => i.videoId), tracks = songs.map(yt.toTrack);
    const actions = node("div", "actions");
    const play = button("▶ " + (label || "Riproduci tutto"), () => ytPlay(songs, 0), "primary", "play-all");
    play.dataset.autofocus = "";
    actions.appendChild(play);
    actions.appendChild(button("⇄ Casuale", () => ytPlay(songs, 0, true), "", "shuffle-all"));
    actions.appendChild(button("+ In coda", () => {
      queue = queue.concat(tracks);
      notify(tracks.length + " brani aggiunti alla coda");
    }, "", "queue-all"));
    into.appendChild(actions);
    const list = node("div", "yt-list");
    tracks.forEach((t, i) => list.appendChild(trackRow(t, i, tracks, { index: i + 1, subtitle: songSubtitle(t), key: "song:" + i })));
    into.appendChild(list);
  }
  function ytGrid(items, into, label) {
    const grid = node("div", "grid");
    items.forEach((it) => grid.appendChild(ytCard(it, items, label, "grid")));
    into.appendChild(grid);
  }
  // ── Home ────────────────────────────────────────────────────────────
  const defaultHero = { kind: null, title: "Bloomee", subtitle: "Scegli qualcosa da ascoltare", image: null };
  async function home(mark) {
    setHero(defaultHero);
    content.textContent = "";
    const renderedAt = Date.now();
    if (!jellyfin) content.appendChild(node("p", "hint home-hint", "Collega Jellyfin da Impostazioni (menu a sinistra) per vedere qui la tua musica."));
    const tools = node("div", "actions home-tools");
    tools.appendChild(button("⚙ Personalizza", customize, "", "home:customize"));
    tools.appendChild(button("♥ Preferiti unificati", favoritesPage, "", "home:favorites"));
    content.appendChild(tools);
    const pins = lib.pins();
    if (pins.length) content.appendChild(shelfRow("Fissati", pins.map((p) => refCard(p, null, "Fissato", "pins")), { key: "pins" }));
    const slots = {};
    lib.visibleRows().forEach((k) => content.appendChild(slots[k] = node("div", "home-slot")));
    focusFirst();
    // Prima riga arrivata: il focus va sulla prima copertina, se nel
    // frattempo non hai già usato il telecomando.
    const fill = (k, nodes) => {
      if (mark !== generation || !slots[k]) return;
      slots[k].textContent = "";
      nodes.forEach((n) => slots[k].appendChild(n));
      if (lastKeyAt <= renderedAt && !dialog) {
        const first = content.querySelector(".shelf button");
        if (first) {
          first.focus();
          setHero(heroes.get(first) || defaultHero);
        }
      }
    };
    const jobs = [];
    if (slots.jfRecent && jellyfin) jobs.push(api("/api/library", { kind: "MusicAlbum", sort: "recent", limit: 20 }).then((d) => fill("jfRecent", d.Items.length ? [shelfRow("Aggiunti di recente", d.Items.map((a) => jfCard(a, "album", { kind: "Nella tua libreria", title: a.Name, subtitle: artist(a) + (a.ProductionYear ? " \xB7 " + a.ProductionYear : ""), image: image(a) })), { subtitle: "Jellyfin" })] : []), () => fill("jfRecent", [node("p", "hint", "Jellyfin non raggiungibile: verifica il server o riprova")])));
    if (slots.jfRandom && jellyfin) jobs.push(api("/api/library", { kind: "MusicAlbum", sort: "random", limit: 20 }).then((d) => fill("jfRandom", d.Items.length ? [shelfRow("Scelti per te", d.Items.map((a) => jfCard(a, "album", { kind: "Nella tua libreria", title: a.Name, subtitle: artist(a), image: image(a) })), { subtitle: "Jellyfin" })] : []), () => {
    }));
    if (slots.recent) {
      const recent = lib.recent().slice(0, 25);
      if (recent.length) {
        const tracks = recent.map((r) => r.track);
        fill("recent", [shelfRow("Ascoltati di recente", recent.map((r, i) => refCard(r, () => playList(tracks, i), "Ascoltato di recente", "recent")), { key: "recent" })]);
      }
    }
    if (youtubeAccount && slots.ytHistory) jobs.push(ytApi("browse", { browseId: "FEmusic_history" }).then((d) => {
      const items = yt.flatItems(d).filter((i) => i.videoId).slice(0, 30);
      fill("ytHistory", items.length ? [ytRow({ title: "Ascoltati di recente su YouTube", items, more: null }, { subtitle: "YouTube Music" })] : []);
    }, () => {
    }));
    if (slots.charts) jobs.push(ytApi("browse", { browseId: "FEmusic_charts" }).then((d) => {
      const charts = [];
      yt.parseSections(d).forEach((s) => s.items.forEach((it) => {
        if (it.kind === "playlist" && !charts.some((c) => c.browseId === it.browseId)) charts.push(it);
      }));
      fill("charts", charts.length ? [ytRow({ title: "Classifiche", items: charts, more: null }, { key: "charts" })] : []);
    }, () => {
    }));
    if (slots.ytHome || slots.sections) {
      if (slots.sections) fill("sections", [node("p", "hint", "Carico le novit\xE0…")]);
      jobs.push(ytApi("browse", { browseId: "FEmusic_home" }).then(async (d) => {
        const sections = yt.parseSections(d).filter((s) => s.items.length);
        // Con l'account le prime cinque sezioni sono "Per te su YouTube".
        const mine = youtubeAccount ? sections.slice(0, 5) : [];
        const rest = youtubeAccount ? sections.slice(5) : sections;
        fill("ytHome", mine.map((s) => ytRow(s, { subtitle: "YouTube Music" })));
        fill("sections", rest.map((s) => ytRow(s)));
        // Le sezioni successive arrivano a pagine: ne aggiungo altre due.
        let next = yt.continuation(d);
        for (let i = 0; i < 2 && next && slots.sections; i++) {
          const page2 = await ytApi("browse", { continuation: next.token, legacy: next.legacy });
          if (mark !== generation) return;
          yt.parseSections(page2).filter((s) => s.items.length).forEach((s) => slots.sections.appendChild(ytRow(s)));
          next = yt.continuation(page2);
        }
      }).catch((e) => fill("sections", [node("p", "hint", "Sorgente online non disponibile: " + e.message)])));
    }
    await Promise.all(jobs);
  }
  content.addEventListener("focusin", (e) => {
    if (page !== "home") return;
    const h = heroes.get(e.target);
    if (h) setHero(h);
  });
  // ── Personalizza Home e Preferiti unificati ─────────────────────────
  function customize(options) {
    show("customize", () => customize({ back: true }), options);
    setHeading("Personalizza Home", "HOME");
    content.textContent = "";
    const order = lib.homeOrder(), hidden = lib.get("hiddenRows", []), first = lib.get("startSection", null);
    order.forEach((k, i) => {
      const r = node("div", "setting"), label = node("div", "label");
      label.appendChild(node("strong", "", homeRows[k]));
      label.appendChild(node("p", "", [hidden.indexOf(k) >= 0 ? "Nascosta" : "Visibile", first === k ? "si apre per prima" : ""].filter(Boolean).join(" \xB7 ")));
      r.appendChild(label);
      const actions = node("div", "setting-buttons");
      actions.appendChild(button(hidden.indexOf(k) >= 0 ? "Mostra" : "Nascondi", () => keep(() => {
        lib.toggleRow(k);
        customize({ back: true });
      }), "", "row:" + k + ":toggle"));
      if (i > 0) actions.appendChild(button("Sposta su", () => keep(() => {
        lib.moveRowUp(k);
        customize({ back: true });
      }), "", "row:" + k + ":up"));
      actions.appendChild(button("Apri all’avvio qui", () => keep(() => {
        lib.set("startSection", k);
        customize({ back: true });
      }), "", "row:" + k + ":first"));
      r.appendChild(actions);
      content.appendChild(r);
    });
    content.appendChild(node("h2", "page-title", "Elementi fissati"));
    lib.pins().forEach((p, i) => {
      const r = node("div", "setting"), label = node("div", "label");
      label.appendChild(node("strong", "", p.title));
      label.appendChild(node("p", "", p.subtitle));
      r.appendChild(label);
      const actions = node("div", "setting-buttons");
      if (i > 0) actions.appendChild(button("Sposta su", () => keep(() => {
        lib.movePin(i, -1);
        customize({ back: true });
      }), "", "pin:" + p.id + ":up"));
      actions.appendChild(button("Rimuovi", () => keep(() => {
        lib.togglePin(p);
        customize({ back: true });
      }), "", "pin:" + p.id + ":remove"));
      r.appendChild(actions);
      content.appendChild(r);
    });
    content.appendChild(node("p", "hint", "Tieni premuto OK su una copertina per fissarla alla Home o salvarla nei preferiti."));
    focusFirst();
  }
  function favoritesPage(options) {
    show("unified", () => favoritesPage({ back: true }), options);
    setHeading("Preferiti unificati", "BLOOMEE SU LG");
    content.textContent = "";
    content.appendChild(node("p", "hint", "Ogni elemento conserva tutte le versioni salvate e una sorgente preferita. Nessuna scrittura sul tuo account YouTube."));
    const groups = lib.favorites();
    if (!groups.length) content.appendChild(node("p", "empty", "Nessun preferito. Tieni premuto OK su un brano o una copertina e scegli Salva nei preferiti unificati."));
    const redraw = () => keep(() => favoritesPage({ back: true }));
    groups.forEach((g) => {
      const box = node("section", "favorite-group");
      g.variants.forEach((ref) => {
        const r = node("div", "setting"), label = node("div", "label");
        label.appendChild(node("strong", "", ref.title));
        label.appendChild(node("p", "", ref.subtitle + " \xB7 " + (ref.source === "youtube" ? "YouTube" : "Jellyfin")));
        r.appendChild(label);
        const actions = node("div", "setting-buttons");
        actions.appendChild(button("Riproduci / apri", () => openRef(ref), "", "fav:" + ref.id + ":open"));
        actions.appendChild(button(g.preferred === ref.id ? "✓ Sorgente preferita" : "Preferisci questa sorgente", () => {
          lib.prefer(g.identity, ref.id);
          redraw();
        }, "", "fav:" + ref.id + ":prefer"));
        actions.appendChild(button("Separa versione", () => {
          lib.split(g.identity, ref.id);
          redraw();
        }, "", "fav:" + ref.id + ":split"));
        actions.appendChild(button("Fissa / rimuovi Home", () => {
          notify(lib.togglePin(ref) ? "Fissato nella Home" : "Rimosso dalla Home");
        }, "", "fav:" + ref.id + ":pin"));
        r.appendChild(actions);
        box.appendChild(r);
      });
      const actions = node("div", "actions");
      actions.appendChild(button("Rimuovi preferito", () => {
        lib.removeFavorite(g.identity);
        updateLike();
        redraw();
      }, "", "group:" + g.identity + ":remove"));
      actions.appendChild(button("Unisci a un altro preferito", async () => {
        const choices = lib.favorites().filter((o) => o.identity !== g.identity);
        if (!choices.length) return notify("Non ci sono altri preferiti");
        const target = await choose("Scegli il preferito di destinazione", choices.map((o) => [o.identity, o.variants[0].title]));
        if (target) {
          lib.merge(g.identity, target);
          redraw();
        }
      }, "", "group:" + g.identity + ":merge"));
      box.appendChild(actions);
      content.appendChild(box);
    });
    focusFirst();
  }
  // ── Ricerca ─────────────────────────────────────────────────────────
  const searchState = createSearch({ timeout: 12e3 });
  let lastSearch = "", searchGeneration = 0;
  const savedFilters = lib.get("searchFilters", {});
  const filters = { source: savedFilters.source || "Tutte", kind: savedFilters.kind || "Tutto", alphabetical: !!savedFilters.alphabetical, year: null, version: "", group: true, open: false, allSongs: false };
  const jfKinds = { Brani: ["Audio"], Artisti: ["MusicArtist"], Album: ["MusicAlbum"] };
  function ytSearchProvider(kind) {
    let token = null;
    const tokens = {};
    const page2 = async (q) => {
      const d = await ytApi("search", token ? { continuation: token.token, legacy: token.legacy } : { query: q, params: yt.searchParams[kind] });
      const r = yt.searchPage(d);
      token = r.next && !tokens[r.next.token] ? r.next : null;
      if (token) tokens[token.token] = true;
      return { items: r.items.map(yt.toRef).filter(Boolean), more: token ? page2 : null };
    };
    return page2;
  }
  function jfSearchProvider(kinds) {
    let offset = 0;
    const page2 = async (q) => {
      const pages = await Promise.all(kinds.map((kind) => api("/api/library", { kind, search: q, start: offset, limit: 20 })));
      offset += 20;
      const items = [];
      pages.forEach((d, i) => d.Items.forEach((it) => items.push(jfRef(it, kinds[i] === "Audio" ? "track" : kinds[i] === "MusicArtist" ? "artist" : "album"))));
      return { items, more: pages.some((d) => d.Items.length === 20) ? page2 : null };
    };
    return page2;
  }
  function runSearch() {
    const q = lastSearch.trim();
    filters.allSongs = false;
    if (filters.source === "Jellyfin" && !jellyfin) filters.source = "Tutte";
    lib.set("searchFilters", { source: filters.source, kind: filters.kind, alphabetical: filters.alphabetical });
    if (!q) return searchState.clear();
    const providers = {}, deferred = {}, kind = filters.kind, source = filters.source;
    if (source === "Tutte" || source === "YouTube") {
      const kinds = kind === "Tutto" ? ["Brani", "Artisti", "Album", "Playlist"] : [kind];
      kinds.forEach((type) => {
        (kind === "Tutto" && (type === "Album" || type === "Playlist") ? deferred : providers)["YouTube \xB7 " + type] = ytSearchProvider({ Brani: "song", Artisti: "artist", Album: "album", Playlist: "playlist" }[type]);
      });
    }
    if (jellyfin && (source === "Tutte" || source === "Jellyfin") && kind !== "Playlist") {
      const groups = kind === "Tutto" ? { "Brani e artisti": ["Audio", "MusicArtist"], Album: ["MusicAlbum"] } : { [kind]: jfKinds[kind] };
      Object.keys(groups).forEach((g) => {
        (kind === "Tutto" && g === "Album" ? deferred : providers)["Jellyfin \xB7 " + g] = jfSearchProvider(groups[g]);
      });
    }
    searchState.search(q, providers, deferred);
  }
  function search() {
    setHeading("Cerca", "JELLYFIN E YOUTUBE MUSIC");
    content.textContent = "";
    const mark = ++searchGeneration;
    const row = node("div", "search-row"), input = node("input");
    input.placeholder = "Artista, album o brano";
    input.setAttribute("aria-label", "Artista, album o brano");
    input.value = lastSearch;
    input.dataset.key = "search:input";
    input.dataset.autofocus = "";
    const submit = () => {
      lastSearch = input.value;
      runSearch();
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.stopPropagation();
        submit();
      }
    };
    row.appendChild(input);
    row.appendChild(button("⌕ Cerca", submit, "primary", "search:go"));
    content.appendChild(row);
    const kinds = node("div", "actions chips");
    ["Tutto", "Brani", "Album", "Artisti"].forEach((k) => {
      const b = button(k, () => {
        filters.kind = k;
        paint();
        runSearch();
      }, "", "kind:" + k);
      kinds.appendChild(b);
    });
    const filterButton = button("", () => {
      filters.open = !filters.open;
      paint();
    }, "", "filters");
    kinds.appendChild(filterButton);
    content.appendChild(kinds);
    const panel = node("div", "filters-panel");
    content.appendChild(panel);
    const status = node("div", "search-status"), results = node("div", "search-results");
    content.appendChild(status);
    content.appendChild(results);
    function paint() {
      if (mark !== searchGeneration || page !== "search") return;
      keep(() => {
        kinds.querySelectorAll("button").forEach((b) => {
          const k = keyOf(b).slice(5);
          if (b !== filterButton) b.setAttribute("aria-pressed", String(k === filters.kind));
        });
        filterButton.textContent = "☰ Filtri \xB7 " + filters.source + (filters.kind === "Playlist" ? " \xB7 Playlist" : "");
        filterButton.setAttribute("aria-expanded", String(filters.open));
        panel.textContent = "";
        panel.hidden = !filters.open;
        if (filters.open) {
          const sources = node("div", "actions chips");
          ["Tutte", "YouTube"].concat(jellyfin ? ["Jellyfin"] : []).forEach((s) => {
            const b = button(s, () => {
              filters.source = s;
              paint();
              runSearch();
            }, "", "source:" + s);
            b.setAttribute("aria-pressed", String(s === filters.source));
            sources.appendChild(b);
          });
          panel.appendChild(sources);
          const more2 = node("div", "actions chips");
          const playlist = button("Playlist", () => {
            filters.kind = "Playlist";
            paint();
            runSearch();
          }, "", "kind:Playlist");
          playlist.setAttribute("aria-pressed", String(filters.kind === "Playlist"));
          more2.appendChild(playlist);
          more2.appendChild(button(filters.alphabetical ? "Ordine A–Z" : "Ordine sorgente", () => {
            filters.alphabetical = !filters.alphabetical;
            lib.set("searchFilters", { source: filters.source, kind: filters.kind, alphabetical: filters.alphabetical });
            paint();
          }, "", "alpha"));
          more2.appendChild(button("Anno: " + (filters.year == null ? "tutti" : filters.year), async () => {
            const v = await promptDialog("Anno (vuoto per tutti)", filters.year == null ? "" : String(filters.year));
            if (v == null) return;
            filters.year = /^\d{4}$/.test(v) ? Number(v) : null;
            paint();
          }, "", "year"));
          more2.appendChild(button(filters.version ? "Versione: " + filters.version : "Versione: tutte", async () => {
            const v = await promptDialog("Testo nel titolo: live, remix, remaster…", filters.version);
            if (v == null) return;
            filters.version = v;
            paint();
          }, "", "version"));
          more2.appendChild(button(filters.group ? "✓ Raggruppa versioni" : "Mostra tutte le versioni", () => {
            filters.group = !filters.group;
            paint();
          }, "", "group"));
          panel.appendChild(more2);
          if (filters.year != null) panel.appendChild(node("p", "hint", "Il filtro anno include solo i risultati che dichiarano un anno."));
        }
        const st = searchState.state;
        status.textContent = "";
        if (st.loading.length) status.appendChild(node("p", "hint", "Ricerca in corso: " + st.loading.join(", ") + "…"));
        Object.keys(st.errors).forEach((k) => {
          const r = node("div", "search-error");
          r.appendChild(node("span", "", k + ": " + st.errors[k]));
          r.appendChild(button("Riprova", runSearch, "", "retry:" + k));
          status.appendChild(r);
        });
        renderResults();
      });
    }
    function renderResults() {
      results.textContent = "";
      const st = searchState.state;
      const shown = filterHits(searchState.hits, { kind: filters.kind, year: filters.year, version: filters.version, alphabetical: filters.alphabetical });
      const groups = filters.group ? groupVariants(shown) : shown.map((h) => [h]);
      if (!st.query) return results.appendChild(node("p", "hint", "Premi OK sulla barra per scrivere."));
      if (!groups.length && !st.loading.length) return results.appendChild(node("p", "hint", "Nessun risultato con questi filtri."));
      const label = (v) => v.map((h) => h.source).filter((s, i, a) => a.indexOf(s) === i).join(" / ");
      const songs = groups.filter((g) => g[0].kind === "Brani");
      if (songs.length) {
        results.appendChild(node("h3", "", "Brani"));
        const list = node("div", "yt-list");
        (filters.allSongs ? songs : songs.slice(0, 4)).forEach((v, i) => {
          const ref = v[0].ref;
          const n = button("", () => openVariants(v), "track", "hit:" + ref.id);
          n.appendChild(node("span", "number", String(i + 1)));
          const t = node("span", "track-title");
          t.appendChild(node("strong", "", ref.title));
          t.appendChild(node("small", "", ref.subtitle + " \xB7 " + label(v)));
          n.appendChild(t);
          if (ref.duration) n.appendChild(node("span", "duration", duration(ref.duration)));
          menus.set(n, ref);
          list.appendChild(n);
        });
        results.appendChild(list);
        if (songs.length > 4) results.appendChild(button(filters.allSongs ? "Mostra meno brani" : "Tutti i " + songs.length + " brani", () => {
          filters.allSongs = !filters.allSongs;
          keep(renderResults);
        }, "", "all-songs"));
      }
      ["Artisti", "Album", "Playlist"].forEach((kind) => {
        const row2 = groups.filter((g) => g[0].kind === kind);
        if (!row2.length) return;
        results.appendChild(shelfRow(kind, row2.map((v) => {
          const ref = v[0].ref;
          const c = card({ title: ref.title, subtitle: ref.subtitle + " \xB7 " + label(v) + (v.length > 1 ? " \xB7 " + v.length + " versioni" : ""), image: refImage(ref), circle: ref.kind === "artist", onTap: () => openVariants(v), ref, key: "hit:" + ref.id });
          return c;
        }), { key: "results:" + kind }));
      });
      const keys = Object.keys(st.more);
      if (keys.length) {
        const bar = node("div", "actions chips");
        keys.forEach((k) => {
          const b = button("▾ Altri risultati \xB7 " + k, () => searchState.loadMore(k), "", "more:" + k);
          b.disabled = st.loading.indexOf(k) >= 0;
          bar.appendChild(b);
        });
        results.appendChild(bar);
      }
    }
    searchState.onChange(paint);
    paint();
    focusFirst();
    if (lastSearch && !searchState.state.query) runSearch();
  }
  async function openVariants(variants) {
    if (variants.length === 1) return openRef(variants[0].ref);
    const id = await choose(variants[0].ref.title, variants.map((h) => [h.ref.id, h.source + " \xB7 " + h.ref.subtitle]));
    const hit = variants.find((h) => h.ref.id === id);
    if (hit) openRef(hit.ref);
  }
  // ── Il mio YouTube ──────────────────────────────────────────────────
  const ytTabs = [["forYou", "Per te"], ["history", "Cronologia"], ["liked", "Mi piace"], ["playlists", "Playlist"], ["albums", "Album"], ["artists", "Artisti"]];
  async function ytLibrary(mark) {
    setHeading("Il mio YouTube", youtubeAccount ? (youtubeName || "Account Google").toUpperCase() : "YOUTUBE MUSIC");
    content.textContent = "";
    if (!youtubeAccount) {
      const note = node("article", "info-copy");
      note.appendChild(node("h2", "", "Collega il tuo account"));
      note.appendChild(node("p", "", "Collega il tuo account YouTube Music per vedere cronologia, Mi piace, playlist e artisti seguiti."));
      note.appendChild(node("p", "", "Sulla LG l'accesso a Google si completa dal telefono o dal computer: la TV mostra un indirizzo e un codice."));
      content.appendChild(note);
      const login = button("Accedi con Google", pairYouTube, "primary", "yt:login");
      login.dataset.autofocus = "";
      content.appendChild(login);
      return focusFirst();
    }
    const tabs = node("div", "actions tabs"), body = node("div");
    ytTabs.forEach(([id, label]) => {
      const b = button(label, () => {
        ytTab = id;
        keep(() => navigate("youtube", { back: true }));
      }, "", "tab:" + id);
      b.setAttribute("aria-pressed", String(ytTab === id));
      if (ytTab === id) b.dataset.autofocus = "";
      tabs.appendChild(b);
    });
    content.appendChild(tabs);
    content.appendChild(body);
    body.appendChild(node("p", "empty", "Carico…"));
    const label = ytTabs.filter((t) => t[0] === ytTab)[0][1];
    try {
      if (ytTab === "forYou") {
        const sections = yt.parseSections(await ytApi("browse", { browseId: "FEmusic_home" }));
        if (mark !== generation) return;
        body.textContent = "";
        sections.forEach((s) => body.appendChild(ytRow(s)));
        if (!sections.length) body.appendChild(node("p", "empty", "Niente da mostrare"));
      } else {
        const browseId = { history: "FEmusic_history", liked: "VLLM", playlists: "FEmusic_liked_playlists", albums: "FEmusic_liked_albums", artists: "FEmusic_library_corpus_artists" }[ytTab];
        let items = (await ytAll("browse", { browseId })).items;
        if (mark !== generation) return;
        if (ytTab === "playlists") items = items.filter((i) => i.browseId);
        if (ytTab === "artists") items = items.filter((i) => i.browseId && i.browseId.indexOf("UC") === 0);
        body.textContent = "";
        if (!items.length) body.appendChild(node("p", "empty", "Niente da mostrare"));
        else if (items.some((i) => i.kind === "song")) ytSongs(items, body);
        else ytGrid(items, body, label);
      }
    } catch (e) {
      if (mark !== generation) return;
      body.textContent = "";
      body.appendChild(node("p", "empty", e.message));
    }
    focusFirst();
  }
  // ── Artista ─────────────────────────────────────────────────────────
  async function openYtArtist(browseId, name, options) {
    const mark = show("yt-artist:" + browseId, () => openYtArtist(browseId, name, { back: true }), options);
    setHeading(name || "Artista", "ARTISTA");
    loading("Carico l'artista…");
    let info;
    try {
      info = yt.artistInfo(await ytApi("browse", { browseId }));
    } catch (e) {
      return ytFail(mark, e, () => openYtArtist(browseId, name, { back: true }));
    }
    if (mark !== generation) return;
    const artistName = info.name || name || "Artista";
    setHeading(artistName, "ARTISTA");
    content.textContent = "";
    const songSections = info.sections.filter((s) => s.items.length && s.items.every((i) => i.kind === "song"));
    const topSection = songSections.filter((s) => s.more)[0] || songSections[0];
    const top = topSection ? topSection.items : [];
    const sections = info.sections.filter((s) => s.items.length && !s.items.every((i) => i.kind === "song"));
    const all = [], seen = {};
    const addSongs = (items) => items.forEach((it) => {
      if (it.videoId && !seen[it.videoId]) {
        seen[it.videoId] = true;
        all.push(it);
      }
    });
    addSongs(top);
    if (info.banner) {
      const banner = node("div", "artist-banner");
      banner.appendChild(picture(info.banner));
      content.appendChild(banner);
    }
    const head = node("div", "artist-head");
    const photo = picture(info.banner);
    head.appendChild(photo);
    const about = node("div", "artist-about");
    const facts = [info.monthlyListeners, info.subscribers ? info.subscribers + " iscritti" : null].filter(Boolean).join(" \xB7 ");
    if (facts) about.appendChild(node("p", "facts", facts));
    const bio = info.description || "";
    if (bio) about.appendChild(node("p", "bio", bio));
    const actions = node("div", "actions");
    const playAll = button("", () => ytPlay(all, 0), "primary", "artist:play");
    playAll.dataset.autofocus = "";
    const shuffleAll = button("⇄ Casuale", () => ytPlay(all, 0, true), "", "artist:shuffle");
    actions.appendChild(playAll);
    actions.appendChild(shuffleAll);
    if (bio.length > 120) actions.appendChild(button("ⓘ Biografia", () => openDialog(artistName, (d) => {
      d.body.appendChild(node("p", "bio-full", bio));
      const close = button("Chiudi", () => d.close(), "primary");
      close.dataset.autofocus = "";
      d.actions.appendChild(close);
    }), "", "artist:bio"));
    about.appendChild(actions);
    head.appendChild(about);
    content.appendChild(head);
    const topRow = node("div");
    content.appendChild(topRow);
    sections.forEach((s) => content.appendChild(ytRow(s, { moreSubtitle: artistName })));
    const allTitle = node("h3", "page-title");
    const grid = node("div", "track-grid");
    const status = node("p", "hint");
    content.appendChild(allTitle);
    content.appendChild(status);
    content.appendChild(grid);
    let pages = 0, token = null, busy = false, done = false;
    // Brani più famosi + "Tutti i brani" dalla ricerca, filtrati sull'artista.
    const target = normalize(artistName);
    const byArtist = (it) => it.artists.some((a) => a.id === browseId || normalize(a.name) === target || target.length >= 4 && normalize(a.name).split(" ").indexOf(target) >= 0);
    function paintSongs() {
      playAll.textContent = "▶ Riproduci tutto (" + all.length + ")";
      playAll.disabled = shuffleAll.disabled = !all.length;
      if (!topRow.firstChild && all.length) {
        topRow.appendChild(shelfRow("Brani pi\xF9 famosi", all.slice(0, 20).map((it) => card({ title: it.title, subtitle: it.album ? it.album.name : artistName, image: it.thumbnail, badge: true, onTap: () => ytPlay(all, all.indexOf(it)), ref: yt.toRef(it), key: "top:" + it.videoId })), { onTitle: topSection && topSection.more ? () => openYtAll(topSection.title, artistName, topSection.more.browseId, topSection.more.params) : null, key: "top" }));
      }
      const extra = all.slice(top.length);
      allTitle.textContent = extra.length || busy ? "Tutti i brani" + (extra.length ? " (" + extra.length + (token ? "+" : "") + ")" : "") : "";
      status.textContent = busy && !extra.length ? "Cerco altri brani…" : "";
      for (let i = grid.children.length; i < extra.length; i++) {
        const t = yt.toTrack(extra[i]);
        const it = extra[i];
        const n = trackRow(t, 0, [t], { index: top.length + i + 1, subtitle: it.album ? it.album.name : "", key: "all:" + it.videoId, onTap: () => ytPlay(all, all.indexOf(it)) });
        n.addEventListener("focus", () => {
          if (Array.prototype.indexOf.call(grid.children, n) >= grid.children.length - 6) loadSongs();
        });
        grid.appendChild(n);
      }
    }
    async function loadSongs() {
      if (busy || done || pages >= 15 || mark !== generation) return;
      busy = true;
      paintSongs();
      try {
        const d = await ytApi("search", token ? { continuation: token.token, legacy: token.legacy } : { query: artistName, params: yt.searchParams.song });
        if (mark !== generation) return;
        pages++;
        const r = yt.searchPage(d);
        addSongs(r.items.filter((it) => it.kind === "song" && byArtist(it)));
        token = r.next;
        if (!token) done = true;
      } catch (_) {
        done = true;
      } finally {
        busy = false;
      }
      if (mark !== generation) return;
      paintSongs();
      // Pochi brani dell'artista nella prima pagina: ne carico subito altri.
      if (all.length - top.length < 40) loadSongs();
    }
    paintSongs();
    focusFirst();
    loadSongs();
  }
  // ── Album e playlist ────────────────────────────────────────────────
  async function openYtCollection(browseId, name, options) {
    const mark = show("yt-list:" + browseId, () => openYtCollection(browseId, name, { back: true }), options);
    const album = browseId.indexOf("MPREb") === 0;
    setHeading(album ? "Album" : "Playlist", "YOUTUBE MUSIC");
    loading("Carico…");
    try {
      const all = await ytAll("browse", { browseId });
      if (mark !== generation) return;
      const info = yt.collectionInfo(all.first);
      const items = yt.fillCollectionTracks(all.items, info, browseId), tracks = items.map(yt.toTrack);
      const title = info.title || name || "";
      content.textContent = "";
      const detail = node("div", "detail"), cover = node("div", "cover-column"), list = node("div", "detail-list");
      cover.appendChild(picture(info.thumbnail || items[0] && items[0].thumbnail));
      cover.appendChild(node("h2", "", title));
      cover.appendChild(node("p", "", [info.subtitle, items.length + " brani"].filter(Boolean).join(" \xB7 ")));
      const actions = node("div", "actions");
      const play = button("▶ Riproduci", () => ytPlay(items, 0), "primary", "list:play");
      play.dataset.autofocus = "";
      const mix = button("⇄ Casuale", () => ytPlay(items, 0, true), "", "list:shuffle");
      play.disabled = mix.disabled = !items.length;
      actions.appendChild(play);
      actions.appendChild(mix);
      actions.appendChild(button("+ In coda", () => {
        queue = queue.concat(tracks);
        notify(tracks.length + " brani aggiunti alla coda");
      }, "", "list:queue"));
      list.appendChild(actions);
      tracks.forEach((t, i) => list.appendChild(trackRow(t, i, tracks, { index: i + 1, subtitle: album ? null : t.Artists.join(", "), key: "song:" + i })));
      if (!items.length) list.appendChild(node("p", "empty", "Niente da mostrare"));
      detail.appendChild(cover);
      detail.appendChild(list);
      content.appendChild(detail);
      focusFirst();
    } catch (e) {
      ytFail(mark, e, () => openYtCollection(browseId, name, { back: true }));
    }
  }
  // ── Elenco completo di una sezione (TvYtAllScreen) ──────────────────
  async function openYtAll(title, subtitle, browseId, params, options) {
    const mark = show("yt-all:" + browseId + ":" + (params || ""), () => openYtAll(title, subtitle, browseId, params, { back: true }), options);
    setHeading(title || "YouTube Music", subtitle ? subtitle.toUpperCase() : "YOUTUBE MUSIC");
    loading("Carico tutto…");
    try {
      const items = (await ytAll("browse", params ? { browseId, params } : { browseId })).items;
      if (mark !== generation) return;
      const songs = items.length && items.filter((i) => i.kind === "song").length > items.length / 2;
      const what = songs ? "brani" : items.every((i) => i.kind === "artist") ? "artisti" : items.every((i) => i.kind === "album") ? "uscite" : "elementi";
      setHeading(title || "YouTube Music", [subtitle, items.length + " " + what].filter(Boolean).join(" \xB7 ").toUpperCase());
      content.textContent = "";
      if (!items.length) empty("Niente da mostrare");
      else if (songs) ytSongs(items.filter((i) => i.kind === "song"), content, "Riproduci");
      else ytGrid(items, content, title);
      focusFirst();
    } catch (e) {
      ytFail(mark, e, () => openYtAll(title, subtitle, browseId, params, { back: true }));
    }
  }
  // Pagine senza tipo (generi e mood, podcast): righe o elenco completo.
  async function openYtBrowse(browseId, params, name, options) {
    const mark = show("yt-browse:" + browseId + ":" + (params || ""), () => openYtBrowse(browseId, params, name, { back: true }), options);
    setHeading(name || "YouTube Music", "YOUTUBE MUSIC");
    loading("Carico…");
    try {
      const body = params ? { browseId, params } : { browseId };
      const sections = yt.parseSections(await ytApi("browse", body)).filter((s) => s.items.length);
      if (mark !== generation) return;
      if (sections.length > 1) {
        content.textContent = "";
        sections.forEach((s) => content.appendChild(ytRow(s)));
        return focusFirst();
      }
      return openYtAll(name, null, browseId, params, { back: true });
    } catch (e) {
      ytFail(mark, e, () => openYtBrowse(browseId, params, name, { back: true }));
    }
  }
  // ── Account YouTube ─────────────────────────────────────────────────
  async function checkYouTube() {
    try {
      const health = await api("/health");
      youtubeAccount = !!health.youtube;
      youtubeName = null;
      youtubeMessage = null;
      if (youtubeAccount) {
        youtubeName = yt.accountName(await ytApi("account/account_menu", {}));
        youtubeMessage = youtubeName ? "Collegato come " + youtubeName : "Accesso scaduto: accedi di nuovo";
      }
    } catch (e) {
      youtubeMessage = "YouTube non risponde: " + e.message;
    }
    updateConnection();
    return youtubeAccount;
  }
  function accountChanged() {
    ytCache.clear();
    if (view && (page === "settings" || page === "youtube" || page === "home")) keep(view.render);
  }
  // Accesso dal telefono o dal computer: la TV apre per cinque minuti una
  // pagina sulla rete di casa protetta da un codice.
  async function pairYouTube() {
    let started;
    try {
      started = await api("/yt/pair/start", null, "POST");
    } catch (e) {
      return notify(e.message);
    }
    let timer = null, done = false;
    openDialog("Accedi a YouTube Music", (d) => {
      d.body.appendChild(node("p", "", "Sul telefono o sul computer, connesso alla stessa rete, apri:"));
      d.body.appendChild(node("p", "pair-url", started.url));
      d.body.appendChild(node("p", "", "Codice da inserire:"));
      d.body.appendChild(node("p", "pair-code", started.code.slice(0, 3) + " " + started.code.slice(3)));
      const state = node("p", "hint", "In attesa… La pagina spiega come copiare il cookie di music.youtube.com.");
      d.body.appendChild(state);
      const close = button("Chiudi abbinamento", () => d.close(), "", "pair:close");
      close.dataset.autofocus = "";
      d.actions.appendChild(close);
      const deadline = Date.now() + started.seconds * 1e3;
      const poll = async () => {
        if (d.closed) return;
        try {
          const s = await api("/yt/pair/status");
          if (s.name) {
            done = true;
            d.close();
            await checkYouTube();
            notify("YouTube Music collegato: " + (youtubeName || s.name));
            return accountChanged();
          }
          if (!s.active) {
            state.textContent = s.error || "Abbinamento scaduto. Chiudi e scegli di nuovo Accedi.";
            return;
          }
          state.textContent = "In attesa… Scade tra " + Math.max(0, Math.round((deadline - Date.now()) / 1e3)) + " secondi.";
        } catch (_) {
        }
        timer = setTimeout(poll, 2e3);
      };
      timer = setTimeout(poll, 2e3);
    }, { onClose: () => {
      clearTimeout(timer);
      if (!done) api("/yt/pair/stop", null, "POST").catch(() => {
      });
    } });
  }
  function updateConnection() {
    const c = $("#connection");
    c.textContent = "";
    c.appendChild(node("span", "", jellyfin ? "Jellyfin collegato" : "Jellyfin non collegato"));
    c.appendChild(node("span", "", youtubeAccount ? "YouTube: " + (youtubeName || "account collegato") : "YouTube Music senza account"));
  }
  // ── Impostazioni ────────────────────────────────────────────────────
  function settings() {
    setHeading("Impostazioni", "BLOOMEE SU LG");
    content.textContent = "";
    function row(title, description, control) {
      const n = node("div", "setting"), label = node("div", "label");
      label.appendChild(node("strong", "", title));
      if (description) label.appendChild(node("p", "", description));
      n.appendChild(label);
      if (control) n.appendChild(control);
      content.appendChild(n);
      return n;
    }
    const choices = [[0, "Mai"], [15, "15 secondi"], [30, "30 secondi"], [60, "1 minuto"], [120, "2 minuti"], [300, "5 minuti"]];
    const valueLabel = () => {
      const choice = choices.find((c) => c[0] === prefs.screenOff);
      return choice ? choice[1] : "Mai";
    };
    const choiceButton = button(valueLabel() + "  ›", () => {
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
          savePrefs({ screenOff: value });
          screen.configure(value);
          choiceButton.textContent = valueLabel() + "  ›";
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
    }, "", "set:jellyfin"));
    // Account YouTube Music: Accedi / Cambia account, Verifica, Esci.
    const ytButtons = node("div", "setting-buttons");
    const login = button(youtubeAccount ? "Cambia account" : "Accedi con Google", pairYouTube, "primary", "set:yt-login");
    ytButtons.appendChild(login);
    if (youtubeAccount) {
      ytButtons.appendChild(button("Verifica", async () => {
        youtubeMessage = "Verifico l'accesso…";
        keep(settings);
        await checkYouTube();
        keep(settings);
      }, "", "set:yt-check"));
      ytButtons.appendChild(button("Esci", async () => {
        if (!await confirmDialog("Uscire da YouTube Music?", "Cronologia e playlist del tuo account non saranno pi\xF9 visibili finch\xE9 non accedi di nuovo.", "Esci")) return;
        try {
          await api("/yt/logout", null, "POST");
        } catch (e) {
          return notify(e.message);
        }
        await checkYouTube();
        accountChanged();
        const n = content.querySelector('[data-key="set:yt-login"]');
        if (n) n.focus();
      }, "", "set:yt-logout"));
    }
    row("Account YouTube Music", youtubeAccount ? (youtubeName || "Account Google") + " \xB7 Accesso salvato su questo dispositivo" + (youtubeMessage ? ". " + youtubeMessage : "") : "Accedi con Google per avere cronologia, Mi piace, playlist e artisti seguiti nel menu \"Il mio YouTube\" e nella Home. L'accesso si completa dal telefono o dal computer.", ytButtons);
    row("Riproduzione automatica", "Verso la fine della coda aggiunge brani simili da YouTube Music.", button(prefs.autoPlay === false ? "Disattivata" : "Attiva", () => {
      savePrefs({ autoPlay: prefs.autoPlay === false });
      radioFor = null;
      keep(settings);
    }, "", "set:autoplay"));
    row("Home", "Ordine delle righe, righe nascoste e elementi fissati.", button("Personalizza", customize, "", "set:customize"));
    const info = button("Informazioni su Bloomee", () => {
      showInfo();
    }, "", "set:info");
    info.id = "bloomee-info";
    row("Informazioni e compatibilit\xE0", "Funzioni disponibili su LG e differenze dalla versione Android TV.", info);
    focusFirst();
  }
  function showInfo() {
    setHeading("Informazioni", "BLOOMEE SU LG \xB7 0.3.0");
    content.textContent = "";
    const note = node("article", "info-copy");
    note.appendChild(node("h2", "", "La tua musica, sulla LG"));
    note.appendChild(node("p", "", "Home con righe personalizzabili, ricerca unificata con filtri, artisti, album, playlist e classifiche di YouTube Music; Il mio YouTube con cronologia, Mi piace, playlist, album e artisti del tuo account. Album, artisti, brani e preferiti Jellyfin, preferiti unificati, elementi fissati, coda con riproduzione automatica, casuale e ripetizione."));
    note.appendChild(node("h2", "", "Telecomando"));
    note.appendChild(node("p", "", "Frecce per muoverti, OK per scegliere, Indietro per tornare. Tieni premuto OK su una copertina o un brano per fissarlo nella Home, salvarlo nei preferiti o riprodurlo dopo. Sulla barra del brano sinistra e destra spostano di dieci secondi."));
    note.appendChild(node("h2", "", "Schermo e ascolto"));
    note.appendChild(node("p", "", "Sulla LG viene spento solo il pannello. La musica continua e il televisore rimane acceso. Su Android TV si usa uno schermo nero e la luminosit\xE0 minima, perch\xE9 lo spegnimento fisico non \xE8 disponibile alle app su tutte le TV."));
    note.appendChild(node("h2", "", "Differenze dalla versione Android"));
    note.appendChild(node("p", "", "L'accesso Google si completa dal telefono o dal computer. Ricerca vocale di Bloomee, download locali, Lidarr, plugin Android, profili, Cast ed equalizzatore non sono inclusi nel porting LG. Mi piace e preferiti restano sulla TV e non vengono scritti sul tuo account YouTube."));
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
  // ── Tasti ───────────────────────────────────────────────────────────
  const isEnter = (e) => e.key === "Enter" || e.keyCode === 13;
  document.addEventListener("keydown", (e) => {
    const nativeVolume = [447, 448, 449].indexOf(e.keyCode) >= 0;
    const media = [415, 19, 413, 417, 412].indexOf(e.keyCode) >= 0 || e.key === "MediaPlayPause";
    if (!nativeVolume && !media && screen.activity()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    lastKeyAt = Date.now();
    if (media) {
      e.preventDefault();
      if (e.keyCode === 415) audio.play().catch(() => notify("Impossibile riprendere"));
      else if (e.keyCode === 19 || e.keyCode === 413) audio.pause();
      else if (e.keyCode === 417) seekBy(30);
      else if (e.keyCode === 412) seekBy(-10);
      else $("#play").click();
      return;
    }
    if (e.key === "Escape" || e.keyCode === 461) {
      e.preventDefault();
      if (press) {
        clearTimeout(press.timer);
        press = null;
      }
      if (dialog) dialog.close();
      else if (settingsChoice) settingsChoice.close();
      else if (page === "settings" && document.getElementById("settings-info-back")) settings();
      else back();
      return;
    }
    const target = e.target;
    // OK tenuto premuto apre il menu; rilasciato subito è un clic.
    if (isEnter(e) && menus.has(target)) {
      e.preventDefault();
      // Il menu si apre anche se la TV non manda il rilascio del tasto.
      if (!e.repeat && !press) press = { el: target, timer: setTimeout(() => {
        press = null;
        openMenu(target);
      }, 600) };
      return;
    }
    if ((e.keyCode === 403 || e.keyCode === 457) && menus.has(target)) {
      e.preventDefault();
      openMenu(target);
      return;
    }
    if (!/^Arrow/.test(e.key)) return;
    if (target === $("#seek")) {
      e.preventDefault();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") seekBy(e.key === "ArrowRight" ? 10 : -10);
      else move(e.key);
      return;
    }
    if (target.tagName === "INPUT") {
      // Il cursore si muove nel testo; ai bordi, e con su e giù, si esce.
      const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
      const atEnd = target.selectionStart === target.value.length;
      if (e.key === "ArrowLeft" && !atStart || e.key === "ArrowRight" && !atEnd) return;
    }
    e.preventDefault();
    move(e.key);
  }, true);
  document.addEventListener("keyup", (e) => {
    if (!isEnter(e) || !press) return;
    clearTimeout(press.timer);
    const p = press;
    press = null;
    if (document.contains(p.el)) p.el.click();
  }, true);
  document.addEventListener("contextmenu", (e) => {
    const n = e.target.closest && e.target.closest("button");
    if (n && menus.has(n)) {
      e.preventDefault();
      openMenu(n);
    }
  });
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
      setHeading("Bloomee", "BLOOMEE SU LG");
      empty("Collegamento alla musica non disponibile. Verifica Homebrew Channel, poi scegli Riprova.");
      content.appendChild(button("Riprova", boot, "primary"));
      return focusFirst(true);
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
  const transportPaths = { repeat: "M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3", shuffle: "M16 3h5v5 M4 20L21 3 M21 16v5h-5 M4 4l5 5 M15 15l6 6", next: "M18 4v16 M5 4l10 8L5 20z", previous: "M6 4v16 M19 4L9 12l10 8z", like: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8" };
  Object.keys(transportPaths).forEach((id) => {
    $("#" + id).innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + transportPaths[id] + '"/></svg>';
  });
  $("#now-art").onerror = function() {
    this.onerror = null;
    this.src = "placeholder.svg";
  };
  $("#now-art").src = "placeholder.svg";
  $("#hero-art").onerror = function() {
    this.hidden = true;
  };
  window.bloomee = { screen, preferences: () => Object.assign({}, prefs), library: lib };
  setHero(defaultHero);
  boot();
})();
