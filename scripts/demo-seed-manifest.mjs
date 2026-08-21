export const DEMO_SEED_VERSION = 1;

export const DEMO_ORGANIZATION = Object.freeze({
  id: "d3e00000-0000-4000-8000-000000000001",
  name: "Werkstatt Nord · Demo",
  slug: "demo",
  isReadOnly: true,
});

export const DEMO_USER = Object.freeze({
  id: "d3e00000-0000-4000-8000-000000000002",
  email: "demo@inventory.invalid",
  name: "Demo-Besucher",
  role: "viewer",
});

export const DEMO_ACTOR = "demo-seed";

export const APP_PERMISSIONS = Object.freeze([
  "inventory.read",
  "inventory.create",
  "inventory.update",
  "inventory.delete",
  "inventory.import",
  "inventory.export",
  "stock.read",
  "stock.manage",
  "assignments.read",
  "assignments.manage",
  "counts.read",
  "counts.manage",
  "spatial.read",
  "spatial.manage",
  "orders.read",
  "orders.manage",
  "requests.read",
  "requests.create",
  "requests.manage",
  "workflows.read",
  "workflows.manage",
  "labels.read",
  "labels.manage",
  "ai.use",
  "settings.inventory-types.manage",
  "settings.custom-fields.manage",
  "settings.languages.manage",
  "users.manage",
  "roles.manage",
  "sharing.manage",
  "tokens.manage",
  "tokens.delegate",
  "webhooks.manage",
]);

export const VIEWER_PERMISSIONS = Object.freeze([
  "inventory.read",
  "stock.read",
  "assignments.read",
  "counts.read",
  "spatial.read",
  "orders.read",
  "requests.read",
  "workflows.read",
  "labels.read",
]);

const administrationPermissions = new Set([
  "users.manage",
  "roles.manage",
  "sharing.manage",
  "tokens.manage",
  "tokens.delegate",
  "webhooks.manage",
]);

export const DEMO_ROLES = Object.freeze([
  {
    key: "admin",
    name: "Admin",
    description: "Vollzugriff auf die Organisation und ihre Einstellungen.",
    permissions: [...APP_PERMISSIONS],
  },
  {
    key: "editor",
    name: "Bearbeitung",
    description: "Kann Inventar und Abläufe bearbeiten, aber keine Organisation verwalten.",
    permissions: APP_PERMISSIONS.filter(
      (permission) =>
        !permission.startsWith("settings.") &&
        !administrationPermissions.has(permission),
    ),
  },
  {
    key: "viewer",
    name: "Nur ansehen",
    description: "Schreibgeschützter Zugriff auf Inventar und betriebliche Abläufe.",
    permissions: [...VIEWER_PERMISSIONS],
  },
]);

export const DEMO_INVENTORY_TYPES = Object.freeze([
  {
    key: "place",
    label: "Ort / Raum",
    description: "Standort, Raum, Zone, Regal oder Fach.",
    color: "#16a374",
    icon: "map-pin",
    canContain: true,
    spatialContainment: true,
    position: 10,
  },
  {
    key: "furniture",
    label: "Möbel",
    description: "Möbel und Einbauten, die Gegenstände enthalten können.",
    color: "#b9875e",
    icon: "armchair",
    canContain: true,
    spatialContainment: true,
    position: 20,
  },
  {
    key: "vehicle",
    label: "Fahrzeug",
    description: "Fahrzeuge und mobile Lagerorte.",
    color: "#3b82f6",
    icon: "car",
    canContain: true,
    spatialContainment: true,
    position: 30,
  },
  {
    key: "tool",
    label: "Werkzeug",
    description: "Werkzeuge und Werkstattausrüstung.",
    color: "#e99b2d",
    icon: "wrench",
    canContain: false,
    spatialContainment: false,
    position: 40,
  },
  {
    key: "object",
    label: "Gegenstand",
    description: "Allgemeine Gegenstände und Verbrauchsmaterial.",
    color: "#635bff",
    icon: "box",
    canContain: false,
    spatialContainment: false,
    position: 50,
  },
  {
    key: "clothing",
    label: "Kleidung",
    description: "Kleidung und tragbare Ausrüstung.",
    color: "#e2647f",
    icon: "shirt",
    canContain: false,
    spatialContainment: false,
    position: 60,
  },
  {
    key: "person",
    label: "Person",
    description: "Eine Person im Inventargraphen.",
    color: "#a66dd4",
    icon: "user",
    canContain: false,
    spatialContainment: false,
    position: 70,
  },
  {
    key: "project",
    label: "Projekt",
    description: "Projekt oder logische Sammlung.",
    color: "#64748b",
    icon: "folder",
    canContain: true,
    spatialContainment: false,
    position: 80,
  },
  {
    key: "other",
    label: "Sonstiges",
    description: "Auffangtyp für andere Einträge.",
    color: "#858b95",
    icon: "shapes",
    canContain: false,
    spatialContainment: false,
    position: 90,
  },
]);

