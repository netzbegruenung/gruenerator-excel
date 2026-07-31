/**
 * Runtime model reconciliation after provider configuration changes.
 *
 * Fixes #553: on a fresh install the first runtime is created before any
 * provider is connected, so it holds the absolute-fallback model
 * (`openai/gpt-5.6-sol` — the API provider). When the user then logs in with
 * ChatGPT (`openai-codex`), the runtime kept pointing at the unusable
 * `openai` provider and pi popped an "enter API key" prompt for the wrong
 * provider — charging the pasted API key instead of the subscription.
 *
 * A runtime whose model belongs to a provider with no configured credentials
 * cannot complete any request, so swapping it to the (recomputed) default
 * model is strictly an improvement.
 *
 * Geprüft wird auf **Modell**ebene, nicht auf Anbieterebene: ein Modell kann
 * aus dem Angebot fallen, während sein Anbieter bestehen bleibt. Genau das
 * passiert, wenn sich die Modellliste hinter einem Gateway ändert.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

export interface RuntimeModelSwap {
  model: Model<Api>;
  thinkingLevel: "high" | "off";
}

export function resolveRuntimeModelSwap(opts: {
  currentModel: { provider: string; id: string };
  availableProviders: readonly string[];
  /**
   * Alle derzeit angebotenen Modelle. Fehlt das Modell der Sitzung darin, wird
   * getauscht — auch wenn sein Anbieter noch da ist.
   *
   * Dieser Fork bietet genau ein Modell an, und die Modellliste kann sich
   * ändern, ohne dass der Anbietername sich ändert: eine Sitzung, die noch auf
   * einem früher entdeckten Modell steht (`gemma` aus LiteLLMs eigener Liste),
   * schickt dessen Namen weiter und bekommt vom Endpoint ein 400. Auf
   * Anbieterebene fiele das nie auf.
   */
  availableModels: readonly { provider: string; id: string }[];
  defaultModel: Model<Api>;
  /**
   * True when the runtime is doing any work — streaming OR processing queued
   * actions (`agent.state.isStreaming || actionQueue.isBusy()`). Working
   * sessions must never have their model swapped underneath them; callers
   * skip them and reconcile on a later providers-changed pass.
   */
  isBusy: boolean;
}): RuntimeModelSwap | null {
  const { currentModel, availableProviders, availableModels, defaultModel, isBusy } = opts;

  // Never yank the model out from under a working session (streaming or
  // queue-busy — e.g. /compact, auto-compaction, queued prompts).
  if (isBusy) return null;

  // No providers configured — nothing usable to swap to.
  if (availableProviders.length === 0) return null;

  // Das Modell der Sitzung wird weiterhin angeboten — nichts zu tun.
  const stillOffered = availableModels.some(
    (model) => model.provider === currentModel.provider && model.id === currentModel.id,
  );
  if (stillOffered) return null;

  // Only swap onto a model whose provider is actually usable, otherwise we
  // would just trade one wrong API-key prompt for another.
  if (!availableProviders.includes(defaultModel.provider)) return null;

  return {
    model: defaultModel,
    // Mirror runtime-creation semantics (init.ts): reasoning models default
    // to "high", non-reasoning models must be "off".
    thinkingLevel: defaultModel.reasoning ? "high" : "off",
  };
}
