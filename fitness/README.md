# Fitness

Persoonlijke trainingsapp: werkt in de desktopbrowser en als installeerbare app (PWA) op Android.
Draait op gewone **shared hosting** (PHP + SQLite), **zonder afhankelijkheden**: geen Composer, npm of frameworks.

## Wat kan het

- **Training samenstellen zonder schema.** Kies doel (kracht, spiermassa of fit & atletisch), tijd (20–60 min) en eventueel een focus. De app maakt een complete training met warming-up, supersets en cooling-down.
  - **Rotatie:** wisselt automatisch tussen volledig lichaam A/B (of boven/onder).
  - **Hoofdoefeningen** blijven gelijk, zodat je voortgang meetbaar is. **Accessoires** variëren.
  - Kiest alleen oefeningen waarvoor jouw materiaal beschikbaar is.
- **Klaarzetten:** trainingen opslaan, aanpassen (sets, reps, rust, volgorde, supersets, wisselen) en inplannen op een datum.
- **Tijdens de training:**
  - Je ziet wat je **vorige keer** deed, met een voorstel voor **progressie** (+2,5 kg als je alles haalde).
  - Een **rusttimer** start automatisch na elke set, met −15/+15/overslaan, piepjes en trillen.
  - Getimede oefeningen (plank, stretches) hebben een eigen afteltimer.
  - Een aangepast gewicht schuift door naar de volgende sets.
  - Opwarmsets, schijvencalculator, en het scherm blijft aan.
- **Oefeningen:** 79 oefeningen met Nederlandse tips en afbeeldingen (start- en eindpositie wisselen af). Je kunt eigen oefeningen toevoegen met tips en een video-link.
- **Resultaten:**
  - Persoonlijke records, met een feestje na een training.
  - Grafiek per oefening (geschatte 1RM, zwaarste set, volume).
  - Kalender van trainingsdagen, weken op rij.
  - Sets per spiergroep per week, met richtlijn.
- **Lichaam:** gewicht en taille bijhouden met grafiek, plus **privé voortgangsfoto's** met een vergelijking naast elkaar.
- **AI-analyse van je foto's, zonder API-sleutel:**
  1. De app maakt een prompt met een vast JSON-antwoordformaat, aangevuld met je gegevens en je vorige analyse.
  2. Je deelt foto's en prompt met een AI-app naar keuze.
  3. Je plakt het antwoord terug in de app.
  4. De app controleert het streng en gebruikt de aandachtspunten als "extra aandacht" in de trainingsgenerator.
- **Statistieken:**
  - gewicht met trendlijn (gemiddelde over 7 dagen) en verandering per week;
  - taille en BMI;
  - trainingen en volume per week, krachtontwikkeling per oefening en sets per spiergroep;
  - kies de periode: 4 weken, 3 maanden, een jaar of alles.
- **Offline:** een training gaat door zonder bereik. Wordt hij offline afgerond, dan synchroniseert hij vanzelf zodra je weer online bent.
- **Export:** al je data als JSON of CSV.

## Beveiliging

- Wachtwoord gehasht met `password_hash` (bcrypt/argon2), minimaal 10 tekens.
- **Tweestapsverificatie (TOTP)** met elke authenticator-app (Google Authenticator, Aegis, …), inclusief bescherming tegen hergebruik van codes.
- Sessies in de database:
  - alleen een SHA-256-hash van de token wordt opgeslagen;
  - de cookie is `HttpOnly`, `Secure`, `SameSite=Strict` en heeft een `__Host-`-prefix;
  - uitloggen op alle andere apparaten kan, en bij een wachtwoordwijziging gebeurt dat automatisch.
- **Rate limiting:** maximaal 5 mislukte inlogpogingen per 15 minuten (per IP en per gebruikersnaam).
- **CSRF-bescherming:** een verplichte custom header plus SameSite-cookies.
- **Content-Security-Policy** zonder inline scripts. De UI zet nooit `innerHTML` met data, dus XSS is uitgesloten bij het opbouwen van de pagina.
- Registratie gaat alleen bij de eerste keer (het account van de eigenaar). Daarna is registreren dicht.
- Database en foto's staan **buiten de webroot**, met een extra `.htaccess`-blokkade. Foto's zijn alleen via een ingelogde sessie op te vragen.

## Installeren op shared hosting

