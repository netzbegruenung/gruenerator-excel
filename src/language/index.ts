/**
 * Lightweight UI translation layer — zero dependencies.
 *
 * Scope: **UI chrome only.** Never route agent-facing strings through this —
 * the system prompt, tool names/descriptions/schemas, and auto-context
 * injection must stay English for prompt-cache prefix stability
 * (see docs/cache-observability-baselines.md).
 *
 * Usage:
 *   import { t } from "../language/index.js";
 *   element.textContent = t("welcome.subtitle");
 *   element.textContent = t("settings.toast.connected", { label: "Anthropic" });
 *
 * `en.json` is the source of truth. Untranslated keys silently fall back to
 * English; unknown keys render the key itself (visible in dev, harmless in
 * production). Language is persisted in SettingsStore and applied at boot;
 * switching reloads the taskpane.
 */

import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };

export const SUPPORTED_LANGUAGES = ["de", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const translations: Record<SupportedLanguage, Record<string, string>> = {
  de,
  en,
};

let currentLang: SupportedLanguage = "de";

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang);
}

export function initLanguage(lang: string): void {
  if (isSupportedLanguage(lang)) {
    currentLang = lang;
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = translations[currentLang] ?? translations.en;
  let value = dict[key] ?? translations.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.split(`{${k}}`).join(String(v));
    }
  }
  return value;
}

export function getLanguage(): SupportedLanguage {
  return currentLang;
}
