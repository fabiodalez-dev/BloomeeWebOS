# Bloomee per LG webOS

Porting leggero di BloomeeTV per una LG con webOS 5 (Chrome 68), Homebrew Channel e root. L'app Android originale resta nel repository e conserva le proprie funzioni.

## Musica e telecomando

Le funzioni YouTube seguono una per una quelle della versione Android TV.

- **Home**: in alto la testata mostra l'elemento con il focus (tipo e riga, titolo, artista, copertina). Pulsanti **Personalizza** e **Preferiti unificati**, riga **Fissati**, poi Aggiunti di recente e Scelti per te (Jellyfin), Ascoltati di recente su YouTube e Per te su YouTube (con account), Ascoltati di recente sulla TV, Classifiche e le sezioni di YouTube Music. Le righe si nascondono, si spostano e si sceglie quale aprire per prima in **Personalizza**.
- **Cerca**: Jellyfin e YouTube Music insieme. Tutto / Brani / Album / Artisti sotto la barra; **Filtri** per sorgente (Tutte, YouTube, Jellyfin), Playlist, ordine A–Z, anno, testo nel titolo (live, remix…) e raggruppamento delle versioni. Ogni sorgente risponde per conto suo entro 12 secondi, con **Riprova** in caso di errore e **Altri risultati** per sorgente. Lo stesso brano da più sorgenti si apre scegliendo la versione.
- **Artista**: foto, ascoltatori mensili e iscritti, Riproduci tutto (N), Casuale, **Biografia** completa, Brani più famosi, le righe di YouTube Music (album, singoli, video, artisti simili; il titolo apre l'elenco completo) e **Tutti i brani** dell'artista, caricati man mano.
- **Album e playlist**: copertina, numero di brani, Riproduci, Casuale, In coda. Gli elenchi completi ("Album ›", "Singoli ›") mostrano il conteggio di brani, uscite o artisti.
- **YouTube** (Il mio YouTube): Per te, Cronologia, Mi piace, Playlist, Album, Artisti dell'account.
- **OK tenuto premuto** su una copertina o un brano (o il tasto rosso): Fissa / rimuovi dalla Home, Salva nei preferiti unificati, Riproduci dopo. Il **cuore** nella barra del player salva il brano nei preferiti. Preferiti e fissati restano sulla TV: niente viene scritto sull'account YouTube.
- **Riproduzione automatica** (Impostazioni): verso la fine della coda aggiunge la radio di YouTube Music del brano in ascolto. Un brano che non si riproduce viene saltato, anche a schermo spento; dopo tre errori di fila l'ascolto si ferma. Un video che YouTube rifiuta (paese, età, conferma "non sono un bot") non viene richiesto di nuovo per dieci minuti.

Jellyfin: album, artisti, brani e preferiti, dettaglio album, coda mista Jellyfin/YouTube, casuale e ripetizione.

**Telecomando.** Frecce e OK su ogni controllo; Indietro chiude le finestre e riapre la pagina precedente. Destra e sinistra restano sulla stessa riga; dal bordo sinistro si torna al menu. Nelle finestre di dialogo le frecce restano dentro e alla chiusura il focus torna al controllo che le ha aperte. Sulla barra del brano sinistra e destra spostano di dieci secondi, su e giù escono; nei campi di testo su e giù escono sempre. Dopo un'azione (Nascondi, una scheda, un filtro) il focus resta sul pulsante premuto. `npm run test:ui` apre ogni schermata e finestra con dati finti, preme le quattro frecce su ogni controllo e fallisce se il focus si perde, se un controllo è irraggiungibile o se da un punto non si torna al menu.

In **Impostazioni → Spegni schermo dopo**, scegliere Mai, 15/30 secondi oppure 1/2/5 minuti. La preferenza resta salvata. Il timer vale solo durante l'ascolto senza interazioni. Sulla LG spegne il pannello tramite TV power, lasciando attivo l'audio; OK o una freccia lo riaccendono. Spegni ora applica lo stesso comando. Non viene mandato un comando di standby.

Su **Android TV**, la stessa preferenza è nelle impostazioni TV e viene salvata nel database. Le API pubbliche Android non consentono lo spegnimento fisico universale del pannello: si usa una vista nera con luminosità minima, mantenendo l'audio. La luminosità e i flag della finestra vengono ripristinati al risveglio e uscendo dall'app.

## YouTube Music

Catalogo, ricerca e riproduzione funzionano senza account. Il bridge usa lo stesso protocollo InnerTube del sito web e della versione Android TV per le pagine, e chiede l'audio con i client IOS e ANDROID_VR, che restituiscono flussi audio diretti. Si riproduce l'AAC; se la TV lo rifiuta, Bloomee riprova una volta con Opus. Gli URL di Google restano nel bridge: la pagina riceve solo l'ID del brano.

**Accesso all'account.** L'accesso Google non è possibile dentro un'app web webOS, quindi si completa da un altro dispositivo. In **Impostazioni → Account YouTube Music → Accedi con Google** (o dalla pagina YouTube) la TV apre per cinque minuti una pagina sulla rete di casa, mostrando indirizzo e codice a sei cifre (si può scrivere con o senza lo spazio). Sul telefono o sul computer aprire l'indirizzo, inserire il codice e incollare il cookie di music.youtube.com: da un browser con l'accesso, strumenti per sviluppatori, scheda Rete, una richiesta a `youtubei/v1`, valore dell'intestazione `cookie`. Il bridge verifica il cookie con Google e lo salva solo se l'account risponde; dopo cinque codici errati la pagina si chiude. Se sulla TV scegli Chiudi abbinamento o Esci mentre il cookie è in verifica, non viene salvato. **Verifica** controlla l'accesso, **Esci** cancella il cookie dalla TV.

Il cookie dà accesso all'account Google. Sulla rete di casa viaggia in chiaro (HTTP) dal dispositivo alla TV, poi resta in `/var/lib/bloomee-webos/youtube.json`, root e 0600. In alternativa lo si scrive direttamente come root:

```sh
cat > /var/lib/bloomee-webos/youtube.json <<'JSON'
{"cookie": "VALORE COPIATO"}
JSON
chmod 600 /var/lib/bloomee-webos/youtube.json
```

Per un account brand aggiungere `"dataSyncId"`, il valore `DATASYNC_ID` della pagina; `"visitorData"` è facoltativo. Il bridge firma le richieste con SAPISIDHASH e legge il file a ogni richiesta. Il cookie non va inserito nei sorgenti o nell'IPK.

Google può cambiare questi endpoint o chiedere la conferma "non sono un bot"; in quel caso il motivo compare nell'avviso e il brano non parte.

## Collegamento Jellyfin e privacy

Jellyfin è facoltativo: senza collegamento YouTube Music resta disponibile. Alla prima apertura il bridge importa, se presente, il collegamento privato di Cinema da `/var/lib/launch-home-cinema/jellyfin.json`. Altrimenti configurare `/var/lib/bloomee-webos/connection.json` come JSON con `server`, `userId` e `token`, proprietario root e permessi 0600. Non inserire credenziali nei sorgenti o nell'IPK.

Il bridge Python usa il token nell'header di autorizzazione sul server. Audio Jellyfin e YouTube e immagini Jellyfin passano da un proxy esclusivamente su 127.0.0.1, protetto da una capacità locale casuale. Il token del server non viene inserito nell'URL dei brani. La verifica TLS resta attiva. I moduli PSF di Python 2.7.18 inclusi servono sul runtime ridotto della LG e hanno licenza propria in PYTHON-LICENSE.txt.

## Build e test

```sh
cd webos
npm ci
npm test
npm run test:ui   # audit del focus da telecomando: serve Playwright con Chromium
npm run pack
```

Il pacchetto viene scritto in `release-webos/`. Per Android seguire le istruzioni del README principale. `restore.py`, eseguito come root sulla TV, riaccende il pannello, termina solo il bridge Bloomee e rimuove la sua copia privata della connessione e il cookie YouTube. Aggiornando l'app, un bridge di una versione precedente ancora attivo viene sostituito al primo avvio. Poi disinstallare Bloomee dal normale elenco app LG. Cinema e gli altri client restano installati.

## Differenze dalla versione Android

L'edizione LG usa Jellyfin e YouTube Music. Non ci sono: accesso Google direttamente sulla TV (si completa dal telefono o dal computer), ricerca vocale di Bloomee (resta il microfono della tastiera LG), Scarica (download locali e richieste Lidarr), sorgente Locale e filtro Solo scaricati della ricerca, plugin Rust/Android, profili, Cast ed equalizzatore. Come su Android, Mi piace e preferiti non vengono scritti sull'account YouTube. Non si tratta dell'APK Android eseguito in una pagina web.

## Verifiche su LG

YouTube Music (0.2.0–0.3.0) non è ancora stato provato su una LG fisica. Verificato: bridge su Python 2.7.18 e 3 con ricerca, home, classifiche, artista, playlist e radio reali, flusso audio con Range e salto nel brano, pagina di accesso (codice, cinque tentativi, riapertura, uscita); interfaccia in Chromium con `npm run test:ui` su 33 schermate e finestre. Il desktop Chromium non ha AAC e ha usato il ripiego Opus; la libreria dell'account è provata con dati finti e con i test sulla firma delle richieste, non con un account reale.

Versione 0.1.1:

Su 43UN70006LA con webOS 5: riproduzione Jellyfin readyState 4, nessun errore audio, tempo avanzato per 17 secondi durante il comando pannello spento, risveglio da freccia. Verificati album, artisti e brani, preferenza conservata dopo reinstallazione, navigazione del timer e uscita, accesso alle informazioni, ritorno al menu, assenza di overflow nelle righe delle impostazioni. I test remoti non sostituiscono una prova fisica di ogni tasto di ogni telecomando.

![Impostazioni webOS con timer e pulsanti navigabili](docs/settings.png)
