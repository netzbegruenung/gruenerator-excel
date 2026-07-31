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
 * Standardmäßig die Produktion. Für einen lokalen Lauf
 * `VITE_GRUENERATOR_ENDPOINT=https://localhost:3141/api/v1` setzen — das geht
 * durch den `/api`-Proxy des Dev-Servers ans Backend auf :3001 und bleibt damit
 * same-origin. Ein direktes `http://localhost:3001` ginge nicht: das Taskpane
 * läuft auf HTTPS, der Browser blockt den Aufruf als Mixed Content.
 */
export const GRUENERATOR_ENDPOINT_URL =
  import.meta.env.VITE_GRUENERATOR_ENDPOINT ?? "https://gruenerator.eu/api/v1";

/**
 * Gemma 4 31B (ctx128k). Im Tool-Loop-Test gegen gefakte Excel-Tools: 3 Runden,
 * 0 Schema-Verstöße. GPT-OSS 120B (`verdigado-pro`) verletzte im selben Test
 * zwei Enums und traf Bereiche und Formeln falsch — deshalb hier keine Auswahl.
 */
export const GRUENERATOR_MODEL_ID = "verdigado-think";

/**
 * 64k, NICHT die 128k des Modell-Tags.
 *
 * Die Ollama-gestützten verdigado-Lanes kürzen zu lange Prompts **still**:
 * bei ~350k Input antworten sie mit HTTP 200 und `prompt_tokens: 65538` —
 * die Signatur eines `num_ctx` von 65536, unabhängig davon, was das Tag
 * verspricht. Ein zu hoher Wert kostet hier keinen Fehler, sondern Kontext:
 * das Add-in packt die Arbeitsmappe voll und bekommt eine Antwort auf einem
 * Fragment. Das Grünerator-Backend fährt aus demselben Grund CTX_VERDIGADO
 * = 64_000 (apps/api/routes/chat/agents/providers.ts).
 *
 * Nur zusammen mit einem frischen Needle-Test und einer Overflow-Probe erhöhen.
 */
export const GRUENERATOR_CONTEXT_WINDOW = 64_000;