Benodigd: PHP 8.0 of hoger met `pdo_sqlite` (bijna altijd standaard aan) en Apache (`.htaccess`). Een HTTPS-certificaat is nodig om de app op Android te kunnen installeren.

1. Upload de hele map `fitness/` naar je hosting, bijvoorbeeld naar `~/fitness/`, **naast** (niet in) `public_html`.
2. Laat in het controlepaneel de **document root van je subdomein** wijzen naar `~/fitness/public`.
3. Zorg dat `~/fitness/app/data` schrijfbaar is voor PHP (meestal al zo; anders rechten 755 of 775).
4. Ga naar `https://jouw-subdomein/`, maak je account aan en zet direct onder **Meer → Beveiliging** tweestapsverificatie aan.
5. Op Android: open de site in Chrome en kies **⋮ → App installeren** (of "Toevoegen aan startscherm").

**Kun je de document root niet kiezen?** Zet dan de inhoud van `public/` in de map van het subdomein, en `app/` één niveau hoger. Pas het pad in `public/api/index.php` aan als dat nodig is.

**Instellingen aanpassen (optioneel):** kopieer `app/config.sample.php` naar `app/config.php`. Daar stel je bijvoorbeeld een andere datamap of sessieduur in.

### Automatisch live zetten met GitHub Actions (optioneel)

`.github/workflows/deploy-fitness.yml` uploadt de app via FTPS naar je hosting. `app/data` (database en foto's) en `app/config.php` worden nooit overschreven.

1. Zet bij GitHub onder **Settings → Secrets and variables → Actions** deze gegevens:
   - **Secrets:** `FTP_SERVER`, `FTP_USERNAME` en `FTP_PASSWORD`.
   - **Variabele `FTP_APP_DIR`:** de map vanaf de FTP-root, bijvoorbeeld `fitness/`.
2. Voer de workflow uit via **Actions → Deploy fitness app → Run workflow**. Een handmatig te starten workflow is pas zichtbaar als hij op de standaardbranch staat.
3. Wil je dat elke push naar `main` automatisch live gaat? Zet dan de variabele `FITNESS_DEPLOY` op `true`.

### Back-up

Alles staat in `app/data/`: `fitness.sqlite` en de map `photos/`. Download die map af en toe, of gebruik **Meer → Export**.

### Updates uitrollen

Upload de gewijzigde bestanden en verhoog `VERSION` in `public/sw.js` (en `APP_VERSION` in `public/js/app.js`). Daarmee halen geïnstalleerde apps de nieuwe versie op.

## Lokaal ontwikkelen

```bash
php -S 127.0.0.1:8000 -t public
```

Open daarna http://127.0.0.1:8000. Lokaal over http werkt alles, behalve installeren als app.

Hulpscripts (alleen voor ontwikkeling):

- `php tools/fetch-images.php`: controleert de oefeningencatalogus en downloadt ontbrekende afbeeldingen.
- `php tools/make-icons.php`: genereert de app-iconen (heeft GD nodig, alleen lokaal).

## Opbouw

```
app/                 PHP-code en data – NIET in de webroot
  bootstrap.php      configuratie en autoloader
  lib/Api.php        alle API-routes (?r=…)
  lib/Auth.php       login, sessies, rate limiting
  lib/Totp.php       tweestapsverificatie (RFC 6238)
  lib/Db.php         SQLite + migraties
  data/              database en foto's (staat in .gitignore)
public/              document root
  index.html, sw.js, manifest.webmanifest, .htaccess
  api/index.php      ingang van de API
  data/exercises.json  oefeningencatalogus (Nederlands)
  img/ex/            oefeningafbeeldingen
  js/                app (ES-modules, geen build-stap)
    generator.js     regels voor het samenstellen van trainingen
    timer.js         rust-/werktimer (tijdstempel-gebaseerd)
    store.js         data, statistieken en progressie
    views/           schermen
  css/app.css
tools/               ontwikkelscripts
```

## Later

- Koppeling met Google Agenda: ingeplande trainingen als afspraak. De datums staan al klaar in `templates.planned_for`.
- Health Connect (Android) of een echte achtergrondtimer via een native wrapper (Capacitor).

## Bronnen

Oefeningafbeeldingen komen uit [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (publiek domein, Unlicense). De Nederlandse namen en tips zijn zelf geschreven.
