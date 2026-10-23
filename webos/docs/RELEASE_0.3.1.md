# Bloomee per LG webOS 0.3.1

Correzione per i brani di YouTube Music bloccati per dieci minuti con "Accedi per confermare di non essere un bot" anche quando YouTube li avrebbe riprodotti.

## Cosa cambia

- **Un errore di rete non blocca più il brano.** Se il primo client di YouTube (IOS) non rispondeva, per un timeout o una connessione lenta subito dopo l'avvio del bridge, Bloomee passava ad ANDROID_VR, che oggi rifiuta sempre con la richiesta di conferma "non sono un bot", e ricordava quel rifiuto per dieci minuti. Ora un brano viene ricordato come non disponibile solo quando tutti i client hanno risposto di no; dopo un errore di rete il tentativo successivo riparte da capo.
- **Nuovo client ANDROID** tra IOS e ANDROID_VR. Dalla stessa rete di casa IOS e ANDROID restituiscono flussi audio diretti, mentre ANDROID_VR, TVHTML5, WEB_EMBEDDED e MWEB vengono rifiutati: se IOS non risponde, ANDROID prende il suo posto.
- Il bridge passa alla versione 4: al primo avvio dopo l'aggiornamento quello vecchio viene sostituito.

## Installazione

Scarica `org.bloomee.webos_0.3.1_all.ipk` e installalo con webOS Dev Manager o `ares-install`, come per la 0.3.0.

## Verifiche

32 test JavaScript e 18 test Python del bridge superati, compresi due nuovi: un client che va in errore non fa ricordare il brano come rifiutato, e ANDROID risponde quando IOS non è raggiungibile. Provata su una LG 43UN70006LA con webOS 5: tre brani di YouTube Music serviti dal bridge con risposta 206 e audio AAC.

## Limiti noti

Sulla LG di prova il primo pezzo di ogni brano arriva dopo circa venti secondi: la rete ha un indirizzo IPv6 che non porta da nessuna parte e il bridge prova IPv4 solo allo scadere del timeout. Restano validi i limiti della 0.3.0.

Licenza GPL-2.0; Bloomee originale di HemantKArya.
