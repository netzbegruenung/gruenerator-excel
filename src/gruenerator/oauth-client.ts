/**
 * OAuth-2.1-Client gegen den Grünerator-Autorisierungsserver.
 *
 * Der Unterschied zum Upstream ist nicht die Menge Code, sondern wer den
 * Server betreibt. Upstream spricht mit Anthropic, OpenAI und Google: deren
 * Token-Endpunkte senden keine CORS-Header an Browser-Herkünfte, und ihre
 * Redirect-URIs zeigen auf `http://localhost:1455/…` — ein Taskpane kann auf
 * keinem Port lauschen. Deshalb braucht Upstream einen Begleitprozess auf dem
 * Rechner, der die Weiterleitung abfängt und die Token-Aufrufe durchreicht.
 *
 * Wir sind der Autorisierungsserver (Better Auth, `mcp()`-Plugin: OAuth 2.1
 * mit Pflicht-PKCE und dynamischer Client-Registrierung). Damit setzen wir die
 * CORS-Header selbst und tragen eine echte HTTPS-Redirect-URI auf unserer
 * eigenen Herkunft ein. Kein Begleitprozess, kein Lauschen, kein Abfragen im
 * Takt.
 *
 * Dieses Modul ist bewusst frei von Office.js, `import.meta.env` und Speicher:
 * es bekommt alles als Parameter und ist dadurch unter `node --test`
 * vollständig prüfbar. Die Verdrahtung liegt in `oauth-session.ts`, der Dialog
 * in `oauth-dialog.ts`.
 */

/** Ohne `offline_access` gibt der Server kein Refresh-Token heraus. */
export const GRUENERATOR_OAUTH_SCOPE = "chat:completions offline_access";

/** Anzeigename bei der dynamischen Registrierung — taucht auf der Consent-Seite auf. */
export const GRUENERATOR_OAUTH_CLIENT_NAME = "Grünerator für Excel";

/**
 * Zugangsdaten in der Form, die `oauth-storage.ts` bereits kennt
 * (`OAuthCredentials` aus pi-ai: `access`, `refresh`, `expires`).
 * `expires` ist ein absoluter Zeitpunkt in Millisekunden, keine Restlaufzeit —
 * eine Restlaufzeit wäre nach dem ersten Neuladen des Taskpanes wertlos.
 */
export interface GruenteratorTokens {
  access: string;
  refresh: string;
  expires: number;
}

export interface AuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Fehlt, wenn der Server keine dynamische Registrierung anbietet. */
  registrationEndpoint: string | null;
}

/** Fehlerstufen — bestimmen, was das UI schreibt und ob ein neuer Versuch hilft. */
export type OAuthFailureStage =
  | "discovery"
  | "registration"
  | "authorization"
  | "token"
  | "refresh";

export type OAuthResult<T> = { ok: true; value: T } | { ok: false; stage: OAuthFailureStage; detail: string };

export interface OAuthHttpDeps {
  /** `| undefined` ausdrücklich: das Projekt fährt exactOptionalPropertyTypes. */
  fetchFn?: typeof globalThis.fetch | undefined;
}

function resolveFetch(deps: OAuthHttpDeps | undefined): typeof globalThis.fetch {
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("Kein fetch verfügbar — fetchFn übergeben");
  }
  return fetchFn;
}

/** Benannt nach der Sache, nicht nach der Form — generische Objekt-Wächter sind hier untersagt. */
function isOAuthJsonBody(value: DynamicValue): value is DynamicObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: DynamicValue): DynamicObject | null {
  return isOAuthJsonBody(value) ? value : null;
}

