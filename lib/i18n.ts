"use client";

import { createContext, useContext } from "react";

export type Lang = "en" | "de";

export const LANG_NAMES: Record<Lang, string> = { en: "English", de: "Deutsch" };

// Flat string table. Use {placeholders} for interpolation.
export const STRINGS = {
  en: {
    "app.title": "TerraDelta",
    "app.tagline": "Orthophoto change analyzer",
    "app.subtitle":
      "AI-powered semantic change detection between two aerial orthophotos. Images are co-registered, split into high-resolution tiles, and analyzed region by region to find added / removed / modified buildings, roads, plots and land development — while ignoring season, lighting and shadows.",

    "lang.label": "Language",
    "theme.toLight": "Switch to light mode",
    "theme.toDark": "Switch to dark mode",

    "settings.heading": "Provider & API key",
    "settings.provider": "Provider",
    "settings.model": "Model",
    "settings.apiKey": "{provider} API key",
    "settings.keySet": "key set",
    "settings.usingEnv": "using server env / no key",
    "settings.clear": "Clear",
    "settings.stored":
      "Stored only in this browser (localStorage) and sent to your local server per request. Leave blank to use the server's environment key.",
    "settings.getKey": "Get a key ↗",
    "settings.nonAscii":
      "This key contains a non-ASCII character — re-paste it as plain text (keys use only letters, digits, “-” and “_”).",
    "settings.tipProvider": "Choose which AI vision model provider to use.",
    "settings.tipModel": "The specific model. Larger models are more accurate but slower/costlier.",
    "settings.tipKey":
      "Your API key, stored only in this browser. Leave empty to use the server's key.",
    "settings.tipClear": "Remove the key and fall back to the server's environment key.",
    "settings.tipOpen": "Open settings — choose provider, model and API key.",
    "common.close": "Close",
    "common.done": "Done",
    "run.needKey": "No API key set — open settings to add one.",

    "upload.earlier": "Earlier capture (reference)",
    "upload.earlierSub": "e.g. 2021",
    "upload.later": "Later capture",
    "upload.laterSub": "e.g. 2025",
    "upload.hint": "Click or drop an image",
    "upload.tip": "Upload an aerial/orthophoto image (PNG, JPEG, BMP, WebP, TIFF, GIF).",
    "upload.tiffError": "Could not decode this TIFF — the file may use an unsupported encoding (e.g. tiled, 16-bit float, or proprietary GeoTIFF). Try exporting as PNG or JPEG.",

    "run.detect": "Detect changes",
    "run.loading": "Loading alignment engine…",
    "run.aligning": "Aligning images…",
    "run.analyzing": "Detecting changes…",
    "run.tip": "Align both images and analyze them for semantic changes.",

    "step.load": "Load engine",
    "step.align": "Align",
    "step.detect": "Detect changes",

    "progress.initEngine":
      "Initializing alignment engine (OpenCV, bundled locally — first run only)…",
    "progress.engineReady": "Alignment engine ready.",
    "progress.aligning": "Co-registering images — ORB feature matching + RANSAC homography…",
    "progress.splitting": "Splitting the scene into high-resolution regions…",
    "progress.region": "Analyzing region {done}/{total} with the vision model…",
    "progress.merging": "Merging overlapping regions and de-duplicating…",

    "align.matched": "Aligned via feature matching ({n} matches)",
    "align.fallback": "Alignment fell back to resize — results may be noisier",

    "note.pipeline":
      "Alignment runs in your browser; tiles are analyzed server-side. Larger scenes mean more regions (and a few more seconds).",

    "error.someFailed": "{failed} of {total} regions failed — results may be incomplete. Error: {err}",
    "error.allFailed": "{failed} of {total} regions failed. Error: {err}",
    "error.generic": "Something went wrong",

    "summary.heading": "Summary",
    "summary.meta": "{n} changes · model: {model}",

    "compare.heading": "Visual comparison",
    "compare.overlays": "Overlays",
    "compare.spotlight": "Spotlight",
    "compare.wipe": "Wipe",
    "compare.showing": "Showing {n} of {total}",
    "compare.tipOverlays": "Show or hide the colored change boxes.",
    "compare.tipSpotlight": "Dim everything except the detected changes.",
    "compare.tipWipe": "Drag to wipe between the earlier and later image.",

    "mode.old": "Earlier",
    "mode.new": "Later",
    "mode.slider": "Slider",
    "mode.side": "Side by side",
    "mode.tipOld": "Show only the earlier image.",
    "mode.tipNew": "Show only the later image.",
    "mode.tipSlider": "Overlay both with a draggable wipe divider.",
    "mode.tipSide": "Show both images next to each other.",

    "badge.earlier": "earlier",
    "badge.later": "later",

    "report.heading": "Change report ({n})",
    "report.headingOf": "Change report ({n} of {total})",
    "report.export": "Export PDF",
    "report.tipExport": "Download a professional PDF report with annotated images and change table.",

    "pdf.title": "Change Report",
    "pdf.subtitle": "Orthophoto Change Analysis",
    "pdf.earlier": "Earlier image",
    "pdf.later": "Later image",
    "pdf.changes": "Detected Changes",
    "pdf.generated": "Generated on {date}",
    "pdf.page": "Page {n} of {total}",
    "pdf.tagline": "Orthophoto change analyzer",
    "report.minConf": "min",
    "report.tipMinConf": "Hide changes below this confidence level.",
    "report.search": "Search…",
    "report.noMatch": "No changes match the current filters.",
    "report.tipType": "Show or hide this change type.",

    "conf.any": "any",
    "conf.mediumPlus": "≥ 65%",
    "conf.highOnly": "≥ 90%",
    "conf.low": "35%",
    "conf.medium": "65%",
    "conf.high": "90%",

    "type.added": "added",
    "type.removed": "removed",
    "type.modified": "modified",

    "th.num": "#",
    "th.type": "Type",
    "th.category": "Category",
    "th.description": "Description",
    "th.conf": "Confidence",

    "cat.building": "building",
    "cat.house": "house",
    "cat.road": "road",
    "cat.bridge": "bridge",
    "cat.plot": "plot",
    "cat.water": "water",
    "cat.vegetation": "vegetation",
    "cat.other": "other",

    "how.heading": "How it works",
    "how.1": "Both images are co-registered in-browser using ORB feature matching + a RANSAC homography.",
    "how.2": "The aligned pair is split into overlapping high-resolution tiles plus one overview pass.",
    "how.3": "Each region is analyzed by a vision model that reasons about genuine structural / land-use changes (ignoring season, lighting and shadows).",
    "how.4": "Detections are mapped back to global coordinates, de-duplicated, highlighted and listed.",

    "onboard.heading": "Getting started",
    "onboard.subtitle": "Follow these steps to compare two orthophotos.",
    "onboard.optional": "optional",
    "onboard.done": "done",
    "onboard.dismiss": "Got it",
    "onboard.reopen": "Guide",
    "onboard.tipReopen": "Show the getting-started guide",
    "onboard.key": "Add your API key",
    "onboard.keyHint": "Open Settings (⚙, top-right), pick a provider and paste your key — or leave blank to use the server's key.",
    "onboard.earlier": "Upload the earlier image",
    "onboard.earlierHint": "The older capture (the reference date, e.g. 2021).",
    "onboard.later": "Upload the later image",
    "onboard.laterHint": "The newer capture to compare against (e.g. 2025).",
    "onboard.run": "Detect changes",
    "onboard.runHint": "We align both images and analyze them region by region.",
    "onboard.explore": "Explore the results",
    "onboard.exploreHint":
      "Drag the slider, switch to side-by-side, filter by type/confidence, and export to PDF.",
  },

  de: {
    "app.title": "TerraDelta",
    "app.tagline": "Orthophoto-Veränderungsanalyse",
    "app.subtitle":
      "KI-gestützte semantische Veränderungserkennung zwischen zwei Luftbild-Orthophotos. Die Bilder werden überlagert, in hochaufgelöste Kacheln zerlegt und Region für Region analysiert, um hinzugefügte / entfernte / veränderte Gebäude, Straßen, Grundstücke und Landentwicklung zu finden — Jahreszeit, Beleuchtung und Schatten werden ignoriert.",

    "lang.label": "Sprache",
    "theme.toLight": "Zum hellen Modus wechseln",
    "theme.toDark": "Zum dunklen Modus wechseln",

    "settings.heading": "Anbieter & API-Schlüssel",
    "settings.provider": "Anbieter",
    "settings.model": "Modell",
    "settings.apiKey": "{provider} API-Schlüssel",
    "settings.keySet": "Schlüssel gesetzt",
    "settings.usingEnv": "Server-Umgebung / kein Schlüssel",
    "settings.clear": "Löschen",
    "settings.stored":
      "Wird nur in diesem Browser gespeichert (localStorage) und pro Anfrage an Ihren lokalen Server gesendet. Leer lassen, um den Server-Schlüssel zu verwenden.",
    "settings.getKey": "Schlüssel erhalten ↗",
    "settings.nonAscii":
      "Dieser Schlüssel enthält ein Nicht-ASCII-Zeichen — bitte als reinen Text neu einfügen (Schlüssel bestehen nur aus Buchstaben, Ziffern, „-“ und „_“).",
    "settings.tipProvider": "Wählen Sie den Anbieter des KI-Bildmodells.",
    "settings.tipModel": "Das konkrete Modell. Größere Modelle sind genauer, aber langsamer/teurer.",
    "settings.tipKey":
      "Ihr API-Schlüssel, nur in diesem Browser gespeichert. Leer lassen, um den Server-Schlüssel zu nutzen.",
    "settings.tipClear": "Schlüssel entfernen und auf den Server-Schlüssel zurückgreifen.",
    "settings.tipOpen": "Einstellungen öffnen — Anbieter, Modell und API-Schlüssel wählen.",
    "common.close": "Schließen",
    "common.done": "Fertig",
    "run.needKey": "Kein API-Schlüssel gesetzt — Einstellungen öffnen, um einen hinzuzufügen.",

    "upload.earlier": "Frühere Aufnahme (Referenz)",
    "upload.earlierSub": "z. B. 2021",
    "upload.later": "Spätere Aufnahme",
    "upload.laterSub": "z. B. 2025",
    "upload.hint": "Bild anklicken oder hineinziehen",
    "upload.tip": "Laden Sie ein Luft-/Orthophoto hoch (PNG, JPEG, BMP, WebP, TIFF, GIF).",
    "upload.tiffError": "Dieses TIFF konnte nicht dekodiert werden — die Datei verwendet möglicherweise eine nicht unterstützte Kodierung (z. B. Kacheln, 16-Bit-Float oder proprietäres GeoTIFF). Versuchen Sie, als PNG oder JPEG zu exportieren.",

    "run.detect": "Veränderungen erkennen",
    "run.loading": "Lade Ausrichtungs-Engine…",
    "run.aligning": "Richte Bilder aus…",
    "run.analyzing": "Erkenne Veränderungen…",
    "run.tip": "Beide Bilder ausrichten und auf semantische Veränderungen analysieren.",

    "step.load": "Engine laden",
    "step.align": "Ausrichten",
    "step.detect": "Erkennen",

    "progress.initEngine":
      "Initialisiere Ausrichtungs-Engine (OpenCV, lokal gebündelt — nur beim ersten Lauf)…",
    "progress.engineReady": "Ausrichtungs-Engine bereit.",
    "progress.aligning": "Überlagere Bilder — ORB-Merkmalsabgleich + RANSAC-Homographie…",
    "progress.splitting": "Zerlege die Szene in hochaufgelöste Regionen…",
    "progress.region": "Analysiere Region {done}/{total} mit dem Bildmodell…",
    "progress.merging": "Führe überlappende Regionen zusammen und entferne Duplikate…",

    "align.matched": "Ausgerichtet per Merkmalsabgleich ({n} Treffer)",
    "align.fallback": "Ausrichtung auf einfache Skalierung zurückgefallen — Ergebnisse evtl. ungenauer",

    "note.pipeline":
      "Die Ausrichtung läuft im Browser; die Kacheln werden serverseitig analysiert. Größere Szenen bedeuten mehr Regionen (und ein paar Sekunden mehr).",

    "error.someFailed": "{failed} von {total} Regionen fehlgeschlagen — Ergebnisse evtl. unvollständig. Fehler: {err}",
    "error.allFailed": "{failed} von {total} Regionen fehlgeschlagen. Fehler: {err}",
    "error.generic": "Etwas ist schiefgelaufen",

    "summary.heading": "Zusammenfassung",
    "summary.meta": "{n} Veränderungen · Modell: {model}",

    "compare.heading": "Visueller Vergleich",
    "compare.overlays": "Markierungen",
    "compare.spotlight": "Spotlight",
    "compare.wipe": "Überblendung",
    "compare.showing": "Zeige {n} von {total}",
    "compare.tipOverlays": "Farbige Veränderungs-Rahmen ein-/ausblenden.",
    "compare.tipSpotlight": "Alles außer den erkannten Veränderungen abdunkeln.",
    "compare.tipWipe": "Ziehen, um zwischen früherem und späterem Bild zu überblenden.",

    "mode.old": "Früher",
    "mode.new": "Später",
    "mode.slider": "Schieberegler",
    "mode.side": "Nebeneinander",
    "mode.tipOld": "Nur das frühere Bild anzeigen.",
    "mode.tipNew": "Nur das spätere Bild anzeigen.",
    "mode.tipSlider": "Beide überlagern mit ziehbarer Trennlinie.",
    "mode.tipSide": "Beide Bilder nebeneinander anzeigen.",

    "badge.earlier": "früher",
    "badge.later": "später",

    "report.heading": "Veränderungsbericht ({n})",
    "report.headingOf": "Veränderungsbericht ({n} von {total})",
    "report.export": "PDF exportieren",
    "report.tipExport": "Professionellen PDF-Bericht mit annotierten Bildern und Veränderungstabelle herunterladen.",

    "pdf.title": "Veränderungsbericht",
    "pdf.subtitle": "Orthophoto-Veränderungsanalyse",
    "pdf.earlier": "Früheres Bild",
    "pdf.later": "Späteres Bild",
    "pdf.changes": "Erkannte Veränderungen",
    "pdf.generated": "Erstellt am {date}",
    "pdf.page": "Seite {n} von {total}",
    "pdf.tagline": "Orthophoto-Veränderungsanalyse",
    "report.minConf": "min",
    "report.tipMinConf": "Veränderungen unterhalb dieser Konfidenz ausblenden.",
    "report.search": "Suchen…",
    "report.noMatch": "Keine Veränderungen passen zu den aktuellen Filtern.",
    "report.tipType": "Diesen Veränderungstyp ein-/ausblenden.",

    "conf.any": "beliebig",
    "conf.mediumPlus": "≥ 65%",
    "conf.highOnly": "≥ 90%",
    "conf.low": "35%",
    "conf.medium": "65%",
    "conf.high": "90%",

    "type.added": "hinzugefügt",
    "type.removed": "entfernt",
    "type.modified": "verändert",

    "th.num": "#",
    "th.type": "Typ",
    "th.category": "Kategorie",
    "th.description": "Beschreibung",
    "th.conf": "Konfidenz",

    "cat.building": "Gebäude",
    "cat.house": "Haus",
    "cat.road": "Straße",
    "cat.bridge": "Brücke",
    "cat.plot": "Grundstück",
    "cat.water": "Wasser",
    "cat.vegetation": "Vegetation",
    "cat.other": "Sonstiges",

    "how.heading": "So funktioniert es",
    "how.1": "Beide Bilder werden im Browser per ORB-Merkmalsabgleich + RANSAC-Homographie überlagert.",
    "how.2": "Das ausgerichtete Paar wird in überlappende, hochaufgelöste Kacheln plus einen Überblick zerlegt.",
    "how.3": "Jede Region wird von einem Bildmodell analysiert, das echte bauliche / Nutzungs-Veränderungen erkennt (Jahreszeit, Licht und Schatten werden ignoriert).",
    "how.4": "Treffer werden auf globale Koordinaten zurückgerechnet, dedupliziert, hervorgehoben und aufgelistet.",

    "onboard.heading": "Erste Schritte",
    "onboard.subtitle": "Folgen Sie diesen Schritten, um zwei Orthophotos zu vergleichen.",
    "onboard.optional": "optional",
    "onboard.done": "erledigt",
    "onboard.dismiss": "Verstanden",
    "onboard.reopen": "Anleitung",
    "onboard.tipReopen": "Die Erste-Schritte-Anleitung anzeigen",
    "onboard.key": "API-Schlüssel hinzufügen",
    "onboard.keyHint":
      "Öffnen Sie die Einstellungen (⚙, oben rechts), wählen Sie einen Anbieter und fügen Sie Ihren Schlüssel ein — oder leer lassen für den Server-Schlüssel.",
    "onboard.earlier": "Früheres Bild hochladen",
    "onboard.earlierHint": "Die ältere Aufnahme (Referenzdatum, z. B. 2021).",
    "onboard.later": "Späteres Bild hochladen",
    "onboard.laterHint": "Die neuere Aufnahme zum Vergleich (z. B. 2025).",
    "onboard.run": "Veränderungen erkennen",
    "onboard.runHint": "Wir richten beide Bilder aus und analysieren sie Region für Region.",
    "onboard.explore": "Ergebnisse erkunden",
    "onboard.exploreHint":
      "Ziehen Sie den Schieberegler, wechseln Sie zu Nebeneinander, filtern Sie nach Typ/Konfidenz und exportieren Sie als PDF.",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["en"];

export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const table = STRINGS[lang] as Record<string, string>;
  let s = table[key] ?? (STRINGS.en as Record<string, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18n>({
  lang: "de",
  setLang: () => {},
  t: (key, vars) => translate("de", key, vars),
});

export const useI18n = () => useContext(I18nContext);
