# Previsioni Meteo — versione aggiornata

## Avvio e aggiornamento

Pubblica **tutto il contenuto di questa cartella**, comprese `vendor/`, `app.js`, `core.js`, `translations.js` e i due CSS, nella stessa cartella del sito precedente. Non basta sostituire soltanto `index.html`.

La PWA e la geolocalizzazione richiedono HTTPS o localhost. Il doppio clic su `index.html` permette solo una consultazione limitata: l’installazione e il service worker non sono disponibili con `file://`.

Quando una nuova versione è pronta, il pulsante mostra **Nuova versione · Ricarica**. Il consenso alla ricarica attiva la nuova versione completa. Se il vecchio sito continua a comparire, chiudi tutte le sue finestre e riaprilo.

## Comportamento

- Il passaggio a **IT** imposta **°C**; il passaggio a **EN** imposta **°F**. Il pulsante delle unità permette comunque una modifica manuale. Lingua, ultima unità scelta e ultima località vengono ricordate.
- Lo spinner accanto al nome compare solo durante il recupero del meteo o della posizione e si ferma anche in caso di errore. Aria e mare si aggiornano indipendentemente.
- “Aggiorna” richiede dati nuovi. Finché l’app è visibile, viene controllata ogni minuto l’età dei dati e si aggiornano quelli più vecchi di 10 minuti.
- Gli ultimi dati di un massimo di 24 località restano sul dispositivo. Offline vengono mostrati con l’indicazione di mancato aggiornamento e la data del download. Lo storage del browser può comunque essere cancellato o non essere disponibile.
- I preferiti già salvati con la chiave `weather_favs_v9` sono conservati se l’app viene pubblicata sulla stessa origine del sito precedente. Una nuova origine ha uno storage separato.
- Le previsioni restano a 4 giorni. Date e orari sono quelli della località; il download è indicato nell’ora del dispositivo. I valori mancanti sono “—”.

## Aria, mare e radar

**Qualità dell’aria:** AQI europeo, PM₂.₅, PM₁₀, NO₂, O₃ e SO₂; pollini di graminacee, olivo, betulla, ambrosia, ontano e artemisia dove disponibili. Sono dati previsionali di modello, non misure di una centralina locale. Fonte: [Open-Meteo / CAMS](https://open-meteo.com/en/docs/air-quality-api). I pollini sono limitati alla copertura europea e alla stagione pollinica.

**Meteo mare:** altezza, periodo e direzione delle onde, temperatura dell’acqua e una breve sequenza oraria. È mostrato se il modello restituisce onde valide su un punto marino entro 30 km dalla località. La distanza e le coordinate del punto sono esplicite: questo criterio non è una classificazione amministrativa dei comuni costieri. Se non ci sono dati, il pannello lo indica. Fonte: [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api).

**Meteo & Radar:** “Radar in app” apre il radar incorporato da [meteoeradar.it](https://www.meteoeradar.it/radar-meteo), servito da `radar.wo-cloud.com`; “Radar esterno” apre la stessa vista in una nuova scheda. Vengono passati latitudine, longitudine, zoom, lingua e unità della selezione. Quando si cambia città, anche la vista già aperta viene ricentrata. Sotto il radar è disponibile una previsione oraria delle precipitazioni Open-Meteo, selezionabile su 24, 48 o 72 ore.

Il riquadro esterno richiede Internet. Eventuali consensi, blocchi di incorporamento o modifiche del fornitore possono richiedere l’apertura della nuova scheda. La mappa non viene scaricata o memorizzata per la consultazione offline.

## File e verifiche

Il codice è diviso in HTML, CSS, traduzioni, funzioni dati e applicazione. Chart.js 4.4.8 è distribuito localmente con la sua licenza MIT in `vendor/`. I dati Open-Meteo sono attribuiti ai fornitori nell’interfaccia.

Controlli effettuati: sintassi JavaScript e manifest; risposte HTTP reali delle API meteo, aria e mare; test automatici DOM su dati mancanti, concorrenza, cache offline, spinner, unità, radar e accessibilità della finestra; test del service worker. Non è stata eseguita una prova completa di installazione su iPhone o Android né un controllo visivo del contenuto dei portali esterni.
