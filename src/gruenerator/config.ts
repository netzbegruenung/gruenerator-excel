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

export const GRUENERATOR_CONTEXT_WINDOW = 128_000;
