/**
 * Grünerator-Gateway — die einzige Modellquelle dieses Forks.
 *
 * Upstream (pi-for-excel) lässt Nutzer:innen zwischen ~35 Providern wählen und
 * sich per OAuth einloggen. Hier gibt es genau einen vorkonfigurierten
 * OpenAI-kompatiblen Gateway; einzugeben ist nur noch der Zugangsschlüssel.
 *
 * Der Endpoint ist das Grünerator-Backend, nicht mehr verdigado direkt. Damit
 * entfällt der lokale CORS-Proxy: dort läuft `cors()` als erste Middleware und
 * beantwortet den Preflight, bevor die Authentifizierung greift — anders als
 * der nginx vor LiteLLM, der auf `OPTIONS` mit 401 antwortet. Der Schlüssel ist
 * ein Grünerator-API-Key mit Scope `chat:completions`, kein Anbieter-Schlüssel.
 */

/** Fester Anzeigename — dient zugleich als Wiedererkennung beim Provisionieren. */
export const GRUENERATOR_GATEWAY_NAME = "Grünerator";

/**
 * Im Dev-Server der eigene `/api`-Pfad, im Produktionsbuild gruenerator.eu.
 *
 * Der Dev-Pfad geht durch den `/api`-Proxy aus `vite.config.ts` ans Backend auf
 * :3001 und bleibt dadurch **same-origin**: das Taskpane läuft auf HTTPS und
 * dürfte ein `http://localhost:3001` gar nicht erst aufrufen (Mixed Content),
 * und CORS entfällt gleich mit.
 *
 * Bewusst an `import.meta.env.DEV` statt an einer Variablen in `.env.local`:
 * Vite liest Env-Dateien nur beim Start, ein nachträglich angelegtes
 * `.env.local` wirkt also nicht — und der Fehler sieht aus wie ein
 * Verbindungsproblem, nicht wie eine vergessene Neustart. `DEV` ist immer
 * korrekt, ohne dass jemand daran denken muss.
 *
 * `VITE_GRUENERATOR_ENDPOINT` überschreibt weiterhin beides, etwa um den
 * Dev-Build gegen beta.gruenerator.eu laufen zu lassen.
 */
export const GRUENERATOR_ENDPOINT_URL =
  import.meta.env.VITE_GRUENERATOR_ENDPOINT
  ?? (import.meta.env.DEV ? "https://localhost:3141/api/v1" : "https://gruenerator.eu/api/v1");

/**
 * Gemma 4 31B (ctx128k). Im Tool-Loop-Test gegen gefakte Excel-Tools: 3 Runden,
 * 0 Schema-Verstöße. GPT-OSS 120B (`verdigado-pro`) verletzte im selben Test
 * zwei Enums und traf Bereiche und Formeln falsch — deshalb hier keine Auswahl.
 */
export const GRUENERATOR_MODEL_ID = "verdigado-think";

/**
 * 120k — und bewusst nicht die 128k des Modell-Tags.
 *
 * Die Ollama-gestützten verdigado-Lanes kürzen einen zu langen Prompt
 * **still**: sie antworten mit HTTP 200, aber `prompt_tokens` fällt auf ~65.5k
 * zurück, die Signatur eines `num_ctx` von 65536. Ein zu hoher Wert kostet
 * hier also keinen Fehler, sondern Kontext — das Add-in packt die
 * Arbeitsmappe voll und bekommt eine Antwort auf einem Fragment.
 *
 * Gemessen am 31.07.2026 gegen `verdigado-think`, Nadel am Anfang des Prompts:
 *
 *   ~130k gesendet → prompt_tokens 122.956, Nadel gefunden
 *   ~155k gesendet → prompt_tokens  65.539, Nadel weg
 *
 * Die Kante liegt also zwischen beiden. 120k liegt unter dem höchsten
 * verifizierten Wert und lässt Luft; 128k läge im ungemessenen Bereich direkt
 * davor, und ein Fehlgriff dort ist unsichtbar.
 *
 * Das Grünerator-Backend führt denselben Wert als CTX_VERDIGADO
 * (apps/api/routes/chat/agents/providers.ts) — beide zusammen ändern.
 * Erhöhen nur mit einem frischen Needle-Test wie oben, nie nach Tag-Angabe.
 */
export const GRUENERATOR_CONTEXT_WINDOW = 120_000;