export const DEMO_RELATION_TYPES = Object.freeze([
  {
    key: "contains",
    label: "Enthält",
    inverseLabel: "Befindet sich in",
    description: "Physische oder logische Zuordnung zu einem Ort.",
    allowManual: true,
    spatial: true,
    position: 10,
  },
  {
    key: "related",
    label: "Gehört zu",
    inverseLabel: "Gehört zu",
    description: "Allgemeiner Zusammenhang zwischen zwei Einträgen.",
    allowManual: true,
    spatial: false,
    position: 20,
  },
]);

export const DEMO_RESOURCES = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000101",
    name: "Regal A2",
    description: "Materialregal an der Nordwand, Felder A1 bis A4.",
    type: "place",
    status: "available",
    sku: "ORT-REGAL-A2",
    quantity: 1,
    location: "Werkstatt Nord",
    barcode: "OI-DEMO-ORT-A2",
    valueCents: null,
    priority: 2,
    tags: ["lager", "nordwand"],
    categories: [{ name: "Lagerort", color: "#16a374" }],
    customFields: {},
    notes: "Traglast je Fach: 120 kg.",
    updatedDaysAgo: 21,
    kind: "place",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000102",
    name: "Werkbank E1",
    description: "Elektronikarbeitsplatz mit ESD-Matte und Absaugung.",
    type: "place",
    status: "available",
    sku: "ORT-WERKBANK-E1",
    quantity: 1,
    location: "Werkstatt Nord",
    barcode: "OI-DEMO-ORT-E1",
    valueCents: null,
    priority: 2,
    tags: ["elektronik", "esd"],
    categories: [{ name: "Arbeitsplatz", color: "#3b82f6" }],
    customFields: {},
    notes: "Absaugung vor Lötarbeiten einschalten.",
    updatedDaysAgo: 18,
    kind: "place",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000103",
    name: "Fach K3",
    description: "Kleinteilefach im Regal A2.",
    type: "place",
    status: "available",
    sku: "ORT-FACH-K3",
    quantity: 1,
    location: "Regal A2",
    barcode: "OI-DEMO-ORT-K3",
    valueCents: null,
    priority: 2,
    tags: ["kleinteile", "lager"],
    categories: [{ name: "Lagerort", color: "#16a374" }],
    customFields: {},
    notes: "Behälter 3 bis 6.",
    updatedDaysAgo: 14,
    kind: "place",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000201",
    name: "Akku-Bohrschrauber 18 V",
    description: "Zwei Werkstattgeräte mit Schnellspannfutter, Akkus und Ladegerät.",
    type: "tool",
    status: "in-use",
    sku: "WERK-ABS-18V",
    quantity: 1,
    location: "Regal A2",
    barcode: "OI-DEMO-ABS-18V",
    valueCents: 21900,
    priority: 4,
    tags: ["akku", "bohren", "mobil"],
    categories: [{ name: "Elektrowerkzeug", color: "#e99b2d" }],
    customFields: { lieferumfang: "2 Geräte, 3 Akkus, 1 Ladegerät" },
    notes: "Gerät 02 ist für das Projekt Lastenrad ausgegeben.",
    updatedDaysAgo: 2,
    kind: "item",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000202",
    name: "Lötstation 80 W",
    description: "Temperaturgeregelte Lötstation für Reparaturen und Prototypen.",
    type: "tool",
    status: "available",
    sku: "ELEK-LOET-80W",
    quantity: 3,
    location: "Werkbank E1",
    barcode: "OI-DEMO-LOET-80W",
    valueCents: 14900,
    priority: 3,
    tags: ["löten", "elektronik", "esd"],
    categories: [{ name: "Elektronik", color: "#635bff" }],
    customFields: { temperaturbereich: "150–450 °C" },
    notes: "Spitzen nach Gebrauch reinigen und verzinnen.",
    updatedDaysAgo: 6,
    kind: "item",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000203",
    name: "Digitalmultimeter TRMS",
    description: "Handmultimeter für Spannungs-, Strom- und Widerstandsmessungen.",
    type: "tool",
    status: "maintenance",
    sku: "MESS-DMM-TRMS",
    quantity: 0,
    location: "Werkbank E1",
    barcode: "OI-DEMO-DMM-TRMS",
    valueCents: 18400,
    priority: 5,
    tags: ["messen", "elektronik", "kalibrierung"],
    categories: [{ name: "Messtechnik", color: "#e2647f" }],
    customFields: { wartungsstatus: "Kalibrierung beauftragt" },
    notes: "Bis zur abgeschlossenen Kalibrierung nicht verwenden.",
    updatedDaysAgo: 1,
    kind: "item",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000204",
    name: "Schrauben M4×20",
    description: "Zylinderkopfschrauben M4×20, Edelstahl A2, Innensechskant.",
    type: "object",
    status: "available",
    sku: "VERB-M4X20-A2",
    quantity: 126,
    location: "Fach K3",
    barcode: "OI-DEMO-M4X20-A2",
    valueCents: 12,
    priority: 3,
    tags: ["schrauben", "m4", "edelstahl"],
    categories: [{ name: "Verbrauchsmaterial", color: "#64748b" }],
    customFields: { norm: "ISO 4762", werkstoff: "Edelstahl A2" },
    notes: "Bestand nach Entnahme direkt buchen.",
    updatedDaysAgo: 4,
    kind: "item",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000205",
    name: "Kabelbinder 200 mm schwarz",
    description: "UV-beständige Kabelbinder, 200 × 4,8 mm, schwarz.",
    type: "object",
    status: "available",
    sku: "VERB-KB-200-S",
    quantity: 34,
    location: "Fach K3",
    barcode: "OI-DEMO-KB-200-S",
    valueCents: 9,
    priority: 4,
    tags: ["kabelbinder", "verbrauch", "uv-beständig"],
    categories: [{ name: "Verbrauchsmaterial", color: "#64748b" }],
    customFields: { abmessung: "200 × 4,8 mm" },
    notes: "Mindestbestand unterschritten; Nachbestellung ist offen.",
    updatedDaysAgo: 3,
    kind: "item",
  },
]);

