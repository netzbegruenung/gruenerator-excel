/**
 * Verbindungstest für den Zugangsschlüssel.
 *
 * Prüft die Kette, an der die Nutzung tatsächlich scheitern kann, und zwar in
 * genau der Reihenfolge, in der sie im Betrieb durchlaufen wird:
 *
 *   1. `GET /models`  — ist der Endpoint erreichbar, wird der Schlüssel
 *      akzeptiert, trägt er den Scope `chat:completions`?
 *   2. Abgleich       — kennt der Server das Modell, das dieses Add-in schickt?
 *   3. `POST /chat/completions` — antwortet auch die Modellstrecke dahinter?
 *
 * Schritt 3 ist der Grund, warum der Test nicht bei `/models` aufhört: der
 * Katalog kommt aus einer festen Liste im Backend und antwortet auch dann noch
 * mit 200, wenn LiteLLM dahinter nicht konfiguriert oder nicht erreichbar ist
 * (503/502). Ein Test, der das nicht mitprüft, meldet „in Ordnung“ und der
 * erste echte Auftrag scheitert trotzdem.
 *
 * Schritt 2 fängt die Klasse von Fehlern, die uns schon zweimal getroffen hat:
 * Client und Server sind sich über die Modellkennung uneinig, und die Meldung
 * kommt erst mitten in einer Anfrage („Model 'gemma' is not available“).
 */

/** An welcher Stelle der Kette es gehakt hat — bestimmt die Meldung im UI. */
export type ConnectionTestStage =
  | "network"
  | "auth"
  | "scope"
  | "catalog"
  | "upstream"
  | "http";

export type ConnectionTestResult =
  | { ok: true; models: readonly string[]; durationMs: number }
  | { ok: false; stage: ConnectionTestStage; detail: string };

/**
 * Ziel und Einspritzpunkte. `endpointUrl` und `modelId` kommen bewusst von
 * aussen statt aus `config.ts`: die Konfiguration liest `import.meta.env`, das
 * es nur im Vite-Build gibt — ein Import von hier aus wäre unter `node --test`
 * schon beim Laden des Moduls gescheitert.
 */
export interface ConnectionTestOptions {
  endpointUrl: string;
  modelId: string;
  fetchFn?: typeof globalThis.fetch;
  /** Für Tests: liefert die Zeitmessung. */
  now?: () => number;
}

function isGruenratorPayloadShape(value: DynamicValue): value is DynamicObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Liest die Modellkennungen aus einer OpenAI-kompatiblen `/models`-Antwort.
 * Alles, was nicht dem erwarteten Schema entspricht, fällt still heraus — die
 * Auswertung darüber behandelt eine leere Liste als Fehler.
 */
function readModelIds(payload: DynamicValue): string[] {
  if (!isGruenratorPayloadShape(payload)) return [];

  const data: DynamicValue = payload.data;
  if (!Array.isArray(data)) return [];

  const entries: readonly DynamicValue[] = data;
  const ids: string[] = [];
  for (const entry of entries) {
    if (isGruenratorPayloadShape(entry) && typeof entry.id === "string") {
      ids.push(entry.id);
    }
  }
  return ids;
}

/**
 * Zieht die Fehlermeldung aus einer Antwort. Unser Endpoint antwortet mit
 * `{ error: "..." }`; kommt etwas anderes (etwa eine HTML-Fehlerseite eines
 * Reverse Proxy), bleibt der rohe Text — gekürzt, damit die Meldung im
 * schmalen Aufgabenbereich lesbar bleibt.
 */
async function readErrorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  if (raw.length === 0) return `HTTP ${response.status}`;

  try {
    const parsed: DynamicValue = JSON.parse(raw);
    if (isGruenratorPayloadShape(parsed) && typeof parsed.error === "string") {
      return parsed.error.slice(0, 200);
    }
  } catch {
    // Kein JSON — der Rohtext ist die beste verfügbare Auskunft.
  }

  return raw.slice(0, 200);
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Ordnet einen Statuscode einer Stufe zu. 401 und 403 sind die einzigen, die
 * auf den Schlüssel der Nutzer:in zeigen — bei allem anderen liegt es an uns.
 */
function stageForStatus(status: number): ConnectionTestStage {
  if (status === 401) return "auth";
  if (status === 403) return "scope";
  return "http";
}

export async function testGruenratorConnection(
  apiKey: string,
  options: ConnectionTestOptions,
): Promise<ConnectionTestResult> {
  const key = apiKey.trim();
  if (key.length === 0) {
    return { ok: false, stage: "auth", detail: "" };
  }

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const baseUrl = trimTrailingSlash(options.endpointUrl);
  const modelId = options.modelId;
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  const startedAt = now();

  // ── 1. Katalog: Erreichbarkeit, Schlüssel, Scope ──────────────────────────
  let catalogResponse: Response;
  try {
    catalogResponse = await fetchFn(`${baseUrl}/models`, { method: "GET", headers });
  } catch (error) {
    return {
      ok: false,
      stage: "network",
      detail: error instanceof Error ? error.message : "",
    };
  }

  if (!catalogResponse.ok) {
    return {
      ok: false,
      stage: stageForStatus(catalogResponse.status),
      detail: await readErrorDetail(catalogResponse),
    };
  }

  const catalogPayload: DynamicValue = await catalogResponse.json().catch(() => null);
  const models = readModelIds(catalogPayload);
  if (models.length === 0) {
    return { ok: false, stage: "catalog", detail: "" };
  }

  // ── 2. Abgleich: kennt der Server unser Modell? ───────────────────────────
  if (!models.includes(modelId)) {
    return { ok: false, stage: "catalog", detail: models.join(", ") };
  }

  // ── 3. Modellstrecke: antwortet auch LiteLLM dahinter? ────────────────────
  // Ein Token Ausgabe genügt; geprüft wird, ob eine Antwort zustande kommt,
  // nicht was drinsteht.
  let completionResponse: Response;
  try {
    completionResponse = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      stage: "network",
      detail: error instanceof Error ? error.message : "",
    };
  }

  if (!completionResponse.ok) {
    const status = completionResponse.status;
    return {
      ok: false,
      // 401/403 zeigen weiterhin auf den Schlüssel; alles andere auf dieser
      // Strecke ist die Modellstrecke selbst.
      stage: status === 401 || status === 403 ? stageForStatus(status) : "upstream",
      detail: await readErrorDetail(completionResponse),
    };
  }

  return { ok: true, models, durationMs: Math.max(0, Math.round(now() - startedAt)) };
}
