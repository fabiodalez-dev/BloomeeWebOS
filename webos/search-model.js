// Risultati della ricerca unificata, come TvSearchController della versione
// Android: ogni sorgente risponde per conto suo, una ricerca nuova invalida le
// risposte vecchie, i filtri lavorano sui risultati già arrivati.
import { normalize, identity } from "./library.js";

export const kindLabel = { track: "Brani", album: "Album", artist: "Artisti", playlist: "Playlist" };

export function createSearch(options) {
  const timeout = options && options.timeout || 12e3;
  let hits = [], generation = 0;
  const state = { query: "", loading: [], errors: {}, more: {} };
  let changed = () => {
  };
  function add(source, result) {
    const ids = {};
    hits.forEach((h) => ids[h.source + ":" + h.ref.id] = true);
    result.forEach((ref) => {
      if (ids[source + ":" + ref.id]) return;
      ids[source + ":" + ref.id] = true;
      hits.push({ ref, source, kind: kindLabel[ref.kind], year: ref.year == null ? null : ref.year });
    });
  }
  function withTimeout(promise) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Error("Il servizio non ha risposto in tempo. Riprova.")), timeout);
      promise.then((v) => {
        clearTimeout(t);
        resolve(v);
      }, (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }
  // Un provider restituisce { items: [riferimenti], more: provider | null }.
  async function run(key, provider, mark) {
    try {
      const page = await withTimeout(provider(state.query));
      if (mark !== generation) return false;
      add(key.split(" \xB7 ")[0], page.items);
      if (page.more) state.more[key] = page.more;
      else delete state.more[key];
      return page.items.length > 0;
    } catch (e) {
      if (mark === generation) state.errors[key] = e.message;
      return false;
    } finally {
      if (mark === generation) {
        state.loading = state.loading.filter((k) => k !== key);
        changed();
      }
    }
  }
  return {
    state,
    get hits() {
      return hits.slice();
    },
    onChange(f) {
      changed = f;
    },
    clear() {
      generation++;
      hits = [];
      state.query = "";
      state.loading = [];
      state.errors = {};
      state.more = {};
      changed();
    },
    // I provider in deferred partono al primo risultato utile o dopo delay ms.
    async search(text, providers, deferred, delay) {
      this.clear();
      state.query = String(text || "").trim();
      if (!state.query) return;
      const mark = generation;
      state.loading = Object.keys(providers).concat(Object.keys(deferred || {}));
      changed();
      let release;
      const first = new Promise((r) => release = r);
      const primary = Promise.all(Object.keys(providers).map((k) => run(k, providers[k], mark).then((found) => {
        if (found) release();
      })));
      primary.then(release);
      const secondary = (async () => {
        const keys = Object.keys(deferred || {});
        if (!keys.length) return;
        await Promise.race([first, new Promise((r) => setTimeout(r, delay == null ? 2e3 : delay))]);
        if (mark !== generation) return;
        await Promise.all(keys.map((k) => run(k, deferred[k], mark)));
      })();
      await Promise.all([primary, secondary]);
    },
    async loadMore(key) {
      const provider = state.more[key];
      if (!provider || state.loading.indexOf(key) >= 0) return;
      const mark = generation;
      state.loading.push(key);
      delete state.errors[key];
      changed();
      await run(key, provider, mark);
    }
  };
}

export function filterHits(hits, options) {
  const o = options || {};
  const version = normalize(o.version || "");
  const out = hits.filter((h) => (!o.kind || o.kind === "Tutto" || h.kind === o.kind) && (o.year == null || h.year === o.year) && normalize(h.ref.title).indexOf(version) >= 0);
  if (o.alphabetical) out.sort((a, b) => normalize(a.ref.title) < normalize(b.ref.title) ? -1 : normalize(a.ref.title) > normalize(b.ref.title) ? 1 : 0);
  return out;
}

// Stesso brano o album da più sorgenti: un gruppo con tutte le versioni.
export function groupVariants(hits) {
  const groups = [], index = {};
  hits.forEach((h) => {
    const id = identity(h.ref);
    if (index[id] == null) {
      index[id] = groups.length;
      groups.push([]);
    }
    groups[index[id]].push(h);
  });
  return groups;
}