export const DEMO_STOCK_SETTINGS = Object.freeze([
  {
    resourceId: "d3e00000-0000-4000-8000-000000000201",
    trackingMode: "serialized",
    minimumStock: 1,
    reorderQuantity: 1,
    leadTimeDays: 5,
    unitName: "Gerät",
  },
  {
    resourceId: "d3e00000-0000-4000-8000-000000000202",
    trackingMode: "bulk",
    minimumStock: 1,
    reorderQuantity: 2,
    leadTimeDays: 4,
    unitName: "Station",
  },
  {
    resourceId: "d3e00000-0000-4000-8000-000000000203",
    trackingMode: "serialized",
    minimumStock: 1,
    reorderQuantity: 1,
    leadTimeDays: 10,
    unitName: "Gerät",
  },
  {
    resourceId: "d3e00000-0000-4000-8000-000000000204",
    trackingMode: "bulk",
    minimumStock: 100,
    reorderQuantity: 200,
    leadTimeDays: 3,
    unitName: "Stück",
  },
  {
    resourceId: "d3e00000-0000-4000-8000-000000000205",
    trackingMode: "bulk",
    minimumStock: 50,
    reorderQuantity: 100,
    leadTimeDays: 6,
    unitName: "Stück",
  },
]);

export const DEMO_LOCATION_BALANCES = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000301",
    resourceId: "d3e00000-0000-4000-8000-000000000201",
    locationResourceId: "d3e00000-0000-4000-8000-000000000101",
    quantity: 1,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000302",
    resourceId: "d3e00000-0000-4000-8000-000000000202",
    locationResourceId: "d3e00000-0000-4000-8000-000000000102",
    quantity: 3,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000303",
    resourceId: "d3e00000-0000-4000-8000-000000000203",
    locationResourceId: "d3e00000-0000-4000-8000-000000000102",
    quantity: 0,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000304",
    resourceId: "d3e00000-0000-4000-8000-000000000204",
    locationResourceId: "d3e00000-0000-4000-8000-000000000103",
    quantity: 126,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000305",
    resourceId: "d3e00000-0000-4000-8000-000000000205",
    locationResourceId: "d3e00000-0000-4000-8000-000000000103",
    quantity: 34,
  },
]);

