# Bloomee per LG webOS 0.3.0

YouTube Music arriva sulla LG con le stesse funzioni della versione Android TV, insieme a Jellyfin, e il telecomando non si blocca più in nessuna schermata.

## YouTube Music

- **Home**: la testata mostra l'elemento selezionato. Righe Fissati, Aggiunti di recente e Scelti per te (Jellyfin), Ascoltati di recente su YouTube e Per te su YouTube (con account), Ascoltati di recente sulla TV, Classifiche e sezioni di YouTube Music. **Personalizza** nasconde e sposta le righe e sceglie quale aprire per prima.
- **Cerca**: Jellyfin e YouTube Music insieme. Tutto / Brani / Album / Artisti, **Filtri** per sorgente, playlist, ordine A–Z, anno, versione (live, remix…) e raggruppamento delle versioni. Ogni sorgente risponde per conto suo, con Riprova e Altri risultati.
- **Artista**: ascoltatori mensili, iscritti, biografia completa, Riproduci tutto, Casuale, Brani più famosi, album, singoli, video, artisti simili e tutti i brani.
- **Album, playlist ed elenchi completi**: Riproduci, Casuale, In coda.
- **Il mio YouTube**: Per te, Cronologia, Mi piace, Playlist, Album, Artisti dell'account.
- **OK tenuto premuto** (o tasto rosso): Fissa nella Home, Salva nei preferiti unificati, Riproduci dopo. Pagina dei preferiti unificati e cuore nella barra del player.
- **Riproduzione automatica**: verso la fine della coda aggiunge la radio di YouTube Music. Un brano che non si riproduce viene saltato.
- **Accesso all'account dal telefono o dal computer**: Impostazioni → Account YouTube Music → Accedi con Google mostra un indirizzo e un codice a sei cifre. Si incolla il cookie di music.youtube.com; la TV lo verifica con Google prima di salvarlo. Sulla rete di casa il cookie viaggia senza cifratura.

## Telecomando

Frecce e OK su ogni controllo; destra e sinistra restano sulla stessa riga, dal bordo sinistro si torna al menu. Finestre di dialogo chiuse con Indietro, con il focus che torna dove eri. Barra del brano: sinistra e destra spostano di dieci secondi. Un audit automatico prova le quattro frecce su ogni controllo di 33 schermate e finestre.

## Installazione

Serve una LG con webOS e Homebrew Channel con accesso root. Scarica `org.bloomee.webos_0.3.0_all.ipk` e installalo, per esempio con webOS Dev Manager o `ares-install`. Aggiornando dalla 0.1.1 il vecchio bridge viene sostituito al primo avvio. Jellyfin resta facoltativo; la configurazione è descritta nel [README di webOS](https://github.com/fabiodalez-dev/BloomeeWebOS/blob/main/webos/README.md).

## Limiti noti

- **Questa versione non è ancora stata provata su una LG fisica.** Verificata con il bridge su Python 2.7.18 e YouTube Music reale (ricerca, artisti, radio, flusso audio) e con l'interfaccia in Chromium; la libreria dell'account è provata solo con dati finti.
- Il desktop Chromium usato nelle prove non riproduce l'AAC: sulla TV l'audio AAC va confermato; in caso di rifiuto Bloomee riprova in Opus.
- Google può cambiare gli endpoint di YouTube Music o chiedere la conferma "non sono un bot".
- Non inclusi rispetto ad Android: accesso Google direttamente sulla TV, ricerca vocale di Bloomee, download e Lidarr, plugin, profili, Cast, equalizzatore. Mi piace e preferiti non vengono scritti sull'account YouTube.

## Verifiche

32 test JavaScript, 16 test Python del bridge e audit del focus superati; analisi e 106 test Flutter verdi per il codice Android incluso nel repository.

Licenza GPL-2.0; Bloomee originale di HemantKArya.