function readString(source: DynamicObject, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function describeError(error: DynamicValue): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Liest so viel wie möglich aus einer Fehlerantwort heraus.
 *
 * OAuth-Server antworten im Fehlerfall mit `{error, error_description}`; das
 * ist die Zeile, die einem Menschen tatsächlich weiterhilft. Fällt das aus,
 * bleibt der Statuscode — besser als „Anfrage fehlgeschlagen“.
 */
async function describeHttpFailure(response: Response): Promise<string> {
  try {
    const body: DynamicValue = await response.json();
    const parsed = asObject(body);
    if (parsed) {
      const code = readString(parsed, "error");
      const description = readString(parsed, "error_description");
      if (code && description) return `${code}: ${description}`;
      if (description) return description;
      if (code) return code;
    }
  } catch {
    // Kein JSON — der Statuscode unten muss reichen.
  }
  return `HTTP ${response.status}`;
}

/**
 * Pfad des Metadatendokuments — **nicht** an der Wurzel.
 *
 * RFC 8414 sieht `/.well-known/oauth-authorization-server` an der Herkunft
 * vor. Dort liegt es bei uns aber nicht: Better Auth bedient das Dokument
 * unter seinem eigenen `basePath`, und der nginx vor gruenerator.eu reicht
 * den Wurzelpfad an die SPA weiter. Ein Abruf an der Wurzel bekommt deshalb
 * HTTP 200 mit der HTML-Seite — kein Fehler, nur kein JSON.
 *
 * Am 31.07.2026 gegen beta.gruenerator.eu nachgemessen:
 *
 *   /.well-known/oauth-authorization-server              -> 200 text/html
 *   /api/auth/v2/.well-known/oauth-authorization-server  -> 200 application/json
 *
 * Angenehmer Nebeneffekt: der Pfad liegt unter `/api/` und geht im lokalen
 * Lauf damit durch denselben Vite-Proxy wie alles andere.
 */
export const OAUTH_DISCOVERY_PATH = "/api/auth/v2/.well-known/oauth-authorization-server";

/**
 * Fragt die Metadaten des Autorisierungsservers ab (RFC 8414).
 *
 * `origin` ist die Herkunft ohne Pfad, etwa `https://gruenerator.eu`. Die
 * Adressen kommen aus dem Dokument statt aus Konstanten — sie hier fest zu
 * verdrahten wäre eine zweite Wahrheit neben dem Server.
 */
export async function discoverAuthServer(
  origin: string,
  deps?: OAuthHttpDeps,
): Promise<OAuthResult<AuthServerMetadata>> {
  const url = `${origin.replace(/\/$/, "")}${OAUTH_DISCOVERY_PATH}`;

  let response: Response;
  try {
    response = await resolveFetch(deps)(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    return { ok: false, stage: "discovery", detail: describeError(error) };
  }

  if (!response.ok) {
    return { ok: false, stage: "discovery", detail: await describeHttpFailure(response) };
  }

  // HTML statt JSON bei HTTP 200 heisst: die Anfrage ist bei der SPA gelandet,
  // nicht beim Autorisierungsserver — ein falscher Pfad oder eine nginx-Regel,
  // die den Wurzelpfad wegfängt. Genau das ist am 31.07.2026 passiert, und der
  // Parserfehler allein („Unexpected token <") zeigt auf nichts.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return {
      ok: false,
      stage: "discovery",
      detail: `${url} lieferte ${contentType || "unbekannten Inhaltstyp"} statt JSON — vermutlich die Weboberfläche statt des Autorisierungsservers`,
    };
  }

  let payload: DynamicValue;
  try {
    payload = await response.json();
  } catch (error) {
    return { ok: false, stage: "discovery", detail: describeError(error) };
  }

  const parsed = asObject(payload);
  if (!parsed) {
    return { ok: false, stage: "discovery", detail: "Antwort war kein JSON-Objekt" };
  }

  const authorizationEndpoint = readString(parsed, "authorization_endpoint");
  const tokenEndpoint = readString(parsed, "token_endpoint");
  if (!authorizationEndpoint || !tokenEndpoint) {
    return {
      ok: false,
      stage: "discovery",
      detail: "Metadaten ohne authorization_endpoint oder token_endpoint",
    };
  }

  return {
    ok: true,
    value: {
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint: readString(parsed, "registration_endpoint"),
    },
  };
}

