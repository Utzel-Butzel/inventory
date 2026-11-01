export const DEMO_SEED_VERSION = 6;

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

export const DEMO_FAVORITE_RESOURCE_IDS = Object.freeze([
  "d3e00000-0000-4000-8000-000000000201",
  "d3e00000-0000-4000-8000-000000000202",
]);

const demoGridViewConfig = {
  query: "",
  filters: { type: "all", status: "all", priority: "all", tag: "all", category: "all", excludeCategory: "all" },
  sort: "updatedAt",
  direction: "desc",
  layout: "grid",
  density: "compact",
  pageSize: 50,
  columns: ["name", "quantity", "location", "status"],
};

export const DEMO_LIST_VIEWS = Object.freeze([
  { scope: "inventory", id: "d3e00000-0000-4000-8000-000000000b01" },
  { scope: "inventory.favorites", id: "d3e00000-0000-4000-8000-000000000b02" },
].map(({ scope, id }) => ({
  scope,
  collection: {
    views: [{ id, name: "Raster", config: demoGridViewConfig }],
    defaultId: id,
  },
})));

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
    description: "Zentrales Materialregal an der Nordwand der Werkstatt Nord. Hier lagern die Akku-Bohrschrauber mit Zubehör und das Kleinteilefach K3 für Schrauben und Kabelbinder.",
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
    notes: "Werkzeugkoffer auf den unteren Böden abstellen, Kleinteile im Fach K3 einsortieren. Ausgeliehene Geräte nach der Rückgabe mit Akku und Zubehör auf Vollständigkeit prüfen. Traglast je Fach: 120 kg.",
    updatedDaysAgo: 21,
    kind: "place",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000102",
    name: "Werkbank E1",
    description: "Elektronikarbeitsplatz für Reparaturen und Prototypen mit ESD-Matte, Lötstationen und Absaugung. Hier ist auch das Digitalmultimeter für die nächste Kalibrierung hinterlegt.",
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
    notes: "Absaugung vor Lötarbeiten einschalten und die Arbeitsfläche nach Gebrauch freiräumen. Das Digitalmultimeter ist zur Kalibrierung vorgemerkt und bis zur Freigabe nicht verfügbar.",
    updatedDaysAgo: 18,
    kind: "place",
  },
  {
    id: "d3e00000-0000-4000-8000-000000000103",
    name: "Fach K3",
    description: "Übersichtliches Kleinteilefach im Regal A2 mit blauen Sichtlagerkästen für Schrauben M4×20 und einer separaten Schale für schwarze Kabelbinder. Verbrauchsmaterial ist hier direkt griffbereit.",
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
    notes: "Schrauben und Kabelbinder getrennt einsortieren und Entnahmen im Bestand buchen. Die Kabelbinder liegen unter dem Mindestbestand; eine Nachbestellung über 100 Stück ist bereits unterwegs.",
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
    notes: "Die Historie zeigt vier abgeschlossene Ausleihen mit Rückgaben. Gerät 02 ist aktuell für das Projekt Lastenrad ausgegeben; Gerät 01 liegt einsatzbereit in Regal A2.",
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
    notes: "Von zwei auf drei Arbeitsplätze erweitert. Nach Workshop-Ausleihen und einem Netzteilwechsel sind alle drei Stationen wieder verfügbar. Spitzen nach Gebrauch reinigen und verzinnen.",
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
    notes: "Die Historie zeigt Außeneinsatz, Prüfleitungstausch und die aktuelle Kalibrierung. Bis zur Freigabe nicht verwenden; die Sperre ist kein Verbrauch.",
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
    notes: "Regelmäßiger Montageverbrauch mit zwei Nachlieferungen à 200 Stück, einer Materialrückgabe und einer Inventurkorrektur. Aktuell 126 Stück in Fach K3; Bedarf für die nächste Wagenserie prüfen.",
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
    notes: "Der Bedarf ist durch die Lastenrad-Vorserie zuletzt deutlich gestiegen. Nur noch 34 Stück verfügbar, 100 Stück werden in fünf Tagen erwartet. Bei weiterem Verbrauch droht bereits kurz vor der Lieferung eine Lücke.",
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

// Events run oldest to newest. Derive balances from bookings rather than
// inventing chart points; the forecast reads this same ledger in production.
function demoStockHistory(sku, idBase, events) {
  const resource = DEMO_RESOURCES.find((entry) => entry.sku === sku);
  const locationId = DEMO_LOCATION_BALANCES.find((entry) => entry.resourceId === resource.id)?.locationResourceId ?? null;
  let balance = 0;
  return events.map(([daysAgo, delta, type, reason, note, unitCode], index) => {
    const unit = unitCode ? DEMO_STOCK_UNITS.find((entry) => entry.code === unitCode) : null;
    if (unitCode && !unit) throw new Error(`Unknown demo stock unit: ${unitCode}`);
    balance += delta;
    return {
      id: `d3e00000-0000-4000-8000-${(idBase + index + 1).toString(16).padStart(12, "0")}`,
      sequence: index + 1,
      resourceId: resource.id,
      unitId: unit?.id ?? null,
      delta,
      quantity: Math.abs(delta),
      balanceAfter: balance,
      type,
      reason,
      note,
      location: resource.location,
      fromLocationResourceId: delta < 0 ? locationId : null,
      toLocationResourceId: delta > 0 ? locationId : null,
      daysAgo,
    };
  });
}

export const DEMO_STOCK_MOVEMENTS = Object.freeze([
  {
    id: "d3e00000-0000-4000-8000-000000000510",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000101",
    unitId: null,
    delta: 1,
    quantity: 1,
    balanceAfter: 1,
    type: "opening_balance",
    reason: "Ort angelegt",
    note: "Regal als Lagerort in die Werkstattstruktur aufgenommen.",
    location: "Werkstatt Nord",
    fromLocationResourceId: null,
    toLocationResourceId: null,
    daysAgo: 125,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000511",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000102",
    unitId: null,
    delta: 1,
    quantity: 1,
    balanceAfter: 1,
    type: "opening_balance",
    reason: "Ort angelegt",
    note: "Elektronikarbeitsplatz in die Werkstattstruktur aufgenommen.",
    location: "Werkstatt Nord",
    fromLocationResourceId: null,
    toLocationResourceId: null,
    daysAgo: 124,
  },
  {
    id: "d3e00000-0000-4000-8000-000000000512",
    sequence: 1,
    resourceId: "d3e00000-0000-4000-8000-000000000103",
    unitId: null,
    delta: 1,
    quantity: 1,
    balanceAfter: 1,
    type: "opening_balance",
    reason: "Ort angelegt",
    note: "Kleinteilefach im Regal A2 erfasst.",
    location: "Regal A2",
    fromLocationResourceId: null,
    toLocationResourceId: "d3e00000-0000-4000-8000-000000000101",
    daysAgo: 123,
  },
  ...demoStockHistory("WERK-ABS-18V", 0xc00, [
    [95, 2, "opening_balance", "Werkstattbestand übernommen", "Zwei einsatzbereite Geräte mit Akkus und Ladegerät erfasst."],
    [80, -1, "assignment-checkout", "Ausleihe: Regalaufbau", "Gerät 01 für den Aufbau der Materialregale ausgegeben.", "ABS-18V-01"],
    [77, 1, "assignment-return", "Rückgabe: Regalaufbau", "Gerät 01 vollständig und mit geladenem Akku zurück.", "ABS-18V-01"],
    [65, -1, "assignment-checkout", "Ausleihe: Repair-Café", "Gerät 02 für das mobile Reparaturteam ausgegeben.", "ABS-18V-02"],
    [61, 1, "assignment-return", "Rückgabe: Repair-Café", "Gerät 02 gereinigt und mit vollständigem Bit-Set zurück.", "ABS-18V-02"],
    [45, -1, "assignment-checkout", "Ausleihe: Prüfstandbau", "Gerät 01 für die Montage eines Prüfstands ausgegeben.", "ABS-18V-01"],
    [42, 1, "assignment-return", "Rückgabe: Prüfstandbau", "Prüfstand fertig; Gerät 01 wieder in Regal A2.", "ABS-18V-01"],
    [22, -1, "assignment-checkout", "Ausleihe: Werkbankwagen", "Gerät 02 für die Vormontage der Wagen ausgegeben.", "ABS-18V-02"],
    [18, 1, "assignment-return", "Rückgabe: Werkbankwagen", "Gerät 02 und Zubehör vollständig zurück.", "ABS-18V-02"],
    [2, -1, "assignment-checkout", "Ausgabe an Projekt Lastenrad", "Gerät 02 mit Akku und Bit-Set ausgegeben; Rückgabe in fünf Tagen.", "ABS-18V-02"],
  ]),
  ...demoStockHistory("ELEK-LOET-80W", 0xd00, [
    [95, 2, "opening_balance", "Elektronikplätze ausgestattet", "Zwei Lötstationen aus dem Werkstattbestand übernommen."],
    [64, 1, "receipt", "Dritter Lötarbeitsplatz", "Eine neue Station für den Prototypenplatz geliefert und geprüft."],
    [52, -2, "assignment-checkout", "Ausleihe: Lötworkshop", "Zwei Stationen samt Ablagen für einen dreitägigen Workshop ausgegeben."],
    [49, 2, "assignment-return", "Rückgabe: Lötworkshop", "Beide Stationen funktionsgeprüft und wieder an Werkbank E1."],
    [28, -1, "assignment-checkout", "Ausleihe: Repair-Café", "Eine Station für Reparaturen an Radios und Leuchten bereitgestellt."],
    [24, 1, "assignment-return", "Rückgabe: Repair-Café", "Station mit gereinigter Lötspitze zurückgegeben."],
    [12, -1, "adjustment", "Station vorübergehend gesperrt", "Netzteil defekt; eine Station aus dem verfügbaren Bestand genommen."],
    [6, 1, "return", "Reparierte Station zurück", "Netzteil ersetzt, Schutzleiterprüfung bestanden; wieder drei Stationen verfügbar."],
  ]),
  ...demoStockHistory("MESS-DMM-TRMS", 0xe00, [
    [95, 1, "opening_balance", "Messgerät übernommen", "Digitalmultimeter mit Prüfleitungssatz und gültigem Prüfnachweis erfasst."],
    [70, -1, "assignment-checkout", "Ausleihe: mobile Fehlersuche", "Messgerät für die Diagnose an der Werkstattbeleuchtung ausgegeben.", "DMM-TRMS-01"],
    [66, 1, "assignment-return", "Rückgabe: mobile Fehlersuche", "Messgerät und Prüfleitungssatz vollständig zurück.", "DMM-TRMS-01"],
    [42, -1, "unit-status", "Defekte Prüfleitung", "Messgerät bis zum Austausch der beschädigten Leitung gesperrt.", "DMM-TRMS-01"],
    [37, 1, "unit-status", "Messgerät wieder freigegeben", "Neue Prüfleitung montiert, Funktionsprüfung bestanden.", "DMM-TRMS-01"],
    [1, -1, "unit-status", "Kalibrierung fällig", "Gerät bis zur Rückgabe aus der beauftragten Kalibrierung gesperrt.", "DMM-TRMS-01"],
  ]),
  ...demoStockHistory("VERB-M4X20-A2", 0xf00, [
    [95, 200, "opening_balance", "Kleinteilebestand gezählt", "Eine Packung mit 200 Schrauben als Anfangsbestand erfasst."],
    [88, -18, "issue", "Montage: Monitorhalter", "18 Schrauben für drei Halterungen an den Prüfplätzen verbaut."],
    [82, -24, "issue", "Montage: Prüfadapter", "Sechs Prüfadapter mit jeweils vier Schrauben montiert."],
    [76, -32, "issue", "Prototypen: Sensorgehäuse", "Acht Sensorgehäuse verschraubt."],
    [71, -20, "issue", "Repair-Café: Gehäusereparaturen", "20 Schrauben für fünf Reparaturen entnommen."],
    [65, -36, "issue", "Montage: Prototypenträger", "Neun Trägerplatten für die Versuchsreihe vorbereitet."],
    [60, 200, "receipt", "Wareneingang: M4-Schrauben", "Eine weitere Packung mit 200 Stück geliefert und in Fach K3 einsortiert."],
    [57, -28, "issue", "Montage: Wagenhalter", "Sieben Halterungen für mobile Werkzeugwagen montiert."],
    [52, -16, "issue", "Reparatur: Netzteilgehäuse", "Vier Gehäuse nach der Reparatur wieder verschraubt."],
    [47, -42, "issue", "Projekt Lastenrad: Träger", "42 Schrauben für die Trägermontage ausgegeben."],
    [43, 12, "return", "Unbenutzte Schrauben zurück", "Zwölf unbenutzte Schrauben aus der Trägermontage zurückgezählt."],
    [40, -30, "issue", "Montage: Bohrschablonen", "Sechs Schablonen für die Werkstatt gefertigt."],
    [35, -22, "issue", "Reparatur: Schutzabdeckungen", "Abdeckungen an zwei Maschinen erneuert."],
    [31, -18, "issue", "Montage: Kabelkanalhalter", "Sechs Halter am Elektronikarbeitsplatz angebracht."],
    [26, 200, "receipt", "Wareneingang vor Wagenserie", "200 Stück für die anstehenden Montageaufträge nachgeliefert."],
    [24, -36, "issue", "Montage: Gerätehalter", "Neun Halterungen für die Werkstattwagen aufgebaut."],
    [20, -28, "issue", "Montage: Rollenaufnahmen", "Rollenaufnahmen und Adapterplatten verschraubt."],
    [16, -32, "issue", "Prototypen: Steuergehäuse", "Acht Steuergehäuse geschlossen."],
    [12, -24, "issue", "Reparatur: Messplatz", "Sechs Aufnahmen am Messplatz ersetzt."],
    [9, -4, "waste", "Beschädigte Gewinde aussortiert", "Vier Schrauben mit beschädigten Gewinden entsorgt."],
    [7, -74, "issue", "Endmontage: drei Werkbankwagen", "74 Stück für die Endmontage der drei Wagen verbaut."],
    [4, -2, "adjustment", "Inventurkorrektur Fach K3", "Beim Nachzählen zwei Stück Fehlbestand festgestellt; korrigierter Bestand: 126."],
  ]),
  ...demoStockHistory("VERB-KB-200-S", 0x1000, [
    [95, 150, "opening_balance", "Kabelbinderbestand gezählt", "Eine volle Packung und 50 Stück Restbestand übernommen."],
    [89, -8, "issue", "Verdrahtung: Prüfadapter", "Acht Kabelbinder für die Zugentlastung eingesetzt."],
    [83, -10, "issue", "Verdrahtung: Sensorleitungen", "Leitungen an zwei Testaufbauten gebündelt."],
    [77, -12, "issue", "Wartung: Ladeplätze", "Ladekabel an drei Werkstattplätzen neu geführt."],
    [71, -8, "issue", "Repair-Café: Leuchten", "Neue Zugentlastungen an vier Leuchten befestigt."],
    [65, -14, "issue", "Montage: Werkstattregale", "Stromleitungen an den Materialregalen befestigt."],
    [59, -10, "issue", "Reparatur: E-Bike-Kabel", "Lose Leitungen an zwei Rädern neu verlegt."],
    [53, -12, "issue", "Prototyp: Steuerbox", "Kabelbaum in der ersten Steuerbox fixiert."],
    [47, -16, "issue", "Montage: Präsentationsstand", "Versorgungsleitungen am mobilen Stand gesichert."],
    [45, 100, "receipt", "Wareneingang: Kabelbinder", "Eine Packung à 100 Stück geliefert."],
    [35, -16, "issue", "Montage: LED-Arbeitsplätze", "Kabel an vier neuen Leuchten befestigt."],
    [29, -22, "issue", "Projekt Lastenrad: Prototyp", "Erster vollständiger Kabelbaum am Lastenrad verlegt."],
    [28, -14, "issue", "Projekt Lastenrad: Prüfstand", "Zusätzliche Leitungen am Belastungsprüfstand fixiert."],
    [25, -26, "issue", "Projekt Lastenrad: zweite Baugruppe", "Beleuchtung, Sensoren und Ladeleitung gebündelt."],
    [21, -30, "issue", "Projekt Lastenrad: Vorserie", "Zwei Kabelbäume für die erste Vorserie vorbereitet."],
    [18, 100, "receipt", "Nachlieferung für die Vorserie", "100 Stück eingetroffen und vor Serienstart eingelagert."],
    [16, -28, "issue", "Projekt Lastenrad: Montage", "Kabelbäume an zwei weiteren Rädern befestigt."],
    [13, 6, "return", "Unbenutztes Material zurück", "Sechs noch offene Kabelbinder aus dem Montagekit zurückgelegt."],
    [12, -32, "issue", "Projekt Lastenrad: zweite Serie", "Zwei weitere Räder fertig verdrahtet."],
    [8, -28, "issue", "Nacharbeit: Beleuchtung", "Geänderte Leitungsführung an der Vorserie befestigt."],
    [5, -4, "waste", "Beschädigte Rastköpfe", "Vier beschädigte Kabelbinder aussortiert."],
    [3, -32, "issue", "Projekt Lastenrad: Abschlussmontage", "Noch 34 Stück verfügbar; Nachbestellung über 100 Stück ist offen."],
  ]),
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
    "id": "d3e00000-0000-4000-8000-000000000a01",
    "resourceId": "d3e00000-0000-4000-8000-000000000201",
    "filename": "generated-drill.webp",
    "sha256": "5bd6c0c691b07d0e09c4d4d9cec1374ef75820b988a6418019801a6add86632b",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild eines Akku-Bohrschraubers im Werkzeugkoffer.",
    "position": 0
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a02",
    "resourceId": "d3e00000-0000-4000-8000-000000000202",
    "filename": "generated-soldering.webp",
    "sha256": "2696d5a6d0793c06a3f7a9647a972d7b76d456b2f3d9fe195dbe156cabc3c5f8",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild einer Lötstation am Elektronikarbeitsplatz.",
    "position": 0
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a03",
    "resourceId": "d3e00000-0000-4000-8000-000000000204",
    "filename": "generated-screws.webp",
    "sha256": "ede69a989c0f34c6d38f6de21db1ffa639209110b2c56989b8289728346d100e",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild von Schrauben in Kleinteilebehältern.",
    "position": 0
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a04",
    "resourceId": "d3e00000-0000-4000-8000-000000000203",
    "filename": "generated-multimeter.webp",
    "sha256": "a32bfa1c3afa7c9d1f5a16dca969868831b0659bd32cba05dcfa1d7f8408e011",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild eines Digitalmultimeters mit Messleitungen.",
    "position": 0
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a05",
    "resourceId": "d3e00000-0000-4000-8000-000000000205",
    "filename": "generated-cable-ties.webp",
    "sha256": "e4526c0648744e79bc40651e3d2dc96c0af85c941dae41f4152103881f7f476f",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild schwarzer Kabelbinder in einer Ablageschale.",
    "position": 0
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a06",
    "resourceId": "d3e00000-0000-4000-8000-000000000101",
    "filename": "generated-shelf.webp",
    "sha256": "fdc2bbd8f22bbdd685162d0d22210522e8162b1a4b9987f3486b5e66a8ddb176",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild von Regal A2 mit Werkzeugkoffern, Akkugeräten und blauen Kleinteilekästen.",
    "position": 0
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a07",
    "resourceId": "d3e00000-0000-4000-8000-000000000102",
    "filename": "generated-workbench.webp",
    "sha256": "a4302c20cd8c35bbf5bb2988445f7070a886d0b51a382b9faec7741878649e62",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild von Werkbank E1 mit blauer ESD-Matte, Lötstation, Absaugung und Multimeter.",
    "position": 0
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a08",
    "resourceId": "d3e00000-0000-4000-8000-000000000103",
    "filename": "generated-parts-bin.webp",
    "sha256": "6ee159ebeb2b68c58150061a6292751ec122abfc0830382ecb44e212ec1f8b52",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild von Fach K3 mit sortierten Schrauben, Muttern, Unterlegscheiben und Kabelbindern.",
    "position": 0
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a11",
    "resourceId": "d3e00000-0000-4000-8000-000000000201",
    "filename": "generated-drill-perspective.webp",
    "sha256": "e0c510ec48bdd8049e87506ac39fa603c493fdfef0daf49f30397aaadec8119e",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Akku-Bohrschrauber aus seitlicher Perspektive mit Akku, Ladegerät und geöffnetem Werkzeugkoffer.",
    "position": 1
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a12",
    "resourceId": "d3e00000-0000-4000-8000-000000000201",
    "filename": "generated-drill-detail.webp",
    "sha256": "6fa78017eb57eccace2c42bb757004f7df0d721fec7143bf47055f7c99b27a8f",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Detailansicht des Akku-Bohrschraubers mit Schnellspannfutter, Drehmomentring und Griff.",
    "position": 2
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a13",
    "resourceId": "d3e00000-0000-4000-8000-000000000202",
    "filename": "generated-soldering-perspective.webp",
    "sha256": "05724396775eea383bde1c576468f8a53fa786b354742645d6c476834d112f20",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Lötstation mit Ablage, Spitzenreiniger und Lötzinn aus erhöhter Perspektive.",
    "position": 1
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a14",
    "resourceId": "d3e00000-0000-4000-8000-000000000202",
    "filename": "generated-soldering-detail.webp",
    "sha256": "23386cdef63cf3e3aa4d08f7adf02b075e4c74686496caeb3ff969881b23488a",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Detailansicht von Lötkolben, sicherer Ablage und Messing-Spitzenreiniger.",
    "position": 2
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a15",
    "resourceId": "d3e00000-0000-4000-8000-000000000203",
    "filename": "generated-multimeter-perspective.webp",
    "sha256": "f260dbc42402fdda3ad4d0c0814ca0032e35ccb1b0f23a69b12ccbfeeb5c7086",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Digitalmultimeter und rote sowie schwarze Messleitungen in der Draufsicht.",
    "position": 1
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a16",
    "resourceId": "d3e00000-0000-4000-8000-000000000203",
    "filename": "generated-multimeter-detail.webp",
    "sha256": "5aaf772b29b48158ef7e61156bb2ad2627471d694737af41837bfbdefe8c769c",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Detailansicht von Drehschalter, Messbuchsen und Prüfspitzen des Digitalmultimeters.",
    "position": 2
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a17",
    "resourceId": "d3e00000-0000-4000-8000-000000000204",
    "filename": "generated-screws-perspective.webp",
    "sha256": "e7cb5c14763129719929d25a0e631f08e387e342aec80d769492666545da352b",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Schrauben, Muttern und Unterlegscheiben in getrennten blauen Behältern von oben.",
    "position": 1
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a18",
    "resourceId": "d3e00000-0000-4000-8000-000000000204",
    "filename": "generated-screws-detail.webp",
    "sha256": "a2861a08cf5da51fb4588bb56d3a184d066e1408647e504fcfb2952ed2c7cd71",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Nahaufnahme der M4-Schrauben mit Innensechskant, Gewinde, Mutter und Unterlegscheibe.",
    "position": 2
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a19",
    "resourceId": "d3e00000-0000-4000-8000-000000000205",
    "filename": "generated-cable-ties-perspective.webp",
    "sha256": "4d138dd0f53fbe81d180a6f506cf47f4bdbb048ccc2a8362e1e87657b9026c15",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Schwarze Kabelbinder als Bündel, Einzelteile und lose Schlaufe in der Draufsicht.",
    "position": 1
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a1a",
    "resourceId": "d3e00000-0000-4000-8000-000000000205",
    "filename": "generated-cable-ties-detail.webp",
    "sha256": "82150e8434462d4438843d71e6c1eada10a315c77e93d227bb7e9c3eac345be5",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Detailansicht der Verschlussköpfe und Verzahnung schwarzer Kabelbinder.",
    "position": 2
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a1b",
    "resourceId": "d3e00000-0000-4000-8000-000000000101",
    "filename": "generated-shelf-perspective.webp",
    "sha256": "fca35db0ca92fd1be5037786d3a0c4f6d51ada53f3bdab73a9c7bf4ea9626932",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Regal A2 in der Frontalansicht mit Kleinteilekästen und Werkzeugkoffern.",
    "position": 1
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a1c",
    "resourceId": "d3e00000-0000-4000-8000-000000000101",
    "filename": "generated-shelf-detail.webp",
    "sha256": "fd2e69d8755f2c08097d8890cae1a513d23db5e20c507e28b49eee6ee0fcd6b8",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Detailansicht der Werkzeugkoffer und unteren Lagerböden im Regal A2.",
    "position": 2
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a1d",
    "resourceId": "d3e00000-0000-4000-8000-000000000102",
    "filename": "generated-workbench-perspective.webp",
    "sha256": "65777cb18298f8ccff1a2188f5265999ab42d6bd7eb16aec2740ae8155928f43",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Werkbank E1 aus erhöhter Perspektive mit ESD-Arbeitsfläche und Elektronikwerkzeugen.",
    "position": 1
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a1e",
    "resourceId": "d3e00000-0000-4000-8000-000000000102",
    "filename": "generated-workbench-detail.webp",
    "sha256": "98e622df9f16d68a5a37713011570d2c620ae2cce14b58a82edcf7d79db726f0",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Detailansicht des Lötbereichs an Werkbank E1 mit Absaugung und ESD-Matte.",
    "position": 2
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a1f",
    "resourceId": "d3e00000-0000-4000-8000-000000000103",
    "filename": "generated-parts-bin-perspective.webp",
    "sha256": "f6c8debceea89c9fb9687c6dcdb92caa5538648ddc24281da67a67b3372a3a34",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Fach K3 aus erhöhter Perspektive mit Einblick in die sortierten Materialbehälter.",
    "position": 1
  },
  {
    "id": "d3e00000-0000-4000-8000-000000000a20",
    "resourceId": "d3e00000-0000-4000-8000-000000000103",
    "filename": "generated-parts-bin-detail.webp",
    "sha256": "8a9c2fbfd9ff0b7f09b5d98c64ff602fbe0a705d5634b8856eab19fbfc60ae65",
    "width": 1536,
    "height": 1024,
    "altText": "KI-generiertes Demobild: Detailansicht der griffbereiten Sichtlagerkästen und Kabelbinderschale in Fach K3.",
    "position": 2
  }
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDemoSeedManifest() {
  const errors = [];
  const stableIds = [
    DEMO_ORGANIZATION.id,
    DEMO_USER.id,
    ...DEMO_LIST_VIEWS.flatMap(({ collection }) => collection.views.map(({ id }) => id)),
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
  if (new Set(DEMO_FAVORITE_RESOURCE_IDS).size !== 2 || DEMO_FAVORITE_RESOURCE_IDS.length !== 2) {
    errors.push("The demo must have exactly two distinct favorites.");
  }
  for (const id of DEMO_FAVORITE_RESOURCE_IDS) {
    if (!itemResources.some((resource) => resource.id === id)) {
      errors.push(`Unknown demo favorite item: ${id}`);
    }
  }
  for (const { scope, collection } of DEMO_LIST_VIEWS) {
    if (collection.views.find(({ id }) => id === collection.defaultId)?.config.layout !== "grid") {
      errors.push(`Demo list needs a default grid view: ${scope}`);
    }
  }
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
    if (movement.unitId && unitById.get(movement.unitId)?.resourceId !== movement.resourceId) {
      errors.push(`Unknown or mismatched movement unit: ${movement.id}`);
    }
    if (!Number.isInteger(movement.daysAgo) || movement.daysAgo < 0 || movement.quantity !== Math.abs(movement.delta)) {
      errors.push(`Invalid movement age or quantity: ${movement.id}`);
    }
  }
  for (const resource of DEMO_RESOURCES) {
    if (!Number.isInteger(resource.updatedDaysAgo) || resource.updatedDaysAgo < 0) {
      errors.push(`Invalid resource update age: ${resource.sku}`);
    }
    const history = DEMO_STOCK_MOVEMENTS
      .filter((movement) => movement.resourceId === resource.id)
      .sort((left, right) => left.sequence - right.sequence);
    let balance = 0;
    let previousDaysAgo = Infinity;
    for (const movement of history) {
      balance += movement.delta;
      if (movement.balanceAfter !== balance) errors.push(`Movement balance mismatch: ${movement.id}`);
      if (balance < 0 || movement.daysAgo >= previousDaysAgo) {
        errors.push(`Negative balance or nonchronological movement: ${movement.id}`);
      }
      previousDaysAgo = movement.daysAgo;
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
  for (const resource of DEMO_RESOURCES) {
    const images = DEMO_MEDIA.filter(({ resourceId }) => resourceId === resource.id);
    const positions = images.map(({ position }) => position).sort((left, right) => left - right);
    if (positions.length !== 3 || positions.some((position, index) => position !== index)) {
      errors.push(`Demo resource needs three images at positions 0, 1, 2: ${resource.sku}`);
    }
    if (new Set(images.map(({ sha256 }) => sha256)).size !== images.length) {
      errors.push(`Duplicate demo gallery image: ${resource.sku}`);
    }
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
