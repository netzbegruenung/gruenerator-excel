import assert from "node:assert/strict";
import test from "node:test";

import {
  readTaskpaneConnectSrcTokens,
  readTaskpaneScriptSrcTokens,
  readVercelCspValue,
  readDockerCspValue,
} from "./helpers/taskpane-csp.mjs";

test("taskpane CSP allows Pyodide CDN host in script-src and connect-src", async () => {
  const connectTokens = await readTaskpaneConnectSrcTokens();
  const scriptTokens = await readTaskpaneScriptSrcTokens();

  assert.ok(connectTokens.has("https://cdn.jsdelivr.net"), "Missing jsDelivr in CSP connect-src");
  assert.ok(scriptTokens.has("https://cdn.jsdelivr.net"), "Missing jsDelivr in CSP script-src");
});

test("taskpane CSP allows blob module imports in script-src", async () => {
  const scriptTokens = await readTaskpaneScriptSrcTokens();

  assert.ok(scriptTokens.has("blob:"), "Missing blob: in CSP script-src");
});

test("die CSP im Container stimmt mit der in vercel.json ueberein", async () => {
  // Zwei Auslieferungswege, eine Richtlinie. Driften sie auseinander, faellt es
  // erst in Produktion auf — und dann als "das Add-in erreicht nichts mehr".
  const [vercel, docker] = await Promise.all([readVercelCspValue(), readDockerCspValue()]);
  assert.equal(docker, vercel);
});

test("die CSP erlaubt das Gruenerator-Backend", async () => {
  // Ohne diesen Eintrag blockiert der Browser jeden Modellaufruf im
  // Produktionsbuild. Lokal faellt das nicht auf: dort ist der Aufruf
  // same-origin und `'self'` deckt ihn ab.
  const connectTokens = await readTaskpaneConnectSrcTokens();
  assert.ok(connectTokens.has("https://gruenerator.eu"), "gruenerator.eu fehlt in connect-src");
});