/**
 * Dynamische Client-Registrierung (RFC 7591).
 *
 * Wir registrieren als **öffentlicher** Client: `token_endpoint_auth_method:
 * "none"`, kein Secret. Ein Secret in einem Browser-Bundle ist keins — PKCE
 * ist hier der Nachweis, nicht das Geheimnis.
 *
 * Die vergebene `client_id` gilt pro Installation und wird von der aufrufenden
 * Schicht gespeichert; eine erneute Registrierung bei jedem Start würde die
 * Client-Tabelle des Servers fluten.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  deps?: OAuthHttpDeps,
): Promise<OAuthResult<string>> {
  let response: Response;
  try {
    response = await resolveFetch(deps)(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: GRUENERATOR_OAUTH_CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: GRUENERATOR_OAUTH_SCOPE,
      }),
    });
  } catch (error) {
    return { ok: false, stage: "registration", detail: describeError(error) };
  }

  if (!response.ok) {
    return { ok: false, stage: "registration", detail: await describeHttpFailure(response) };
  }

  let payload: DynamicValue;
  try {
    payload = await response.json();
  } catch (error) {
    return { ok: false, stage: "registration", detail: describeError(error) };
  }

  const parsed = asObject(payload);
  const clientId = parsed ? readString(parsed, "client_id") : null;
  if (!clientId) {
    return { ok: false, stage: "registration", detail: "Antwort ohne client_id" };
  }

  return { ok: true, value: clientId };
}

export interface AuthorizationUrlInput {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}

/**
 * Baut die Adresse, die im Anmeldedialog geöffnet wird.
 *
 * `prompt=consent` steht bewusst drin: das Better-Auth-Plugin überspringt die
 * Zustimmungsseite sonst, sobald eine Sitzung besteht — die Nutzerin sähe nie,
 * was sie freigibt.
 */
export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scope ?? GRUENERATOR_OAUTH_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

/**
 * Liest den Autorisierungscode aus der Rückleitungsadresse.
 *
 * Der `state`-Abgleich ist keine Formsache: ohne ihn nimmt das Add-in einen
 * Code entgegen, den ein fremder Ablauf erzeugt hat. Ungleicher `state` wird
 * deshalb wie ein Fehlschlag behandelt, nicht wie ein Sonderfall.
 */
export function parseCallbackUrl(
  rawUrl: string,
  expectedState: string,
): OAuthResult<string> {
  let params: URLSearchParams;
  try {
    params = new URL(rawUrl).searchParams;
  } catch (error) {
    return { ok: false, stage: "authorization", detail: describeError(error) };
  }

  const error = params.get("error");
  if (error) {
    const description = params.get("error_description");
    return {
      ok: false,
      stage: "authorization",
      detail: description ? `${error}: ${description}` : error,
    };
  }

  if (params.get("state") !== expectedState) {
    return { ok: false, stage: "authorization", detail: "state stimmt nicht überein" };
  }

  const code = params.get("code");
  if (!code) {
    return { ok: false, stage: "authorization", detail: "Rückleitung ohne code" };
  }

  return { ok: true, value: code };
}

/**
 * Wandelt die Token-Antwort in absolute Ablaufzeit um.
 *
 * Fehlt `expires_in`, nehmen wir eine Stunde an — denselben Wert, den der
 * Server als `accessTokenExpiresIn` führt. Zu kurz geraten kostet einen
 * überflüssigen Erneuerungslauf, zu lang geraten kostet einen 401 mitten in
 * einer Anfrage; die Richtung ist also bewusst gewählt.
 */
