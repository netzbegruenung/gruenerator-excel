/**
 * Offline-Prüfung des OAuth-Ablaufs.
 *
 * Was hier geprüft werden kann: die gesamte Protokoll-Logik, die
 * Weiterleitungsregel des Dialogs und das Zusammenspiel von Entdeckung,
 * Registrierung, Tokentausch, Erneuerung und Speicher — gegen Attrappen für
 * `fetch`, Office-Dialog und Einstellungsspeicher.
 *
 * Was hier **nicht** geprüft werden kann und offen bleibt:
 *   • ob Better Auth eine Registrierung mit `https://localhost:3141/...` als
 *     Rückleitungsadresse annimmt,
 *   • ob Office' Dialog die Weiterleitung von unserer Startseite zum Server
 *     mitmacht (die Regel „erste Adresse gleiche Herkunft" ist erfüllt, das
 *     Verhalten danach ist unbelegt),
 *   • ob der Server den Scope `chat:completions` ausstellt.
 * Diese drei brauchen einen laufenden Server und Excel.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAuthorizationUrl,
  discoverAuthServer,
  exchangeAuthorizationCode,
  needsRefresh,
  parseCallbackUrl,
  refreshAccessToken,
  OAUTH_DISCOVERY_PATH,
  registerClient,
  rewriteToLocalProxy,
  TOKEN_REFRESH_SKEW_MS,
} from "../src/gruenerator/oauth-client.ts";
import {
  buildDialogBootstrapUrl,
  buildRedirectUri,
  isAllowedAuthorizationTarget,
  openAuthorizationDialog,
  DIALOG_EVENT_RECEIVED,
  DIALOG_MESSAGE_RECEIVED,
  type DialogHandle,
  type DialogHost,
  type DialogOpenResult,
} from "../src/gruenerator/oauth-dialog.ts";
import {
  getValidAccessToken,
  loadTokens,
  login,
  OAUTH_CLIENT_ID_KEY,
  OAUTH_TOKEN_KEY,
  type SettingsLike,
} from "../src/gruenerator/oauth-session.ts";

// ---------------------------------------------------------------------------
// Attrappen
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  body: string | null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function bodyOf(init: RequestInit | undefined): string | null {
  const body = init?.body;
  return typeof body === "string" ? body : null;
}

function jsonResponse(payload: DynamicValue, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** `fetch`-Attrappe: bildet Adress-Fragmente auf Antworten ab und merkt sich die Aufrufe. */
function makeFetch(
  routes: Array<{ match: string; respond: () => Response }>,
): { fetchFn: typeof globalThis.fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    calls.push({ url, body: bodyOf(init) });

    const route = routes.find((candidate) => url.includes(candidate.match));
    if (!route) {
      return Promise.reject(new Error(`Keine Attrappe für ${url}`));
    }
    return Promise.resolve(route.respond());
  }) as typeof globalThis.fetch;

  return { fetchFn, calls };
}

class MemorySettings implements SettingsLike {
  private readonly values = new Map<string, DynamicValue>();

  get(key: string): Promise<DynamicValue> {
    return Promise.resolve(this.values.has(key) ? this.values.get(key) : null);
  }

  set(key: string, value: DynamicValue): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

/** Dialog-Attrappe: meldet eine vorgegebene Adresse zurück und merkt sich die Startadresse. */
class FakeDialogHost implements DialogHost {
  public opened: string | null = null;
  public closed = false;

  // Als Feld statt als Parametereigenschaft: Nodes strip-only-Modus
  // unterstützt `private readonly` im Konstruktor nicht.
  private readonly reply:
    | { kind: "message"; value: string }
    | { kind: "event"; code: number }
    | { kind: "openFailed"; message: string };

  constructor(
    reply:
      | { kind: "message"; value: string }
      | { kind: "event"; code: number }
      | { kind: "openFailed"; message: string },
  ) {
    this.reply = reply;
  }

