/**
 * Anmeldedialog im Office-Add-in.
 *
 * Office verlangt, dass die **erste** Adresse eines Dialogs auf derselben
 * Herkunft liegt wie das Add-in selbst. Unser Autorisierungsserver liegt aber
 * auf `gruenerator.eu`, das Add-in im lokalen Lauf auf `localhost:3141` und
 * später auf `excel.gruenerator.eu`. Ein direkter Aufruf von
 * `displayDialogAsync(authUrl)` scheitert deshalb.
 *
 * Der Ausweg ist eine eigene Startseite auf unserer Herkunft, die sofort
 * weiterleitet: Dialog öffnet `/src/oauth-start.html?target=…`, die Seite
 * ersetzt sich durch die Adresse des Servers. Nach der Anmeldung leitet der
 * Server auf `/src/oauth-callback.html` zurück — wieder unsere Herkunft, und
 * damit darf die Seite `messageParent` aufrufen.
 *
 * Diese Weiterleitung ist der Grund für `isAllowedAuthorizationTarget`: eine
 * Seite, die eine beliebige Adresse aus dem Aufrufparameter öffnet, ist eine
 * offene Weiterleitung. Die Prüfung steht hier in TypeScript und nicht als
 * Kopie im HTML, damit sie geprüft werden kann und nur an einer Stelle lebt.
 */

/** Herkünfte, auf die die Startseite weiterleiten darf. */
export const ALLOWED_AUTH_ORIGINS: readonly string[] = [
  "https://gruenerator.eu",
  "https://beta.gruenerator.eu",
];

/**
 * Darf die Startseite auf diese Adresse weiterleiten?
 *
 * Nur HTTPS und nur die ausdrücklich genannten Herkünfte. `localhost` steht
 * absichtlich **nicht** in der Vorgabeliste: die Liste wird auch im
 * Produktionsbündel ausgeliefert, und eine Ausnahme, die dort mitfährt, ist
 * eine Ausnahme zu viel. Für den lokalen Lauf reicht der zweite Parameter.
 */
export function isAllowedAuthorizationTarget(
  target: string,
  allowedOrigins: readonly string[] = ALLOWED_AUTH_ORIGINS,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  return allowedOrigins.includes(parsed.origin);
}

/** Baut die Adresse der Startseite auf unserer eigenen Herkunft. */
export function buildDialogBootstrapUrl(addinOrigin: string, authorizationUrl: string): string {
  const url = new URL("/src/oauth-start.html", addinOrigin);
  url.searchParams.set("target", authorizationUrl);
  return url.toString();
}

/** Rückleitungsadresse, die bei der Registrierung hinterlegt wird. */
export function buildRedirectUri(addinOrigin: string): string {
  return new URL("/src/oauth-callback.html", addinOrigin).toString();
}

/**
 * Die Teilmenge von `Office.context.ui`, die wir benutzen.
 *
 * Als eigene Schnittstelle statt `typeof Office.context.ui`, damit der Ablauf
 * unter `node --test` gegen eine Attrappe läuft — Office.js gibt es dort nicht.
 */
export interface DialogHost {
  displayDialogAsync(
    url: string,
    options: { height: number; width: number; promptBeforeOpen: boolean },
    callback: (result: DialogOpenResult) => void,
  ): void;
}

export interface DialogOpenResult {
  status: "succeeded" | "failed";
  value?: DialogHandle;
  error?: { message?: string };
}

export interface DialogHandle {
  addEventHandler(eventType: string, handler: (arg: DynamicValue) => void): void;
  close(): void;
}

/** Ereignisnamen als Zeichenketten, weil das Office-Enum zur Laufzeit fehlt. */
export const DIALOG_MESSAGE_RECEIVED = "dialogMessageReceived";
export const DIALOG_EVENT_RECEIVED = "dialogEventReceived";

export type DialogOutcome =
  | { ok: true; callbackUrl: string }
  | { ok: false; detail: string };

/** Benannt nach der Sache, nicht nach der Form — generische Objekt-Wächter sind hier untersagt. */
function isDialogEventArg(value: DynamicValue): value is DynamicObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDialogArg(arg: DynamicValue): DynamicObject | null {
  return isDialogEventArg(arg) ? arg : null;
}

function readDialogMessage(arg: DynamicValue): string | null {
  const message = asDialogArg(arg)?.["message"];
  return typeof message === "string" ? message : null;
}

function readDialogEventCode(arg: DynamicValue): number | null {
  const code = asDialogArg(arg)?.["error"];
  return typeof code === "number" ? code : null;
}

/**
 * Öffnet den Dialog und wartet auf die Rückleitungsadresse.
 *
 * Das Versprechen wird **genau einmal** aufgelöst; `settled` schützt davor,
 * dass ein nachlaufendes Ereignis (etwa `12006`, wenn die Nutzerin den Dialog
 * nach erfolgreicher Anmeldung noch von Hand schließt) ein bereits gemeldetes
 * Ergebnis überschreibt.
 */
export function openAuthorizationDialog(
  bootstrapUrl: string,
  host: DialogHost,
): Promise<DialogOutcome> {
  return new Promise<DialogOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: DialogOutcome, dialog?: DialogHandle): void => {
      if (settled) return;
      settled = true;
      try {
        dialog?.close();
      } catch {
        // Ein bereits geschlossener Dialog wirft — das Ergebnis steht trotzdem.
      }
      resolve(outcome);
    };

    host.displayDialogAsync(
      bootstrapUrl,
      { height: 60, width: 30, promptBeforeOpen: false },
      (result) => {
        if (result.status !== "succeeded" || !result.value) {
          settle({ ok: false, detail: result.error?.message ?? "Dialog konnte nicht geöffnet werden" });
          return;
        }

        const dialog = result.value;

        dialog.addEventHandler(DIALOG_MESSAGE_RECEIVED, (arg) => {
          const message = readDialogMessage(arg);
          if (!message) {
            settle({ ok: false, detail: "Dialog meldete sich ohne Inhalt" }, dialog);
            return;
          }
          settle({ ok: true, callbackUrl: message }, dialog);
        });

        dialog.addEventHandler(DIALOG_EVENT_RECEIVED, (arg) => {
          const code = readDialogEventCode(arg);
          // 12006: von der Nutzerin geschlossen. Das ist ein Abbruch, kein
          // Fehler — die Meldung im UI soll nicht nach Störung klingen.
          if (code === 12006) {
            settle({ ok: false, detail: "Anmeldung abgebrochen" }, dialog);
            return;
          }
          settle({ ok: false, detail: `Dialog beendet (Code ${code ?? "unbekannt"})` }, dialog);
        });
      },
    );
  });
}
