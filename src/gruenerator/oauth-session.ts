/**
 * Der Anmeldeablauf als Ganzes — verbindet Entdeckung, Registrierung, PKCE,
 * Dialog, Tokentausch und Erneuerung.
 *
 * Alles Äußere kommt als Parameter herein: Speicher, `fetch`, Dialoghost, Uhr
 * und PKCE-Erzeugung. Das ist nicht Zierde, sondern die Bedingung dafür, dass
 * der Ablauf unter `node --test` vollständig durchlaufen werden kann — ohne
 * Office, ohne IndexedDB, ohne Netz. Genau diese drei fehlen beim Prüfen, und
 * genau in ihrem Zusammenspiel steckt der Fehler, den man sonst erst in Excel
 * sieht.
 */

import {
  buildAuthorizationUrl,
  discoverAuthServer,
  exchangeAuthorizationCode,
  needsRefresh,
  parseCallbackUrl,
  refreshAccessToken,
  registerClient,
  type AuthServerMetadata,
  type GruenteratorTokens,
  type OAuthFailureStage,
  type OAuthResult,
} from "./oauth-client.js";
import {
  buildDialogBootstrapUrl,
  buildRedirectUri,
  openAuthorizationDialog,
  type DialogHost,
} from "./oauth-dialog.js";

/** Schlüssel im Einstellungsspeicher. Beide sind F0: nie umbenennen, nur additiv. */
export const OAUTH_TOKEN_KEY = "oauth.gruenerator";
export const OAUTH_CLIENT_ID_KEY = "oauth.gruenerator.clientId";

/**
 * Nur die drei Methoden, die wir brauchen — bewusst nicht der Typ aus
 * `storage/local/settings-store.js`: dessen Import zöge IndexedDB-Code in
 * einen Node-Testlauf, in dem es kein IndexedDB gibt.
 */
export interface SettingsLike {
  get(key: string): Promise<DynamicValue>;
  set(key: string, value: DynamicValue): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PkceMaterial {
  verifier: string;
  challenge: string;
}

export interface OAuthSessionDeps {
  settings: SettingsLike;
  /** Herkunft des Add-ins, etwa `https://localhost:3141`. */
  addinOrigin: string;
  /** Herkunft des Grünerator-Backends, etwa `https://gruenerator.eu`. */
  authOrigin: string;
  fetchFn?: typeof globalThis.fetch | undefined;
  dialogHost?: DialogHost | undefined;
  now?: (() => number) | undefined;
  generatePkce?: (() => Promise<PkceMaterial>) | undefined;
  generateState?: (() => string) | undefined;
  /**
   * Biegt die per Entdeckung gefundenen **fetch**-Adressen um (Registrierung,
   * Token). Nur für den lokalen Lauf gedacht.
   *
   * Grund: der Server liefert absolute Adressen auf seiner eigenen Herkunft
   * (`https://beta.gruenerator.eu/api/auth/…`). Ein `fetch` dorthin aus dem
   * Taskpane auf `localhost:3141` ist herkunftsübergreifend, und diese Herkunft
   * steht in der CORS-Liste des Backends nur im Entwicklungsmodus — beta läuft
   * mit `NODE_ENV=production`. Über den Vite-Proxy bleibt derselbe Aufruf
   * gleichherkünftig.
   *
   * Die **Autorisierungsadresse** wird bewusst nicht umgebogen: das ist eine
   * echte Navigation im Dialog, kein `fetch`. Sie muss auf den richtigen Server
   * zeigen, sonst meldet sich die Nutzerin gegen die falsche Sitzung an.
   */
  rewriteFetchEndpoint?: ((endpoint: string) => string) | undefined;
}

function isTokens(value: DynamicValue): value is GruenteratorTokens {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as DynamicObject)["access"] === "string" &&
    typeof (value as DynamicObject)["refresh"] === "string" &&
    typeof (value as DynamicObject)["expires"] === "number"
  );
}

