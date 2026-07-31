/**
 * Zugangsseite — die einzige Provider-Einstellung dieses Forks.
 *
 * Ersetzt die Upstream-Seiten „providers" (OAuth-Logins), „gateway"
 * (frei konfigurierbarer Endpoint) und „proxy" (lokaler CORS-Helfer).
 * Endpoint, Modell und Kontextfenster stehen fest; einzugeben ist der Schlüssel.
 *
 * Die Seite ist bewusst mehr als ein Eingabefeld: ohne Rückmeldung ist ein
 * falsch kopierter oder abgelaufener Schlüssel erst mitten im ersten Auftrag zu
 * merken, und die Meldung dort („Connection error") sagt nicht, woran es liegt.
 * Deshalb hier eine Statuszeile, ein echter Verbindungstest gegen den Endpoint
 * und die fest eingestellten Werte im Klartext — alles, was man braucht, um
 * einen Fehlschlag einzuordnen, ohne die Entwicklerkonsole zu öffnen.
 */

import { t } from "../../../language/index.js";
import { getAppStorage } from "../../../storage/local/app-storage.js";
import {
  createButton,
  createCallout,
  createConfigInput,
  createConfigRow,
  createConfigValue,
} from "../../../ui/extensions-hub-components.js";
import type { SettingsShellPage } from "../../../ui/settings-shell.js";
import { showToast } from "../../../ui/toast.js";
import { maskSecret } from "../../../utils/secrets.js";
import {
  GRUENERATOR_CONTEXT_WINDOW,
  GRUENERATOR_ENDPOINT_URL,
  GRUENERATOR_MODEL_ID,
} from "../../../gruenerator/config.js";
import {
  testGruenratorConnection,
  type ConnectionTestResult,
  type ConnectionTestStage,
} from "../../../gruenerator/connection-test.js";
import {
  clearGruenratorApiKey,
  findGruenratorGateway,
  setGruenratorApiKey,
} from "../../../gruenerator/gateway.js";

type CalloutTone = "info" | "warn" | "success";

interface StatusState {
  tone: CalloutTone;
  icon: string;
  message: string;
}

/**
 * Übersetzt ein Testergebnis in eine Zeile, die sagt, was zu tun ist.
 *
 * Die Trennung nach Stufen ist der eigentliche Zweck des Tests: „Schlüssel
 * abgelehnt" (die Nutzer:in kann handeln) sieht sonst genauso aus wie
 * „Modellstrecke antwortet nicht" (wir müssen handeln).
 */
function describeFailure(stage: ConnectionTestStage, detail: string): string {
  if (stage === "network") return t("gruenerator.access.test_network");
  if (stage === "auth") return t("gruenerator.access.test_auth");
  if (stage === "scope") return t("gruenerator.access.test_scope");
  if (stage === "catalog") {
    return detail.length > 0
      ? t("gruenerator.access.test_catalog_mismatch", { model: GRUENERATOR_MODEL_ID, models: detail })
      : t("gruenerator.access.test_catalog_empty");
  }
  if (stage === "upstream") {
    return detail.length > 0
      ? t("gruenerator.access.test_upstream_detail", { detail })
      : t("gruenerator.access.test_upstream");
  }
  return detail.length > 0
    ? t("gruenerator.access.test_http", { detail })
    : t("gruenerator.access.test_failed");
}

function describeResult(result: ConnectionTestResult): StatusState {
  if (result.ok) {
    return {
      tone: "success",
      icon: "✓",
      message: t("gruenerator.access.test_ok", {
        count: result.models.length,
        ms: result.durationMs,
      }),
    };
  }

  return { tone: "warn", icon: "!", message: describeFailure(result.stage, result.detail) };
}

