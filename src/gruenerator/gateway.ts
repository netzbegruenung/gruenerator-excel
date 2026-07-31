/**
 * Provisioniert den einen Grünerator-Gateway und hält ihn aktuell.
 *
 * Läuft bei jedem Start: Endpoint, Modell und Kontextfenster kommen aus der
 * Konfiguration und werden bei jedem Boot überschrieben, damit ein späterer
 * Endpoint-Wechsel ohne Zutun der Nutzer:innen greift. Der Schlüssel bleibt
 * erhalten — er ist das Einzige, was von Hand gesetzt wird.
 */

import { clearOAuthCredentials } from "../auth/oauth-storage.js";
import { BROWSER_OAUTH_PROVIDERS } from "../auth/provider-map.js";
import type { SettingsStore } from "../storage/local/settings-store.js";
import {
  listOpenAiGatewayConfigs,
  saveOpenAiGatewayConfig,
  type CustomProvidersStoreLike,
  type OpenAiGatewayConfig,
} from "../auth/custom-gateways.js";
import {
  GRUENERATOR_CONTEXT_WINDOW,
  GRUENERATOR_ENDPOINT_URL,
  GRUENERATOR_GATEWAY_NAME,
  GRUENERATOR_MODEL_ID,
} from "./config.js";

/** Findet den Grünerator-Gateway unter den gespeicherten Gateways. */
export async function findGruenratorGateway(
  store: CustomProvidersStoreLike,
): Promise<OpenAiGatewayConfig | null> {
  const gateways = await listOpenAiGatewayConfigs(store);
  return gateways.find((gateway) => gateway.displayName === GRUENERATOR_GATEWAY_NAME) ?? null;
}

/**
 * Legt den Gateway an oder aktualisiert ihn. `apiKey` überschreibt den
 * gespeicherten Schlüssel nur, wenn er übergeben wird.
 */
export async function ensureGruenratorGateway(
  store: CustomProvidersStoreLike,
  apiKey?: string,
): Promise<OpenAiGatewayConfig> {
  const existing = await findGruenratorGateway(store);
  const resolvedKey = apiKey ?? existing?.apiKey ?? "";

  const input = {
    displayName: GRUENERATOR_GATEWAY_NAME,
    endpointUrl: GRUENERATOR_ENDPOINT_URL,
    modelId: GRUENERATOR_MODEL_ID,
    contextWindow: GRUENERATOR_CONTEXT_WINDOW,
    apiKey: resolvedKey,
    ...(existing ? { id: existing.id } : {}),
  };

  return saveOpenAiGatewayConfig(store, input);
}

/** Setzt den Zugangsschlüssel und meldet die Provideränderung an die App. */
export async function setGruenratorApiKey(
  store: CustomProvidersStoreLike,
  apiKey: string,
): Promise<OpenAiGatewayConfig> {
  const gateway = await ensureGruenratorGateway(store, apiKey.trim());
  document.dispatchEvent(new CustomEvent("pi:providers-changed"));
  return gateway;
}

/**
 * Entfernt den hinterlegten Schlüssel. Der Gateway selbst bleibt stehen — er
 * wird beim nächsten Start ohnehin neu provisioniert, und ohne ihn hätte die
 * App gar keine Modellquelle mehr.
 */
export async function clearGruenratorApiKey(
  store: CustomProvidersStoreLike,
): Promise<OpenAiGatewayConfig> {
  const gateway = await ensureGruenratorGateway(store, "");
  document.dispatchEvent(new CustomEvent("pi:providers-changed"));
  return gateway;
}

/**
 * Schaltet den lokalen CORS-Proxy ab, falls eine frühere Fassung ihn gesetzt hat.
 *
 * Solange der Gateway direkt auf verdigado zeigte, war der Proxy nötig — dessen
 * nginx beantwortet den CORS-Preflight mit 401. Seit der Umstellung auf das
 * Grünerator-Backend ist er überflüssig und sogar schädlich: er blockt
 * Loopback-Ziele (`blocked_target_loopback`), also genau den lokalen Lauf.
 *
 * Das Entfernen des Codes allein genügt nicht — `proxy.enabled` liegt im
 * Browser-Speicher und überlebt jedes Update. Und weil die Proxy-Seite aus den
 * Einstellungen entfernt ist, gäbe es keinen Weg, ihn von Hand auszuschalten.
 * Kann weg, sobald niemand mehr eine Installation von vor der Umstellung hat.
 */
export async function disableLegacyProxy(settings: {
  get(key: string): Promise<DynamicValue>;
  set(key: string, value: DynamicValue): Promise<void>;
}): Promise<void> {
  const configured = await settings.get("proxy.enabled");
  if (configured !== true) return;

  await settings.set("proxy.enabled", false);
}

/**
 * Entfernt jede fremde Anmeldung aus dem Browser-Speicher.
 *
 * Upstream konnte man sich bei Anthropic, ChatGPT, Copilot und Google
 * einloggen; wer eine ältere Fassung benutzt hat, ist dort weiterhin
 * angemeldet, weil Zugangsdaten das Entfernen des Anmelde-Codes überleben.
 * Dieser Fork hat genau eine Modellquelle, also darf auch genau eine
 * Zugangsberechtigung im Speicher liegen — der eigene Schlüssel, und der
 * liegt am Gateway, nicht hier.
 *
 * Läuft bei jedem Start und nicht als einmalige Migration: es ist billig, und
 * ein zurückgespieltes Backup darf keine fremden Token wieder einschleusen.
 */
export async function purgeForeignCredentials(
  providerKeys: { list(): Promise<string[]>; delete(provider: string): Promise<void> },
  settings: SettingsStore,
): Promise<void> {
  const stored = await providerKeys.list();
  for (const provider of stored) {
    await providerKeys.delete(provider);
  }

  for (const providerId of BROWSER_OAUTH_PROVIDERS) {
    await clearOAuthCredentials(settings, providerId);
  }
}

/**
 * Wirft zwischengespeicherte Modellkataloge fremder Anbieter weg.
 *
 * Der Katalog wird pro Anbieter gespeichert und überlebt einen Wechsel des
 * Endpunkts. Als der Gateway noch direkt auf LiteLLM zeigte, landete dessen
 * vollständige Liste im Speicher — inklusive der Embedding-Modelle
 * (`nomic-embed-text`), die auf einen Chat-Request unbrauchbar antworten.
 * Unser Endpunkt liefert eine kuratierte Liste; alles andere hat hier nichts
 * mehr zu suchen.
 */
export async function purgeForeignModelCatalogs(
  catalogs: { listProviderIds(): Promise<string[]>; delete(providerId: string): Promise<void> },
  ownProviderName: string,
): Promise<void> {
  const providerIds = await catalogs.listProviderIds();
  for (const providerId of providerIds) {
    if (providerId !== ownProviderName) {
      await catalogs.delete(providerId);
    }
  }
}

/** Ist ein Schlüssel hinterlegt? Steuert den Hinweis auf der Startseite. */
export async function hasGruenratorApiKey(store: CustomProvidersStoreLike): Promise<boolean> {
  const gateway = await findGruenratorGateway(store);
  return (gateway?.apiKey ?? "").length > 0;
}