function toTokens(parsed: DynamicObject, now: number, previousRefresh: string | null): OAuthResult<GruenteratorTokens> {
  const access = readString(parsed, "access_token");
  if (!access) {
    return { ok: false, stage: "token", detail: "Antwort ohne access_token" };
  }

  // Bei der Erneuerung darf der Server das Refresh-Token weglassen; dann gilt
  // das bisherige weiter. Ohne diesen Rückgriff wäre nach der ersten
  // Erneuerung Schluss.
  const refresh = readString(parsed, "refresh_token") ?? previousRefresh;
  if (!refresh) {
    return { ok: false, stage: "token", detail: "Antwort ohne refresh_token" };
  }

  const rawExpiry = parsed["expires_in"];
  const expiresInSeconds = typeof rawExpiry === "number" && Number.isFinite(rawExpiry) ? rawExpiry : 3600;

  return { ok: true, value: { access, refresh, expires: now + expiresInSeconds * 1000 } };
}

async function postTokenRequest(
  tokenEndpoint: string,
  body: URLSearchParams,
  stage: OAuthFailureStage,
  now: number,
  previousRefresh: string | null,
  deps?: OAuthHttpDeps,
): Promise<OAuthResult<GruenteratorTokens>> {
  let response: Response;
  try {
    response = await resolveFetch(deps)(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (error) {
    return { ok: false, stage, detail: describeError(error) };
  }

  if (!response.ok) {
    return { ok: false, stage, detail: await describeHttpFailure(response) };
  }

  let payload: DynamicValue;
  try {
    payload = await response.json();
  } catch (error) {
    return { ok: false, stage, detail: describeError(error) };
  }

  const parsed = asObject(payload);
  if (!parsed) {
    return { ok: false, stage, detail: "Antwort war kein JSON-Objekt" };
  }

  const tokens = toTokens(parsed, now, previousRefresh);
  if (!tokens.ok) {
    return { ok: false, stage, detail: tokens.detail };
  }
  return tokens;
}

export interface CodeExchangeInput {
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  now?: number | undefined;
}

export async function exchangeAuthorizationCode(
  input: CodeExchangeInput,
  deps?: OAuthHttpDeps,
): Promise<OAuthResult<GruenteratorTokens>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });

  return postTokenRequest(input.tokenEndpoint, body, "token", input.now ?? Date.now(), null, deps);
}

export interface RefreshInput {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  now?: number | undefined;
}

export async function refreshAccessToken(
  input: RefreshInput,
  deps?: OAuthHttpDeps,
): Promise<OAuthResult<GruenteratorTokens>> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });

  return postTokenRequest(
    input.tokenEndpoint,
    body,
    "refresh",
    input.now ?? Date.now(),
    input.refreshToken,
    deps,
  );
}

/**
 * Vorlaufzeit, ab der ein Token als abgelaufen gilt.
 *
 * 60 Sekunden, weil eine Anfrage an das Modell länger dauern kann als der
 * Augenblick, in dem wir prüfen: ein Token, das in zehn Sekunden verfällt,
 * überlebt eine laufende Antwort nicht.
 */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

export function needsRefresh(
  tokens: GruenteratorTokens,
  now: number = Date.now(),
  skewMs: number = TOKEN_REFRESH_SKEW_MS,
): boolean {
  return tokens.expires - skewMs <= now;
}

/**
 * Biegt eine absolute Serveradresse auf die eigene Herkunft um.
 *
 * Nur für den lokalen Lauf: der Vite-Proxy leitet `/api/**` an das Backend
 * weiter, wodurch der Aufruf gleichherkünftig bleibt und die CORS-Prüfung von
 * beta — die `localhost:3141` im Produktionsmodus nicht kennt — gar nicht erst
 * greift. Auch das Metadatendokument liegt unter `/api/` (siehe
 * OAUTH_DISCOVERY_PATH), es braucht also keine eigene Regel.
 *
 * Pfade außerhalb von `/api/` bleiben unangetastet: für die gibt es keinen
 * Proxy-Eintrag, und ein Umbiegen würde ins Leere zeigen.
 */
export function rewriteToLocalProxy(endpoint: string, localOrigin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return endpoint;
  }

  if (!parsed.pathname.startsWith("/api/")) return endpoint;

  return `${localOrigin.replace(/\/$/, "")}${parsed.pathname}${parsed.search}`;
}
