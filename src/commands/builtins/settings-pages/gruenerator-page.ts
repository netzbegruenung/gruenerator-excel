/**
 * Zugangsseite — die einzige Provider-Einstellung dieses Forks.
 *
 * Ersetzt die Upstream-Seiten „providers" (OAuth-Logins), „gateway"
 * (frei konfigurierbarer Endpoint) und „proxy" (lokaler CORS-Helfer).
 * Endpoint, Modell und Kontextfenster stehen fest; einzugeben ist der Schlüssel.
 */

import { t } from "../../../language/index.js";
import { getAppStorage } from "../../../storage/local/app-storage.js";
import {
  createButton,
  createConfigInput,
  createConfigRow,
} from "../../../ui/extensions-hub-components.js";
import type { SettingsShellPage } from "../../../ui/settings-shell.js";
import { showToast } from "../../../ui/toast.js";
import { GRUENERATOR_MODEL_ID } from "../../../gruenerator/config.js";
import { findGruenratorGateway, setGruenratorApiKey } from "../../../gruenerator/gateway.js";

export function createGruenratorPage(): SettingsShellPage {
  return {
    id: "gruenerator",
    parentId: "root",
    title: () => t("gruenerator.access.title"),
    subtitle: () => t("gruenerator.access.hint"),
    render: async (ctx) => {
      const storage = getAppStorage();

      const card = document.createElement("div");
      card.className = "pi-overlay-surface";

      let keyValue = "";
      const input = createConfigInput({
        type: "password",
        placeholder: t("gruenerator.access.key_placeholder"),
        onChange: (value) => {
          keyValue = value;
        },
      });
      input.autocomplete = "off";
      input.spellcheck = false;
      input.addEventListener("input", () => {
        keyValue = input.value;
      });

      const keyRow = createConfigRow(t("gruenerator.access.key_label"), input);

      const hint = document.createElement("p");
      hint.className = "pi-overlay-hint";
      hint.textContent = t("gruenerator.access.model_hint", { model: GRUENERATOR_MODEL_ID });

      const actions = document.createElement("div");
      actions.className = "pi-settings-gateway-item__actions";

      const save = createButton(t("gruenerator.access.save"), {
        primary: true,
        onClick: () => {
          const value = keyValue.trim();
          if (value.length === 0) {
            showToast(t("gruenerator.access.key_required"));
            return;
          }

          void setGruenratorApiKey(storage.customProviders, value)
            .then(() => {
              keyValue = "";
              input.value = "";
              input.placeholder = t("gruenerator.access.key_saved");
              showToast(t("gruenerator.access.saved"));
            })
            .catch((error: DynamicValue) => {
              console.warn("[gruenerator] Schlüssel konnte nicht gespeichert werden:", error);
              showToast(t("gruenerator.access.save_failed"));
            });
        },
      });

      actions.append(save);
      card.append(keyRow, hint, actions);
      ctx.body.appendChild(card);

      // Vorhandenen Schlüssel nie anzeigen, nur signalisieren, dass einer liegt.
      try {
        const gateway = await findGruenratorGateway(storage.customProviders);
        if ((gateway?.apiKey ?? "").length > 0) {
          input.placeholder = t("gruenerator.access.key_saved");
        }
      } catch {
        // Anzeige ist Beiwerk; ein Lesefehler darf die Seite nicht blockieren.
      }
    },
  };
}
