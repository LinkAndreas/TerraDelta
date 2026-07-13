// Shared types used by both the browser and the API route.

export type ChangeType = "added" | "removed" | "modified";
export type Confidence = "low" | "medium" | "high";

// Categories of semantic change we ask the model to classify — the leaf
// object-type/subtype values from two Baden-Württemberg AdV catalogs:
// "Spitzenaktualisierung" (priority currency — transport/utility network)
// and "Grundaktualisierung" (baseline currency — buildings, land use,
// vegetation, water, terrain, etc). An object with no subtypes of its own
// (Straße, Bahnstrecke) is a leaf category by itself; every other object
// contributes one leaf per subtype/object, keyed "<object>.<subtype>".
export const CATEGORIES = [
  // Spitzenaktualisierung
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
  "schiffsverkehr.anleger",
  "schiffsverkehr.autofaehre",
  // Grundaktualisierung
  "gebaeude.wohngebaeude",
  "gebaeude.geschaeftsgebaeude",
  "gebaeude.industriegebaeude",
  "gebaeude.lagerhalle",
  "gebaeude.garage",
  "gebaeude.carport",
  "gebaeude.nebengebaeude",
  "gebaeude.schuppen",
  "gebaeude.gewaechshaus",
  "gebaeude.kirche",
  "gebaeude.schule",
  "gebaeude.krankenhaus",
  "gebaeude.sporthalle",
  "tatsaechliche_nutzung.acker",
  "tatsaechliche_nutzung.gruenland",
  "tatsaechliche_nutzung.wiese",
  "tatsaechliche_nutzung.weide",
  "tatsaechliche_nutzung.obstplantage",
  "tatsaechliche_nutzung.weinberg",
  "tatsaechliche_nutzung.baumschule",
  "tatsaechliche_nutzung.wald",
  "tatsaechliche_nutzung.laubwald",
  "tatsaechliche_nutzung.nadelwald",
  "tatsaechliche_nutzung.mischwald",
  "tatsaechliche_nutzung.heide",
  "tatsaechliche_nutzung.moor",
  "tatsaechliche_nutzung.sumpf",
  "tatsaechliche_nutzung.brachflaeche",
  "tatsaechliche_nutzung.garten",
  "tatsaechliche_nutzung.parkanlage",
  "vegetation.einzelbaum",
  "vegetation.baumgruppe",
  "vegetation.baumreihe",
  "vegetation.hecke",
  "vegetation.gebuesch",
  "vegetation.gehoelz",
  "gewaesser.fluss",
  "gewaesser.bach",
  "gewaesser.see",
  "gewaesser.weiher",
  "gewaesser.teich",
  "gewaesser.quelle",
  "gewaesser.hafenbecken",
  "gewaesser.uferlinie",
  "gewaesser.insel",
  "verkehr.feldweg",
  "verkehr.forstweg",
  "verkehr.wirtschaftsweg",
  "verkehr.radweg",
  "verkehr.gehweg",
  "verkehr.privatstrasse",
  "verkehr.zufahrt",
  "bauwerke.mauer",
  "bauwerke.stuetzmauer",
  "bauwerke.zaun",
  "bauwerke.laermschutzwand",
  "bauwerke.treppe",
  "bauwerke.rampe",
  "bauwerke.durchlass",
  "bauwerke.damm",
  "bauwerke.boeschung",
  "siedlung.wohngebiet",
  "siedlung.gewerbegebiet",
  "siedlung.industriegebiet",
  "siedlung.sportplatz",
  "siedlung.spielplatz",
  "siedlung.friedhof",
  "siedlung.campingplatz",
  "siedlung.kleingartenanlage",
  "versorgung.trafostation",
  "versorgung.umspannwerk",
  "versorgung.rohrleitung",
  "versorgung.wasserbehaelter",
  "versorgung.klaeranlage",
  "versorgung.pumpwerk",
  "versorgung.brunnen",
  "bahn.gleis",
  "bahn.weiche",
  "bahn.bahnsteig",
  "bahn.rangieranlage",
  "relief.gelaendekante",
  "relief.aufschuettung",
  "relief.einschnitt",
  "relief.reliefform",
] as const;
export type Category = (typeof CATEGORIES)[number];

// The object-type groupings from the same catalogs, for the category-picker
// UI: each group is either a single leaf (no subtypes) or an umbrella the
// user can select as a whole or drill into individual subtypes/objects.
export interface ObjectTypeGroup {
  key: string;
  categories: Category[];
}

export const SPITZE_GROUPS: ObjectTypeGroup[] = [
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
  { key: "schiffsverkehr", categories: ["schiffsverkehr.anleger", "schiffsverkehr.autofaehre"] },
];

