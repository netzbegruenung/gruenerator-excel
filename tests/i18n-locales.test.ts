import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "src", "language", "locales");

function parseLocaleJson(raw: DynamicValue, label: string): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label} locale must be an object`);
  }

  const rawObject = raw as DynamicObject;
  const parsed: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawObject)) {
    if (typeof value !== "string") {
      throw new Error(`${label} locale value for ${key} must be a string`);
    }
    parsed[key] = value;
  }
  return parsed;
}

const en = parseLocaleJson(JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8")) as DynamicValue, "en");
const de = parseLocaleJson(JSON.parse(readFileSync(join(localesDir, "de.json"), "utf8")) as DynamicValue, "de");

function requireMatchGroup(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`Expected regex capture group ${index}.`);
  }
  return value;
}

function placeholders(value: string): Set<string> {
  const found = new Set<string>();
  for (const m of value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) found.add(requireMatchGroup(m, 1));
  return found;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "locales" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|html)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = collectSourceFiles(join(root, "src"));
const localizedUiSourceFiles = ["ui", "taskpane", "commands", "compaction", "files"]
  .flatMap((dir) => collectSourceFiles(join(root, "src", dir)));
const corpus = sourceFiles.map((f) => readFileSync(f, "utf8")).join("\n");

void test("en and de locales have identical key sets", () => {
  const missingInDe = Object.keys(en).filter((k) => !(k in de)).sort();
  const extraInDe = Object.keys(de).filter((k) => !(k in en)).sort();
  assert.deepEqual(missingInDe, [], `keys missing in de.json: ${missingInDe.join(", ")}`);
  assert.deepEqual(extraInDe, [], `keys in de.json but not en.json: ${extraInDe.join(", ")}`);
});

void test("de placeholders are a subset of en placeholders per key", () => {
  // German must never reference a placeholder the caller does not provide.
  const violations: string[] = [];
  for (const [key, enValue] of Object.entries(en)) {
    const deValue = de[key];
    if (typeof deValue !== "string") continue;
    const enVars = placeholders(enValue);
    for (const v of placeholders(deValue)) {
      if (!enVars.has(v)) violations.push(`${key}: {${v}}`);
    }
  }
  assert.deepEqual(violations, [], `de placeholders missing from en: ${violations.join(", ")}`);
});

void test("de locale has no empty values", () => {
  const empty = Object.entries(de)
    .filter(([, v]) => typeof v !== "string" || v.length === 0)
    .map(([k]) => k);
  assert.deepEqual(empty, [], `empty de values: ${empty.join(", ")}`);
});

void test("en locale has no empty values", () => {
  const empty = Object.entries(en)
    .filter(([, v]) => typeof v !== "string" || v.length === 0)
    .map(([k]) => k);
  assert.deepEqual(empty, [], `empty en values: ${empty.join(", ")}`);
});

void test("every locale key is referenced somewhere in src/", () => {
  // Keys appear as t("key") literals, bare string literals in key arrays
  // (whimsical messages, hint keys), or are constructed dynamically:
  // - humanize.label.* via l("Label") slugs in src/ui/humanize-params.ts
  // - humanize.value.* via v("suffix") in src/ui/humanize-params.ts
  // - humanize.unit.*  via nUnit() template keys in src/ui/humanize-params.ts
  const labelKeys = new Set(
    [...corpus.matchAll(/\bl\("([^"]+)"\)/g)].map(
      (m) => `humanize.label.${requireMatchGroup(m, 1).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    ),
  );
  const valueKeys = new Set(
    [...corpus.matchAll(/\bv\("([^"]+)"/g)].map((m) => `humanize.value.${requireMatchGroup(m, 1)}`),
  );
  const unused = Object.keys(en).filter((k) => {
    if (labelKeys.has(k) || valueKeys.has(k)) return false;
    if (k.startsWith("humanize.unit.")) return false;
    // perm.trust.* is constructed via t("perm.trust." + trust) in permissions.ts
    if (k.startsWith("perm.trust.")) return false;
    return !corpus.includes(`"${k}"`) && !corpus.includes(`'${k}'`) && !corpus.includes("`" + k + "`");
  });
  assert.deepEqual(unused, [], `locale keys never referenced in src/: ${unused.join(", ")}`);
});

void test("every static t(\"...\") call site references an existing key", () => {
  const missing: string[] = [];
  for (const f of sourceFiles) {
    const content = readFileSync(f, "utf8");
    for (const m of content.matchAll(/\bt\(\s*"([^"$`]+)"/g)) {
      // Keys ending in "." are dynamic prefixes (string concatenation), e.g.
      // t("perm.trust." + trust) — covered by the unused-key exemptions above.
      const key = requireMatchGroup(m, 1);
      if (key.endsWith(".")) continue;
      if (!(key in en)) missing.push(`${f.slice(root.length + 1)}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `t() call sites with unknown keys: ${missing.join(", ")}`);
});

void test("common UI text sinks use locale keys instead of hardcoded English", () => {
  // This is a deliberately low-noise guard for the UI surfaces agents most
  // often edit: DOM text sinks, button/config-row helpers, dialog labels, and
  // toast templates. It does not try to classify every string literal in src/;
  // agent-facing prompts, model/provider IDs, CSS classes, and command syntax
  // are valid English literals elsewhere.
  const staticSink = /(?:textContent|innerHTML|placeholder|title|subtitle|message|\w*[Ll]abel|showToast|createButton|createConfigRow|\.text)\s*(?:=|:|\()\s*["`][A-Z]/;
  const toastTemplate = /\b(?:showToast|resolved\.showToast)\(\s*`/;
  const allowed = /aria-|data-|className|\.css|https?:\/\/|icon\(|throw new Error|const message = error instanceof Error|externalLoadError|activationLoadError/;
  const offenders: string[] = [];

  for (const f of localizedUiSourceFiles) {
    const rel = f.slice(root.length + 1);
    for (const [i, line] of readFileSync(f, "utf8").split("\n").entries()) {
      if ((staticSink.test(line) || toastTemplate.test(line)) && !/\bt\(/.test(line) && !allowed.test(line)) {
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `hardcoded English in localized UI sinks:\n${offenders.join("\n")}`);
});

void test("no module-scope t() calls (language is set at boot, after import)", () => {
  // Heuristic: track brace/paren depth per file; flag t(" calls at depth 0.
  const offenders: string[] = [];
  for (const f of sourceFiles) {
    const content = readFileSync(f, "utf8");
    let depth = 0;
    for (const [i, line] of content.split("\n").entries()) {
      if (depth === 0 && /\bt\(\s*"/.test(line) && !/^\s*(\*|\/\/)/.test(line)) {
        offenders.push(`${f.slice(root.length + 1)}:${i + 1}`);
      }
      for (const ch of line) {
        if (ch === "{" || ch === "(") depth++;
        else if (ch === "}" || ch === ")") depth = Math.max(0, depth - 1);
      }
    }
  }
  assert.deepEqual(offenders, [], `module-scope t() calls: ${offenders.join(", ")}`);
});
