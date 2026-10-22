> **Fork per LG webOS:** il porting installabile per LG è in [webos/](webos/README.md), con YouTube Music (home, ricerca, artisti, album, playlist e libreria dell'account) e Jellyfin. Include un timer persistente per ascoltare musica a schermo spento; la stessa impostazione è disponibile nella versione Android TV, con oscuramento compatibile con le API Android. Il codice e le funzioni Android originali sono conservati.

# 📺 Bloomee TV

A music player for Android TV and Google TV, designed for listening from the sofa with a remote. It combines YouTube Music discovery, your Jellyfin music library and album requests to a Lidarr server. The TV interface is primarily in Italian; some inherited screens and error messages use the selected app language or English.

Bloomee TV is a fork of [BloomeeTunes](https://github.com/HemantKArya/BloomeeTunes) by HemantKArya: the audio engine, Rust plugin system, lyrics, equalizer and many library features come from Bloomee. This fork adds the TV interface and home-server integrations.

<p align="center">
  <img src="assets/docs/tv/artist.jpg" width="49%" alt="Artist page">
  <img src="assets/docs/tv/albums.jpg" width="49%" alt="All albums of an artist">
  <img src="assets/docs/tv/search.jpg" width="49%" alt="Search">
  <img src="assets/docs/tv/album.jpg" width="49%" alt="Album page">
</p>

## Features

These features describe the current source tree. Published release APKs may predate these changes; use the build instructions below to produce an APK from this tree.

**Made for the remote**
- Expandable side menu, visible focus, horizontal rows and grids.
- Bottom player bar and fullscreen TV player with queue, seeking, shuffle, repeat and access to lyrics. Equalizer is in the complete player settings, not the fullscreen TV player.
- Responsive on-screen keyboard with symbols, cursor editing and Unicode backspace; Italian voice search when a microphone and Android speech recognition service are available.
- Reopenable TV guide and **Centro TV** for profiles, Home customization, operations, storage, accessibility, phone input, playlists, favorites, sleep timer, ReplayGain and diagnostics.

**Search and artists**
- Unified search across local tracks, configured Jellyfin, YouTube Music and the selected plugin. Songs and artists start first; albums/playlists follow independently. Sources have a 12-second response limit and explicit **Altri risultati** pagination. Repeated searches use a two-minute, profile/account-scoped memory cache. **Tutto / Brani / Album / Artisti** stay visible directly below the search bar; initial focus is on **Parla**. **Filtri** opens source, playlist, offline, year and version filters, A–Z sorting and variant grouping. Missing year metadata is excluded by the year filter.
- Artist information and sections such as monthly listeners, biography, top songs, albums, singles, videos and similar artists, where supplied by YouTube Music. Some section titles open a larger list.

**Your music**
- Connect Google through an embedded WebView to read YouTube Music history, liked songs, playlists, saved albums, followed artists and personalized home. Playback still requires the YouTube Music resolver plugin.
- Jellyfin library ("La tua musica") with direct streaming, complete paginated album/artist lists and persistent genre/year/initial/sort filters.
- Profile-scoped metadata caches allow previously visited catalogs to be browsed offline with an age indicator. Large catalogs live in `tv-catalog.json`, separately from preferences, and their encoding runs outside the UI isolate. Search responses use memory only and do not become a persistent offline search index. An expired login is reported and never treated as an offline success.

**Downloads**
- **Locale** saves original audio streams in the active profile’s TV download folder. ID-based filenames and atomic transfers prevent collisions and incomplete files from being registered. Transfers enforce a quota and a free-space reserve.
- **Centro TV → operazioni/spazio** exposes transfer progress, retry/cancel, Lidarr status, quota, file protection and explicit deletion. Interrupted local operations can be retried.
- **Lidarr** requests album monitoring/search on your server. For playlists, it requests the albums identified in track metadata, potentially whole albums rather than individual tracks. Availability and successful download are not guaranteed.

**From Bloomee**
- Streaming and charts through installed plugins, synced lyrics when available, 10-band equalizer, crossfade, Last.fm scrobbling, and library import/export and backup/restore through inherited settings.

**Queue, playlists and listening**
- Open the player and choose **Modifica coda**. **Su/Giù** changes actual playback order, keeps the current occurrence selected and disables shuffle. Remove individual/selected tracks, undo the last edit or save the queue as a playlist. Removing the current track stops playback.
- **Centro TV → playlist** creates, renames, reorders, duplicates, changes covers and deletes local playlists. These edits do not write to YouTube playlists.
- **timer** offers 15–90 minutes, end of track or end of album, an eight-second fade and cancellation. It stops audio; it does not power off the television. The inherited timer UI uses the same timer.
- **audio** offers opt-in ReplayGain on both audio players, clipping protection, −6 dB preamp and 0 dB fallback for files without gain tags. It does not analyze or normalize untagged streams in real time.
- Profiles separate databases, service credentials, catalog cache, preferences and downloaded files. Guest files and credentials are removed on exit or the next startup. Unified favorites retain source variants, manual merge/split and a preferred source.

The TV player's **Mi piace** changes the local Bloomee library. It does not write likes back to YouTube Music. Reading account lists is separate from playback and from local favorites.

## Install

Download the APK from this fork's [latest release](https://github.com/fabiodalez-dev/BloomeeTV/releases/latest) and sideload it. Release 1.2.0 publishes `BloomeeTV-1.2.0-armeabi-v7a.apk`. Check the device's supported ABIs:

```sh
adb devices
adb -s DEVICE_SERIAL shell getprop ro.product.cpu.abilist
adb -s DEVICE_SERIAL install -r BloomeeTV-1.2.0-armeabi-v7a.apk
```

Replace `DEVICE_SERIAL` with the TV serial or network address. ARMv7 requires 32-bit ARM compatibility; ARM64-only devices require an `arm64-v8a` build. With the pinned Flutter 3.35.4 defaults, builds require Android 7.0 / API 24 or newer. Enable installation from the source used for sideloading.

Updates preserve data when the application ID and signing certificate match and Android accepts the version code. An APK signed with a different local key cannot update the published APK in place. Back up data before changing installations.

The application ID is `it.fabiodalez.bloomeetv`. TV mode is automatic when Android reports Leanback or television features. A phone emulator can show the inherited mobile interface. Other platform directories in this repository do not imply support for this fork's TV integrations.

## Connect your services

Open **Impostazioni** in the side menu. All three integrations are optional.

- **YouTube Music:** complete Google login in the embedded WebView. The integration reads session cookies and uses internal YouTube Music web endpoints; changes at Google can break login or browsing. Disconnect in the same settings screen.
- **Jellyfin:** enter a full URL, including `http://` or `https://` and any reverse-proxy path, username and password, or a server API key. The password is exchanged for a token stored by the app. The TV must be able to reach the server address.
- **Lidarr:** enter a full URL and API key. Configure a root folder, quality/metadata profiles and working indexers/download clients on the server. The current client selects the first root folder and quality profile, and a metadata profile other than `None` when available; selection is not exposed in the TV UI.

Lidarr performs its own search, download and import. An album appears in Jellyfin after those succeed and Jellyfin scans the shared music location. These services and their configuration are not included in the APK.

Configuration is stored locally, while searches, playback and plugin discovery contact their corresponding services. TV tokens, API keys and Google session cookies are encrypted with Android Keystore and isolated by profile. Legacy plaintext values are removed after successful migration. Binary database exports exclude credential settings, plugin storage and API caches. The TV workspace/profile registry and downloaded audio are separate files and are not included in an inherited database-only backup. Prefer HTTPS for service connections.

On TV, **Controlla aggiornamenti** queries this fork’s GitHub releases, reports failed checks and selects APKs by supported ABI. The base build number is read from application metadata rather than truncating Android’s ABI-specific version code.

## Remote controls

| Control | Action |
| --- | --- |
| D-pad | Navigate items, rows and controls; Left from the content's left edge reaches the menu. |
| OK | Activate an item; on a text field, open the grid keyboard. |
| Hold OK | Open available pin/favorite/download/play-next actions. Detail pages also expose **Scarica**. |
| Back | Dismiss the player or navigate back; from root sections return toward Home and eventually exit. |
| Progress bar | Focus it, then Left/Right seeks by 10 seconds; OK toggles playback. |

## Phone input and Cast

**Centro TV → telefono** displays a five-minute pairing QR and code for the same IPv4 LAN. The phone can submit non-secret text, which must be accepted on the TV keyboard. Passwords, Google cookies and API keys must be entered on the TV; this HTTP input endpoint is not a credential setup service.

The Android media session publishes title, artist, display metadata, artwork and content ID. Cast Connect shares that existing session and explicitly maps title/artist/album/images to Cast's music-track metadata type. For authenticated Jellyfin or local artwork, the TV serves only the current cover from an opaque LAN URL, revoked on track changes, stop or profile switch; service credentials never enter that URL. Google's shared network notification controls its own presentation; valid Cast metadata alone does not guarantee it displays every field. In the real-phone check with build 1005 it still showed “Bloomee TV / Chromecast”, so this notification issue remains unresolved. This fork does not include a phone controller mode.

A full Cast receiver also needs a compatible sender and Google Cast Console package/device registration for sideloaded builds. Installing this APK does not make it the receiver for another app’s Cast application ID. See [Google’s Cast Connect setup](https://developers.google.com/cast/docs/android_tv_receiver/core_features). Verify the actual phone notification as well as the TV session; metadata checks alone do not prove an end-to-end Cast session. Fire TV without Google Play Services keeps local playback and does not enable Cast Connect.

## Scope and verification

The current tree implements MVPs **F01–F14, F18 and F19** from the [20-feature roadmap](docs/PIANO_20_FUNZIONALITA.md). The Home guide prompt is offered once; configured installations skip it, and the guide remains accessible from Centro TV. F15–F17 and F20 remain planned. The [initial review](docs/REVIEW_USABILITA_STABILITA.md) is historical; [implementation and verification](docs/IMPLEMENTAZIONE_E_VERIFICHE.md) records the subsequent corrections and remaining limits.

Google’s internal web API and source plugins may change. Previously visited metadata can be read offline; uncached catalogs and online streams still need the network. Inherited settings keep their original layout.

## Building

The workflows pin **Flutter 3.35.4** (Dart **3.9.2**). Install Flutter, Rust/Cargo, JDK 17 and the Android SDK with accepted licenses. That Flutter version supplies SDK 36, minimum API 24 and NDK `27.0.12077973` as the defaults used by Gradle. The Rust bridge is pinned to **2.12.0** on both sides.

```sh
git clone https://github.com/fabiodalez-dev/BloomeeTV.git
cd BloomeeTV
flutter doctor -v
flutter doctor --android-licenses
rustup target add armv7-linux-androideabi aarch64-linux-android x86_64-linux-android
flutter pub get
flutter build apk --release --target-platform android-arm --split-per-abi
```

The ARMv7 artifact is `build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk`. For ARM64 use `--target-platform android-arm64`; omit `--target-platform` to build all configured ABIs. Cargokit builds Rust during the Flutter build. Normal builds use the committed generated bridge files.

For development, use `flutter build apk --debug --target-platform android-arm64 --split-per-abi`. Test the TV flow on an Android TV device or TV emulator.

For release signing, provide your own ignored `android/bloomee.jks` and `android/key.properties`:

```properties
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=YOUR_KEY_ALIAS
```

Gradle reads `android/bloomee.jks` directly. Without `key.properties`, even release builds fall back to the debug signing key. Do not commit signing material, API keys or account cookies. The local `tv-env.sh`, if present, contains machine-specific paths and is not required by the project.

## Development checks

```sh
flutter analyze --no-fatal-infos
flutter test --concurrency=1
python3 -m unittest discover -s tool -p 'test_install_tv_apk.py'
cargo clippy --locked --manifest-path rust/Cargo.toml --all-targets
cargo check --locked --manifest-path rust/Cargo.toml
cargo test --locked --manifest-path rust/Cargo.toml
```

The test bootstrap loads the host Isar core bundled in `isar_community_flutter_libs`. The former empty regression cases have been replaced with executable tests. CI runs Flutter analysis/tests, installer safety tests and Rust Clippy/tests. Clippy currently reports existing warnings.

Run Flutter checks and APK builds sequentially in a checkout: they regenerate shared plugin-registration files, and concurrent test/build commands can race over whether development plugins belong in the release build.

For an in-place device update use the verified installer:

```sh
python3 tool/install_tv_apk.py --serial DEVICE_SERIAL build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk
```

It verifies package, certificate, effective Android version code and device ABI, and never uninstalls or downgrades. On a debuggable installation, `--backup /private/path/backup.tar` saves the stopped app’s private files before installing; keep that archive private. Android Keystore keys are not transferable through a file archive.

**Do not run `flutter test -d` or `flutter run` directly over an installation containing user data.** Flutter can uninstall the existing app after an install failure, including an ABI version-code downgrade. Build a signed per-ABI test APK, install it with the verifier, then attach `flutter drive --use-existing-app=VM_SERVICE_URL --driver=test_driver/integration_test.dart`. The native instrumentation tests are under `android/app/src/androidTest` and the device playback test is `integration_test/tv_playback_test.dart`.

## Issues

Bugs and ideas about Bloomee TV go in this fork's [issues](https://github.com/fabiodalez-dev/BloomeeTV/issues). Include app version, TV model, Android version, reproduction steps and expected/actual behavior. Remove tokens, cookies, API keys and private server addresses from logs before sharing them.

## Credits and license

Bloomee TV is based on [BloomeeTunes](https://github.com/HemantKArya/BloomeeTunes) by [HemantKArya](https://github.com/HemantKArya); all credit for the original app goes to him. Like the original, this fork is released under the [GPL-2.0](LICENSE) license.
