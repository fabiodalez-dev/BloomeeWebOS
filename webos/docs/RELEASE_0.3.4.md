# Bloomee per LG webOS 0.3.4

I brani di YouTube Music si ascoltano di nuovo fino alla fine, e si può saltare avanti.

## Cosa cambia

- **YouTube suona di nuovo.** Da ottobre 2026 i server audio di YouTube servono i flussi dei client iOS e Android solo per il primo megabyte, se manca un token che un'app come Bloomee non può generare; il player della TV chiede subito il file intero e si fermava con «La TV non riesce a riprodurre questo brano di YouTube». Ora il bridge chiede l'audio come client visionOS, insieme all'identificativo anonimo di visitatore che YouTube assegna a ogni browser: così i flussi arrivano interi. iOS e Android restano come riserva.
- **Salti nel brano.** Il bridge sceglie prima l'audio Opus, in cui il player della LG salta avanti e indietro senza problemi; nell'AAC di YouTube un salto faceva ripartire il brano da capo. Se una TV non riproduce l'Opus, l'app passa da sola all'AAC.
- Il bridge passa alla versione 6: al primo avvio dopo l'aggiornamento quello vecchio viene sostituito.

## Installazione

Scarica `org.bloomee.webos_0.3.4_all.ipk` e installalo con webOS Dev Manager o `ares-install`, come per le versioni precedenti.

## Verifiche

33 test JavaScript e 21 test Python del bridge superati, compresi due nuovi sull'identificativo di visitatore. Provata su una LG 43UN70006LA con webOS 5 dall'interfaccia di Bloomee: cercato e avviato un brano di YouTube Music, in riproduzione dopo dieci secondi senza errori, salto a mezzo minuto dalla fine eseguito. Con il player della TV anche un secondo brano suona oltre il primo megabyte, e un brano Jellyfin continua a funzionare.

## Limiti noti

YouTube cambia spesso le regole per i client non ufficiali: questa correzione vale finché il client visionOS resta accettato. Restano validi i limiti della 0.3.0.

Licenza GPL-2.0; Bloomee originale di HemantKArya.