  displayDialogAsync(
    url: string,
    _options: { height: number; width: number; promptBeforeOpen: boolean },
    callback: (result: DialogOpenResult) => void,
  ): void {
    this.opened = url;

    if (this.reply.kind === "openFailed") {
      callback({ status: "failed", error: { message: this.reply.message } });
      return;
    }

    const handlers = new Map<string, (arg: DynamicValue) => void>();
    // Pfeilfunktionen binden `this` lexisch — kein Alias nötig.
    const dialog: DialogHandle = {
      addEventHandler: (eventType, handler) => {
        handlers.set(eventType, handler);
      },
      close: () => {
        this.closed = true;
      },
    };

    callback({ status: "succeeded", value: dialog });

    // Erst nach der Registrierung beider Handler auslösen — so wie Office es tut.
    if (this.reply.kind === "message") {
      handlers.get(DIALOG_MESSAGE_RECEIVED)?.({ message: this.reply.value });
    } else {
      handlers.get(DIALOG_EVENT_RECEIVED)?.({ error: this.reply.code });
    }
  }
}

const AUTH_ORIGIN = "https://beta.gruenerator.eu";
const ADDIN_ORIGIN = "https://localhost:3141";

function metadataPayload(): DynamicValue {
  return {
    issuer: AUTH_ORIGIN,
    authorization_endpoint: `${AUTH_ORIGIN}/api/auth/mcp/authorize`,
    token_endpoint: `${AUTH_ORIGIN}/api/auth/mcp/token`,
    registration_endpoint: `${AUTH_ORIGIN}/api/auth/mcp/register`,
  };
}

// ---------------------------------------------------------------------------
// Entdeckung
// ---------------------------------------------------------------------------

void test("Entdeckung liest die Adressen aus den Servermetadaten", async () => {
  const { fetchFn, calls } = makeFetch([
    { match: "/.well-known/oauth-authorization-server", respond: () => jsonResponse(metadataPayload()) },
  ]);

  const result = await discoverAuthServer(AUTH_ORIGIN, { fetchFn });

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.tokenEndpoint, `${AUTH_ORIGIN}/api/auth/mcp/token`);
  assert.equal(result.value.registrationEndpoint, `${AUTH_ORIGIN}/api/auth/mcp/register`);
  // Nicht der Wurzelpfad aus RFC 8414: dort antwortet der nginx mit der SPA.
  assert.equal(calls[0]?.url, `${AUTH_ORIGIN}${OAUTH_DISCOVERY_PATH}`);
  assert.match(OAUTH_DISCOVERY_PATH, /^\/api\//);
});

void test("Entdeckung toleriert einen Schrägstrich am Ende der Herkunft", async () => {
  const { fetchFn, calls } = makeFetch([
    { match: "/.well-known/", respond: () => jsonResponse(metadataPayload()) },
  ]);

  await discoverAuthServer(`${AUTH_ORIGIN}/`, { fetchFn });

  assert.equal(calls[0]?.url, `${AUTH_ORIGIN}${OAUTH_DISCOVERY_PATH}`);
});

void test("Entdeckung ohne token_endpoint ist ein Fehlschlag, kein halbes Ergebnis", async () => {
  const { fetchFn } = makeFetch([
    {
      match: "/.well-known/",
      respond: () => jsonResponse({ authorization_endpoint: `${AUTH_ORIGIN}/a` }),
    },
  ]);

  const result = await discoverAuthServer(AUTH_ORIGIN, { fetchFn });

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.stage, "discovery");
});

void test("Fehlerantworten reichen error_description durch statt nur den Statuscode", async () => {
  const { fetchFn } = makeFetch([
    {
      match: "/.well-known/",
      respond: () =>
        jsonResponse({ error: "invalid_request", error_description: "resource unbekannt" }, 400),
    },
  ]);

  const result = await discoverAuthServer(AUTH_ORIGIN, { fetchFn });

  assert.ok(!result.ok);
  assert.match(result.detail, /invalid_request/);
  assert.match(result.detail, /resource unbekannt/);
});

