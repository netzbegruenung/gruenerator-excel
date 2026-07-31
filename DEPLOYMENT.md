# Deployment

Das Add-in ist ein statischer Vite-Build. Es hat keinen eigenen Serveranteil —
der Modellzugriff geht an das Grünerator-Backend unter `/api/v1`.

## Wo was liegt

| Teil | Ort |
| --- | --- |
| Taskpane (dieses Repo) | `https://excel.gruenerator.eu` |
| Modellzugriff | `https://gruenerator.eu/api/v1` (Repo `netzbegruenung/Gruenerator`) |
| Image | `ghcr.io/netzbegruenung/gruenerator-excel` |
| Rollout | Salt-State `gruenerator-docker` (`verdigado-Privileged/Salt`) |

Gebaut wird in GitHub Actions (`.github/workflows/build-image.yml`),
ausgerollt über Salt — dieselbe Strecke wie der `doku`-Dienst.

## Zwei Allowlists, die beide stimmen müssen

Taskpane und Backend liegen auf **verschiedenen Hosts**. Damit ist jeder
Modellaufruf cross-origin, und zwei voneinander unabhängige Listen entscheiden,
ob er durchkommt:

1. **CSP** (`connect-src`) — steht in `docker/nginx.conf` und, für
   Vercel-Deployments des Upstream-Projekts, in `vercel.json`.
   `tests/taskpane-csp.test.mjs` hält beide deckungsgleich.
2. **CORS** im Backend — `ALLOWED_DOMAINS` in
   `apps/api/config/domains.ts`. Der Vergleich dort ist **exakt**: die
   Subdomain-Logik (`endsWith`) sitzt in `isAllowedDomain` und gilt für CORS
   nicht. `excel.gruenerator.eu` muss also ausdrücklich eingetragen sein — es
   erbt nichts von `gruenerator.eu`.

Fehlt eine der beiden, funktioniert lokal alles und in Produktion nichts: im
Dev-Server ist der Aufruf same-origin, dort greift keine der Listen.

## Salt-Änderungen für einen neuen Host

Im Repo `verdigado-Privileged/Salt`:

1. `pillars/letsencrypt/net/verdigado/netzbegruenung/gruenerator.sls` —
   `excel.gruenerator.eu` in die Domainliste (analog `gruenerator-test.sls`
   für `excel.beta.gruenerator.eu`).
2. `states/gruenerator-docker/files/docker-compose.yml.j2` — Dienst `excel`
   mit `ghcr.io/netzbegruenung/gruenerator-excel:${TAG:-latest}`, Vorbild ist
   der Dienst `doku`.
3. `states/gruenerator-docker/files/nginx.conf.j2` — `server`-Block für
   `excel.{{ pillar["gruenerator"]["domain"] }}`, der auf `http://excel:80`
   weiterleitet.

Der DNS-Eintrag muss stehen, **bevor** das Zertifikat ausgestellt werden kann.

## Manifest

`public/manifest.prod.xml` wird erzeugt, nicht von Hand gepflegt:

```bash
ADDIN_BASE_URL="https://excel.gruenerator.eu" \
  OUT=public/manifest.prod.xml node scripts/generate-manifest.mjs
```

Die `<Id>` ist eine eigene GUID (nicht die des Upstream-Projekts) — beide
Add-ins können also nebeneinander installiert sein.

## Verteilung

- **Sideloading**: jede Person lädt das Manifest selbst hoch. Ohne
  Administration, geeignet für einen Pilotkreis.
- **Zentrale Bereitstellung** über das Microsoft-365-Admin-Center: gezielt an
  Personen oder Gruppen. Braucht eine Tenant-Administration.

## Zugangsschlüssel

Ein Schlüssel pro Person, damit einzeln gesperrt werden kann:

```bash
pnpm mint-api-key --user <profil-id> --label "Vorname Nachname" \
  --scope chat:completions --expires-in-days 180 --rate-limit 20
```

Der Schlüssel liegt im Browserspeicher **pro Gerät** — wer Excel auf zwei
Rechnern nutzt, trägt ihn zweimal ein.