export async function loadTokens(settings: SettingsLike): Promise<GruenteratorTokens | null> {
  try {
    const stored: DynamicValue = await settings.get(OAUTH_TOKEN_KEY);
    return isTokens(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function clearSession(settings: SettingsLike): Promise<void> {
  await settings.delete(OAUTH_TOKEN_KEY);
}

function forFetch(endpoint: string, deps: OAuthSessionDeps): string {
  return deps.rewriteFetchEndpoint ? deps.rewriteFetchEndpoint(endpoint) : endpoint;
}

function defaultState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Besorgt die Client-Kennung — einmal registrieren, danach aus dem Speicher.
 *
 * Eine erneute Registrierung bei jedem Start würde die Client-Tabelle des
 * Servers mit Karteileichen füllen, eine pro Neustart des Taskpanes.
 */
async function ensureClientId(
  metadata: AuthServerMetadata,
  deps: OAuthSessionDeps,
  redirectUri: string,
): Promise<OAuthResult<string>> {
  try {
    const stored: DynamicValue = await deps.settings.get(OAUTH_CLIENT_ID_KEY);
    if (typeof stored === "string" && stored.length > 0) {
      return { ok: true, value: stored };
    }
  } catch {
    // Nicht lesbar heisst: neu registrieren. Kein Grund abzubrechen.
  }

  if (!metadata.registrationEndpoint) {
    return {
      ok: false,
      stage: "registration",
      detail: "Server bietet keine dynamische Client-Registrierung an",
    };
  }

  const registered = await registerClient(
    forFetch(metadata.registrationEndpoint, deps),
    redirectUri,
    { fetchFn: deps.fetchFn },
  );
  if (!registered.ok) return registered;

  await deps.settings.set(OAUTH_CLIENT_ID_KEY, registered.value);
  return registered;
}

/**
 * Führt die Anmeldung durch und legt die Zugangsdaten ab.
 *
 * `verifier` und `state` bleiben absichtlich im Arbeitsspeicher: der Dialog
 * meldet sich an dieselbe Taskpane-Instanz zurück, die ihn geöffnet hat. Sie
 * zu speichern würde ein Geheimnis über den Ablauf hinaus haltbar machen,
 * ohne dass irgendjemand davon etwas hätte.
 */
export async function login(deps: OAuthSessionDeps): Promise<OAuthResult<GruenteratorTokens>> {
  const dialogHost = deps.dialogHost;
  if (!dialogHost) {
    return { ok: false, stage: "authorization", detail: "Kein Dialoghost verfügbar" };
  }

  const metadata = await discoverAuthServer(deps.authOrigin, { fetchFn: deps.fetchFn });
  if (!metadata.ok) return metadata;

  const redirectUri = buildRedirectUri(deps.addinOrigin);

  const clientId = await ensureClientId(metadata.value, deps, redirectUri);
  if (!clientId.ok) return clientId;

  const pkce = await (deps.generatePkce
    ? deps.generatePkce()
    : import("../auth/pkce.js").then((module) => module.generatePKCE()));
  const state = (deps.generateState ?? defaultState)();

  const authorizationUrl = buildAuthorizationUrl({
    authorizationEndpoint: metadata.value.authorizationEndpoint,
    clientId: clientId.value,
    redirectUri,
    state,
    codeChallenge: pkce.challenge,
  });

  const outcome = await openAuthorizationDialog(
    buildDialogBootstrapUrl(deps.addinOrigin, authorizationUrl),
    dialogHost,
  );
  if (!outcome.ok) {
    return { ok: false, stage: "authorization", detail: outcome.detail };
  }

  const code = parseCallbackUrl(outcome.callbackUrl, state);
  if (!code.ok) return code;

  const tokens = await exchangeAuthorizationCode(
    {
      tokenEndpoint: forFetch(metadata.value.tokenEndpoint, deps),
      clientId: clientId.value,
      redirectUri,
      code: code.value,
      codeVerifier: pkce.verifier,
      now: deps.now?.(),
    },
    { fetchFn: deps.fetchFn },
  );
  if (!tokens.ok) return tokens;

  await deps.settings.set(OAUTH_TOKEN_KEY, { ...tokens.value });
  return tokens;
}

/**
 * Liefert ein gültiges Zugriffstoken, erneuert es bei Bedarf.
 *
 * Schlägt die Erneuerung fehl, werden die Zugangsdaten **gelöscht**. Ein
 * abgelaufenes Refresh-Token liegen zu lassen führt sonst dazu, dass jede
 * folgende Anfrage denselben Fehlversuch wiederholt, statt zur Anmeldung zu
 * führen.
 */
export async function getValidAccessToken(
  deps: OAuthSessionDeps,
): Promise<OAuthResult<string>> {
  const stored = await loadTokens(deps.settings);
  if (!stored) {
    return { ok: false, stage: "authorization", detail: "Nicht angemeldet" };
  }

  const now = deps.now?.() ?? Date.now();
  if (!needsRefresh(stored, now)) {
    return { ok: true, value: stored.access };
  }

  const metadata = await discoverAuthServer(deps.authOrigin, { fetchFn: deps.fetchFn });
  if (!metadata.ok) return metadata;

  let clientId: string | null = null;
  try {
    const value: DynamicValue = await deps.settings.get(OAUTH_CLIENT_ID_KEY);
    if (typeof value === "string" && value.length > 0) clientId = value;
  } catch {
    // Fällt unten auf die Fehlermeldung durch.
  }
  if (!clientId) {
    return { ok: false, stage: "refresh", detail: "Client-Kennung fehlt — bitte neu anmelden" };
  }

  const refreshed = await refreshAccessToken(
    {
      tokenEndpoint: forFetch(metadata.value.tokenEndpoint, deps),
      clientId,
      refreshToken: stored.refresh,
      now,
    },
    { fetchFn: deps.fetchFn },
  );

  if (!refreshed.ok) {
    await clearSession(deps.settings);
    return refreshed;
  }

  await deps.settings.set(OAUTH_TOKEN_KEY, { ...refreshed.value });
  return { ok: true, value: refreshed.value.access };
}

/** Für die Anzeige im Zugang-Bereich: angemeldet, ohne ein Token zu offenbaren. */
export async function isSignedIn(settings: SettingsLike): Promise<boolean> {
  return (await loadTokens(settings)) !== null;
}

export type { OAuthFailureStage };