void test("HTML bei HTTP 200 wird als falscher Pfad gemeldet, nicht als Parserfehler", async () => {
  // Am 31.07.2026 real passiert: der Wurzelpfad /.well-known/... liefert auf
  // beta die SPA mit Status 200. Ein blosser Parserfehler („Unexpected token
  // <") zeigt dabei auf nichts.
  const { fetchFn } = makeFetch([
    {
      match: "/.well-known/",
      respond: () =>
        new Response("<!doctype html><html><body>SPA</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    },
  ]);

  const result = await discoverAuthServer(AUTH_ORIGIN, { fetchFn });

  assert.ok(!result.ok);
  assert.equal(result.stage, "discovery");
  assert.match(result.detail, /text\/html/);
  assert.match(result.detail, /Weboberfl/);
});

// ---------------------------------------------------------------------------
// Registrierung
// ---------------------------------------------------------------------------

void test("Registrierung meldet einen öffentlichen Client ohne Geheimnis an", async () => {
  const { fetchFn, calls } = makeFetch([
    { match: "/register", respond: () => jsonResponse({ client_id: "client-123" }) },
  ]);

  const result = await registerClient(
    `${AUTH_ORIGIN}/api/auth/mcp/register`,
    `${ADDIN_ORIGIN}/src/oauth-callback.html`,
    { fetchFn },
  );

  assert.ok(result.ok);
  assert.equal(result.value, "client-123");

  const sent: DynamicValue = JSON.parse(calls[0]?.body ?? "{}");
  assert.ok(typeof sent === "object" && sent !== null && !Array.isArray(sent));
  assert.equal(sent["token_endpoint_auth_method"], "none");
  assert.deepEqual(sent["redirect_uris"], [`${ADDIN_ORIGIN}/src/oauth-callback.html`]);
  assert.deepEqual(sent["grant_types"], ["authorization_code", "refresh_token"]);
});

// ---------------------------------------------------------------------------
// Autorisierungsadresse und Rückleitung
// ---------------------------------------------------------------------------

void test("Autorisierungsadresse trägt PKCE-S256 und erzwingt die Zustimmungsseite", () => {
  const url = new URL(
    buildAuthorizationUrl({
      authorizationEndpoint: `${AUTH_ORIGIN}/api/auth/mcp/authorize`,
      clientId: "client-123",
      redirectUri: `${ADDIN_ORIGIN}/src/oauth-callback.html`,
      state: "state-abc",
      codeChallenge: "challenge-xyz",
    }),
  );

  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-xyz");
  assert.equal(url.searchParams.get("state"), "state-abc");
  // Ohne prompt=consent überspringt das Better-Auth-Plugin die Zustimmung,
  // sobald eine Sitzung besteht — die Nutzerin sähe nie, was sie freigibt.
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.match(url.searchParams.get("scope") ?? "", /chat:completions/);
  // Ohne offline_access gibt es kein Refresh-Token, und die Anmeldung wäre
  // nach einer Stunde vorbei.
  assert.match(url.searchParams.get("scope") ?? "", /offline_access/);
});

void test("Rückleitung mit fremdem state wird verworfen", () => {
  const result = parseCallbackUrl(
    `${ADDIN_ORIGIN}/src/oauth-callback.html?code=abc&state=fremd`,
    "eigen",
  );

  assert.ok(!result.ok);
  assert.match(result.detail, /state/);
});

void test("Rückleitung mit Fehlerparameter nennt den Grund", () => {
  const result = parseCallbackUrl(
    `${ADDIN_ORIGIN}/src/oauth-callback.html?error=access_denied&error_description=Abgelehnt&state=s`,
    "s",
  );

  assert.ok(!result.ok);
  assert.match(result.detail, /access_denied/);
  assert.match(result.detail, /Abgelehnt/);
});

void test("Rückleitung ohne code ist ein Fehlschlag", () => {
  const result = parseCallbackUrl(`${ADDIN_ORIGIN}/src/oauth-callback.html?state=s`, "s");
  assert.ok(!result.ok);
});

void test("Gültige Rückleitung liefert den Code", () => {
  const result = parseCallbackUrl(`${ADDIN_ORIGIN}/src/oauth-callback.html?code=abc&state=s`, "s");
  assert.ok(result.ok);
  assert.equal(result.value, "abc");
});

// ---------------------------------------------------------------------------
// Tokentausch und Erneuerung
// ---------------------------------------------------------------------------

void test("Tokentausch schickt den Verifier und rechnet die Ablaufzeit absolut", async () => {
  const { fetchFn, calls } = makeFetch([
    {
      match: "/token",
      respond: () =>
        jsonResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
    },
  ]);

  const result = await exchangeAuthorizationCode(
    {
      tokenEndpoint: `${AUTH_ORIGIN}/api/auth/mcp/token`,
      clientId: "client-123",
      redirectUri: `${ADDIN_ORIGIN}/src/oauth-callback.html`,
      code: "code-1",
      codeVerifier: "verifier-1",
      now: 1_000_000,
    },
    { fetchFn },
  );

  assert.ok(result.ok);
  assert.equal(result.value.access, "at-1");
  // Absolut, nicht als Restlaufzeit: eine Restlaufzeit wäre nach dem ersten
  // Neuladen des Taskpanes wertlos.
  assert.equal(result.value.expires, 1_000_000 + 3_600_000);

  const sent = new URLSearchParams(calls[0]?.body ?? "");
  assert.equal(sent.get("grant_type"), "authorization_code");
  assert.equal(sent.get("code_verifier"), "verifier-1");
  assert.equal(sent.get("client_id"), "client-123");
});

void test("Erneuerung behält das bisherige Refresh-Token, wenn der Server keins mitschickt", async () => {
  const { fetchFn } = makeFetch([
    { match: "/token", respond: () => jsonResponse({ access_token: "at-2", expires_in: 60 }) },
  ]);

  const result = await refreshAccessToken(
    {
      tokenEndpoint: `${AUTH_ORIGIN}/api/auth/mcp/token`,
      clientId: "client-123",
      refreshToken: "rt-alt",
      now: 0,
    },
    { fetchFn },
  );

  // Ohne diesen Rückgriff wäre nach der ersten Erneuerung Schluss.
  assert.ok(result.ok);
  assert.equal(result.value.refresh, "rt-alt");
  assert.equal(result.value.access, "at-2");
});

void test("Ablaufprüfung greift eine Minute vor dem Ablauf", () => {
  const tokens = { access: "a", refresh: "r", expires: 1_000_000 };

  assert.equal(needsRefresh(tokens, 1_000_000 - TOKEN_REFRESH_SKEW_MS - 1), false);
  assert.equal(needsRefresh(tokens, 1_000_000 - TOKEN_REFRESH_SKEW_MS), true);
  assert.equal(needsRefresh(tokens, 1_000_000), true);
});

void test("Umbiegen auf den Proxy trifft nur die proxierten Präfixe", () => {
  const local = "https://localhost:3141";

  assert.equal(
    rewriteToLocalProxy(`${AUTH_ORIGIN}/api/auth/mcp/token`, local),
    `${local}/api/auth/mcp/token`,
  );
  // Das Metadatendokument liegt selbst unter /api/ und braucht keine Sonderregel.
  assert.equal(
    rewriteToLocalProxy(`${AUTH_ORIGIN}${OAUTH_DISCOVERY_PATH}`, local),
    `${local}${OAUTH_DISCOVERY_PATH}`,
  );
  // Abfrageteil muss mit, sonst geht der `resource`-Parameter verloren.
  assert.equal(
    rewriteToLocalProxy(`${AUTH_ORIGIN}/api/auth/mcp/token?x=1`, local),
    `${local}/api/auth/mcp/token?x=1`,
  );

  // Ohne Proxy-Eintrag würde das Umbiegen ins Leere zeigen.
  assert.equal(rewriteToLocalProxy(`${AUTH_ORIGIN}/login`, local), `${AUTH_ORIGIN}/login`);
  assert.equal(
    rewriteToLocalProxy(`${AUTH_ORIGIN}/.well-known/x`, local),
    `${AUTH_ORIGIN}/.well-known/x`,
  );
  assert.equal(rewriteToLocalProxy("keine-url", local), "keine-url");
});

// ---------------------------------------------------------------------------
// Weiterleitungsregel des Dialogs
// ---------------------------------------------------------------------------

void test("Startseite leitet nur auf die eigenen HTTPS-Herkünfte weiter", () => {
  assert.equal(isAllowedAuthorizationTarget("https://gruenerator.eu/api/auth/mcp/authorize"), true);
  assert.equal(isAllowedAuthorizationTarget("https://beta.gruenerator.eu/api/auth/mcp/authorize"), true);

  // Klartext — auch auf der richtigen Herkunft nicht.
  assert.equal(isAllowedAuthorizationTarget("http://gruenerator.eu/api/auth/mcp/authorize"), false);
  // Fremde Herkunft.
  assert.equal(isAllowedAuthorizationTarget("https://example.com/authorize"), false);
  // Der Klassiker: Präfix-Vergleich statt Herkunftsvergleich würde das durchlassen.
  assert.equal(isAllowedAuthorizationTarget("https://gruenerator.eu.example.com/authorize"), false);
  // Und der zweite Klassiker: Herkunft im Pfad.
  assert.equal(isAllowedAuthorizationTarget("https://example.com/https://gruenerator.eu"), false);
  assert.equal(isAllowedAuthorizationTarget("javascript:alert(1)"), false);
  assert.equal(isAllowedAuthorizationTarget("kein-url"), false);
});

void test("Start- und Rückleitungsadresse liegen auf der Herkunft des Add-ins", () => {
  const bootstrap = buildDialogBootstrapUrl(ADDIN_ORIGIN, `${AUTH_ORIGIN}/api/auth/mcp/authorize?x=1`);
  const parsed = new URL(bootstrap);

  // Office verlangt die gleiche Herkunft für die erste Adresse des Dialogs.
  assert.equal(parsed.origin, ADDIN_ORIGIN);
  assert.equal(parsed.pathname, "/src/oauth-start.html");
  assert.equal(parsed.searchParams.get("target"), `${AUTH_ORIGIN}/api/auth/mcp/authorize?x=1`);

  assert.equal(buildRedirectUri(ADDIN_ORIGIN), `${ADDIN_ORIGIN}/src/oauth-callback.html`);
});

// ---------------------------------------------------------------------------
// Dialogablauf
// ---------------------------------------------------------------------------

void test("Dialog gibt die zurückgemeldete Adresse weiter und schließt sich", async () => {
  const host = new FakeDialogHost({
    kind: "message",
    value: `${ADDIN_ORIGIN}/src/oauth-callback.html?code=abc&state=s`,
  });

  const outcome = await openAuthorizationDialog("https://localhost:3141/src/oauth-start.html", host);

  assert.ok(outcome.ok);
  assert.match(outcome.callbackUrl, /code=abc/);
  assert.equal(host.closed, true);
});

void test("Vom Nutzer geschlossener Dialog meldet Abbruch, nicht Störung", async () => {
  const outcome = await openAuthorizationDialog("x", new FakeDialogHost({ kind: "event", code: 12006 }));

  assert.ok(!outcome.ok);
  assert.equal(outcome.detail, "Anmeldung abgebrochen");
});

void test("Dialog, der sich nicht öffnen lässt, meldet den Grund", async () => {
  const outcome = await openAuthorizationDialog(
    "x",
    new FakeDialogHost({ kind: "openFailed", message: "Popup blockiert" }),
  );

  assert.ok(!outcome.ok);
  assert.equal(outcome.detail, "Popup blockiert");
});

// ---------------------------------------------------------------------------
// Gesamtablauf
// ---------------------------------------------------------------------------

function loginDeps(settings: MemorySettings, dialogHost: DialogHost, extra: DynamicObject = {}) {
  const { fetchFn, calls } = makeFetch([
    { match: "/.well-known/", respond: () => jsonResponse(metadataPayload()) },
    { match: "/register", respond: () => jsonResponse({ client_id: "client-123" }) },
    {
      match: "/token",
      respond: () => jsonResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
    },
  ]);

  return {
    calls,
    deps: {
      settings,
      addinOrigin: ADDIN_ORIGIN,
      authOrigin: AUTH_ORIGIN,
      fetchFn,
      dialogHost,
      now: () => 1_000_000,
      generatePkce: () => Promise.resolve({ verifier: "v-1", challenge: "c-1" }),
      generateState: () => "state-abc",
      ...extra,
    },
  };
}

void test("Anmeldung läuft von der Entdeckung bis zum abgelegten Token durch", async () => {
  const settings = new MemorySettings();
  const host = new FakeDialogHost({
    kind: "message",
    value: `${ADDIN_ORIGIN}/src/oauth-callback.html?code=code-1&state=state-abc`,
  });
  const { deps } = loginDeps(settings, host);

  const result = await login(deps);

  assert.ok(result.ok);
  assert.equal(result.value.access, "at-1");

  const stored = await loadTokens(settings);
  assert.equal(stored?.access, "at-1");
  assert.equal(stored?.expires, 1_000_000 + 3_600_000);
  // Die Client-Kennung wird abgelegt, sonst registriert sich das Add-in bei
  // jedem Start neu und füllt die Client-Tabelle mit Karteileichen.
  assert.equal(await settings.get(OAUTH_CLIENT_ID_KEY), "client-123");
});

void test("Bereits registrierte Client-Kennung wird wiederverwendet", async () => {
  const settings = new MemorySettings();
  await settings.set(OAUTH_CLIENT_ID_KEY, "client-alt");

  const host = new FakeDialogHost({
    kind: "message",
    value: `${ADDIN_ORIGIN}/src/oauth-callback.html?code=code-1&state=state-abc`,
  });
  const { deps, calls } = loginDeps(settings, host);

  const result = await login(deps);

  assert.ok(result.ok);
  assert.equal(calls.some((call) => call.url.includes("/register")), false);
  assert.equal(await settings.get(OAUTH_CLIENT_ID_KEY), "client-alt");
});

void test("Antwort mit fremdem state legt nichts ab", async () => {
  const settings = new MemorySettings();
  const host = new FakeDialogHost({
    kind: "message",
    value: `${ADDIN_ORIGIN}/src/oauth-callback.html?code=code-1&state=fremd`,
  });
  const { deps } = loginDeps(settings, host);

  const result = await login(deps);

  assert.ok(!result.ok);
  assert.equal(settings.has(OAUTH_TOKEN_KEY), false);
});

void test("Umbiegen für den Proxy trifft den Token-Aufruf, nicht die Anmeldeadresse", async () => {
  const settings = new MemorySettings();
  const host = new FakeDialogHost({
    kind: "message",
    value: `${ADDIN_ORIGIN}/src/oauth-callback.html?code=code-1&state=state-abc`,
  });
  const { deps, calls } = loginDeps(settings, host, {
    rewriteFetchEndpoint: (endpoint: string) =>
      endpoint.replace(AUTH_ORIGIN, ADDIN_ORIGIN),
  });

  const result = await login(deps);
  assert.ok(result.ok);

  // Der Tokentausch läuft über den lokalen Proxy — sonst blockt die
  // CORS-Prüfung von beta die Herkunft localhost:3141.
  const tokenCall = calls.find((call) => call.url.includes("/token"));
  assert.ok(tokenCall);
  assert.ok(tokenCall.url.startsWith(ADDIN_ORIGIN));

  // Die Anmeldeadresse im Dialog zeigt weiterhin auf den echten Server: das
  // ist eine Navigation, kein fetch. Umgebogen würde sich die Nutzerin gegen
  // die falsche Sitzung anmelden.
  const target = new URL(host.opened ?? "").searchParams.get("target");
  assert.ok(target);
  assert.ok(target.startsWith(AUTH_ORIGIN));
});

// ---------------------------------------------------------------------------
// Tokenausgabe im Betrieb
// ---------------------------------------------------------------------------

function tokenDeps(settings: MemorySettings, now: number, tokenResponse: () => Response) {
  const { fetchFn, calls } = makeFetch([
    { match: "/.well-known/", respond: () => jsonResponse(metadataPayload()) },
    { match: "/token", respond: tokenResponse },
  ]);

  return {
    calls,
    deps: {
      settings,
      addinOrigin: ADDIN_ORIGIN,
      authOrigin: AUTH_ORIGIN,
      fetchFn,
      now: () => now,
    },
  };
}

void test("Gültiges Token wird ohne Netzaufruf zurückgegeben", async () => {
  const settings = new MemorySettings();
  await settings.set(OAUTH_TOKEN_KEY, { access: "at-1", refresh: "rt-1", expires: 5_000_000 });
  await settings.set(OAUTH_CLIENT_ID_KEY, "client-123");

  const { deps, calls } = tokenDeps(settings, 1_000_000, () => jsonResponse({}));
  const result = await getValidAccessToken(deps);

  assert.ok(result.ok);
  assert.equal(result.value, "at-1");
  assert.equal(calls.length, 0);
});

void test("Fast abgelaufenes Token wird erneuert und neu abgelegt", async () => {
  const settings = new MemorySettings();
  await settings.set(OAUTH_TOKEN_KEY, { access: "at-alt", refresh: "rt-1", expires: 1_000_000 });
  await settings.set(OAUTH_CLIENT_ID_KEY, "client-123");

  const { deps } = tokenDeps(settings, 1_000_000, () =>
    jsonResponse({ access_token: "at-neu", refresh_token: "rt-2", expires_in: 3600 }),
  );

  const result = await getValidAccessToken(deps);

  assert.ok(result.ok);
  assert.equal(result.value, "at-neu");
  const stored = await loadTokens(settings);
  assert.equal(stored?.access, "at-neu");
  assert.equal(stored?.refresh, "rt-2");
});

void test("Gescheiterte Erneuerung löscht die Zugangsdaten", async () => {
  const settings = new MemorySettings();
  await settings.set(OAUTH_TOKEN_KEY, { access: "at-alt", refresh: "rt-abgelaufen", expires: 1_000_000 });
  await settings.set(OAUTH_CLIENT_ID_KEY, "client-123");

  const { deps } = tokenDeps(settings, 1_000_000, () =>
    jsonResponse({ error: "invalid_grant", error_description: "Refresh-Token abgelaufen" }, 400),
  );

  const result = await getValidAccessToken(deps);

  assert.ok(!result.ok);
  assert.match(result.detail, /invalid_grant/);
  // Liegen bleiben würde bedeuten: jede folgende Anfrage wiederholt denselben
  // Fehlversuch, statt zur Anmeldung zu führen.
  assert.equal(settings.has(OAUTH_TOKEN_KEY), false);
});

void test("Ohne Anmeldung gibt es kein Token und keinen Netzaufruf", async () => {
  const settings = new MemorySettings();
  const { deps, calls } = tokenDeps(settings, 1_000_000, () => jsonResponse({}));

  const result = await getValidAccessToken(deps);

  assert.ok(!result.ok);
  assert.equal(calls.length, 0);
});
