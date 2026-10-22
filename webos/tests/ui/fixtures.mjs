// Risposte finte di bridge, YouTube Music e Jellyfin con la stessa forma di
// quelle reali, per provare l'interfaccia senza rete né TV.
const color = (i) => ["#ef88ba", "#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#2ac3de"][i % 6];
export const svg = (i) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="' + color(i) + '"/></svg>');
const runs = (...r) => ({ runs: r.map((x) => typeof x === "string" ? { text: x } : x) });
const link = (text, browseId, params) => ({ text, navigationEndpoint: { browseEndpoint: params ? { browseId, params } : { browseId } } });
const thumbs = (i) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: svg(i) }] } } });
const col = (r) => ({ musicResponsiveListItemFlexColumnRenderer: { text: r } });
export const vid = (i) => ("v" + i + "xxxxxxxxxxx").slice(0, 11);
export const artists = ["Laura Pausini", "Vasco Rossi", "Elisa", "Ligabue", "Mina", "Tiziano Ferro"];
export function song(i, artist) {
  artist = artist || artists[i % artists.length];
  return { musicResponsiveListItemRenderer: { thumbnail: thumbs(i), playlistItemData: { videoId: vid(i) }, flexColumns: [col(runs("Brano numero " + i)), col(runs(link(artist, "UC" + artist.replace(/ /g, "")), " • ", link("Album " + i % 5, "MPREbalbum" + i % 5), " • ", "3:" + String(10 + i % 50)))] } };
}
const twoRow = (title, subtitle, browseId, i) => ({ musicTwoRowItemRenderer: { title: runs(title), subtitle, thumbnailRenderer: thumbs(i), navigationEndpoint: { browseEndpoint: { browseId } } } });
export const album = (i) => twoRow("Album " + i, runs("Album", " • ", link(artists[i % 6], "UC" + artists[i % 6].replace(/ /g, "")), " • ", String(2000 + i)), "MPREbalbum" + i, i);
export const artistCard = (i) => twoRow(artists[i % 6], runs("Artista"), "UC" + artists[i % 6].replace(/ /g, ""), i);
export const playlist = (i) => twoRow("Playlist " + i, runs("Playlist", " • ", "YouTube Music"), "VLPLlist" + i, i);
const carousel = (title, items, more) => ({ musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: runs(more ? link(title, more.browseId, more.params) : title) } }, contents: items } });
const shelf = (title, items, extra) => ({ musicShelfRenderer: Object.assign({ title: runs(title), contents: items }, extra || {}) });
const range = (n, f, from) => Array.from({ length: n }, (_, i) => f(i + (from || 0)));
const continuationItem = (token) => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } });
const page = (sections, token) => ({ contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: sections.concat(token ? [continuationItem(token)] : []) } } } }] } } });
export function youtube(endpoint, body) {
  if (endpoint === "account/account_menu") return { actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: { accountName: runs("Fabio Test") } } } } } }] };
  if (endpoint === "next") return { contents: range(20, (i) => ({ playlistPanelVideoRenderer: { videoId: vid(500 + i), title: runs("Radio " + i), longBylineText: runs(link("Elisa", "UCElisa")), shortBylineText: runs("Elisa"), lengthText: runs("3:30"), thumbnail: { thumbnails: [{ url: svg(i) }] } } })) };
  if (endpoint === "search") {
    if (body.continuation === "search-2") return { continuationContents: { musicShelfContinuation: { contents: range(10, (i) => song(i, "Laura Pausini"), 120) } } };
    const p = body.params || "";
    if (p.indexOf("EgWKAQIIA") === 0) return page([shelf("Brani", range(20, (i) => song(i, "Laura Pausini"), 100), { contents: range(20, (i) => song(i, "Laura Pausini"), 100).concat([continuationItem("search-2")]) })]);
    if (p.indexOf("EgWKAQIgA") === 0) return page([shelf("Artisti", range(4, (i) => ({ musicResponsiveListItemRenderer: { thumbnail: thumbs(i), navigationEndpoint: { browseEndpoint: { browseId: "UC" + artists[i].replace(/ /g, "") } }, flexColumns: [col(runs(artists[i])), col(runs("Artista"))] } })))]);
    if (p.indexOf("EgWKAQIYA") === 0) return page([shelf("Album", range(8, album))]);
    if (p.indexOf("EgeKAQQoA") === 0) return page([shelf("Playlist", range(6, playlist))]);
    return page([shelf("Brani", range(5, song))]);
  }
  if (body.continuation === "home-2") return { continuationContents: { sectionListContinuation: { contents: [carousel("Altre novit\xE0", range(10, album, 40))] } } };
  const id = body.browseId;
  if (id === "FEmusic_home") return page([carousel("Ascolta di nuovo", range(12, song)), carousel("Album per te", range(12, album), { browseId: "FEmusic_new_releases" }), carousel("Artisti consigliati", range(6, artistCard)), carousel("Playlist in evidenza", range(8, playlist)), carousel("Mix", range(8, playlist, 20)), carousel("Successi italiani", range(12, song, 30))], "home-2");
  if (id === "FEmusic_charts") return page([carousel("Classifiche dei video", range(6, playlist, 60)), carousel("Artisti pi\xF9 ascoltati", range(6, artistCard))]);
  if (id === "FEmusic_history") return page([shelf("Oggi", range(15, song, 200))]);
  if (id === "FEmusic_liked_playlists") return page([{ gridRenderer: { items: range(9, playlist) } }]);
  if (id === "FEmusic_liked_albums") return page([{ gridRenderer: { items: range(9, album) } }]);
  if (id === "FEmusic_library_corpus_artists") return page([shelf("", range(6, (i) => ({ musicResponsiveListItemRenderer: { thumbnail: thumbs(i), navigationEndpoint: { browseEndpoint: { browseId: "UC" + artists[i].replace(/ /g, "") } }, flexColumns: [col(runs(artists[i])), col(runs("12 brani"))] } })))]);
  if (id === "FEmusic_new_releases") return page([{ gridRenderer: { items: range(20, album) } }]);
  if (/^UC/.test(id) && body.params) return page([{ gridRenderer: { items: range(14, album) } }]);
  if (/^UC/.test(id)) {
    const name = artists.filter((a) => "UC" + a.replace(/ /g, "") === id)[0] || "Laura Pausini";
    return Object.assign(page([shelf("Brani", range(5, (i) => song(i, name), 100), { bottomEndpoint: { browseEndpoint: { browseId: "VLPLtop" } } }), carousel("Album", range(8, album), { browseId: id, params: "albums" }), carousel("Singoli", range(6, album, 10)), carousel("Video", range(6, (i) => song(i, name), 300)), carousel("I fan potrebbero apprezzare anche", range(5, artistCard, 1))]), { header: { musicImmersiveHeaderRenderer: { title: runs(name), monthlyListenerCount: runs("15,6 Mln ascoltatori mensili"), description: runs("Biografia di prova, abbastanza lunga da dover scorrere. ".repeat(160)), thumbnail: thumbs(3), subscriptionButton: { subscribeButtonRenderer: { subscriberCountText: runs("1,7 Mln") } } } } });
  }
  if (/^(VL|MPREb)/.test(id)) return Object.assign({ contents: { twoColumnBrowseResultsRenderer: { secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: range(id === "VLLM" ? 25 : 14, (i) => song(i), id.length) } }] } } } } }, { header: { musicResponsiveHeaderRenderer: { title: runs(id.indexOf("MPREb") === 0 ? "Album di prova" : "Playlist di prova"), straplineTextOne: runs("Laura Pausini"), subtitle: runs("Album • 2006"), thumbnail: thumbs(2) } } });
  return page([]);
}
const hex = (i) => (String(i) + "0".repeat(32)).slice(0, 32).replace(/[^0-9a-f]/g, "a");
export function jellyfin(query) {
  const kind = query.get("kind");
  const items = range(kind === "MusicArtist" ? 12 : 24, (i) => ({ Id: hex(i + (kind === "Audio" ? 100 : kind === "MusicArtist" ? 200 : 300)), Name: (kind === "Audio" ? "Canzone " : kind === "MusicArtist" ? "Artista " : "Disco ") + i, Artists: ["Pino Daniele"], AlbumArtist: "Pino Daniele", AlbumId: hex(300 + i % 5), RunTimeTicks: 2e9 + i * 1e7, ProductionYear: 1980 + i, IndexNumber: i + 1 }));
  return { Items: query.get("search") ? items.slice(0, 3) : items, TotalRecordCount: query.get("search") ? 3 : 90 };
}
// Un secondo di silenzio WAV: abbastanza per far partire il lettore.
export function silence() {
  const rate = 8e3, n = rate, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(n, 40);
  b.fill(128, 44);
  return b;
}
