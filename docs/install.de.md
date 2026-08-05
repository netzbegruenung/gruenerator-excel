# Grünerator für Excel installieren

> English version: [install.md](install.md)

Keine Entwicklungswerkzeuge nötig — eine Datei herunterladen, in Excel einbinden, mit dem Grünerator-Konto anmelden.

---

## 1) Manifest-Datei herunterladen

Diese Datei herunterladen und irgendwo speichern, wo sie wiederzufinden ist (z. B. auf dem Schreibtisch):

👉 **[manifest.prod.xml](https://excel.gruenerator.eu/manifest.prod.xml)**

---

## 2) In Excel einbinden

### macOS

1. Finder öffnen und **Cmd + Umschalt + G** drücken (Gehe zu Ordner)
2. Diesen Pfad einfügen und Enter drücken:
   ```
   ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef
   ```
3. `manifest.prod.xml` in diesen Ordner kopieren
4. Excel vollständig beenden (Cmd + Q) und neu öffnen
5. **Einfügen → Meine Add-ins** öffnen — dort sollte **Grünerator für Excel** erscheinen. Anklicken, um das Add-in zu registrieren.
6. Auf der Registerkarte **Start** ganz rechts das Symbol **Add-ins** suchen. Anklicken, dann **Grünerator öffnen** wählen, um die Seitenleiste zu öffnen.

   <img src="../public/assets/add-ins-button.png" width="200" alt="Add-ins-Symbol im Start-Ribbon" />
   <img src="../public/assets/add-ins-dropdown.png" width="200" alt="Grünerator im Add-ins-Menü" />

> **Ordner existiert nicht?** Erst anlegen — Terminal öffnen und ausführen:
> ```bash
> mkdir -p ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef
> ```
> Danach ab Schritt 3 wiederholen.

Mehr Details in [Microsofts Anleitung für Mac](https://learn.microsoft.com/de-de/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac).

### Windows

1. Excel öffnen
2. **Einfügen → Meine Add-ins** öffnen
3. **Eigenes Add-In hochladen…** anklicken
4. Die heruntergeladene Datei `manifest.prod.xml` auswählen
5. In der Menüband-Leiste **Grünerator öffnen** anklicken

> ⚠️ Für `manifest.prod.xml` unbedingt **Eigenes Add-In hochladen…** verwenden.
> **Nicht** über **Verwalten → XML-Erweiterungspakete** einbinden — das ist ein veralteter Excel-Pfad, der bei Office-Add-in-Manifesten irreführende Zertifikatsfehler zeigen kann.

Mehr Details in [Microsofts Anleitung für Windows](https://learn.microsoft.com/de-de/office/dev/add-ins/testing/sideload-office-add-ins-for-testing).

### Excel im Web (Office Online)

> **Von der Community beigetragen — nicht offiziell getestet.** Diese Schritte stammen von einer Beitragenden Person und passen möglicherweise nicht zu jedem Microsoft-365-Mandanten. Falls es anders aussieht, siehe [Microsofts Sideloading-Anleitung für Office im Web](https://learn.microsoft.com/de-de/office/dev/add-ins/testing/sideload-office-add-ins-for-testing#manually-sideload-an-add-in-to-office-on-the-web).

1. **[Excel (Web)](https://www.office.com/launch/excel)** im Browser öffnen
2. Eine vorhandene Arbeitsmappe öffnen oder eine neue Excel-Datei anlegen
3. Auf der Registerkarte **Start** rechts auf **Add-ins** klicken
4. **Weitere Add-ins** anklicken
5. **Meine Add-ins** öffnen
6. **Meine Add-ins verwalten** anklicken
7. **Eigenes Add-In hochladen** anklicken
8. Die Datei `manifest.prod.xml` hochladen

> ⚠️ Bei Excel im Web kann das Add-in nach einigen Tagen verschwinden. In dem Fall die Upload-Schritte oben wiederholen.

---

## 3) Erster Funktionstest

1. Seitenleiste öffnen (Symbol **Add-ins** im Start-Ribbon, dann **Grünerator öffnen**)
2. Anmelden (siehe unten)
3. Eine Testanfrage senden, z. B.:
   - `Auf welchem Tabellenblatt bin ich gerade?`
   - `Fasse meine aktuelle Auswahl zusammen`

Kommt eine Antwort zurück, ist die Installation abgeschlossen.

---

## 4) Anmelden

Grünerator für Excel hat genau eine Modellquelle: das Grünerator-Backend (`https://gruenerator.eu`). Es gibt zwei Wege, sich damit zu verbinden — anders als beim Original-Projekt Pi for Excel müssen keine eigenen API-Schlüssel für OpenAI, Anthropic o. ä. besorgt werden.

### Empfohlen: Mit Grünerator anmelden

1. In der Seitenleiste beim Anmeldebildschirm (oder über `/settings`) **Mit Grünerator anmelden** wählen
2. Im sich öffnenden Fenster mit dem bestehenden Grünerator-Konto anmelden
3. Zurück zu Excel wechseln — die Anmeldung wird automatisch übernommen

### Alternativ: Zugangsschlüssel

Falls kein interaktiver Login möglich ist (z. B. auf einem gemeinsam genutzten Rechner), kann stattdessen ein persönlicher Zugangsschlüssel eingegeben werden:

1. Zugangsschlüssel bei der Grünerator-Administration anfordern
2. In der Seitenleiste `/settings` öffnen → Bereich **Grünerator**
3. Schlüssel einfügen und speichern

Der Schlüssel liegt danach im Browserspeicher **dieses Geräts**. Wer Excel auf mehreren Rechnern nutzt, meldet sich auf jedem einzeln an bzw. trägt den Schlüssel dort erneut ein.

### Fortgeschritten: eigener Anbieter

Wer lieber einen eigenen API-Schlüssel oder ein eigenes OpenAI-kompatibles Gateway nutzen möchte, kann das zusätzlich zum oder statt des Grünerator-Zugangs einrichten — siehe die entsprechenden Abschnitte in der [englischen Anleitung](install.md#4-sign-in).

---

## Aktualisierungen

Wurde mit `manifest.prod.xml` installiert, lädt Grünerator für Excel von einer gehosteten Adresse — die meisten Updates kommen automatisch an.

- Normalfall: Seitenleiste in Excel schließen und neu öffnen, um die aktuelle Version zu laden.
- Seltener Fall (Änderungen am Manifest selbst): `manifest.prod.xml` neu herunterladen und in Excel erneut hochladen.

---

## Fehlerbehebung

### Grünerator erscheint nicht unter „Meine Add-ins"
- Excel neu starten und erneut versuchen
- Prüfen, dass `manifest.prod.xml` hochgeladen wurde (nicht das lokale Entwickler-Manifest)

### Windows meldet ein ungültiges Manifest-Zertifikat / verweist auf XML-Erweiterungspakete
- Stattdessen **Einfügen → Meine Add-ins → Eigenes Add-In hochladen…** verwenden
- `manifest.prod.xml` ist ein Office-Add-in-Manifest, kein veraltetes XML-Erweiterungspaket
- Wurde bereits der XML-Erweiterungspakete-Weg versucht: Excel schließen und den Upload-Ablauf oben wiederholen

### Seitenleiste öffnet sich, bleibt aber leer
- Das Netzwerk blockiert möglicherweise `https://excel.gruenerator.eu`
- Anderes Netzwerk bzw. VPN-Einstellung ausprobieren

### Installiert, aber Änderungen sind nicht sichtbar
- Excel schließen und neu öffnen, um den zwischengespeicherten Seitenleisten-Stand zu leeren

### Anmeldung schlägt fehl
- Prüfen, ob eine Verbindung zu `https://gruenerator.eu` möglich ist (Firmennetzwerk/VPN kann das blockieren)
- Alternativ den Zugangsschlüssel-Weg (siehe oben) versuchen
- Bei anhaltenden Problemen an die Grünerator-Administration wenden

---

## Entwickler-Setup (separat)

Für den Betrieb aus dem Quellcode (`localhost`, Vite, mkcert) siehe die Haupt-README: [Developer Quick Start](../README.md#developer-quick-start).
