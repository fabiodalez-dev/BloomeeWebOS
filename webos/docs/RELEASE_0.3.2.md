# Bloomee per LG webOS 0.3.2

I brani di YouTube Music partono in meno di un secondo invece che dopo venti.

## Cosa cambia

- **Il bridge prova prima IPv4.** I server audio di YouTube (googlevideo.com) rispondono per primo con un indirizzo IPv6, ma su molte reti di casa IPv6 non porta da nessuna parte: il bridge aspettava tutti i venti secondi del timeout prima di passare a IPv4, all'inizio di ogni brano e a ogni salto in avanti nel brano. Ora le connessioni provano prima gli indirizzi IPv4 e poi quelli IPv6, che restano disponibili per i server raggiungibili solo in IPv6.
- Il bridge passa alla versione 5: al primo avvio dopo l'aggiornamento quello vecchio viene sostituito.

## Installazione

Scarica `org.bloomee.webos_0.3.2_all.ipk` e installalo con webOS Dev Manager o `ares-install`, come per le versioni precedenti.

## Verifiche

32 test JavaScript e 19 test Python del bridge superati, compreso uno nuovo che controlla l'ordine degli indirizzi e che una connessione raggiunga IPv4 senza aspettare IPv6. Provata su una LG 43UN70006LA con webOS 5 e Python 2.7: tre brani di YouTube Music serviti dal bridge con risposta 206 e audio AAC in 0,5-0,9 secondi, un salto a metà brano in 0,09 secondi.

## Limiti noti

Restano validi i limiti della 0.3.0.

Licenza GPL-2.0; Bloomee originale di HemantKArya.