export const DEMO_STOCK_UNITS = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000401",
    resourceId: "d3e00000-0000-4000-8000-000000000201",
    code: "ABS-18V-01",
    status: "available",
    location: "Regal A2",
    locationResourceId: "d3e00000-0000-4000-8000-000000000101",
    metadata: { zustand: "einsatzbereit" },
  },
  {
    id: "d3e00000-0000-4000-8000-000000000402",
    resourceId: "d3e00000-0000-4000-8000-000000000201",
    code: "ABS-18V-02",
    status: "in-use",
    location: "Projekt Lastenrad",
    locationResourceId: null,
    metadata: { zustand: "ausgegeben" },
  },
  {
    id: "d3e00000-0000-4000-8000-000000000403",
    resourceId: "d3e00000-0000-4000-8000-000000000203",
    code: "DMM-TRMS-01",
    status: "maintenance",
    location: "Werkbank E1",
    locationResourceId: "d3e00000-0000-4000-8000-000000000102",
    metadata: { wartung: "Kalibrierung" },
  },
]);

export const DEMO_STOCK_MOVEMENTS = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000510",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000101",
    unitId: null,
    delta: 1,
    quantity: 1,
    balanceAfter: 1,
    type: "opening-balance",
    reason: "Ort angelegt",
    note: "Regal als Lagerort in die Werkstattstruktur aufgenommen.",
    location: "Werkstatt Nord",
    fromLocationResourceId: null,
    toLocationResourceId: null,
    daysAgo: 48,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000511",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000102",
    unitId: null,
    delta: 1,
    quantity: 1,
    balanceAfter: 1,
    type: "opening-balance",
    reason: "Ort angelegt",
    note: "Elektronikarbeitsplatz in die Werkstattstruktur aufgenommen.",
    location: "Werkstatt Nord",
    fromLocationResourceId: null,
    toLocationResourceId: null,
    daysAgo: 47,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000512",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000103",
    unitId: null,
    delta: 1,
    quantity: 1,
    balanceAfter: 1,
    type: "opening-balance",
    reason: "Ort angelegt",
    note: "Kleinteilefach im Regal A2 erfasst.",
    location: "Regal A2",
    fromLocationResourceId: null,
    toLocationResourceId: "d3e00000-0000-4000-8000-000000000101",
    daysAgo: 46,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000501",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000201",
    unitId: null,
    delta: 2,
    quantity: 2,
    balanceAfter: 2,
    type: "initial-stock",
    reason: "Erstbestand erfasst",
    note: "Zwei Geräte aus dem Werkstattbestand übernommen.",
    location: "Regal A2",
    fromLocationResourceId: null,
    toLocationResourceId: "d3e00000-0000-4000-8000-000000000101",
    daysAgo: 36,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000502",
    sequence: 2,
    resourceId: "d3e00000-0000-4000-8000-000000000201",
    unitId: "d3e00000-0000-4000-8000-000000000402",
    delta: -1,
    quantity: 1,
    balanceAfter: 1,
    type: "assignment-checkout",
    reason: "Ausgabe an Projekt Lastenrad",
    note: "Gerät 02 mit Akku und Bit-Set ausgegeben.",
    location: "Regal A2",
    fromLocationResourceId: "d3e00000-0000-4000-8000-000000000101",
    toLocationResourceId: null,
    daysAgo: 2,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000503",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000202",
    unitId: null,
    delta: 3,
    quantity: 3,
    balanceAfter: 3,
    type: "initial-stock",
    reason: "Erstbestand erfasst",
    note: "Drei Arbeitsplätze ausgestattet.",
    location: "Werkbank E1",
    fromLocationResourceId: null,
    toLocationResourceId: "d3e00000-0000-4000-8000-000000000102",
    daysAgo: 31,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000504",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000203",
    unitId: null,
    delta: 1,
    quantity: 1,
    balanceAfter: 1,
    type: "initial-stock",
    reason: "Erstbestand erfasst",
    note: "Messgerät mit Prüfleitungssatz übernommen.",
    location: "Werkbank E1",
    fromLocationResourceId: null,
    toLocationResourceId: "d3e00000-0000-4000-8000-000000000102",
    daysAgo: 44,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000505",
    sequence: 2,
    resourceId: "d3e00000-0000-4000-8000-000000000203",
    unitId: "d3e00000-0000-4000-8000-000000000403",
    delta: -1,
    quantity: 1,
    balanceAfter: 0,
    type: "maintenance",
    reason: "Kalibrierung fällig",
    note: "Gerät bis zur Rückgabe aus der Kalibrierung gesperrt.",
    location: "Werkbank E1",
    fromLocationResourceId: "d3e00000-0000-4000-8000-000000000102",
    toLocationResourceId: null,
    daysAgo: 1,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000506",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000204",
    unitId: null,
    delta: 200,
    quantity: 200,
    balanceAfter: 200,
    type: "receipt",
    reason: "Wareneingang",
    note: "Packung zu 200 Stück eingebucht.",
    location: "Fach K3",
    fromLocationResourceId: null,
    toLocationResourceId: "d3e00000-0000-4000-8000-000000000103",
    daysAgo: 24,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000507",
    sequence: 2,
    resourceId: "d3e00000-0000-4000-8000-000000000204",
    unitId: null,
    delta: -74,
    quantity: 74,
    balanceAfter: 126,
    type: "usage",
    reason: "Montage Werkbankwagen",
    note: "74 Stück für drei Werkbankwagen entnommen.",
    location: "Fach K3",
    fromLocationResourceId: "d3e00000-0000-4000-8000-000000000103",
    toLocationResourceId: null,
    daysAgo: 4,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000508",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000205",
    unitId: null,
    delta: 80,
    quantity: 80,
    balanceAfter: 80,
    type: "receipt",
    reason: "Wareneingang",
    note: "Anbruchpackung gezählt und eingebucht.",
    location: "Fach K3",
    fromLocationResourceId: null,
    toLocationResourceId: "d3e00000-0000-4000-8000-000000000103",
    daysAgo: 18,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000509",
    sequence: 2,
    resourceId: "d3e00000-0000-4000-8000-000000000205",
    unitId: null,
    delta: -46,
    quantity: 46,
    balanceAfter: 34,
    type: "usage",
    reason: "Kabelbäume Projekt Lastenrad",
    note: "Bestand liegt jetzt unter dem Mindestwert.",
    location: "Fach K3",
    fromLocationResourceId: "d3e00000-0000-4000-8000-000000000103",
    toLocationResourceId: null,
    daysAgo: 1,
  },
]);

