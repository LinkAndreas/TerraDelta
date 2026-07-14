// Shared types used by both the browser and the API route.

export type ChangeType = "added" | "removed" | "modified";
export type Confidence = "low" | "medium" | "high";

// Categories of semantic change we ask the model to classify — the leaf
// object-type/subtype values from the Baden-Württemberg Mini-OK BW (AS 7.1.2)
// object catalog, keyed by "kennung"/"bezeichnung" from the official spec.
// 12 objects are dual-tagged (both "Grundaktualisierung" AND
// "Spitzenaktualisierung", the priority-currency subset) and contribute the
// SpA-relevant subtype breakdown given in the spec; the other 50 objects are
// Grundaktualisierung-only and have no further breakdown, so each is a leaf
// by itself. Two entries in the source spec (51010, 52004) are marked as
// deleted and are excluded entirely.
export const CATEGORIES = [
  // Dual (Spitzenaktualisierung + Grundaktualisierung) — 12 objects, 26 leaves
  "strasse",
  "platz.fussgaengerzone",
  "platz.parkplatz",
  "platz.rastplatz",
  "platz.raststaette",
  "platz.autohof",
  "bahnstrecke",
  "flugverkehr.flughafen",
  "fliessgewaesser.kanal",
  "gewaesserachse.breitenklasse_3",
  "gewaesserachse.breitenklasse_6",
  "gewaesserachse.breitenklasse_12",
  "industrie_gewerbebauwerk.windrad",
  "industrie_gewerbebauwerk.freileitungsmast",
  "industrie_gewerbebauwerk.funkmast",
  "leitung.freileitung",
  "verkehrsbauwerk.bruecke",
  "verkehrsbauwerk.hochbahn",
  "verkehrsbauwerk.hochstrasse",
  "verkehrsbauwerk.tunnel",
  "verkehrsbauwerk.unterfuehrung",
  "bahnverkehrsanlage.bahnhof",
  "bahnverkehrsanlage.haltestelle",
  "bahnverkehrsanlage.haltepunkt",
  "einrichtungen_schiffsverkehr.anleger",
  "schifffahrtslinie_faehrverkehr.autofaehre",
  // Grundaktualisierung-only — 50 objects, 50 leaves
  "siedlungsflaeche.wohnbauflaeche",
  "siedlungsflaeche.industrie_gewerbeflaeche",
  "siedlungsflaeche.halde",
  "siedlungsflaeche.bergbaubetrieb",
  "siedlungsflaeche.tagebau_grube_steinbruch",
  "siedlungsflaeche.flaeche_gemischter_nutzung",
  "siedlungsflaeche.flaeche_besonderer_funktionaler_praegung",
  "siedlungsflaeche.sport_freizeit_erholungsflaeche",
  "siedlungsflaeche.friedhof",
  "verkehr.strassenverkehr",
  "verkehr.strassenachse",
  "verkehr.fahrbahnachse",
  "verkehr.fahrwegachse",
  "verkehr.bahnverkehr",
  "verkehr.schiffsverkehr_allgemein",
  "vegetation_landwirtschaft.landwirtschaft",
  "vegetation_landwirtschaft.wald",
  "vegetation_landwirtschaft.gehoelz",
  "vegetation_landwirtschaft.heide",
  "vegetation_landwirtschaft.moor",
  "vegetation_landwirtschaft.sumpf",
  "vegetation_landwirtschaft.unland_vegetationslose_flaeche",
  "gewaesser.wasserlauf",
  "gewaesser.kanal",
  "gewaesser.hafenbecken",
  "gewaesser.stehendes_gewaesser",
  "bauwerke_anlagen.turm",
  "bauwerke_anlagen.vorratsbehaelter_speicherbauwerk",
  "bauwerke_anlagen.transportanlage",
  "bauwerke_anlagen.bauwerk_sport_freizeit_erholung",
  "bauwerke_anlagen.historisches_bauwerk",
  "bauwerke_anlagen.sonstiges_bauwerk",
  "ortslagen_haefen.ortslage",
  "ortslagen_haefen.hafen",
  "ortslagen_haefen.schleuse",
  "ortslagen_haefen.testgelaende",
  "verkehrsbauwerke_anlagen.strassenverkehrsanlage",
  "verkehrsbauwerke_anlagen.weg_pfad_steig",
  "verkehrsbauwerke_anlagen.seilbahn_schwebebahn",
  "verkehrsbauwerke_anlagen.gleis",
  "verkehrsbauwerke_anlagen.flugverkehrsanlage",
  "verkehrsbauwerke_anlagen.bauwerk_gewaesserbereich",
  "sonstige_merkmale.vegetationsmerkmal",
  "sonstige_merkmale.gewaessermerkmal",
  "sonstige_merkmale.polder",
  "sonstige_merkmale.netzknoten",
  "sonstige_merkmale.nullpunkt",
  "sonstige_merkmale.wasserspiegelhoehe",
  "sonstige_merkmale.gewaesserstationierungsachse",
  "sonstige_merkmale.sickerstrecke",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Official Mini-OK BW (AS 7.1.2) catalog reference for every leaf category —
// "OAR" (Objektart-Kennung, the 5-digit object-type code) alone, or
// "OAR/WAR" when the leaf is a subtype/attribute-value of that object type
// (WAR = Werteart-Kennung, the attribute-value code from the FKT/ART/BWF/etc.
// column). Shown in the UI and used in exports so a change can be cross-
// checked against the source spec. NOTE: three pairs of leaves here share a
// single WAR code in the spec (raststaette+autohof -> 5330;
// hochbahn+hochstrasse -> 1830; tunnel+unterfuehrung -> 1870) — the catalog
// splits each pair into two visually-distinguishable categories for the
// model even though the official spec treats them as one value; see
// SYSTEM's disambiguation note for how the detector is told to handle this.
export const CATEGORY_REF: Record<Category, string> = {
  strasse: "42002",
  "platz.fussgaengerzone": "42009/5130",
  "platz.parkplatz": "42009/5310",
  "platz.rastplatz": "42009/5320",
  "platz.raststaette": "42009/5330",
  "platz.autohof": "42009/5330",
  bahnstrecke: "42014",
  "flugverkehr.flughafen": "42015/5511",
  "fliessgewaesser.kanal": "44001/8300",
  "gewaesserachse.breitenklasse_3": "44004/BRG-3",
  "gewaesserachse.breitenklasse_6": "44004/BRG-6",
  "gewaesserachse.breitenklasse_12": "44004/BRG-12",
  "industrie_gewerbebauwerk.windrad": "51002/1220",
  "industrie_gewerbebauwerk.freileitungsmast": "51002/1251",
  "industrie_gewerbebauwerk.funkmast": "51002/1260",
  "leitung.freileitung": "51005/1110",
  "verkehrsbauwerk.bruecke": "53001/1800",
  "verkehrsbauwerk.hochbahn": "53001/1830",
  "verkehrsbauwerk.hochstrasse": "53001/1830",
  "verkehrsbauwerk.tunnel": "53001/1870",
  "verkehrsbauwerk.unterfuehrung": "53001/1870",
  "bahnverkehrsanlage.bahnhof": "53004/1010",
  "bahnverkehrsanlage.haltestelle": "53004/1020",
  "bahnverkehrsanlage.haltepunkt": "53004/1030",
  "einrichtungen_schiffsverkehr.anleger": "53008/1460",
  "schifffahrtslinie_faehrverkehr.autofaehre": "57002/1710",
  "siedlungsflaeche.wohnbauflaeche": "41001",
  "siedlungsflaeche.industrie_gewerbeflaeche": "41002",
  "siedlungsflaeche.halde": "41003",
  "siedlungsflaeche.bergbaubetrieb": "41004",
  "siedlungsflaeche.tagebau_grube_steinbruch": "41005",
  "siedlungsflaeche.flaeche_gemischter_nutzung": "41006",
  "siedlungsflaeche.flaeche_besonderer_funktionaler_praegung": "41007",
  "siedlungsflaeche.sport_freizeit_erholungsflaeche": "41008",
  "siedlungsflaeche.friedhof": "41009",
  "verkehr.strassenverkehr": "42001",
  "verkehr.strassenachse": "42003",
  "verkehr.fahrbahnachse": "42005",
  "verkehr.fahrwegachse": "42008",
  "verkehr.bahnverkehr": "42010",
  "verkehr.schiffsverkehr_allgemein": "42016",
  "vegetation_landwirtschaft.landwirtschaft": "43001",
  "vegetation_landwirtschaft.wald": "43002",
  "vegetation_landwirtschaft.gehoelz": "43003",
  "vegetation_landwirtschaft.heide": "43004",
  "vegetation_landwirtschaft.moor": "43005",
  "vegetation_landwirtschaft.sumpf": "43006",
  "vegetation_landwirtschaft.unland_vegetationslose_flaeche": "43007",
  "gewaesser.wasserlauf": "44002",
  "gewaesser.kanal": "44003",
  "gewaesser.hafenbecken": "44005",
  "gewaesser.stehendes_gewaesser": "44006",
  "bauwerke_anlagen.turm": "51001",
  "bauwerke_anlagen.vorratsbehaelter_speicherbauwerk": "51003",
  "bauwerke_anlagen.transportanlage": "51004",
  "bauwerke_anlagen.bauwerk_sport_freizeit_erholung": "51006",
  "bauwerke_anlagen.historisches_bauwerk": "51007",
  "bauwerke_anlagen.sonstiges_bauwerk": "51009",
  "ortslagen_haefen.ortslage": "52001",
  "ortslagen_haefen.hafen": "52002",
  "ortslagen_haefen.schleuse": "52003",
  "ortslagen_haefen.testgelaende": "52005",
  "verkehrsbauwerke_anlagen.strassenverkehrsanlage": "53002",
  "verkehrsbauwerke_anlagen.weg_pfad_steig": "53003",
  "verkehrsbauwerke_anlagen.seilbahn_schwebebahn": "53005",
  "verkehrsbauwerke_anlagen.gleis": "53006",
  "verkehrsbauwerke_anlagen.flugverkehrsanlage": "53007",
  "verkehrsbauwerke_anlagen.bauwerk_gewaesserbereich": "53009",
  "sonstige_merkmale.vegetationsmerkmal": "54001",
  "sonstige_merkmale.gewaessermerkmal": "55001",
  "sonstige_merkmale.polder": "55003",
  "sonstige_merkmale.netzknoten": "56001",
  "sonstige_merkmale.nullpunkt": "56002",
  "sonstige_merkmale.wasserspiegelhoehe": "57001",
  "sonstige_merkmale.gewaesserstationierungsachse": "57003",
  "sonstige_merkmale.sickerstrecke": "57004",
};

// The OAR (object-type) part of a leaf's reference, e.g. "42009/5310" -> "42009".
export function oarOf(cat: Category): string {
  return CATEGORY_REF[cat].split("/")[0];
}

// A single official object type (Objektart): either a leaf by itself (no
// subtype breakdown given in the spec, e.g. "Bahnverkehr") or an umbrella
// over several subtypes/attribute-values (e.g. "Platz" -> Fußgängerzone,
// Parkplatz, ...). `categories.length === 1 && categories[0] === key` marks
// the no-subtype case for the UI (flat checkbox, no disclosure).
export interface CategoryObject {
  key: string;
  categories: Category[];
}

// A thematic grouping of objects sharing an Objektartengruppe (e.g. all
// "42xxx" transport objects) — exists only to keep the Grundaktualisierung
// branch (50 objects) browsable; Spitzenaktualisierung's 12 objects are few
// enough to list directly under their branch with no extra grouping layer.
export interface CategoryObjectGroup {
  key: string;
  objects: CategoryObject[];
}

// Spitzenaktualisierung — the 12 dual-tagged objects, listed directly.
export const SPITZE_OBJECTS: CategoryObject[] = [
  { key: "strasse", categories: ["strasse"] },
  {
    key: "platz",
    categories: ["platz.fussgaengerzone", "platz.parkplatz", "platz.rastplatz", "platz.raststaette", "platz.autohof"],
  },
  { key: "bahnstrecke", categories: ["bahnstrecke"] },
  { key: "flugverkehr", categories: ["flugverkehr.flughafen"] },
  { key: "fliessgewaesser", categories: ["fliessgewaesser.kanal"] },
  {
    key: "gewaesserachse",
    categories: ["gewaesserachse.breitenklasse_3", "gewaesserachse.breitenklasse_6", "gewaesserachse.breitenklasse_12"],
  },
  {
    key: "industrie_gewerbebauwerk",
    categories: [
      "industrie_gewerbebauwerk.windrad",
      "industrie_gewerbebauwerk.freileitungsmast",
      "industrie_gewerbebauwerk.funkmast",
    ],
  },
  { key: "leitung", categories: ["leitung.freileitung"] },
  {
    key: "verkehrsbauwerk",
    categories: [
      "verkehrsbauwerk.bruecke",
      "verkehrsbauwerk.hochbahn",
      "verkehrsbauwerk.hochstrasse",
      "verkehrsbauwerk.tunnel",
      "verkehrsbauwerk.unterfuehrung",
    ],
  },
  {
    key: "bahnverkehrsanlage",
    categories: ["bahnverkehrsanlage.bahnhof", "bahnverkehrsanlage.haltestelle", "bahnverkehrsanlage.haltepunkt"],
  },
  { key: "einrichtungen_schiffsverkehr", categories: ["einrichtungen_schiffsverkehr.anleger"] },
  { key: "schifffahrtslinie_faehrverkehr", categories: ["schifffahrtslinie_faehrverkehr.autofaehre"] },
];

// Grundaktualisierung — all 62 objects (including the 12 dual ones, reusing
// their exact categories above), organized into 8 thematic groups mirroring
// the source spec's Objektartengruppen (41xxx Siedlungsfläche, 42xxx
// Verkehr, 43xxx Vegetation/Landwirtschaft, 44xxx Gewässer, 51xxx Bauwerke
// und Anlagen, 52xxx Ortslagen/Häfen, 53xxx Verkehrsbauwerke/-anlagen,
// 54xxx-57xxx Sonstige Merkmale).
export const GRUND_GROUPS: CategoryObjectGroup[] = [
  {
    key: "siedlungsflaeche",
    objects: [
      { key: "wohnbauflaeche", categories: ["siedlungsflaeche.wohnbauflaeche"] },
      { key: "industrie_gewerbeflaeche", categories: ["siedlungsflaeche.industrie_gewerbeflaeche"] },
      { key: "halde", categories: ["siedlungsflaeche.halde"] },
      { key: "bergbaubetrieb", categories: ["siedlungsflaeche.bergbaubetrieb"] },
      { key: "tagebau_grube_steinbruch", categories: ["siedlungsflaeche.tagebau_grube_steinbruch"] },
      { key: "flaeche_gemischter_nutzung", categories: ["siedlungsflaeche.flaeche_gemischter_nutzung"] },
      {
        key: "flaeche_besonderer_funktionaler_praegung",
        categories: ["siedlungsflaeche.flaeche_besonderer_funktionaler_praegung"],
      },
      { key: "sport_freizeit_erholungsflaeche", categories: ["siedlungsflaeche.sport_freizeit_erholungsflaeche"] },
      { key: "friedhof", categories: ["siedlungsflaeche.friedhof"] },
    ],
  },
  {
    key: "verkehr",
    objects: [
      { key: "strassenverkehr", categories: ["verkehr.strassenverkehr"] },
      SPITZE_OBJECTS[0], // strasse
      { key: "strassenachse", categories: ["verkehr.strassenachse"] },
      { key: "fahrbahnachse", categories: ["verkehr.fahrbahnachse"] },
      { key: "fahrwegachse", categories: ["verkehr.fahrwegachse"] },
      SPITZE_OBJECTS[1], // platz
      { key: "bahnverkehr", categories: ["verkehr.bahnverkehr"] },
      SPITZE_OBJECTS[2], // bahnstrecke
      SPITZE_OBJECTS[3], // flugverkehr
      { key: "schiffsverkehr_allgemein", categories: ["verkehr.schiffsverkehr_allgemein"] },
    ],
  },
  {
    key: "vegetation_landwirtschaft",
    objects: [
      { key: "landwirtschaft", categories: ["vegetation_landwirtschaft.landwirtschaft"] },
      { key: "wald", categories: ["vegetation_landwirtschaft.wald"] },
      { key: "gehoelz", categories: ["vegetation_landwirtschaft.gehoelz"] },
      { key: "heide", categories: ["vegetation_landwirtschaft.heide"] },
      { key: "moor", categories: ["vegetation_landwirtschaft.moor"] },
      { key: "sumpf", categories: ["vegetation_landwirtschaft.sumpf"] },
      {
        key: "unland_vegetationslose_flaeche",
        categories: ["vegetation_landwirtschaft.unland_vegetationslose_flaeche"],
      },
    ],
  },
  {
    key: "gewaesser",
    objects: [
      SPITZE_OBJECTS[4], // fliessgewaesser
      { key: "wasserlauf", categories: ["gewaesser.wasserlauf"] },
      { key: "kanal", categories: ["gewaesser.kanal"] },
      SPITZE_OBJECTS[5], // gewaesserachse
      { key: "hafenbecken", categories: ["gewaesser.hafenbecken"] },
      { key: "stehendes_gewaesser", categories: ["gewaesser.stehendes_gewaesser"] },
    ],
  },
  {
    key: "bauwerke_anlagen",
    objects: [
      { key: "turm", categories: ["bauwerke_anlagen.turm"] },
      SPITZE_OBJECTS[6], // industrie_gewerbebauwerk
      { key: "vorratsbehaelter_speicherbauwerk", categories: ["bauwerke_anlagen.vorratsbehaelter_speicherbauwerk"] },
      { key: "transportanlage", categories: ["bauwerke_anlagen.transportanlage"] },
      SPITZE_OBJECTS[7], // leitung
      { key: "bauwerk_sport_freizeit_erholung", categories: ["bauwerke_anlagen.bauwerk_sport_freizeit_erholung"] },
      { key: "historisches_bauwerk", categories: ["bauwerke_anlagen.historisches_bauwerk"] },
      { key: "sonstiges_bauwerk", categories: ["bauwerke_anlagen.sonstiges_bauwerk"] },
    ],
  },
  {
    key: "ortslagen_haefen",
    objects: [
      { key: "ortslage", categories: ["ortslagen_haefen.ortslage"] },
      { key: "hafen", categories: ["ortslagen_haefen.hafen"] },
      { key: "schleuse", categories: ["ortslagen_haefen.schleuse"] },
      { key: "testgelaende", categories: ["ortslagen_haefen.testgelaende"] },
    ],
  },
  {
    key: "verkehrsbauwerke_anlagen",
    objects: [
      SPITZE_OBJECTS[8], // verkehrsbauwerk
      { key: "strassenverkehrsanlage", categories: ["verkehrsbauwerke_anlagen.strassenverkehrsanlage"] },
      { key: "weg_pfad_steig", categories: ["verkehrsbauwerke_anlagen.weg_pfad_steig"] },
      SPITZE_OBJECTS[9], // bahnverkehrsanlage
      { key: "seilbahn_schwebebahn", categories: ["verkehrsbauwerke_anlagen.seilbahn_schwebebahn"] },
      { key: "gleis", categories: ["verkehrsbauwerke_anlagen.gleis"] },
      { key: "flugverkehrsanlage", categories: ["verkehrsbauwerke_anlagen.flugverkehrsanlage"] },
      SPITZE_OBJECTS[10], // einrichtungen_schiffsverkehr
      { key: "bauwerk_gewaesserbereich", categories: ["verkehrsbauwerke_anlagen.bauwerk_gewaesserbereich"] },
    ],
  },
  {
    key: "sonstige_merkmale",
    objects: [
      { key: "vegetationsmerkmal", categories: ["sonstige_merkmale.vegetationsmerkmal"] },
      { key: "gewaessermerkmal", categories: ["sonstige_merkmale.gewaessermerkmal"] },
      { key: "polder", categories: ["sonstige_merkmale.polder"] },
      { key: "netzknoten", categories: ["sonstige_merkmale.netzknoten"] },
      { key: "nullpunkt", categories: ["sonstige_merkmale.nullpunkt"] },
      { key: "wasserspiegelhoehe", categories: ["sonstige_merkmale.wasserspiegelhoehe"] },
      SPITZE_OBJECTS[11], // schifffahrtslinie_faehrverkehr
      { key: "gewaesserstationierungsachse", categories: ["sonstige_merkmale.gewaesserstationierungsachse"] },
      { key: "sickerstrecke", categories: ["sonstige_merkmale.sickerstrecke"] },
    ],
  },
];

// The two top-level "Oberkategorien" of the category tree — Spitzenaktualität
// is preselected by default (see defaultSelectedCategories); Grundaktualität
// starts unselected but is equally always toggleable, since there's no
// separate locked-preset mode anymore. Note some leaf categories are
// reachable from both branches (the 12 dual objects) — checking one instance
// checks the same underlying category the other branch shows, which mirrors
// the source spec: those objects genuinely belong to both catalogs.
export type CategoryBranch =
  | { key: "spitze"; objects: CategoryObject[] }
  | { key: "grund"; groups: CategoryObjectGroup[] };

export const CATEGORY_BRANCHES: CategoryBranch[] = [
  { key: "grund", groups: GRUND_GROUPS },
  { key: "spitze", objects: SPITZE_OBJECTS },
];

// Default selection: exactly the Spitzenaktualisierung leaves. Computed
// against SPITZE_OBJECTS directly (not by iterating both branches in order)
// because 26 of the 76 categories are reachable from BOTH branches — a
// sequential per-branch overwrite would flip those back to false when the
// Grundaktualisierung pass ran after Spitzenaktualisierung's.
export function defaultSelectedCategories(): Record<Category, boolean> {
  const spitzeCategories = new Set<Category>(SPITZE_OBJECTS.flatMap((o) => o.categories));
  const result: Partial<Record<Category, boolean>> = {};
  for (const cat of CATEGORIES) {
    result[cat] = spitzeCategories.has(cat);
  }
  return result as Record<Category, boolean>;
}

export interface Change {
  id: string;
  category: string;
  change_type: ChangeType;
  description: string;
  confidence: Confidence;
  // Normalized bounding box on the aligned reference image:
  // [x, y, width, height], each in 0..1, origin top-left. This is the sole
  // geometry for a change — used for map overlays, dedup IoU, search-area
  // pruning, and export. A tight rectangle is a simpler, more reliable
  // target for the model than a free-form polygon (fewer points to get
  // right, no risk of a self-intersecting or mismatched-scale outline).
  bbox: [number, number, number, number];
}

// Token counts for one API call, as reported by the provider — used to
// estimate the API spend of a run (see lib/models.ts estimateCost).
// inputTokens is the NON-cached portion only (Anthropic's `input_tokens`
// already excludes cache hits); cacheWriteTokens/cacheReadTokens break out
// the cached portion, which is billed at different (write: ~1.25x, read:
// ~0.1x base input price) rates — see buildSystem's cache_control usage in
// lib/claude.ts for why most of a run's system-prompt tokens end up here
// instead of in inputTokens after the first tile.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

// Display currency for the estimated API cost (§ lib/models.ts) — a user
// preference, independent of the provider/model actually billing in USD.
export type Currency = "USD" | "EUR";

// How much reasoning effort the model spends per call (Anthropic's
// output_config.effort) — higher effort trades cost/latency for accuracy.
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];
export const DEFAULT_EFFORT: Effort = "medium";

