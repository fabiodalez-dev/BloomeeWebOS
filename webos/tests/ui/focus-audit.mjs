// Audit del focus da telecomando. Apre ogni schermata con dati finti e, su
// ogni controllo, preme le quattro frecce: nessun controllo deve perdere il
// focus, da ogni controllo si deve tornare al menu laterale e tutti i
// controlli della pagina devono essere raggiungibili. Le finestre di dialogo
// devono essere chiuse in sé e chiudersi con Indietro.
// Uso: npm run build && node tests/ui/focus-audit.mjs  (serve Playwright e Chromium).
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as fx from "./fixtures.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "../../index.html");
async function loadPlaywright() {
  for (const name of [process.env.BLOOMEE_PLAYWRIGHT, "playwright", "/opt/node-tools/node_modules/playwright/index.mjs"].filter(Boolean)) {
    try {
      return await import(name);
    } catch (_) {
    }
  }
  throw Error("Playwright non trovato: imposta BLOOMEE_PLAYWRIGHT");
}
const { chromium } = await loadPlaywright();
const executablePath = process.env.BLOOMEE_CHROMIUM || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].filter((p) => fs.existsSync(p))[0];
const browser = await chromium.launch({ executablePath, args: ["--autoplay-policy=no-user-gesture-required", "--disable-web-security"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const shots = process.env.BLOOMEE_SHOTS;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const state = { loggedIn: false, polls: 0, name: "Fabio Test", nextName: "Fabio Test" };
await page.route("http://127.0.0.1:18791/**", async (route) => {
  const u = new URL(route.request().url()), p = u.pathname;
  const json = (data, status) => route.fulfill({ status: status || 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(data) });
  if (p === "/health") return json({ ok: true, version: 3, connected: true, youtube: state.loggedIn });
  if (p === "/yt/api/account/account_menu") return json({ actions: [{ header: { activeAccountHeaderRenderer: { accountName: { runs: [{ text: state.name }] } } } }] });
  if (p.indexOf("/yt/api/") === 0) return json(fx.youtube(p.slice(8), JSON.parse(route.request().postData() || "{}")));
  if (p === "/api/library") return json(fx.jellyfin(u.searchParams));
  if (p === "/yt/pair/start") {
    state.polls = 0;
    return json({ url: "http://192.168.1.50:18793/", code: "123456", seconds: 300 });
  }
  if (p === "/yt/pair/status") {
    if (++state.polls < 2) return json({ active: true });
    state.loggedIn = true;
    state.name = state.nextName;
    return json({ active: false, name: state.name });
  }
  if (p === "/yt/logout") {
    state.loggedIn = false;
    return json({ ok: true });
  }
  if (p.indexOf("/image/") === 0) return route.fulfill({ contentType: "image/svg+xml", body: decodeURIComponent(fx.svg(1).split(",")[1]) });
  if (p === "/yt/audio/" + fx.vid(0)) return json({ error: "Questo video non \xE8 disponibile" }, 404);
  if (p === "/yt/stream/" + fx.vid(0)) return json({ error: "Questo video non \xE8 disponibile" }, 404);
  if (p.indexOf("/audio/") === 0 || p.indexOf("/yt/audio/") === 0) return route.fulfill({ contentType: "audio/wav", headers: { "Access-Control-Allow-Origin": "*" }, body: fx.silence() });
  return json({ ok: true });
});
await page.addInitScript(() => {
  window.PalmServiceBridge = function() {
    this.call = () => setTimeout(() => this.onservicecallback(JSON.stringify({ returnValue: true, stdoutString: JSON.stringify({ port: 18791, key: "test" }) })), 5);
    this.cancel = () => {
    };
  };
});
await page.goto("file://" + app);
const wait = (ms) => page.waitForTimeout(ms);
const problems = [];
let audits = 0;
async function settle() {
  await wait(250);
  await page.waitForFunction(() => !/Carico|Caricamento|Ricerca in corso/.test(document.getElementById("content").textContent) || document.querySelector(".dialog"), null, { timeout: 8e3 }).catch(() => {
  });
  await wait(150);
}
const where = () => page.evaluate(() => {
  const a = document.activeElement;
  return a && a !== document.body ? (a.closest("nav") ? "nav:" : a.closest("footer") ? "footer:" : a.closest(".dialog") ? "dialog:" : "") + (a.getAttribute("aria-label") || a.textContent || a.placeholder || a.id).trim().slice(0, 40) : "(nessuno)";
});
async function key(k, n) {
  for (let i = 0; i < (n || 1); i++) {
    await page.keyboard.press(k);
    await wait(90);
  }
}
// Come un telecomando vero: il tasto tenuto giù continua a mandare OK ripetuti.
async function longPress() {
  await page.keyboard.down("Enter");
  for (let i = 0; i < 12; i++) {
    await wait(80);
    await page.keyboard.down("Enter");
  }
  await wait(150);
  await page.keyboard.up("Enter");
  await wait(200);
}
async function focusOn(selector) {
  await page.evaluate((s) => {
    const n = typeof s === "string" ? document.querySelector(s) : null;
    n.focus();
    n.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, selector);
}
async function focusText(text, scope) {
  const ok = await page.evaluate(([t, s]) => {
    const n = Array.from(document.querySelectorAll((s || "") + " button")).filter((b) => b.textContent.indexOf(t) >= 0 && !b.disabled)[0];
    if (n) n.focus();
    return !!n;
  }, [text, scope]);
  if (!ok) problems.push("controllo non trovato: " + text);
  return ok;
}
// Copertina o brano con questo titolo esatto.
async function enterTitle(title) {
  const ok = await page.evaluate((t) => {
    const n = Array.from(document.querySelectorAll("#content button")).filter((b) => b.querySelector("strong") && b.querySelector("strong").textContent === t)[0];
    if (n) n.focus();
    return !!n;
  }, title);
  if (!ok) return problems.push("copertina non trovata: " + title);
  await key("Enter");
  await settle();
}
async function enter(text, scope) {
  if (text && !await focusText(text, scope)) return;
  await key("Enter");
  await settle();
}
function expect(label, cond, detail) {
  if (!cond) problems.push(label + (detail ? ": " + detail : ""));
}
// Preme le frecce su ogni controllo visibile e controlla il grafo del focus.
async function audit(label) {
  await settle();
  audits++;
  if (shots) await page.screenshot({ path: path.join(shots, String(audits).padStart(2, "0") + "-" + label.replace(/[^a-z0-9]+/gi, "-") + ".png") });
  const before = await page.evaluateHandle(() => document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
  const r = await page.evaluate(() => {
    const dlg = document.querySelector(".dialog");
    const scope = dlg || document;
    const list = Array.from(scope.querySelectorAll('button,input,[tabindex="0"]')).filter((n) => !n.disabled && !n.closest("[hidden]") && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0);
    document.querySelectorAll("[data-fid]").forEach((n) => delete n.dataset.fid);
    list.forEach((n, i) => n.dataset.fid = String(i));
    const start = document.activeElement && document.activeElement.dataset.fid != null ? Number(document.activeElement.dataset.fid) : -1;
    const zone = (n) => n.closest("nav") ? "nav" : n.closest("footer") ? "footer" : n.closest("header") ? "header" : dlg ? "dialog" : "content";
    const name = (n) => zone(n) + ":" + (n.getAttribute("aria-label") || n.textContent || n.placeholder || n.id || n.tagName).trim().replace(/\s+/g, " ").slice(0, 36);
    const edges = [], lost = [];
    list.forEach((n, i) => {
      edges[i] = {};
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].forEach((k) => {
        if (!document.contains(n)) return;
        n.focus();
        if (n.tagName === "INPUT" && n.type !== "range") n.selectionStart = n.selectionEnd = k === "ArrowLeft" ? 0 : n.value.length;
        n.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
        const a = document.activeElement;
        if (!a || a === document.body || !document.contains(a)) lost.push(name(n) + " " + k);
        else if (dlg && !dlg.contains(a)) lost.push(name(n) + " " + k + " esce dalla finestra");
        edges[i][k] = a && a.dataset.fid != null ? Number(a.dataset.fid) : -1;
      });
    });
    return { dialog: !!dlg, names: list.map(name), zones: list.map(zone), edges, lost, start };
  });
  await page.evaluate((n) => n && document.contains(n) && n.focus(), before);
  const reach = (from) => {
    const seen = /* @__PURE__ */ new Set([from]), todo = [from];
    while (todo.length) {
      const i = todo.pop();
      Object.values(r.edges[i] || {}).forEach((j) => {
        if (j >= 0 && !seen.has(j)) {
          seen.add(j);
          todo.push(j);
        }
      });
    }
    return seen;
  };
  r.lost.forEach((l) => problems.push(label + ": focus perso da " + l));
  const n = r.names.length;
  if (!n) return problems.push(label + ": nessun controllo raggiungibile");
  if (r.dialog) {
    for (let i = 0; i < n; i++) {
      const s = reach(i);
      if (s.size < n) problems.push(label + ": nella finestra da " + r.names[i] + " non si raggiunge " + r.names.filter((_, j) => !s.has(j)).join(", "));
    }
  } else {
    const nav = r.zones.map((z, i) => z === "nav" ? i : -1).filter((i) => i >= 0);
    for (let i = 0; i < n; i++) {
      const s = reach(i);
      if (!nav.some((j) => s.has(j))) problems.push(label + ": BLOCCO, da " + r.names[i] + " non si torna al menu");
      if (!r.zones.some((z, j) => z === "footer" && s.has(j))) problems.push(label + ": da " + r.names[i] + " non si raggiunge il player");
    }
    const from = r.start >= 0 ? r.start : r.zones.indexOf("content");
    const s = reach(from);
    const missing = r.names.filter((_, j) => r.zones[j] === "content" && !s.has(j));
    if (missing.length) problems.push(label + ": controlli irraggiungibili: " + missing.slice(0, 8).join(", ") + (missing.length > 8 ? " e altri " + (missing.length - 8) : ""));
  }
  console.log("✓ " + label + " (" + n + " controlli" + (r.dialog ? ", finestra" : "") + ")");
}
const nav = async (pageName) => {
  await page.evaluate((p) => document.querySelector('nav button[data-page="' + p + '"]').focus(), pageName);
  await key("Enter");
  await settle();
};
const heading = () => page.evaluate(() => document.getElementById("heading").textContent);
// ── Percorso ────────────────────────────────────────────────────────────
await settle();
await wait(800);
expect("Home: il focus parte da una copertina", (await where()).indexOf("Brano numero") >= 0 || (await page.evaluate(() => !!document.activeElement.closest(".shelf"))), await where());
expect("Home: la testata segue il focus", (await heading()) !== "Bloomee", await heading());
await audit("Home senza account");
await key("ArrowRight", 3);
const heroTitle = await heading();
expect("Home: destra resta nella riga", await page.evaluate(() => !!document.activeElement.closest(".shelf")));
const pinsBefore = await page.evaluate(() => window.bloomee.library.pins().length);
await longPress();
expect("OK prolungato apre il menu", await page.evaluate(() => !!document.querySelector(".dialog")));
expect("OK ripetuti non scelgono da soli la prima voce del menu", (await page.evaluate(() => window.bloomee.library.pins().length)) === pinsBefore);
await audit("Menu OK prolungato");
await key("Escape");
expect("Indietro chiude il menu e il focus torna alla copertina", await page.evaluate(() => !document.querySelector(".dialog") && !!document.activeElement.closest(".shelf")));
expect("La testata resta sulla copertina", (await heading()) === heroTitle);
await longPress();
await enter("Fissa / rimuovi dalla Home", ".dialog");
await settle();
expect("Fissati compare nella Home", await page.evaluate(() => /Fissati/.test(document.getElementById("content").textContent)));
await longPress();
await enter("Salva nei preferiti unificati", ".dialog");
await enter("Personalizza");
await audit("Personalizza Home");
await focusText("Nascondi");
const hideKey = await page.evaluate(() => document.activeElement.dataset.key);
await key("Enter");
await settle();
expect("Nascondi: il focus resta sul pulsante", await page.evaluate((k) => document.activeElement.dataset.key === k && document.activeElement.textContent === "Mostra", hideKey), await where());
await key("Enter");
await settle();
await key("Escape");
await settle();
await enter("Preferiti unificati");
await audit("Preferiti unificati");
await focusText("Unisci");
await key("Enter");
await settle();
await key("Escape");
await settle();
await key("Escape");
await settle();
expect("Indietro torna alla Home", (await page.evaluate(() => document.querySelector("nav button.selected").dataset.page)) === "home");
// Ricerca
await nav("search");
await audit("Cerca vuota");
expect("Cerca: il focus parte dalla barra", await page.evaluate(() => document.activeElement.tagName === "INPUT"));
await page.keyboard.type("laura pausini");
await key("Enter");
await settle();
await wait(500);
await audit("Cerca con risultati");
await focusOn("#content input");
await key("ArrowDown");
expect("Cerca: gi\xF9 esce dalla barra di testo", await page.evaluate(() => document.activeElement.tagName !== "INPUT"));
await enter("Filtri");
await audit("Cerca con filtri aperti");
await enter("Anno:");
await audit("Finestra Anno");
await key("Escape");
expect("Indietro chiude Anno e torna al pulsante", (await where()).indexOf("Anno") >= 0, await where());
await enter("Album", ".chips");
await settle();
await audit("Cerca solo album");
await enter("Tutto", ".chips");
await settle();
await wait(400);
await enter("Altri risultati");
await settle();
await audit("Cerca dopo Altri risultati");
// Artista
await enterTitle("Laura Pausini");
await settle();
await wait(600);
expect("Artista: si apre la pagina", (await heading()) === "Laura Pausini", await heading());
await audit("Artista YouTube");
await enter("Biografia");
await audit("Finestra Biografia");
await key("ArrowDown", 3);
expect("Biografia: gi\xF9 scorre il testo", await page.evaluate(() => document.querySelector(".dialog-body").scrollTop > 0));
await key("Escape");
await enter("Album  ›");
await audit("Tutti gli album dell'artista");
await key("Escape");
await settle();
expect("Indietro torna all'artista", (await heading()) === "Laura Pausini", await heading());
await enterTitle("Album 1");
expect("Album: si apre la pagina", (await heading()) === "Album", await heading());
await audit("Album YouTube");
await enter("Riproduci");
await wait(600);
await key("Escape");
await settle();
await key("Escape");
await settle();
expect("Indietro due volte torna alla ricerca con i risultati", (await heading()) === "Cerca" && await page.evaluate(() => /Brani/.test(document.querySelector(".search-results").textContent)), await heading());
// Brano che non si riproduce: si passa al successivo
await nav("home");
await wait(600);
await focusOn("#shuffle");
await key("Enter");
await enterTitle("Brano numero 3");
expect("Un brano scelto non spegne Casuale", (await page.evaluate(() => document.getElementById("shuffle").getAttribute("aria-pressed"))) === "true");
await focusOn("#shuffle");
await key("Enter");
await enterTitle("Brano numero 0");
await wait(4500);
// I brani finti durano un secondo: conta che l'ascolto sia andato avanti.
expect("Brano non riproducibile: si passa ai successivi", /^Brano numero [1-9]$/.test(await page.evaluate(() => document.getElementById("now-title").textContent)), await page.evaluate(() => document.getElementById("now-title").textContent));
// Player
await focusOn("#seek");
await key("ArrowLeft");
expect("Barra del brano: sinistra sposta il brano, non il focus", (await page.evaluate(() => document.activeElement.id)) === "seek");
await key("ArrowUp");
expect("Barra del brano: su esce", (await page.evaluate(() => document.activeElement.id)) !== "seek", await where());
await nav("queue");
await audit("In coda");
// Il mio YouTube
await nav("youtube");
await audit("Il mio YouTube senza account");
await enter("Accedi con Google");
await audit("Finestra di accesso");
await wait(4500);
expect("Accesso: la finestra si chiude a collegamento avvenuto", await page.evaluate(() => !document.querySelector(".dialog")));
await settle();
await audit("Il mio YouTube: Per te");
for (const tab of ["Cronologia", "Mi piace", "Playlist", "Album", "Artisti"]) {
  await enter(tab, ".tabs");
  await settle();
  expect(tab + ": il focus resta sulla scheda", (await where()) === tab, await where());
  await audit("Il mio YouTube: " + tab);
}
await nav("home");
await wait(600);
await audit("Home con account");
// Impostazioni
await nav("settings");
await audit("Impostazioni");
await enter("Mai");
await audit("Impostazioni con scelta tempo aperta");
await key("Escape");
state.nextName = "Secondo Account";
await enter("Cambia account");
await wait(4500);
await settle();
expect("Cambia account: il nome nuovo compare subito", await page.evaluate(() => /Secondo Account/.test(document.getElementById("connection").textContent)), await page.evaluate(() => document.getElementById("connection").textContent));
await enter("Esci");
await audit("Conferma uscita");
await key("Escape");
expect("Annulla uscita: il focus torna su Esci", (await where()) === "Esci", await where());
await enter("Informazioni su Bloomee");
await audit("Informazioni");
await key("Escape");
await settle();
// Jellyfin
for (const p of ["albums", "artists", "tracks", "favorites"]) {
  await nav(p);
  await audit("Jellyfin " + p);
}
await nav("albums");
await enterTitle("Disco 1");
await audit("Album Jellyfin");
errors.forEach((e) => problems.push("errore JavaScript: " + e));
await browser.close();
if (problems.length) {
  console.log("\n" + problems.length + " problemi:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("\nNessun blocco del focus in " + audits + " schermate.");
