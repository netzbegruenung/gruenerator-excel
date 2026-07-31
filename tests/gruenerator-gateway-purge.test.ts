import assert from "node:assert/strict";
import { test } from "node:test";

import {
  listOpenAiGatewayConfigs,
  saveOpenAiGatewayConfig,
  type CustomProvidersStoreLike,
} from "../src/auth/custom-gateways.ts";
import { purgeForeignGateways } from "../src/gruenerator/gateway-purge.ts";
import type { CustomProvider } from "../src/storage/local/custom-providers-store.ts";

class MemoryStore implements CustomProvidersStoreLike {
  private readonly providers = new Map<string, CustomProvider>();

  get(id: string): Promise<CustomProvider | null> {
    return Promise.resolve(this.providers.get(id) ?? null);
  }

  set(provider: CustomProvider): Promise<void> {
    this.providers.set(provider.id, provider);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.providers.delete(id);
    return Promise.resolve();
  }

  getAll(): Promise<CustomProvider[]> {
    return Promise.resolve([...this.providers.values()]);
  }
}

void test("ein aelteres Gateway unter anderem Namen wird entfernt", async () => {
  // Genau der Fall aus dem Feld: die Installation trug noch einen Gateway aus
  // der Zeit, als direkt auf verdigado gezeigt wurde. `ensureGruenratorGateway`
  // erkennt ihn am Anzeigenamen nicht und legt einen zweiten an — der alte
  // bleibt gueltig, und die gespeicherte Sitzung schickt weiter dorthin.
  const store = new MemoryStore();

  await saveOpenAiGatewayConfig(store, {
    displayName: "litellm.netzbegruenung.verdigado.net",
    endpointUrl: "https://litellm.netzbegruenung.verdigado.net/v1",
    modelId: "verdigado-think",
    apiKey: "alt",
  });
  await saveOpenAiGatewayConfig(store, {
    displayName: "Grünerator",
    endpointUrl: "https://localhost:3141/api/v1",
    modelId: "verdigado-think",
    apiKey: "neu",
  });

  assert.equal((await listOpenAiGatewayConfigs(store)).length, 2);

  const removed = await purgeForeignGateways(store, "Grünerator");
  assert.equal(removed, 1);

  const remaining = await listOpenAiGatewayConfigs(store);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.displayName, "Grünerator");
  assert.equal(remaining[0]?.endpointUrl, "https://localhost:3141/api/v1");
});

void test("unser eigener Gateway bleibt unangetastet", async () => {
  const store = new MemoryStore();
  await saveOpenAiGatewayConfig(store, {
    displayName: "Grünerator",
    endpointUrl: "https://localhost:3141/api/v1",
    modelId: "verdigado-think",
    apiKey: "geheim",
  });

  assert.equal(await purgeForeignGateways(store, "Grünerator"), 0);
  const remaining = await listOpenAiGatewayConfigs(store);
  assert.equal(remaining.length, 1);
  // Der Schluessel darf beim Aufraeumen nicht verlorengehen.
  assert.equal(remaining[0]?.apiKey, "geheim");
});

void test("ein leerer Speicher ist kein Sonderfall", async () => {
  assert.equal(await purgeForeignGateways(new MemoryStore(), "Grünerator"), 0);
});