export interface AnalyzeResult {
  changes: Change[];
  summary: string;
  model: string;
  usage: TokenUsage;
}

// Result of the second-pass verification of a single candidate change,
// judged on a zoomed-in crop around the detection.
export interface VerifyResult {
  genuine: boolean;
  confidence: Confidence;
  // Refined tight box in the CROP's normalized coordinates ([0,0,0,0] if rejected).
  bbox: [number, number, number, number];
  reason: string;
  usage: TokenUsage;
}

export type SupportedModels = { id: string; name: string }[];

export const CHANGE_COLORS: Record<ChangeType, string> = {
  added: "#22c55e", // green
  removed: "#ef4444", // red
  modified: "#f59e0b", // amber
};

export const CONF_PCT: Record<Confidence, number> = { low: 35, medium: 65, high: 90 };
export const confLabel = (c: Confidence): string => `${CONF_PCT[c]}%`;

// ── Georeferencing (from GeoTIFF input) ────────────────────────────────────

// Enough to map pixel <-> geographic coordinates for one image: a proj4
// definition for the raster's native CRS, its bounding box in that CRS
// ([minX, minY, maxX, maxY], north-up assumed), and its original pixel size.
export interface GeoRef {
  proj4Def: string;
  bbox: [number, number, number, number];
  pixelWidth: number;
  pixelHeight: number;
}

// ── Search-area restriction (requires GeoTIFF input for both images) ──────

export type SearchShape = "circle" | "rectangle" | "square";

export interface SearchArea {
  shape: SearchShape;
  lat: number;
  lon: number;
  // Circle: radiusM. Rectangle: widthM x heightM. Square: widthM === heightM
  // (kept as a distinct shape so the UI can offer a single "side length"
  // field instead of independent width/height).
  radiusM: number;
  widthM: number;
  heightM: number;
}

export const DEFAULT_RADIUS_M = 200;
