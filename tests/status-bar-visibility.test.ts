import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTEXT_PILL_VISIBLE_FROM_PCT,
  shortenModelLabel,
  shouldShowContextPill,
} from "../src/taskpane/status-bar.ts";

void test("die Kontextanzeige bleibt unterhalb der Schwelle verborgen", () => {
  // Darunter meldet sie eine Zahl, aus der nichts folgt, und draengt die
  // Bedienelemente daneben in eine zweite Zeile.
  assert.equal(shouldShowContextPill(0), false);
  assert.equal(shouldShowContextPill(24), false);
  assert.equal(shouldShowContextPill(CONTEXT_PILL_VISIBLE_FROM_PCT - 1), false);
});

void test("ab der Schwelle ist sie da", () => {
  assert.equal(shouldShowContextPill(CONTEXT_PILL_VISIBLE_FROM_PCT), true);
  assert.equal(shouldShowContextPill(95), true);
});

void test("die Schwelle liegt vor der ersten Warnstufe", () => {
  // Sie soll sichtbar sein, bevor es dringend wird — nicht erst mit der
  // Warnung zusammen auftauchen.
  assert.ok(CONTEXT_PILL_VISIBLE_FROM_PCT < 80);
});

void test("die Statusleiste kuerzt den Modellnamen auf das Wesentliche", () => {
  // In der schmalen Leiste zaehlt nur, welches der beiden Modelle laeuft.
  assert.equal(shortenModelLabel("verdigado-think"), "think");
  assert.equal(shortenModelLabel("verdigado-pro"), "pro");
});

void test("fremde Namen bleiben unangetastet", () => {
  // Nur das bekannte Praefix faellt weg — sonst beschneidet die Kurzform
  // irgendwann einen Namen, der zufaellig einen Bindestrich enthaelt.
  assert.equal(shortenModelLabel("gpt-oss-120b"), "gpt-oss-120b");
  assert.equal(shortenModelLabel("verdigado"), "verdigado");
});