export const DEMO_ASSIGNMENTS = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000601",
    resourceId: "d3e00000-0000-4000-8000-000000000201",
    stockUnitId: "d3e00000-0000-4000-8000-000000000402",
    kind: "checkout",
    status: "active",
    quantity: 1,
    assigneeLabel: "Projekt Lastenrad",
    startsDaysAgo: 2,
    dueDaysFromNow: 5,
    note: "Rückgabe zusammen mit Akku und Bit-Set.",
  },
]);

export const DEMO_PURCHASE_ORDERS = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000701",
    reference: "BN-2026-0815",
    supplier: "Werkstattbedarf · Demo",
    status: "ordered",
    orderedDaysAgo: 1,
    expectedDaysFromNow: 5,
    note: "Nachbestellung aufgrund unterschrittenen Mindestbestands.",
  },
]);

export const DEMO_PURCHASE_ORDER_LINES = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000702",
    purchaseOrderId: "d3e00000-0000-4000-8000-000000000701",
    resourceId: "d3e00000-0000-4000-8000-000000000205",
    orderedQuantity: 100,
    receivedQuantity: 0,
    expectedDaysFromNow: 5,
    note: "1 Packung à 100 Stück.",
  },
]);

export const DEMO_RELATIONS = Object.freeze([
  ["d3e00000-0000-4000-8000-000000000801", "d3e00000-0000-4000-8000-000000000101", "d3e00000-0000-4000-8000-000000000103", "contains"],
  ["d3e00000-0000-4000-8000-000000000802", "d3e00000-0000-4000-8000-000000000101", "d3e00000-0000-4000-8000-000000000201", "contains"],
  ["d3e00000-0000-4000-8000-000000000803", "d3e00000-0000-4000-8000-000000000102", "d3e00000-0000-4000-8000-000000000202", "contains"],
  ["d3e00000-0000-4000-8000-000000000804", "d3e00000-0000-4000-8000-000000000102", "d3e00000-0000-4000-8000-000000000203", "contains"],
  ["d3e00000-0000-4000-8000-000000000805", "d3e00000-0000-4000-8000-000000000103", "d3e00000-0000-4000-8000-000000000204", "contains"],
  ["d3e00000-0000-4000-8000-000000000806", "d3e00000-0000-4000-8000-000000000103", "d3e00000-0000-4000-8000-000000000205", "contains"],
  ["d3e00000-0000-4000-8000-000000000807", "d3e00000-0000-4000-8000-000000000202", "d3e00000-0000-4000-8000-000000000203", "related"],
].map(([id, sourceResourceId, targetResourceId, relationTypeKey]) => ({
  id,
  sourceResourceId,
  targetResourceId,
  relationTypeKey,
})));

