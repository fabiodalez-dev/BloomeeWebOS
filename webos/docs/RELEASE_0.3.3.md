# Bloomee per LG webOS 0.3.3

Bloomee torna in primo piano quando la si riapre mentre è ancora in esecuzione.

## Cosa cambia

- **Bloomee si riapre davvero.** L'app dichiarava a webOS di gestire da sola il proprio rilancio (`handlesRelaunch`). Finché webOS la chiudeva ogni volta che si apriva un'altra app, ogni apertura era un avvio da zero e il problema non si vedeva. Quando Bloomee resta in memoria, per esempio mentre suona in sottofondo e si torna alla Home, riaprirla dal launcher o dall'elenco delle app la risvegliava dietro alla Home senza mostrarla. Ora è webOS a portarla davanti; l'app riceve comunque l'evento di rilancio e riaccende lo schermo se il timer lo aveva spento.

## Installazione

Scarica `org.bloomee.webos_0.3.3_all.ipk` e installalo con webOS Dev Manager o `ares-install`, come per le versioni precedenti.

## Verifiche

33 test JavaScript e 19 test Python del bridge superati, compreso uno nuovo su `appinfo.json`. Provata su una LG 43UN70006LA con webOS 5 con Bloomee lasciata in memoria: aperta dall'elenco Tutte le app del launcher e rilanciata tre volte di seguito dopo il tasto Home, Bloomee è sempre in primo piano secondo il gestore delle applicazioni di webOS, con la pagina visibile e Jellyfin collegato.

## Limiti noti

Restano validi i limiti della 0.3.0.

Licenza GPL-2.0; Bloomee originale di HemantKArya.
