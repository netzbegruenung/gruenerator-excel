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
  ensureGruenratorGateway,
  findGruenratorGateway,
  setGruenratorApiKey,
} from "../../../gruenerator/gateway.js";
import {
  isSignedIn,
  signInWithGruenerator,
  signOutFromGruenerator,
} from "../../../gruenerator/oauth-integration.js";

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
  if (stage === "stream") {
    return detail.length > 0
      ? t("gruenerator.access.test_stream_detail", { detail })
      : t("gruenerator.access.test_stream");
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
      /**
       * Endpoint und Modell, wie sie im gespeicherten Gateway stehen — also das,
       * was der Chat tatsächlich anspricht.
       *
       * Bewusst nicht die Konstanten aus `config.ts`: die beiden können
       * auseinanderlaufen, wenn das Provisionieren beim Start fehlschlägt. Ein
       * Test gegen die Konstante meldet dann „Verbindung steht", während der
       * Chat weiter gegen die alte Adresse läuft — genau so ist uns der Fehler
       * einmal durchgerutscht.
       */
      let storedEndpoint = "";
      let storedModel = "";

      const readGateway = async (): Promise<void> => {
        try {
          const gateway = await findGruenratorGateway(storage.customProviders);
          storedKey = gateway?.apiKey ?? "";
          storedEndpoint = gateway?.endpointUrl ?? "";
          storedModel = gateway?.modelId ?? "";
        } catch (error) {
          // Anzeige ist Beiwerk; ein Lesefehler darf die Seite nicht blockieren.
          console.warn("[gruenerator] Gateway konnte nicht gelesen werden:", error);
        }
      };

      await readGateway();

      const effectiveEndpoint = (): string =>
        storedEndpoint.length > 0 ? storedEndpoint : GRUENERATOR_ENDPOINT_URL;
      const effectiveModel = (): string =>
        storedModel.length > 0 ? storedModel : GRUENERATOR_MODEL_ID;

      /** Weicht der gespeicherte Gateway von der Konfiguration ab? */
      const hasDrift = (): boolean =>
        (storedEndpoint.length > 0 && storedEndpoint !== GRUENERATOR_ENDPOINT_URL)
        || (storedModel.length > 0 && storedModel !== GRUENERATOR_MODEL_ID);

      // ── Status ────────────────────────────────────────────────────────────
      const statusSlot = document.createElement("div");

      const setStatus = (state: StatusState): void => {
        statusSlot.replaceChildren(createCallout(state.tone, state.icon, state.message));
      };

      /**
       * Angemeldet über das Grünerator-Konto?
       *
       * Wird gehalten statt bei jeder Anzeige neu gefragt: `syncButtons` läuft
       * synchron, und ein `await` mitten in der Beschriftung würde die Knöpfe
       * für einen Wimpernschlag falsch zeigen.
       */
      let signedIn = await isSignedIn(storage.settings);

      const showStoredKeyStatus = (): void => {
        // Abweichung zuerst: sie erklaert, warum ein gruener Test und ein
        // fehlschlagender Chat zusammenpassen koennen.
        if (hasDrift()) {
          setStatus({
            tone: "warn",
            icon: "!",
            message: t("gruenerator.access.status_drift", {
              endpoint: effectiveEndpoint(),
              model: effectiveModel(),
            }),
          });
          return;
        }

        // Die Anmeldung geht der Schlüsselanzeige vor: bei angemeldetem Konto
        // steht im Schlüsselfeld das Zugriffstoken, und „Schlüssel hinterlegt"
        // wäre dann die irreführendere von zwei wahren Aussagen.
        if (signedIn) {
          setStatus({ tone: "success", icon: "✓", message: t("gruenerator.access.signed_in") });
          return;
        }

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
        // Nur zeigen, wenn es etwas zu reparieren gibt: abweichende Werte oder
        // gar kein Gateway (dann ist das Provisionieren beim Start gescheitert).
        repair.hidden = !hasDrift() && storedEndpoint.length > 0;
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

        // Gegen den gespeicherten Gateway, nicht gegen die Konstante — sonst
        // prueft der Test eine andere Adresse als die, die der Chat benutzt.
        void testGruenratorConnection(key, {
          endpointUrl: effectiveEndpoint(),
          modelId: effectiveModel(),
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

      // Setzt Endpoint und Modell aus der Konfiguration neu — der Ausweg, wenn
      // das Provisionieren beim Start fehlgeschlagen ist.
      const repair = createButton(t("gruenerator.access.repair"));
      repair.addEventListener("click", () => {
        repair.disabled = true;
        void ensureGruenratorGateway(storage.customProviders)
          .then(async () => {
            await readGateway();
            document.dispatchEvent(new CustomEvent("pi:providers-changed"));
            renderFacts();
            syncButtons();
            showStoredKeyStatus();
            showToast(t("gruenerator.access.repaired"));
          })
          .catch((error: DynamicValue) => {
            console.warn("[gruenerator] Gateway konnte nicht repariert werden:", error);
            showToast(t("gruenerator.access.repair_failed"));
          })
          .finally(() => {
            repair.disabled = false;
          });
      });

      // ── Anmeldung über das Grünerator-Konto ───────────────────────────────
      // Der Weg ohne Schlüsselausgabe von Hand: das Add-in holt sich ein Token
      // über OAuth. Beide Wege bestehen nebeneinander — das Backend nimmt seit
      // `addinAuth.ts` Schlüssel und Token an derselben Tür an.
      const account = createButton("");

      const syncAccountButton = (): void => {
        account.textContent = signedIn
          ? t("gruenerator.access.sign_out")
          : t("gruenerator.access.sign_in");
      };
      syncAccountButton();

      account.addEventListener("click", () => {
        account.disabled = true;

        const finish = (): void => {
          account.disabled = false;
          syncAccountButton();
          syncButtons();
          showStoredKeyStatus();
        };

        if (signedIn) {
          void signOutFromGruenerator(storage.customProviders, storage.settings)
            .then(async () => {
              signedIn = false;
              await readGateway();
              showToast(t("gruenerator.access.signed_out"));
            })
            .catch((error: DynamicValue) => {
              console.warn("[gruenerator] Abmeldung fehlgeschlagen:", error);
              showToast(t("gruenerator.access.sign_out_failed"));
            })
            .finally(finish);
          return;
        }

        account.textContent = t("gruenerator.access.signing_in");
        void signInWithGruenerator(storage.customProviders, storage.settings)
          .then(async (result) => {
            if (!result.ok) {
              // Stufe mitnennen: „abgebrochen" und „Server lehnt den Scope ab"
              // sehen sonst gleich aus, führen aber zu ganz verschiedenen
              // nächsten Schritten.
              showToast(
                t("gruenerator.access.sign_in_failed", {
                  detail: `${result.stage}: ${result.detail}`,
                }),
              );
              return;
            }
            signedIn = true;
            await readGateway();
            showToast(t("gruenerator.access.signed_in_toast"));
          })
          .catch((error: DynamicValue) => {
            console.warn("[gruenerator] Anmeldung fehlgeschlagen:", error);
            showToast(t("gruenerator.access.sign_in_failed", { detail: "unerwarteter Fehler" }));
          })
          .finally(finish);
      });

      actions.append(account, save, test, remove, repair);

      // ── Tatsaechlich benutzte Werte ───────────────────────────────────────
      // Aus dem gespeicherten Gateway, nicht aus der Konfiguration: bei jedem
      // Fehlschlag ist genau das die erste Rueckfrage — und der Unterschied
      // zwischen beiden war schon einmal die Ursache.
      const facts = document.createElement("div");
      facts.className = "pi-overlay-surface";

      function renderFacts(): void {
        facts.replaceChildren(
          createConfigRow(
            t("gruenerator.access.endpoint_label"),
            createConfigValue(effectiveEndpoint()),
          ),
          createConfigRow(t("gruenerator.access.model_label"), createConfigValue(effectiveModel())),
          createConfigRow(
            t("gruenerator.access.context_label"),
            createConfigValue(
              t("gruenerator.access.context_value", {
                tokens: GRUENERATOR_CONTEXT_WINDOW.toLocaleString("de-DE"),
              }),
            ),
          ),
        );
      }

      renderFacts();

      card.append(keyRow, hint, actions);
      ctx.body.append(statusSlot, card, facts);

      syncButtons();
    },
  };
}
