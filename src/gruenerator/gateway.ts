/**
 * Provisioniert den einen Grünerator-Gateway und hält ihn aktuell.
 *
 * Läuft bei jedem Start: Endpoint, Modell und Kontextfenster kommen aus der
 * Konfiguration und werden bei jedem Boot überschrieben, damit ein späterer
 * Endpoint-Wechsel ohne Zutun der Nutzer:innen greift. Der Schlüssel bleibt
 * erhalten — er ist das Einzige, was von Hand gesetzt wird.
 */

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

/** Ist ein Schlüssel hinterlegt? Steuert den Hinweis auf der Startseite. */
export async function hasGruenratorApiKey(store: CustomProvidersStoreLike): Promise<boolean> {
  const gateway = await findGruenratorGateway(store);
  return (gateway?.apiKey ?? "").length > 0;
}
