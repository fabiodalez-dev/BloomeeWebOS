# Bloomee per LG webOS 0.3.5

Per ascoltare musica a letto: lo schermo spento resta spento, e chi vuole qualcosa da guardare ha un visualizzatore lento e morbido che segue la musica.

## Cosa cambia

- **Lo schermo spento resta spento.** Alla fine di ogni brano il browser della TV segnala una pausa, e Bloomee riaccendeva lo schermo a ogni canzone. Ora lo riaccende solo un tasto, uno qualsiasi; play, pausa, avanti e indietro fanno anche il loro lavoro.
- **I tasti non si bloccano più dopo il risveglio.** Il primo tasto lo riceve LG, che riaccende lo schermo da sola; Bloomee chiedeva poi di riaccendere uno schermo già acceso, riceveva un errore e restava convinta che fosse spento, ignorando ogni tasto con «Controllo pannello non disponibile».
- **Mentre ascolti**, in Impostazioni: allo scadere del tempo scelto la TV spegne lo schermo, mostra la copertina con il brano, oppure un visualizzatore.
- **Visualizzatori per una camera da letto.** Quattro sfumature morbide alla maniera degli sfondi di macOS, senza bordi, che si spostano lentissime e respirano con i bassi: Viola e pesca, Oceano, Aurora, Tramonto. Le stesse con uno spettro a onda in basso (Spettro …). E alcuni preset classici di MilkDrop, con Butterchurn: Castello in aria, Nebulosa, Mare in tempesta, Madreperla, Goccia lucida, Diffusione, Respiro. Si sceglie in Impostazioni → Visualizzatore, oppure «Cambia da solo».
- **Una copertina bianca** per i brani senza copertina, nel visualizzatore e in basso, invece di un riquadro vuoto.
- **Icone** su Cerca, Personalizza e Filtri: i caratteri della TV non hanno quei simboli e mostravano un quadratino.
- **Le pagine arrivano fino al lettore**: sotto le Impostazioni restava una banda nera di 120 pixel.
- **In coda** la pagina si apre sul brano in ascolto, con quelli già sentiti sopra; artista e durata sulla riga rosa ora si leggono.

## Come funziona il visualizzatore

Il player della LG suona l'audio nella sua pipeline hardware: Web Audio collegato all'elemento audio sente solo silenzio. Il visualizzatore scarica quindi una seconda copia del brano dal bridge, la decodifica a 11 kHz in mono e la suona in silenzio, allineata al player, per misurarne lo spettro. Disegna con WebGL sulla GPU della TV. Quando si chiude restituisce GPU e audio: con il visualizzatore aperto e un ricaricamento dell'app, le app web della TV hanno superato i 420 MB e LG ha riavviato la TV.

## Installazione

Scarica `org.bloomee.webos_0.3.5_all.ipk` e installalo con webOS Dev Manager o `ares-install`, come per le versioni precedenti.

## Verifiche

34 test JavaScript e 21 test Python del bridge superati. Provata su una LG 43UN70006LA con webOS 5: con lo schermo spento il cambio di brano e la fine della coda lasciano il pannello spento, un tasto lo riaccende e i tasti successivi funzionano; i visualizzatori seguono la musica, lo shader si compila sulla GPU Mali della TV, la pagina delle Impostazioni arriva fino al lettore.

## Limiti noti

Il visualizzatore prepara il brano in qualche secondo (circa 10 per due minuti di MP3); fino ad allora le immagini si muovono senza musica. I brani di YouTube nel visualizzatore non sono stati provati. Alcuni preset di MilkDrop si muovono a ogni fotogramma e non si lasciano rallentare.

Licenza GPL-2.0; Bloomee originale di HemantKArya. Butterchurn e butterchurn-presets sono MIT.
