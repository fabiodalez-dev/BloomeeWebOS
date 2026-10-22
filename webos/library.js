// Libreria locale della TV, come TvSavedLibrary e TvWorkspace della versione
// Android: elementi fissati nella Home, preferiti unificati con più versioni e
// una sorgente preferita, ascoltati di recente e preferenze dell'interfaccia.
// Niente viene scritto sull'account YouTube.

export function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^0-9a-zÀ-ɏͰ-ϿЀ-ӿ֐-ۿ぀-ヿ一-鿿가-힯]+/g, " ").trim();
}

// Stessa identità di TvReference: un brano è titolo, artisti e durata;
// un album è titolo, artisti e anno; artisti e playlist restano per id.
export function identity(ref) {
  if (ref.kind === "track") return "track|" + normalize(ref.title) + "|" + normalize(ref.subtitle) + "|" + Math.floor(ref.duration || 0);
  if (ref.kind === "album") return "album|" + normalize(ref.title) + "|" + normalize(ref.subtitle) + "|" + (ref.year == null ? "null" : ref.year);
  return ref.kind + "|" + ref.id;
}

export const homeRows = {
  jfRecent: "Jellyfin recenti",
  ytHistory: "Cronologia YouTube",
  ytHome: "Per te su YouTube",
  recent: "Ascoltati di recente",
  jfRandom: "Jellyfin casuali",
  charts: "Classifiche",
  sections: "Sorgente online"
};

export function createLibrary(storage, key) {
  key = key || "bloomee.workspace";
  let data = {};
  try {
    data = JSON.parse(storage.getItem(key) || "{}") || {};
  } catch (_) {
    data = {};
  }
  const listeners = [];
  function save() {
    storage.setItem(key, JSON.stringify(data));
    listeners.forEach((f) => f());
  }
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const lib = {
    get(name, fallback) {
      return data[name] === void 0 ? fallback : copy(data[name]);
    },
    set(name, value) {
      data[name] = copy(value);
      save();
    },
    onChange(f) {
      listeners.push(f);
    },
    pins() {
      return lib.get("pins", []);
    },
    isPinned(ref) {
      return lib.pins().some((p) => p.id === ref.id);
    },
    togglePin(ref) {
      const next = lib.pins();
      const i = next.findIndex((p) => p.id === ref.id);
      if (i >= 0) next.splice(i, 1);
      else next.push(ref);
      lib.set("pins", next);
      return i < 0;
    },
    movePin(index, delta) {
      const next = lib.pins(), to = index + delta;
      if (index < 0 || index >= next.length || to < 0 || to >= next.length) return;
      next.splice(to, 0, next.splice(index, 1)[0]);
      lib.set("pins", next);
    },
    favorites() {
      return lib.get("favorites", []);
    },
    favoriteOf(ref) {
      return lib.favorites().find((g) => g.variants.some((v) => v.id === ref.id)) || null;
    },
    addFavorite(ref) {
      const groups = lib.favorites(), id = identity(ref);
      const existing = groups.find((g) => g.identity === id);
      if (!existing) groups.push({ identity: id, preferred: ref.id, variants: [ref] });
      else if (!existing.variants.some((v) => v.id === ref.id)) existing.variants.push(ref);
      lib.set("favorites", groups);
    },
    removeFavorite(id) {
      lib.set("favorites", lib.favorites().filter((g) => g.identity !== id));
    },
    prefer(id, refId) {
      const groups = lib.favorites(), group = groups.find((g) => g.identity === id);
      if (!group || !group.variants.some((v) => v.id === refId)) throw Error("Versione non presente");
      group.preferred = refId;
      lib.set("favorites", groups);
    },
    merge(from, into) {
      if (from === into) return;
      const groups = lib.favorites();
      const source = groups.find((g) => g.identity === from), target = groups.find((g) => g.identity === into);
      if (!source || !target) return;
      source.variants.forEach((v) => {
        if (!target.variants.some((t) => t.id === v.id)) target.variants.push(v);
      });
      lib.set("favorites", groups.filter((g) => g !== source));
    },
    split(id, refId) {
      const groups = lib.favorites(), group = groups.find((g) => g.identity === id);
      if (!group || group.variants.length < 2) return;
      const i = group.variants.findIndex((v) => v.id === refId);
      if (i < 0) return;
      const selected = group.variants.splice(i, 1)[0];
      if (group.preferred === refId) group.preferred = group.variants[0].id;
      groups.push({ identity: id + "|" + refId, preferred: refId, variants: [selected] });
      lib.set("favorites", groups);
    },
    recent() {
      return lib.get("recent", []);
    },
    addRecent(ref) {
      const next = lib.recent().filter((r) => r.id !== ref.id);
      next.unshift(ref);
      lib.set("recent", next.slice(0, 50));
    },
    // Righe della Home nell'ordine scelto, senza quelle nascoste; la riga
    // "all'avvio" va in cima.
    homeOrder() {
      const order = lib.get("homeOrder", Object.keys(homeRows)).filter((k) => homeRows[k]);
      Object.keys(homeRows).forEach((k) => {
        if (order.indexOf(k) < 0) order.push(k);
      });
      return order;
    },
    visibleRows() {
      const order = lib.homeOrder(), first = lib.get("startSection", null), hidden = lib.get("hiddenRows", []);
      if (first && order.indexOf(first) >= 0) {
        order.splice(order.indexOf(first), 1);
        order.unshift(first);
      }
      return order.filter((k) => hidden.indexOf(k) < 0);
    },
    toggleRow(row) {
      const hidden = lib.get("hiddenRows", []), i = hidden.indexOf(row);
      if (i >= 0) hidden.splice(i, 1);
      else hidden.push(row);
      lib.set("hiddenRows", hidden);
    },
    moveRowUp(row) {
      const order = lib.homeOrder(), i = order.indexOf(row);
      if (i <= 0) return;
      order.splice(i - 1, 0, order.splice(i, 1)[0]);
      lib.set("homeOrder", order);
    }
  };
  return lib;
}
