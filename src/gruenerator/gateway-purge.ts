/**
 * Entfernt jedes OpenAI-Gateway, das nicht unseres ist.
 *
 * Dieser Fork hat genau eine Modellquelle, aber `findGruenratorGateway`
 * erkennt sie am Anzeigenamen. Wer eine ältere Fassung benutzt hat, in der der
 * Gateway noch direkt auf verdigado zeigte, trägt einen zweiten Eintrag mit
 * einem anderen Namen im Speicher — `ensureGruenratorGateway` legt daneben
 * einen neuen an, statt den alten zu übernehmen.
 *
 * Der alte bleibt dann gültig, und weil eine gespeicherte Sitzung ihr Modell
 * mitsamt `baseUrl` festhält, laufen die Anfragen weiter dorthin: die
 * Zugangsseite prüft den neuen Gateway und meldet „Verbindung steht", der Chat
 * spricht den alten an und scheitert am CORS-Preflight von dessen nginx. Das
 * Ergebnis ist ein Fehlerbild, das auf nichts zeigt — „Connection error." bei
 * gleichzeitig grünem Test.
 *
 * Eigenes Modul und der Name als Parameter, damit hier nichts aus `config.ts`
 * hängt: die liest `import.meta.env`, das es nur im Vite-Build gibt.
 */

import {
  deleteOpenAiGatewayConfig,
  listOpenAiGatewayConfigs,
  type CustomProvidersStoreLike,
} from "../auth/custom-gateways.js";

/** Gibt zurück, wie viele Gateways entfernt wurden. */
export async function purgeForeignGateways(
  store: CustomProvidersStoreLike,
  keepDisplayName: string,
): Promise<number> {
  const gateways = await listOpenAiGatewayConfigs(store);
  let removed = 0;

  for (const gateway of gateways) {
    if (gateway.displayName === keepDisplayName) continue;
    try {
      await deleteOpenAiGatewayConfig(store, gateway.id);
      removed += 1;
    } catch (error) {
      console.warn(`[gruenerator] Fremdes Gateway ${gateway.displayName} blieb liegen:`, error);
    }
  }

  return removed;
}