export const GRUND_GROUPS: ObjectTypeGroup[] = [
  {
    key: "gebaeude",
    categories: [
      "gebaeude.wohngebaeude",
      "gebaeude.geschaeftsgebaeude",
      "gebaeude.industriegebaeude",
      "gebaeude.lagerhalle",
      "gebaeude.garage",
      "gebaeude.carport",
      "gebaeude.nebengebaeude",
      "gebaeude.schuppen",
      "gebaeude.gewaechshaus",
      "gebaeude.kirche",
      "gebaeude.schule",
      "gebaeude.krankenhaus",
      "gebaeude.sporthalle",
    ],
  },
  {
    key: "tatsaechliche_nutzung",
    categories: [
      "tatsaechliche_nutzung.acker",
      "tatsaechliche_nutzung.gruenland",
      "tatsaechliche_nutzung.wiese",
      "tatsaechliche_nutzung.weide",
      "tatsaechliche_nutzung.obstplantage",
      "tatsaechliche_nutzung.weinberg",
      "tatsaechliche_nutzung.baumschule",
      "tatsaechliche_nutzung.wald",
      "tatsaechliche_nutzung.laubwald",
      "tatsaechliche_nutzung.nadelwald",
      "tatsaechliche_nutzung.mischwald",
      "tatsaechliche_nutzung.heide",
      "tatsaechliche_nutzung.moor",
      "tatsaechliche_nutzung.sumpf",
      "tatsaechliche_nutzung.brachflaeche",
      "tatsaechliche_nutzung.garten",
      "tatsaechliche_nutzung.parkanlage",
    ],
  },
  {
    key: "vegetation",
    categories: [
      "vegetation.einzelbaum",
      "vegetation.baumgruppe",
      "vegetation.baumreihe",
      "vegetation.hecke",
      "vegetation.gebuesch",
      "vegetation.gehoelz",
    ],
  },
  {
    key: "gewaesser",
    categories: [
      "gewaesser.fluss",
      "gewaesser.bach",
      "gewaesser.see",
      "gewaesser.weiher",
      "gewaesser.teich",
      "gewaesser.quelle",
      "gewaesser.hafenbecken",
      "gewaesser.uferlinie",
      "gewaesser.insel",
    ],
  },
  {
    key: "verkehr",
    categories: [
      "verkehr.feldweg",
      "verkehr.forstweg",
      "verkehr.wirtschaftsweg",
      "verkehr.radweg",
      "verkehr.gehweg",
      "verkehr.privatstrasse",
      "verkehr.zufahrt",
    ],
  },
  {
    key: "bauwerke",
    categories: [
      "bauwerke.mauer",
      "bauwerke.stuetzmauer",
      "bauwerke.zaun",
      "bauwerke.laermschutzwand",
      "bauwerke.treppe",
      "bauwerke.rampe",
      "bauwerke.durchlass",
      "bauwerke.damm",
      "bauwerke.boeschung",
    ],
  },
  {
    key: "siedlung",
    categories: [
      "siedlung.wohngebiet",
      "siedlung.gewerbegebiet",
      "siedlung.industriegebiet",
      "siedlung.sportplatz",
      "siedlung.spielplatz",
      "siedlung.friedhof",
      "siedlung.campingplatz",
      "siedlung.kleingartenanlage",
    ],
  },
  {
    key: "versorgung",
    categories: [
      "versorgung.trafostation",
      "versorgung.umspannwerk",
      "versorgung.rohrleitung",
      "versorgung.wasserbehaelter",
      "versorgung.klaeranlage",
      "versorgung.pumpwerk",
      "versorgung.brunnen",
    ],
  },
  {
    key: "bahn",
    categories: ["bahn.gleis", "bahn.weiche", "bahn.bahnsteig", "bahn.rangieranlage"],
  },
  {
    key: "relief",
    categories: ["relief.gelaendekante", "relief.aufschuettung", "relief.einschnitt", "relief.reliefform"],
  },
];

// The two top-level "Oberkategorien" of the category tree — Spitzenaktualität
// is preselected by default (see defaultSelectedCategories); Grundaktualität
// starts unselected but is equally always toggleable, since there's no
// separate locked-preset mode anymore.
export interface CategoryBranch {
  key: "spitze" | "grund";
  groups: ObjectTypeGroup[];
}

export const CATEGORY_BRANCHES: CategoryBranch[] = [
  { key: "spitze", groups: SPITZE_GROUPS },
  { key: "grund", groups: GRUND_GROUPS },
];

export function defaultSelectedCategories(): Record<Category, boolean> {
  const result: Partial<Record<Category, boolean>> = {};
  for (const branch of CATEGORY_BRANCHES) {
    for (const group of branch.groups) {
      for (const cat of group.categories) {
        result[cat] = branch.key === "spitze";
      }
    }
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
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
