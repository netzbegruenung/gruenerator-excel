import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";

import { resolveRuntimeModelSwap } from "../src/taskpane/runtime-model-reconcile.ts";

const openaiApiModel = getBuiltinModel("openai", "gpt-5.6-sol");
const codexModel = getBuiltinModel("openai-codex", "gpt-5.6-sol");

/**
 * Modelle, die zu einer Anbieterliste gehören. Der Abgleich prüft auf
 * Modellebene; für diese Fälle genügt „je ein Modell pro Anbieter".
 */
function modelsFor(providers: readonly string[]): { provider: string; id: string }[] {
  const byProvider: Record<string, string> = {
    openai: "gpt-5.6-sol",
    "openai-codex": "gpt-5.6-sol",
    anthropic: "claude-opus-4-8",
    "github-copilot": "gpt-5.6-sol",
  };
  return providers.map((provider) => ({ provider, id: byProvider[provider] ?? "unknown" }));
}


void test("swaps a runtime stuck on an unconfigured provider to the default model (#553)", () => {
  // Fresh-install flow: runtime created with the absolute fallback
  // (openai/gpt-5.6-sol) before login, then the user connects ChatGPT.
  const swap = resolveRuntimeModelSwap({
    currentModel: openaiApiModel,
    availableProviders: ["openai-codex"],
    availableModels: modelsFor(["openai-codex"]),
    defaultModel: codexModel,
    isBusy: false,
  });

  assert.ok(swap, "expected a swap for an unusable provider");
  assert.equal(swap.model.provider, "openai-codex");
  assert.equal(swap.model.id, "gpt-5.6-sol");
  assert.equal(swap.thinkingLevel, codexModel.reasoning ? "high" : "off");
});

void test("leaves runtimes alone when their provider is still configured", () => {
  const swap = resolveRuntimeModelSwap({
    currentModel: openaiApiModel,
    availableProviders: ["openai", "openai-codex"],
    availableModels: modelsFor(["openai", "openai-codex"]),
    defaultModel: codexModel,
    isBusy: false,
  });

  assert.equal(swap, null);
});

void test("does not swap while the runtime is working (streaming or queue-busy)", () => {
  // isBusy covers both `agent.state.isStreaming` and `actionQueue.isBusy()`
  // — the latter is true for non-streaming work too (/compact, pre-prompt
  // auto-compaction, queued slash commands). Working sessions must never
  // have their model swapped underneath them.
  const swap = resolveRuntimeModelSwap({
    currentModel: openaiApiModel,
    availableProviders: ["openai-codex"],
    availableModels: modelsFor(["openai-codex"]),
    defaultModel: codexModel,
    isBusy: true,
  });

  assert.equal(swap, null);
});

void test("does not swap when no providers are configured", () => {
  const swap = resolveRuntimeModelSwap({
    currentModel: openaiApiModel,
    availableProviders: [],
    availableModels: modelsFor([]),
    defaultModel: codexModel,
    isBusy: false,
  });

  assert.equal(swap, null);
});

void test("does not swap onto a default model whose provider is also unusable", () => {
  // e.g. copilot-only setups where the default-model rules used to fall back
  // to openai/gpt-5.6-sol — trading one wrong API-key prompt for another.
  const swap = resolveRuntimeModelSwap({
    currentModel: getBuiltinModel("anthropic", "claude-opus-4-8"),
    availableProviders: ["github-copilot"],
    availableModels: modelsFor(["github-copilot"]),
    defaultModel: openaiApiModel,
    isBusy: false,
  });

  assert.equal(swap, null);
});

void test("init.ts reconcile loop guards on streaming AND queue-busy runtimes", () => {
  // Wiring pin for the working-session invariant: the reconcile loop in
  // init.ts must skip runtimes doing non-streaming work (actionQueue busy)
  // as well as streaming ones, before any model mutation.
  const initSource = readFileSync(
    path.resolve(process.cwd(), "src/taskpane/init.ts"),
    "utf8",
  );

  assert.notEqual(
    initSource.indexOf(
      "if (runtime.agent.state.isStreaming || runtime.actionQueue.isBusy()) {",
    ),
    -1,
    "expected reconcile loop to skip streaming or queue-busy runtimes",
  );
  assert.notEqual(
    initSource.indexOf(
      "isBusy: runtime.agent.state.isStreaming || runtime.actionQueue.isBusy(),",
    ),
    -1,
    "expected resolveRuntimeModelSwap to receive the combined busy state",
  );
});

void test("agent-end wiring retries reconciliation skipped during an in-flight unload", () => {
  const initSource = readFileSync(
    path.resolve(process.cwd(), "src/taskpane/init.ts"),
    "utf8",
  );

  assert.match(
    initSource,
    /if \(ev\.type !== "agent_end"\) return;[\s\S]*?window\.setTimeout\(\(\) => onProvidersChanged\?\.\(\), 0\);/u,
  );
});

void test("sets thinkingLevel to off when swapping onto a non-reasoning model", () => {
  const nonReasoning = {
    ...codexModel,
    reasoning: false,
  };

  const swap = resolveRuntimeModelSwap({
    currentModel: openaiApiModel,
    availableProviders: ["openai-codex"],
    availableModels: modelsFor(["openai-codex"]),
    defaultModel: nonReasoning,
    isBusy: false,
  });

  assert.ok(swap);
  assert.equal(swap.thinkingLevel, "off");
});

void test("swaps a session whose model left the offer while its provider stayed", () => {
  // Der Fall aus dem Fork: der Gateway hiess vorher wie jetzt, bot aber eine
  // andere Modellliste an. Die Sitzung stand weiter auf `gemma`, schickte den
  // Namen mit und bekam vom Endpoint ein 400 — auf Anbieterebene unsichtbar.
  const gatewayModel = { ...codexModel, provider: "Gateway · Grünerator", id: "verdigado-think" };

  const swap = resolveRuntimeModelSwap({
    currentModel: { provider: "Gateway · Grünerator", id: "gemma" },
    availableProviders: ["Gateway · Grünerator"],
    availableModels: [{ provider: "Gateway · Grünerator", id: "verdigado-think" }],
    defaultModel: gatewayModel,
    isBusy: false,
  });

  assert.ok(swap, "expected a swap for a model that is no longer offered");
  assert.equal(swap.model.id, "verdigado-think");
});