export function createGruenratorPage(): SettingsShellPage {
  return {
    id: "gruenerator",
    parentId: "root",
    title: () => t("gruenerator.access.title"),
    subtitle: () => t("gruenerator.access.hint"),
    render: async (ctx) => {
      const storage = getAppStorage();

      /** Der zuletzt gespeicherte Schlüssel — Quelle für Maskierung und Test. */
      let storedKey = "";
      try {
        const gateway = await findGruenratorGateway(storage.customProviders);
        storedKey = gateway?.apiKey ?? "";
      } catch (error) {
        // Anzeige ist Beiwerk; ein Lesefehler darf die Seite nicht blockieren.
        console.warn("[gruenerator] Gateway konnte nicht gelesen werden:", error);
      }

      // ── Status ────────────────────────────────────────────────────────────
      const statusSlot = document.createElement("div");

      const setStatus = (state: StatusState): void => {
        statusSlot.replaceChildren(createCallout(state.tone, state.icon, state.message));
      };

      const showStoredKeyStatus = (): void => {
        setStatus(
          storedKey.length > 0
            ? {
                tone: "info",
                icon: "🔑",
                message: t("gruenerator.access.status_stored", { masked: maskSecret(storedKey) }),
              }
            : { tone: "warn", icon: "!", message: t("gruenerator.access.status_missing") },
        );
      };

      showStoredKeyStatus();

      // ── Schlüsselfeld ─────────────────────────────────────────────────────
      const card = document.createElement("div");
      card.className = "pi-overlay-surface";

      const input = createConfigInput({
        type: "password",
        placeholder:
          storedKey.length > 0
            ? t("gruenerator.access.key_replace_placeholder")
            : t("gruenerator.access.key_placeholder"),
      });
      input.autocomplete = "off";
      input.spellcheck = false;

      const keyRow = createConfigRow(t("gruenerator.access.key_label"), input);

      const hint = document.createElement("p");
      hint.className = "pi-overlay-hint";
      hint.textContent = t("gruenerator.access.key_hint");

      // ── Aktionen ──────────────────────────────────────────────────────────
      const actions = document.createElement("div");
      actions.className = "pi-settings-gateway-item__actions";

      /** Der Test läuft gegen das Eingabefeld, sonst gegen den gespeicherten. */
      const keyForTest = (): string => {
        const typed = input.value.trim();
        return typed.length > 0 ? typed : storedKey;
      };

      const save = createButton(t("gruenerator.access.save"), { primary: true });
      const test = createButton(t("gruenerator.access.test"));
      const remove = createButton(t("gruenerator.access.remove"), { danger: true });

      const syncButtons = (): void => {
        save.disabled = input.value.trim().length === 0;
        test.disabled = keyForTest().length === 0;
        remove.hidden = storedKey.length === 0;
      };

      input.addEventListener("input", syncButtons);

      save.addEventListener("click", () => {
        const value = input.value.trim();
        if (value.length === 0) {
          showToast(t("gruenerator.access.key_required"));
          return;
        }

        void setGruenratorApiKey(storage.customProviders, value)
          .then(() => {
            storedKey = value;
            input.value = "";
            input.placeholder = t("gruenerator.access.key_replace_placeholder");
            syncButtons();
            showStoredKeyStatus();
            showToast(t("gruenerator.access.saved"));
          })
          .catch((error: DynamicValue) => {
            console.warn("[gruenerator] Schlüssel konnte nicht gespeichert werden:", error);
            showToast(t("gruenerator.access.save_failed"));
          });
      });

      test.addEventListener("click", () => {
        const key = keyForTest();
        if (key.length === 0) {
          showToast(t("gruenerator.access.key_required"));
          return;
        }

        const previousLabel = test.textContent ?? "";
        test.disabled = true;
        test.textContent = t("gruenerator.access.testing");
        setStatus({ tone: "info", icon: "…", message: t("gruenerator.access.testing_status") });

        void testGruenratorConnection(key, {
          endpointUrl: GRUENERATOR_ENDPOINT_URL,
          modelId: GRUENERATOR_MODEL_ID,
        })
          .then((result) => {
            setStatus(describeResult(result));
          })
          .catch((error: DynamicValue) => {
            console.warn("[gruenerator] Verbindungstest fehlgeschlagen:", error);
            setStatus({ tone: "warn", icon: "!", message: t("gruenerator.access.test_failed") });
          })
          .finally(() => {
            test.textContent = previousLabel;
            syncButtons();
          });
      });

      remove.addEventListener("click", () => {
        void clearGruenratorApiKey(storage.customProviders)
          .then(() => {
            storedKey = "";
            input.value = "";
            input.placeholder = t("gruenerator.access.key_placeholder");
            syncButtons();
            showStoredKeyStatus();
            showToast(t("gruenerator.access.removed"));
          })
          .catch((error: DynamicValue) => {
            console.warn("[gruenerator] Schlüssel konnte nicht entfernt werden:", error);
            showToast(t("gruenerator.access.remove_failed"));
          });
      });

      actions.append(save, test, remove);

      // ── Fest eingestellte Werte ───────────────────────────────────────────
      // Im Klartext, weil sie bei jedem Fehlschlag die erste Rückfrage sind.
      const facts = document.createElement("div");
      facts.className = "pi-overlay-surface";
      facts.append(
        createConfigRow(
          t("gruenerator.access.endpoint_label"),
          createConfigValue(GRUENERATOR_ENDPOINT_URL),
        ),
        createConfigRow(
          t("gruenerator.access.model_label"),
          createConfigValue(GRUENERATOR_MODEL_ID),
        ),
        createConfigRow(
          t("gruenerator.access.context_label"),
          createConfigValue(
            t("gruenerator.access.context_value", {
              tokens: GRUENERATOR_CONTEXT_WINDOW.toLocaleString("de-DE"),
            }),
          ),
        ),
      );

      card.append(keyRow, hint, actions);
      ctx.body.append(statusSlot, card, facts);

      syncButtons();
    },
  };
}
