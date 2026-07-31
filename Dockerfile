# Grünerator für Excel — statisches Taskpane hinter nginx.
#
# Das Add-in ist ein reiner Vite-Build ohne Serveranteil; die Modellzugriffe
# gehen an das Grünerator-Backend (`/api/v1`). Gebaut wird das Image in GitHub
# Actions, ausgerollt über den Salt-State `gruenerator-docker` — dieselbe
# Strecke wie `doku`.
#
# Office lädt das Taskpane ausschließlich über HTTPS. TLS terminiert der
# vorgelagerte nginx auf dem Host; dieser Container spricht intern HTTP.

FROM node:22-alpine AS build

WORKDIR /app

# Erst die Manifeste, damit der Layer mit den Abhängigkeiten nur bei echten
# Dependency-Änderungen neu gebaut wird.
COPY package.json package-lock.json ./
# `npm ci` führt das `prepare`-Skript aus, und das liegt unter scripts/.
# Ohne diese Zeile bricht der Build mit "Cannot find module
# /app/scripts/install-githooks.mjs" ab — das Skript selbst schaltet sich
# ausserhalb eines Git-Checkouts ab, es muss nur da sein. Bewusst nur diese
# eine Datei statt des ganzen Ordners: sonst verfiele der Abhängigkeits-Layer
# bei jeder Änderung an irgendeinem Skript.
COPY scripts/install-githooks.mjs ./scripts/
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

# Die Sicherheitsrichtlinie liegt in der nginx-Konfiguration, nicht in
# vercel.json: die gilt nur für Vercel-Deployments des Upstream-Projekts. Ein
# Test hält beide Fassungen deckungsgleich — driften sie auseinander, fällt es
# erst in Produktion auf, und zwar als "alles blockiert".
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/nginx-health || exit 1
