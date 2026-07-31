/**
 * Grünerator-Gateway — die einzige Modellquelle dieses Forks.
 *
 * Upstream (pi-for-excel) lässt Nutzer:innen zwischen ~35 Providern wählen und
 * sich per OAuth einloggen. Hier gibt es genau einen vorkonfigurierten
 * OpenAI-kompatiblen Gateway; einzugeben ist nur noch der Zugangsschlüssel.
 *
 * ENDPOINT ist bewusst eine einzelne Konstante: heute zeigt sie auf verdigado
 * (über den Dev-Proxy erreichbar, weil dessen nginx den CORS-Preflight mit 401
 * beantwortet), später auf den eigenen OpenAI-kompatiblen Endpoint des
 * Grünerator-Backends. Der Umzug ist dann eine Zeile.
 */

/** Fester Anzeigename — dient zugleich als Wiedererkennung beim Provisionieren. */
export const GRUENERATOR_GATEWAY_NAME = "Grünerator";

export const GRUENERATOR_ENDPOINT_URL = "https://litellm.netzbegruenung.verdigado.net/v1";

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
