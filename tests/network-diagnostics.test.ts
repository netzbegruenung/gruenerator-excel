import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recordFetchFailure,
  resetFetchFailures,
  takeRecentFetchFailure,
} from "../src/gruenerator/network-diagnostics.ts";

void test("ein aufgezeichneter Abbruch wird mit Adresse und Grund gemeldet", () => {
  resetFetchFailures();
  recordFetchFailure(
    "https://localhost:3141/api/v1/chat/completions",
    "post",
    new TypeError("Load failed"),
    1_000,
  );

  const failure = takeRecentFetchFailure("/chat/completions", 60_000, 5_000);
  assert.equal(failure?.url, "https://localhost:3141/api/v1/chat/completions");
  assert.equal(failure?.method, "POST");
  assert.equal(failure?.message, "Load failed");
});

void test("ein Abbruch von woanders wird NICHT der Modellstrecke angehaengt", () => {
  // Der Fehler beim ersten Versuch: unter einer 401 der Modellstrecke stand
  // "GET https://localhost:3341/health" — ein Bridge-Healthcheck, der ohnehin
  // dauernd scheitert. Hintergrundrauschen darf nichts erklaeren.
  resetFetchFailures();
  recordFetchFailure("https://localhost:3341/health", "GET", new TypeError("Failed to fetch"), 1_000);

  assert.equal(takeRecentFetchFailure("/chat/completions", 60_000, 1_100), null);
});

void test("derselbe Abbruch erklaert nur einmal", () => {
  resetFetchFailures();
  recordFetchFailure("https://example.invalid/chat/completions", "GET", new Error("weg"), 1_000);

  assert.notEqual(takeRecentFetchFailure("/chat/completions", 60_000, 1_100), null);
  // Sonst haengt derselbe Eintrag an jedem spaeteren, unabhaengigen Fehler.
  assert.equal(takeRecentFetchFailure("/chat/completions", 60_000, 1_200), null);
});

void test("ein alter Abbruch wird verworfen statt falsch zugeordnet", () => {
  resetFetchFailures();
  recordFetchFailure("https://example.invalid/chat/completions", "GET", new Error("weg"), 1_000);

  assert.equal(takeRecentFetchFailure("/chat/completions", 60_000, 120_000), null);
});

void test("ein geworfener Nicht-Fehler wird trotzdem lesbar", () => {
  resetFetchFailures();
  recordFetchFailure("https://example.invalid/chat/completions", "GET", "kaputt", 1_000);

  assert.equal(takeRecentFetchFailure("/chat/completions", 60_000, 1_100)?.message, "kaputt");
});

void test("ohne Aufzeichnung gibt es nichts anzuhaengen", () => {
  resetFetchFailures();
  assert.equal(takeRecentFetchFailure("/chat/completions"), null);
});
