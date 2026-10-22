# Bloomee per LG webOS

Porting leggero di BloomeeTV per una LG con webOS 5 (Chrome 68), Homebrew Channel e root. L'app Android originale resta nel repository e conserva le proprie funzioni.

## Musica e telecomando

Album, artisti, brani e preferiti del proprio Jellyfin; ricerca, dettaglio album, coda, casuale e ripetizione. Frecce e OK navigano nei controlli. Sinistra dalle impostazioni torna al menu. Indietro chiude le opzioni prima di lasciare la pagina.

In **Impostazioni → Spegni schermo dopo**, scegliere Mai, 15/30 secondi oppure 1/2/5 minuti. La preferenza resta salvata. Il timer vale solo durante l'ascolto senza interazioni. Sulla LG spegne il pannello tramite TV power, lasciando attivo l'audio; OK o una freccia lo riaccendono. Spegni ora applica lo stesso comando. Non viene mandato un comando di standby.

Su **Android TV**, la stessa preferenza è nelle impostazioni TV e viene salvata nel database. Le API pubbliche Android non consentono lo spegnimento fisico universale del pannello: si usa una vista nera con luminosità minima, mantenendo l'audio. La luminosità e i flag della finestra vengono ripristinati al risveglio e uscendo dall'app.

## Collegamento Jellyfin e privacy

Alla prima apertura il bridge importa, se presente, il collegamento privato di Cinema da `/var/lib/launch-home-cinema/jellyfin.json`. Altrimenti configurare `/var/lib/bloomee-webos/connection.json` come JSON con `server`, `userId` e `token`, proprietario root e permessi 0600. Non inserire credenziali nei sorgenti o nell'IPK.

Il bridge Python usa il token nell'header di autorizzazione sul server. Audio e immagini passano da un proxy esclusivamente su 127.0.0.1, protetto da una capacità locale casuale. Il token del server non viene inserito nell'URL dei brani. La verifica TLS resta attiva. I moduli PSF di Python 2.7.18 inclusi servono sul runtime ridotto della LG e hanno licenza propria in PYTHON-LICENSE.txt.

## Build e test

```sh
cd webos
npm ci
npm test
npm run pack
```

Il pacchetto viene scritto in `release-webos/`. Per Android seguire le istruzioni del README principale. `restore.py`, eseguito come root sulla TV, riaccende il pannello, termina solo il bridge Bloomee e rimuove la sua copia privata della connessione. Poi disinstallare Bloomee dal normale elenco app LG. Cinema e gli altri client restano installati.

## Differenze dalla versione Android

Questa prima edizione LG usa Jellyfin. Plugin Rust/Android, accesso YouTube Music, Cast, equalizzatore e download offline non sono implementati nel runtime webOS. Non si tratta dell'APK Android eseguito in una pagina web.

## Verifiche su LG

Su 43UN70006LA con webOS 5: riproduzione Jellyfin readyState 4, nessun errore audio, tempo avanzato per 17 secondi durante il comando pannello spento, risveglio da freccia. Verificati album, artisti e brani, preferenza conservata dopo reinstallazione, navigazione del timer e uscita, accesso alle informazioni, ritorno al menu, assenza di overflow nelle righe delle impostazioni. I test remoti non sostituiscono una prova fisica di ogni tasto di ogni telecomando.

![Impostazioni webOS con timer e pulsanti navigabili](docs/settings.png)
