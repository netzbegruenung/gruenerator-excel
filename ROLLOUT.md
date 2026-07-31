# Grünerator für Excel — Weg in den Produktivbetrieb

Fünf Phasen. Jede endet mit etwas Nachprüfbarem; kommt die Prüfung nicht
zustande, geht es nicht weiter.

---

## Phase 0 — Fundament (erledigt)

- Repo `netzbegruenung/gruenerator-excel`, Standardbranch `gruenerator`,
  vorerst **privat**.
- `Dockerfile`, `docker/nginx.conf`, GitHub-Workflow, `DEPLOYMENT.md`.
- CSP korrigiert (`gruenerator.eu` in `connect-src`), Paritätstest zwischen
  Container-nginx und `vercel.json`.
- Manifest für `excel.gruenerator.eu` erzeugt, eigene GUID.

**Offen aus dieser Phase:** Der Pre-Push-Hook aus dem Upstream lässt
`npm audit` laufen und bricht bei Funden ab. 27 Funde stecken im
Office-Add-in-Werkzeug (dev-only) und sind älter als der Fork. Bis dahin
braucht jeder Push `--no-verify` — das gehört entschieden, nicht umgangen.

---

## Phase 1 — Backend produktiv

Der Endpunkt liegt auf `feat/excel-addon-completions` und **nicht** auf
`master`. Ohne diese Phase gibt es nichts, wogegen das Add-in arbeiten könnte.

1. Branch auf `master` aktualisieren, PR, mergen, deployen.
2. Im selben PR: `excel.gruenerator.eu` in `ALLOWED_DOMAINS`
   (`apps/api/config/domains.ts`). Der CORS-Vergleich ist **exakt** — die
   Subdomain erbt nichts von `gruenerator.eu`.
3. Revoke-Skript als Gegenstück zu `mintApiKey`. Solange es fehlt, ist der
   einzige Notausgang ein Datenbankzugriff.

**Prüfung:** `curl https://gruenerator.eu/api/v1/models` antwortet 401 (nicht
404). 404 heißt: nicht deployt.

---

## Phase 2 — Hosting über Salt

Im Repo `verdigado-Privileged/Salt`, drei Dateien:

1. **DNS zuerst.** `excel.gruenerator.eu` muss auflösen, bevor Let's Encrypt
   ein Zertifikat ausstellen kann.
2. `pillars/letsencrypt/net/verdigado/netzbegruenung/gruenerator.sls` —
   `excel.gruenerator.eu` in die Domainliste. Analog `gruenerator-test.sls`
   für `excel.beta.gruenerator.eu`.
3. `states/gruenerator-docker/files/docker-compose.yml.j2` — Dienst `excel`
   mit `ghcr.io/netzbegruenung/gruenerator-excel:${TAG:-latest}`. Vorbild ist
   der Dienst `doku`: gleiche Form, gleicher Healthcheck.
4. `states/gruenerator-docker/files/nginx.conf.j2` — `server`-Block für
   `excel.{{ pillar["gruenerator"]["domain"] }}` auf `http://excel:80`.

Commit-Konvention dort: `Excel Add-in: add hosting`, erste Zeile ≤ 50 Zeichen,
danach Aufzählung mit dem Warum. **Signiert** — und das Signieren braucht ein
echtes Terminal, weil der YubiKey eine PIN abfragt.

**Prüfung:** `https://excel.gruenerator.eu/src/taskpane.html` liefert 200 mit
gültigem Zertifikat, und der Antwort-Header enthält die CSP.

---

## Phase 3 — Pilotkreis (2–3 Personen, Sideloading)

1. Pro Person ein eigener Schlüssel — nie einer für alle, sonst ist Sperren
   eine Kollektivstrafe:
   ```
   pnpm mint-api-key --user <profil-id> --label "Vorname Nachname" \
     --scope chat:completions --expires-in-days 180 --rate-limit 20
   ```
2. `manifest.prod.xml` verteilen, jede Person lädt es selbst hoch
   (Add-Ins → Meine Add-Ins → Hochladen). Keine Administration nötig.
3. Zugang öffnen, Schlüssel einfügen, **„Verbindung testen"**. Der Test prüft
   Erreichbarkeit, Schlüssel, Berechtigung, Modellkennung und den Datenstrom —
   in derselben Betriebsart, die der Chat benutzt.

**Prüfung:** Bei allen drei Personen steht „Verbindung steht", und eine echte
Anfrage läuft durch. `last_used_at` in `api_keys` zeigt die Nutzung.

**Abbruchkriterium:** Meldet der Test grün und der Chat scheitert trotzdem,
nennt die Fehlermeldung inzwischen Adresse und Grund. Diese Zeile ist das
Signal — nicht weiterrollen, bevor sie verstanden ist.

---

## Phase 4 — Breiter, zentral verteilt

1. Zentrale Bereitstellung im Microsoft-365-Admin-Center: Add-in gezielt
   Personen oder Gruppen zuweisen. Braucht eine Tenant-Administration.
2. Ratenbegrenzung nach den Messwerten aus Phase 3 nachziehen.
3. Repo auf öffentlich stellen, falls gewünscht — private → public ist
   einfach, umgekehrt nicht.

**Prüfung:** Das Add-in erscheint bei den zugewiesenen Personen von selbst.

---

## Was du dabei in Kauf nimmst

- **Der Schlüssel ist ein Bearer-Token.** Wer ihn hat, kann ihn auch per
  `curl` benutzen. Eingegrenzt wird das durch Scope, Zwei-Modell-Liste,
  120k-Kontextprüfung und Ratenbegrenzung — nicht dadurch, dass er „für Excel"
  ist.
- **Die Ratenbegrenzung ist fail-open.** Fällt Redis aus, läuft alles durch.
  Bewusst so, damit ein Redis-Schluckauf nicht die API lahmlegt.
- **Keine Verbrauchsabrechnung pro Schlüssel.** Nur `last_used_at`. Die
  Modellkosten landen gesammelt auf dem LiteLLM-Konto. Für einen ausgewählten
  Kreis vertretbar, für eine Öffnung nicht.
- **Kein Selbstbedienungsweg für Schlüssel.** Ausgabe von Hand, bewusst so
  entschieden.
- **Der Schlüssel liegt pro Gerät im Browserspeicher.** Zwei Rechner heißt:
  zweimal eintragen.

---

## Reihenfolge, kurz

```
DNS  →  Phase 1 (Backend + CORS)  →  Phase 2 (Salt + TLS)
     →  Phase 3 (Pilot, Sideloading)  →  Phase 4 (zentral)
```

Phase 1 und 2 lassen sich parallel vorbereiten, aber Phase 2 kann erst
abgenommen werden, wenn das Backend steht — sonst prüft man eine leere Hülle.
