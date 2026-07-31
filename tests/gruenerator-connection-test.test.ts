import assert from "node:assert/strict";
import { test } from "node:test";

import { testGruenratorConnection } from "../src/gruenerator/connection-test.ts";

const ENDPOINT = "https://example.invalid/api/v1";
const MODEL = "verdigado-think";

interface RecordedCall {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

/**
 * Baut ein `fetch`, das die Aufrufe mitschreibt und der Reihe nach die
 * vorgegebenen Antworten liefert. Ein Handler darf werfen, um einen
 * Netzwerkfehler nachzustellen.
 */
function fakeFetch(handlers: Array<() => Response>): {
  fetchFn: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : "",
    });

    const handler = handlers[index];
    index += 1;
    if (!handler) throw new Error(`Unerwarteter fetch-Aufruf: ${url}`);
    return Promise.resolve(handler());
  }) as typeof globalThis.fetch;

  return { fetchFn, calls };
}

function jsonResponse(payload: DynamicValue, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function catalogWith(...ids: string[]): Response {
  return jsonResponse({ object: "list", data: ids.map((id) => ({ id, object: "model" })) });
}

function run(
  handlers: Array<() => Response>,
  key = "gru_test",
): { result: ReturnType<typeof testGruenratorConnection>; calls: RecordedCall[] } {
  const { fetchFn, calls } = fakeFetch(handlers);
  let tick = 0;
  const result = testGruenratorConnection(key, {
    fetchFn,
    endpointUrl: ENDPOINT,
    modelId: MODEL,
    now: () => {
      tick += 250;
      return tick;
    },
  });
  return { result, calls };
}

void test("ein leerer Schlüssel wird gar nicht erst verschickt", async () => {
  const { fetchFn, calls } = fakeFetch([]);
  const result = await testGruenratorConnection("   ", {
    fetchFn,
    endpointUrl: ENDPOINT,
    modelId: MODEL,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "auth");
  assert.deepEqual(calls, []);
});

void test("erfolgreicher Lauf prüft Katalog und Modellstrecke", async () => {
  const { result, calls } = run([
    () => catalogWith(MODEL, "verdigado-pro"),
    () => jsonResponse({ choices: [{ message: { content: "ok" } }] }),
  ]);
  const outcome = await result;

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual([...outcome.models], [MODEL, "verdigado-pro"]);
  assert.equal(outcome.durationMs, 250);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, `${ENDPOINT}/models`);
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.authorization, "Bearer gru_test");

  assert.equal(calls[1]?.url, `${ENDPOINT}/chat/completions`);
  assert.equal(calls[1]?.method, "POST");
  // Die Probe darf nichts kosten und nichts erzeugen — ein Token genügt.
  const probe: DynamicValue = JSON.parse(calls[1]?.body ?? "{}");
  assert.deepEqual(probe, {
    model: MODEL,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
    stream: false,
  });
});

void test("ein nicht erreichbarer Endpoint meldet die Netzwerkstufe", async () => {
  const fetchFn = (() => Promise.reject(new Error("Failed to fetch"))) as typeof globalThis.fetch;
  const result = await testGruenratorConnection("gru_test", {
    fetchFn,
    endpointUrl: ENDPOINT,
    modelId: MODEL,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "network");
  assert.equal(result.detail, "Failed to fetch");
});

void test("401 zeigt auf den Schlüssel, 403 auf die Berechtigung", async () => {
  const rejected = await run([() => jsonResponse({ error: "Invalid API key" }, 401)]).result;
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.stage, "auth");

  const unscoped = await run([
    () => jsonResponse({ error: "API key lacks the 'chat:completions' scope" }, 403),
  ]).result;
  assert.equal(unscoped.ok, false);
  if (unscoped.ok) return;
  assert.equal(unscoped.stage, "scope");
});

void test("ein Katalog ohne unser Modell schlägt an, bevor eine Anfrage läuft", async () => {
  // Genau der Fall, der sonst erst mitten im Auftrag auffällt:
  // „Model 'verdigado-think' is not available on this endpoint“.
  const { result, calls } = run([() => catalogWith("gemma", "nomic-embed-text")]);
  const outcome = await result;

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.stage, "catalog");
  assert.equal(outcome.detail, "gemma, nomic-embed-text");
  assert.equal(calls.length, 1, "die Modellstrecke wird gar nicht erst angefragt");
});

void test("ein leerer Katalog wird als Katalogfehler ohne Detail gemeldet", async () => {
  const outcome = await run([() => catalogWith()]).result;

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.stage, "catalog");
  assert.equal(outcome.detail, "");
});

void test("ein Fehler hinter dem Katalog wird der Modellstrecke zugeordnet", async () => {
  // Der Katalog ist eine feste Liste im Backend und antwortet auch dann mit
  // 200, wenn LiteLLM dahinter nicht konfiguriert ist.
  const outcome = await run([
    () => catalogWith(MODEL),
    () => jsonResponse({ error: "Model backend is not configured" }, 503),
  ]).result;

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.stage, "upstream");
  assert.equal(outcome.detail, "Model backend is not configured");
});

void test("eine Antwort ohne JSON liefert trotzdem eine lesbare Meldung", async () => {
  const outcome = await run([
    () => catalogWith(MODEL),
    () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
  ]).result;

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.stage, "upstream");
  assert.equal(outcome.detail, "<html>502 Bad Gateway</html>");
});

void test("ein 500 auf dem Katalog bleibt eine allgemeine HTTP-Stufe", async () => {
  const outcome = await run([() => jsonResponse({ error: "boom" }, 500)]).result;

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.stage, "http");
  assert.equal(outcome.detail, "boom");
});