export const DEMO_LABEL_SETUP = Object.freeze({
  id: "d3e00000-0000-4000-8000-000000000901",
  name: "Werkstatt 62 × 35 mm",
  widthMm: 62,
  heightMm: 35,
  elements: [
    { type: "qr", x: 3, y: 14, width: 40, height: 72, visible: true },
    { type: "image", x: 3, y: 14, width: 40, height: 72, visible: false, fit: "cover" },
    { type: "name", x: 46, y: 8, width: 51, height: 20, visible: true, fontSizeMm: 3.3, align: "left" },
    { type: "identifier", x: 46, y: 31, width: 51, height: 10, visible: true, fontSizeMm: 2.2, align: "left" },
    { type: "barcode", x: 46, y: 45, width: 51, height: 17, visible: true },
    { type: "url", x: 46, y: 66, width: 51, height: 21, visible: true, fontSizeMm: 1.55, align: "left" },
    { type: "location", x: 46, y: 90, width: 51, height: 7, visible: true, fontSizeMm: 1.55, align: "left" },
  ],
});

export const DEMO_MEDIA = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000a01",
    resourceId: "d3e00000-0000-4000-8000-000000000201",
    filename: "trades-tool-case.webp",
    sha256: "ea0a0b4061ec22e1163b70c3d70b1a9d6bfa7c9309e5b3bd0df94a0556b1d02a",
    width: 1800,
    height: 1202,
    altText: "Kontextfoto eines geöffneten Werkzeugkoffers; nicht das konkrete Inventarobjekt.",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000a02",
    resourceId: "d3e00000-0000-4000-8000-000000000202",
    filename: "electronics-soldering.webp",
    sha256: "74487813e265cb1405c28a7f4143775550bd05154a910ad7252b77c98572d3c2",
    width: 1800,
    height: 1200,
    altText: "Kontextfoto eines Elektronikarbeitsplatzes; nicht die konkrete Lötstation.",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000a03",
    resourceId: "d3e00000-0000-4000-8000-000000000204",
    filename: "parts-storage-bins.webp",
    sha256: "5938f8efcdca22510ec1ce159c38f42a8df0e1fdd11b4eae01ee15f058366d29",
    width: 1800,
    height: 1202,
    altText: "Kontextfoto von Kleinteilebehältern; nicht der konkrete Lagerbestand.",
  },
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDemoSeedManifest() {
  const errors = [];
  const stableIds = [
    DEMO_ORGANIZATION.id,
    DEMO_USER.id,
    ...DEMO_RESOURCES.map(({ id }) => id),
    ...DEMO_LOCATION_BALANCES.map(({ id }) => id),
    ...DEMO_STOCK_UNITS.map(({ id }) => id),
    ...DEMO_STOCK_MOVEMENTS.map(({ id }) => id),
    ...DEMO_ASSIGNMENTS.map(({ id }) => id),
    ...DEMO_PURCHASE_ORDERS.map(({ id }) => id),
    ...DEMO_PURCHASE_ORDER_LINES.map(({ id }) => id),
    ...DEMO_RELATIONS.map(({ id }) => id),
    DEMO_LABEL_SETUP.id,
    ...DEMO_MEDIA.map(({ id }) => id),
  ];
  for (const id of stableIds) {
    if (!UUID_PATTERN.test(id)) errors.push(`Invalid stable UUID: ${id}`);
  }
  if (new Set(stableIds).size !== stableIds.length) {
    errors.push("Stable UUIDs must be globally unique.");
  }

  if (
    DEMO_ORGANIZATION.slug !== "demo" ||
    DEMO_ORGANIZATION.name !== "Werkstatt Nord · Demo" ||
    !DEMO_ORGANIZATION.isReadOnly
  ) {
    errors.push("The public demo organization contract changed.");
  }
  if (
    DEMO_USER.email !== "demo@inventory.invalid" ||
    DEMO_USER.role !== "viewer"
  ) {
    errors.push("The dedicated demo user must remain a viewer with its reserved email.");
  }

  const resourceIds = new Set(DEMO_RESOURCES.map(({ id }) => id));
  const itemResources = DEMO_RESOURCES.filter(({ kind }) => kind === "item");
  if (itemResources.length !== 5) errors.push("The demo must contain exactly five inventory items.");
  if (DEMO_RESOURCES.filter(({ kind }) => kind === "place").length !== 3) {
    errors.push("The demo must contain exactly three places.");
  }
  for (const field of ["sku", "barcode"]) {
    const values = DEMO_RESOURCES.map((resource) => resource[field]).filter(Boolean);
    if (new Set(values).size !== values.length) errors.push(`Resource ${field} values must be unique.`);
  }

  for (const settings of DEMO_STOCK_SETTINGS) {
    if (!resourceIds.has(settings.resourceId)) errors.push(`Unknown stock resource: ${settings.resourceId}`);
  }
  if (DEMO_STOCK_SETTINGS.length !== itemResources.length) {
    errors.push("Every demo item needs stock settings.");
  }
  for (const balance of DEMO_LOCATION_BALANCES) {
    if (!resourceIds.has(balance.resourceId) || !resourceIds.has(balance.locationResourceId)) {
      errors.push(`Unknown stock balance resource: ${balance.id}`);
    }
  }

  const unitById = new Map(DEMO_STOCK_UNITS.map((unit) => [unit.id, unit]));
  for (const movement of DEMO_STOCK_MOVEMENTS) {
    if (!resourceIds.has(movement.resourceId)) errors.push(`Unknown movement resource: ${movement.id}`);
    if (movement.unitId && !unitById.has(movement.unitId)) errors.push(`Unknown movement unit: ${movement.id}`);
  }
  for (const resource of DEMO_RESOURCES) {
    if (!Number.isInteger(resource.updatedDaysAgo) || resource.updatedDaysAgo < 0) {
      errors.push(`Invalid resource update age: ${resource.sku}`);
    }
    const history = DEMO_STOCK_MOVEMENTS
      .filter((movement) => movement.resourceId === resource.id)
      .sort((left, right) => left.sequence - right.sequence);
    let balance = 0;
    for (const movement of history) {
      balance += movement.delta;
      if (movement.balanceAfter !== balance) errors.push(`Movement balance mismatch: ${movement.id}`);
    }
    if (history.length === 0 || balance !== resource.quantity) {
      errors.push(`Current resource quantity does not match movement history: ${resource.sku}`);
    }
  }

  const assignment = DEMO_ASSIGNMENTS[0];
  const assignedUnit = assignment && unitById.get(assignment.stockUnitId);
  if (!assignment || assignedUnit?.status !== "in-use" || assignedUnit.resourceId !== assignment.resourceId) {
    errors.push("The drill checkout and serialized unit must stay coherent.");
  }

  const cableTies = itemResources.find(({ sku }) => sku === "VERB-KB-200-S");
  const cableSettings = DEMO_STOCK_SETTINGS.find(
    ({ resourceId }) => resourceId === cableTies?.id,
  );
  const cableLine = DEMO_PURCHASE_ORDER_LINES.find(
    ({ resourceId }) => resourceId === cableTies?.id,
  );
  if (
    !cableTies ||
    !cableSettings ||
    cableTies.quantity >= cableSettings.minimumStock ||
    cableLine?.orderedQuantity !== 100
  ) {
    errors.push("The low-stock cable-tie story and open replenishment order must stay coherent.");
  }

  for (const relation of DEMO_RELATIONS) {
    if (!resourceIds.has(relation.sourceResourceId) || !resourceIds.has(relation.targetResourceId)) {
      errors.push(`Unknown relation resource: ${relation.id}`);
    }
  }
  for (const media of DEMO_MEDIA) {
    if (!resourceIds.has(media.resourceId)) errors.push(`Unknown media resource: ${media.id}`);
    if (!/^[0-9a-f]{64}$/.test(media.sha256)) errors.push(`Invalid media checksum: ${media.filename}`);
  }

  return errors;
}

