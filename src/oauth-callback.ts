/**
 * Rückleitungsseite des Anmeldedialogs.
 *
 * Der Autorisierungsserver leitet hierher zurück — auf die Herkunft des
 * Add-ins, weshalb `messageParent` erlaubt ist. Die Seite reicht die volle
 * Adresse an das Taskpane weiter; ausgewertet wird sie dort
 * (`parseCallbackUrl`), inklusive `state`-Abgleich.
 *
 * Bewusst wird die **ganze** Adresse übergeben und nicht nur der Code: der
 * `state` muss mitkommen, sonst kann die Gegenseite nicht prüfen, ob die
 * Antwort zum eigenen Ablauf gehört.
 */

declare const Office: {
  onReady: (callback?: () => void) => Promise<DynamicValue>;
  context: { ui: { messageParent: (message: string) => void } };
};

function report(text: string): void {
  const target = document.getElementById("message");
  if (target) target.textContent = text;
}

function handOver(): void {
  try {
    Office.context.ui.messageParent(window.location.href);
    report("Anmeldung abgeschlossen. Dieses Fenster kann geschlossen werden.");
  } catch (error) {
    // Ohne Office-Kontext (etwa beim Aufruf im normalen Browser) bleibt nur
    // der Hinweis — ein stiller Fehlschlag wäre hier das Schlimmste, weil die
    // Nutzerin auf ein Fenster starrt, das nichts tut.
    const detail = error instanceof Error ? error.message : "unbekannter Fehler";
    report(`Rückmeldung an Excel nicht möglich: ${detail}`);
  }
}

if (typeof Office === "undefined") {
  report("Office.js wurde nicht geladen. Bitte den Dialog schließen und erneut anmelden.");
} else {
  void Office.onReady().then(handOver);
}