export function validateDemoRemovalState({
  configuration,
  organization,
  user,
  organizationMemberships,
  userMemberships,
}) {
  const errors = [];
  if (organization) {
    if (
      organization.id !== DEMO_ORGANIZATION.id ||
      organization.name !== DEMO_ORGANIZATION.name ||
      organization.slug !== configuration.slug ||
      organization.is_read_only !== true
    ) {
      errors.push(
        "The fixed demo organization no longer matches its expected ID, name, slug, and read-only flag.",
      );
    }
    if (user) {
      if (
        organizationMemberships.length !== 1 ||
        organizationMemberships[0].user_id !== DEMO_USER.id ||
        organizationMemberships[0].role_key !== "viewer" ||
        organizationMemberships[0].is_active !== true
      ) {
        errors.push(
          "The demo organization membership set is not the expected single active viewer.",
        );
      }
    } else if (organizationMemberships.length !== 0) {
      errors.push(
        "The demo organization has memberships although its dedicated user is missing.",
      );
    }
  }

  if (user) {
    if (
      user.id !== DEMO_USER.id ||
      user.email !== configuration.email ||
      user.name !== DEMO_USER.name ||
      user.role !== "viewer"
    ) {
      errors.push("The fixed demo user no longer matches its expected identity.");
    }
    if (organization) {
      if (
        userMemberships.length !== 1 ||
        userMemberships[0].organization_id !== DEMO_ORGANIZATION.id ||
        userMemberships[0].role_key !== "viewer" ||
        userMemberships[0].is_active !== true
      ) {
        errors.push(
          "The fixed demo user does not have exactly its expected active viewer membership.",
        );
      }
    } else if (userMemberships.length !== 0) {
      errors.push(
        "The fixed demo user has another membership although the demo organization is missing.",
      );
    }
  }
  return errors;
}
