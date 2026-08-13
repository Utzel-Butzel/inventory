import type { LucideIcon } from "lucide-react";
import {
  Barcode,
  Boxes,
  Braces,
  Camera,
  ClipboardCheck,
  Container,
  Database,
  FileSpreadsheet,
  Fingerprint,
  Github,
  Globe2,
  History,
  ImageIcon,
  Languages,
  Layers3,
  Link2,
  ListChecks,
  MapPinned,
  PackageCheck,
  PackageOpen,
  QrCode,
  ScanLine,
  Search,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tags,
  Users,
  WandSparkles,
} from "lucide-react";

export type FeatureSlug =
  | "erfassen"
  | "strukturieren"
  | "bestand-ausleihe"
  | "labels-api"
  | "orte-raeume"
  | "betrieb-sicherheit";

export type FeatureItem = {
  icon: LucideIcon;
  title: string;
  copy: string;
};

export type FeatureGroup = {
  slug: FeatureSlug;
  menuTitle: string;
  eyebrow: string;
  title: string;
  intro: string;
  description: string;
  detailIntro: string;
  items: FeatureItem[];
  outcomes: string[];
  workflowTitle: string;
  workflowIntro: string;
  workflow: Array<{
    title: string;
    copy: string;
  }>;
  example: {
    eyebrow: string;
    title: string;
    copy: string;
    facts: Array<{
      label: string;
      value: string;
    }>;
  };
  screenshot: {
    src: string;
    alt: string;
    caption: string;
  };
  ios: {
    title: string;
    copy: string;
    points: string[];
  };
  trustTitle: string;
  trustCopy: string;
  trustPoints: string[];
};

export const featureGroups: FeatureGroup[] = [
  {
    slug: "erfassen",
    menuTitle: "Schnell erfassen",
    eyebrow: "01 · Erfassen",
    title: "Vom Foto zum Datensatz",
    intro:
      "Der schnellste Weg ins Inventar beginnt mit der Kamera. Vorschläge bleiben überprüfbar, Originale bleiben erhalten.",
    description:
      "Inventar in Sekunden erfassen: Kamera-first Batch-Aufnahme, prüfbare Bildanalyse, Fotozählung und eine native Open-Source-iOS-App.",
    detailIntro:
      "Open Inventory trennt den kurzen Moment am Gegenstand von der Verarbeitung im Hintergrund. Du fotografierst, gibst gemeinsame Vorgaben einmal für die Serie an und gehst direkt zum nächsten Objekt. Analyse, Upload und Cover-Erstellung bleiben als sichtbare Aufträge nachvollziehbar.",
    outcomes: [
      "Mehrere Gegenstände nacheinander aufnehmen, ohne auf jeden Verarbeitungsschritt zu warten",
      "KI-Vorschläge prüfen und korrigieren, bevor sie zum verlässlichen Datensatz werden",
      "Originalfotos und strukturierte Angaben gemeinsam am Eintrag behalten",
    ],
    workflowTitle: "Ein flüssiger Ablauf statt sechs Formulare",
    workflowIntro:
      "Gemeinsame Angaben werden vor einer Aufnahmeserie gesetzt. Danach konzentriert sich jeder Schritt auf das, was direkt am Objekt entschieden werden muss.",
    workflow: [
      {
        title: "Serie vorbereiten",
        copy: "Lege Typ, Standort und optionale Verarbeitung einmal fest. Diese Vorgaben begleiten alle folgenden Aufnahmen.",
      },
      {
        title: "Fotografieren",
        copy: "Nimm ein Hauptfoto und bei Bedarf weitere Ansichten oder ein Typenschild auf. Die Kamera ist nach dem Absenden sofort wieder frei.",
      },
      {
        title: "Im Hintergrund verarbeiten",
        copy: "Uploads, Bildanalyse und Cover-Erstellung laufen als sichtbare Aufträge. Idempotente Wiederholungen verhindern versehentliche Dubletten.",
      },
      {
        title: "Gesammelt prüfen",
        copy: "Kontrolliere Titel, Typ, Tags, Menge und Bilder. Erst deine Korrektur macht aus einem Vorschlag einen belastbaren Inventareintrag.",
      },
    ],
    example: {
      eyebrow: "Beispiel · Werkstattregal",
      title: "Zwölf Gegenstände, ein gemeinsamer Standort",
      copy: "Für eine Serie werden „Werkzeug“ und „Regal B2“ einmal gesetzt. Danach braucht jedes Objekt nur sein Foto; besondere Angaben wie Seriennummer oder Zustand ergänzt du gezielt.",
      facts: [
        { label: "Gemeinsame Vorgabe", value: "Werkzeug · Regal B2" },
        { label: "Aufnahmen", value: "12 Objekte" },
        { label: "Entscheidung", value: "Vorschlag prüfen" },
      ],
    },
    screenshot: {
      src: "/marketing/batch-mock-data.jpg",
      alt: "Serienerfassung in Open Inventory mit Beispieldaten",
      caption: "Kamera-first Batch-Aufnahme · sämtliche sichtbaren Inhalte sind Beispieldaten",
    },
    ios: {
      title: "Die Kamera ist dort, wo die Dinge sind.",
      copy: "Die native SwiftUI-App nimmt Fotos direkt am Regal auf und legt jeden Vorgang in einer dauerhaften Outbox ab. Sie arbeitet gegen deine eigene Open-Inventory-Instanz.",
      points: [
        "Bis zu zwölf Fotos aufnehmen oder aus der Mediathek wählen",
        "Aufträge bei unterbrochener Verbindung kontrolliert fortsetzen",
        "Code scannen, Datensatz öffnen und Ergebnis vor Ort prüfen",
      ],
    },
    trustTitle: "Automatisierung, deren Grenzen sichtbar bleiben.",
    trustCopy:
      "Bildanalyse und Cover-Erstellung sind optionale Provider-Funktionen. Der offene Code zeigt, wann externe Verarbeitung stattfindet; Originalbilder, Provider-Konfiguration und die endgültige Entscheidung bleiben unter Kontrolle der betreibenden Instanz.",
    trustPoints: [
      "MIT-lizenzierte Web-App und native iOS-App in einem Repository",
      "Optionale KI-Funktionen statt einer Pflicht zur externen Bildverarbeitung",
      "CSV-Export und dokumentierte REST-API für eigene Abläufe",
    ],
    items: [
      {
        icon: Camera,
        title: "Kamera-first Batch-Erfassung",
        copy: "Nimm mehrere Gegenstände nacheinander auf. Dauerhafte Hintergrundaufträge verarbeiten die Einträge weiter, während du schon das nächste Objekt fotografierst.",
      },
      {
        icon: Sparkles,
        title: "KI-Entwurf aus Bildern",
        copy: "Eine optionale OpenAI- oder kompatible Bildanalyse schlägt Titel, Beschreibung, Typ, Tags, Alt-Text und eine Konfidenz vor. Du prüfst den Entwurf vor der Übernahme.",
      },
      {
        icon: WandSparkles,
        title: "Saubere Produkt-Cover",
        copy: "OpenAI oder Google können aus einem Foto ein quadratisches Cover im Studio-Look erzeugen. Das Originalfoto bleibt daneben vollständig erhalten.",
      },
      {
        icon: ScanLine,
        title: "Mengen aus einem Foto",
        copy: "Die optionale Fotozählung erkennt gleichartige Teile, markiert Treffer und liefert eine Konfidenz. Die Menge lässt sich korrigieren, bevor sie als Zu- oder Abgang gebucht wird.",
      },
      {
        icon: ImageIcon,
        title: "Medien ohne Umwege",
        copy: "JPG, PNG, WebP, AVIF, HEIC, MP4, MOV, WebM, PDF und USDZ lassen sich geordnet am Eintrag ablegen. Bilder werden clientseitig optimiert; EXIF-Positionen können übernommen werden.",
      },
      {
        icon: Smartphone,
        title: "Native iPhone-Erfassung",
        copy: "Die offene SwiftUI-App fotografiert, scannt Codes und überträgt Aufträge mit einer absturzsicheren Warteschlange. Netzwerk-Wiederholungen erzeugen dank Idempotenz keine Dubletten.",
      },
    ],
  },
  {
    slug: "strukturieren",
    menuTitle: "Inventar strukturieren",
    eyebrow: "02 · Strukturieren",
    title: "So flexibel wie dein Bestand",
    intro:
      "Nicht jedes Inventar denkt in denselben Kategorien. Typen, Felder, Beziehungen und Sprachen passen sich deinem Modell an.",
    description:
      "Inventar flexibel strukturieren: eigene Typen und Felder, Beziehungen, Medien, Mehrsprachigkeit sowie schnelle Suche und Sammelbearbeitung.",
    detailIntro:
      "Ein Familienkeller braucht andere Angaben als ein Gerätepark. Open Inventory gibt deshalb kein starres Branchenschema vor: Du kombinierst stabile Typen, eigene Felder, Beziehungen, Standorte und Medien zu einem Modell, das verständlich bleibt und per API nutzbar ist.",
    outcomes: [
      "Eigene Begriffe und Felder abbilden, ohne den Anwendungscode ändern zu müssen",
      "Kisten, Räume, Geräte, Personen und Projekte nachvollziehbar verbinden",
      "Auch große Bestände über Suche, Filter und Sammelaktionen pflegen",
    ],
    workflowTitle: "Erst ein klares Modell, dann schnelle Pflege",
    workflowIntro:
      "Die beste Struktur enthält nur Angaben, die später gesucht, gefiltert oder automatisiert werden. Open Inventory lässt sie schrittweise wachsen.",
    workflow: [
      {
        title: "Inventartypen festlegen",
        copy: "Starte mit vorhandenen Typen oder definiere eigene Typen mit stabilen Schlüsseln für Oberfläche und API.",
      },
      {
        title: "Felder ergänzen",
        copy: "Füge nur die fachlich nötigen Text-, Zahlen-, Auswahl-, Datums- oder Referenzfelder hinzu.",
      },
      {
        title: "Zusammenhänge verbinden",
        copy: "Bilde Enthaltensein, Zugehörigkeit oder räumliche Beziehungen gerichtet und nachvollziehbar ab.",
      },
      {
        title: "Suchen und gemeinsam ändern",
        copy: "Nutze Filter und Sammelbearbeitung, um Tags oder gemeinsame Angaben konsistent auf mehrere Einträge anzuwenden.",
      },
    ],
    example: {
      eyebrow: "Beispiel · Gerätekatalog",
      title: "Ein Messgerät ist mehr als ein Name",
      copy: "Der Typ „Messgerät“ kann Seriennummer, Kalibriertermin und verantwortliche Person ergänzen. Beziehungen zeigen Zubehör und Aufbewahrungsort, ohne alles in ein Freitextfeld zu pressen.",
      facts: [
        { label: "Typ", value: "Messgerät" },
        { label: "Eigene Felder", value: "Kalibrierung · Verantwortlich" },
        { label: "Beziehungen", value: "Zubehör · Lagerort" },
      ],
    },
    screenshot: {
      src: "/marketing/inventory-mock-data.jpg",
      alt: "Strukturierte Inventarübersicht in Open Inventory mit Beispieldaten",
      caption: "Typen, Status, Tags und Orte in einer Ansicht · Beispieldaten",
    },
    ios: {
      title: "Struktur bleibt auch mobil verständlich.",
      copy: "Die native iOS-App sucht und filtert dieselben Inventareinträge wie die Web-App. Beim Erfassen lassen sich Standort und weitere Angaben direkt am Gegenstand ergänzen.",
      points: [
        "Nach Name, SKU, Tag oder Ort suchen",
        "Einträge mit authentifizierten Bildern öffnen und bearbeiten",
        "Karte, Details und Einstellungen nativ in SwiftUI nutzen",
      ],
    },
    trustTitle: "Dein Datenmodell bleibt lesbar und übertragbar.",
    trustCopy:
      "Typen und Felder werden nicht hinter einem proprietären Branchenmodell versteckt. Der MIT-lizenzierte Code, CSV-Import und -Export sowie die dokumentierte API geben dir mehrere Wege, Daten zu prüfen und weiterzuverwenden.",
    trustPoints: [
      "Stabile API-Schlüssel für eigene Inventartypen",
      "Validierter UTF-8-CSV-Import und -Export",
      "OpenAPI-3.1-Vertrag direkt im Repository",
    ],
    items: [
      {
        icon: Boxes,
        title: "Einträge mit vollständigen Details",
        copy: "Verwalte Menge, Status, SKU, Seriennummer, Wert, Kategorien, Tags, Standort, Notizen, Priorität, GPS- und GeoJSON-Daten sowie geordnete Medien pro Eintrag.",
      },
      {
        icon: Tags,
        title: "Eigene Inventartypen",
        copy: "Nutze mitgelieferte Typen für Werkzeuge, Objekte, Möbel, Fahrzeuge, Orte, Personen, Kleidung und Projekte oder definiere eigene Typen mit stabilen API-Schlüsseln.",
      },
      {
        icon: ListChecks,
        title: "Typisierte eigene Felder",
        copy: "Ergänze Text, Langtext, Zahl, Ja/Nein, Datum, Datum mit Uhrzeit, Auswahl, Mehrfachauswahl, E-Mail, URL und dynamische Referenzen – auch für serialisierte Einheiten.",
      },
      {
        icon: Link2,
        title: "Beziehungen & Enthaltensein",
        copy: "Konfigurierbare gerichtete Beziehungen verbinden Einträge. Manuelle Zuordnung und automatische Punkt-in-Polygon-Erkennung bilden Räume, Schränke, Maschinen oder Projekte nachvollziehbar ab.",
      },
      {
        icon: Languages,
        title: "Mehrsprachige Inhalte",
        copy: "Eine kanonische Sprache, feldgenaue Aktualität, Terminologiehinweise und Hintergrund-Regeneration halten KI-gestützte Übersetzungen kontrollierbar und konsistent.",
      },
      {
        icon: Search,
        title: "Suchen, filtern, bearbeiten",
        copy: "Durchsuche die responsive Raster- oder Tabellenansicht, filtere Bestände und ändere gemeinsame Felder oder zusätzliche Tags für mehrere Einträge in einem Schritt.",
      },
    ],
  },
  {
    slug: "bestand-ausleihe",
    menuTitle: "Bestand & Ausleihe",
    eyebrow: "03 · Lagern & bewegen",
    title: "Bestand mit belastbarer Historie",
    intro:
      "Open Inventory verbindet schnelle Alltagsaktionen mit einem unveränderlichen Ledger – vom einzelnen Kabel bis zum serialisierten Gerät.",
    description:
      "Bestände, Ausleihen und Lagerorte verwalten: Mengen- und Einzelbestand, append-only Bewegungen, Inventur, Reservierungen, Einkauf und Stücklisten.",
    detailIntro:
      "Schrauben brauchen eine Menge, ein Laptop eine eigene Identität. Open Inventory führt beides im selben System und schreibt jede Veränderung als datierte Bewegung fort. So bleiben aktueller Bestand und sein Zustandekommen gemeinsam nachvollziehbar.",
    outcomes: [
      "Bulk-Artikel und einzelne Geräte passend zu ihrem tatsächlichen Ablauf führen",
      "Ausgabe, Rückgabe, Transfer und Korrektur ohne überschriebene Historie buchen",
      "Mindestbestand, Bestellungen, Wareneingänge und Baugruppen zusammen denken",
    ],
    workflowTitle: "Jede Bewegung hat einen klaren Anlass",
    workflowIntro:
      "Eine Buchung verändert nicht nur eine Zahl. Sie hält fest, was wann, wo und für welchen Empfänger passiert ist.",
    workflow: [
      {
        title: "Bestandsmodell wählen",
        copy: "Nutze Mengenbestand für austauschbare Teile und serialisierte Einheiten für Geräte mit eigener Identität.",
      },
      {
        title: "Lagerorte zuordnen",
        copy: "Verteile Bestand auf Räume, Schränke oder Fahrzeuge, ohne die globale Verfügbarkeit aus dem Blick zu verlieren.",
      },
      {
        title: "Bewegung buchen",
        copy: "Zugang, Abgang, Transfer, Ausgabe oder Rückgabe werden geprüft und als neuer Historieneintrag angelegt.",
      },
      {
        title: "Bedarf rechtzeitig sehen",
        copy: "Mindestmenge, Verbrauch und Lieferzeit machen knappe Bestände sichtbar und unterstützen die Nachbestellung.",
      },
    ],
    example: {
      eyebrow: "Beispiel · Makerspace",
      title: "Schrauben zählen, Oszilloskope einzeln verfolgen",
      copy: "M4-Schrauben werden je Regal als Menge geführt. Jedes Messgerät hat dagegen einen eigenen Code, Status und Standort und kann einer Person zugewiesen werden.",
      facts: [
        { label: "Mengenbestand", value: "240 Schrauben" },
        { label: "Serialisiert", value: "4 Messgeräte" },
        { label: "Aktueller Vorgang", value: "1 Gerät ausgegeben" },
      ],
    },
    screenshot: {
      src: "/marketing/stock-mock-data.jpg",
      alt: "Bestandsübersicht in Open Inventory mit Beispieldaten",
      caption: "Verfügbarkeit, Mindestmengen und Lagerorte · Beispieldaten",
    },
    ios: {
      title: "Bestand direkt am Regal buchen.",
      copy: "Mit dem iPhone wird ein Code dort gescannt, wo Zugang, Ausgabe oder Rückgabe tatsächlich stattfindet. Die App nutzt dieselbe Bewegungshistorie wie die Weboberfläche.",
      points: [
        "Gescannten Eintrag eindeutig auflösen",
        "Zugang mit einem Tipp vorbereiten",
        "Abgang vor der Ausführung bewusst bestätigen",
      ],
    },
    trustTitle: "Die Historie gehört deiner Instanz.",
    trustCopy:
      "Bewegungen, Einheiten, Bestellungen und Stücklisten liegen in deiner PostgreSQL-Datenbank. Der offene Code macht die Buchungsregeln prüfbar; die API ermöglicht eigene Scanner-, Einkaufs- oder Reporting-Abläufe.",
    trustPoints: [
      "Append-only Bewegungen statt stiller Bestandsüberschreibung",
      "Docker Compose und PostgreSQL für den selbst betriebenen Kern",
      "Scoped API-Tokens für gezielte Integrationen",
    ],
    items: [
      {
        icon: PackageOpen,
        title: "Sammel- oder Einzelbestand",
        copy: "Führe identische Teile als Bulk-Bestand oder jede physische Einheit separat mit UUID, lesbarem Code, eigenem Status, Standort, Metadaten und Anschaffungsdatum.",
      },
      {
        icon: History,
        title: "Lückenlose Bewegungen",
        copy: "Zugänge, Abgänge, Korrekturen und Transfers werden datiert und append-only protokolliert. Bestände können nicht unter null fallen; Korrekturen überschreiben die Historie nicht.",
      },
      {
        icon: MapPinned,
        title: "Bestand je Lagerort",
        copy: "Jeder geeignete Inventareintrag kann zum strukturierten Lagerort werden. Globale Menge und Verteilung auf Räume, Schränke oder Fahrzeuge bleiben gemeinsam sichtbar.",
      },
      {
        icon: ClipboardCheck,
        title: "Inventurzyklen",
        copy: "Plane wiederkehrende Zählungen, arbeite fällige Prüfungen ab und gleiche Mengen je Standort ab. Serialisierte Einheiten behalten dabei ihre individuelle Nachverfolgbarkeit.",
      },
      {
        icon: Users,
        title: "Ausgabe, Zuweisung & Reservierung",
        copy: "Buche Mengen oder Einzelgeräte auf Benutzer, andere Inventareinträge oder freie Empfänger. Rückgabe und Storno stellen die Verfügbarkeit nachvollziehbar wieder her.",
      },
      {
        icon: PackageCheck,
        title: "Mindestbestand & Prognose",
        copy: "Mindestmenge, Bestellmenge, Lieferzeit und Verbrauchsrate ergeben Warnungen, ein geschätztes Ausverkaufsdatum und einen begründeten Nachbestellvorschlag.",
      },
      {
        icon: ShoppingCart,
        title: "Bestellungen & Wareneingang",
        copy: "Erfasse Bestellungen, erwartete Mengen und Teillieferungen. Wareneingänge fließen kontrolliert in den Bestand und dessen Bewegungshistorie ein.",
      },
      {
        icon: Layers3,
        title: "Stücklisten & Baugruppen",
        copy: "Hinterlege Komponenten einer Baugruppe und verbrauche sie bei der Montage atomar – entweder vollständig oder gar nicht.",
      },
    ],
  },
  {
    slug: "labels-api",
    menuTitle: "QR, Labels & API",
    eyebrow: "04 · Finden & automatisieren",
    title: "Vom Etikett bis zur API",
    intro:
      "Menschen scannen ein Label, Systeme sprechen OpenAPI. Beide Wege greifen auf denselben verlässlichen Bestand zu.",
    description:
      "Inventar mit QR- und Barcodes finden, eigene Etiketten gestalten, CSV austauschen, Inhalte teilen und Abläufe über die OpenAPI-3.1-REST-API verbinden.",
    detailIntro:
      "Ein gutes Etikett bringt Menschen ohne Umweg zum richtigen Eintrag. Eine gute API macht dasselbe für Software. Open Inventory verbindet beide Wege mit eindeutiger Auflösung, bestätigten Aktionen und einem dokumentierten Datenvertrag.",
    outcomes: [
      "Objekte über QR, Barcode, SKU, Seriennummer oder Inventarlink eindeutig finden",
      "Wiederverwendbare Etikettenlayouts direkt im Browser gestalten",
      "Daten per CSV oder scoped REST-API kontrolliert austauschen",
    ],
    workflowTitle: "Vom physischen Objekt zum sicheren digitalen Vorgang",
    workflowIntro:
      "Scannen ist zunächst eine Suche. Erst nach der eindeutigen Auflösung und einer sichtbaren Prüfung wird daraus eine Lageraktion.",
    workflow: [
      {
        title: "Kennung festlegen",
        copy: "Nutze einen kurzen Inventarlink, eine UUID, SKU oder Seriennummer als eindeutigen Einstieg zum Datensatz.",
      },
      {
        title: "Label gestalten",
        copy: "Kombiniere QR-Link, Code 128, Text und optional ein Objektbild in einem wiederverwendbaren Drucklayout.",
      },
      {
        title: "Scannen und auflösen",
        copy: "Kamera, Foto oder Handscanner lesen den Code. Open Inventory zeigt den gefundenen Eintrag, bevor etwas verändert wird.",
      },
      {
        title: "Ablauf verbinden",
        copy: "Konfiguriere geprüfte Lageraktionen oder binde eigene Systeme mit scoped Token und OpenAPI-Vertrag an.",
      },
    ],
    example: {
      eyebrow: "Beispiel · Werkzeugausgabe",
      title: "Ein Scan öffnet erst den Kontext, dann die Aktion",
      copy: "Der QR-Code auf einem Werkzeugkoffer führt zum eindeutigen Eintrag. Die Oberfläche zeigt Status und Standort und fragt anschließend, ob die Ausgabe wirklich gebucht werden soll.",
      facts: [
        { label: "Einstieg", value: "Kurzer QR-Link" },
        { label: "Auflösung", value: "WERK-0042" },
        { label: "Aktion", value: "Ausgabe bestätigen" },
      ],
    },
    screenshot: {
      src: "/marketing/inventory-mock-data.jpg",
      alt: "Inventareinträge in Open Inventory, die über Codes und API aufgelöst werden können",
      caption: "Dieselben Datensätze für Suche, Scan und API · Beispieldaten",
    },
    ios: {
      title: "Das iPhone wird zum offenen Scanner.",
      copy: "Die native App erkennt QR, EAN-8/13, UPC-E, Code 128, Data Matrix, PDF417 und Aztec und verbindet sich direkt mit deiner eigenen Instanz.",
      points: [
        "Inventarlink, UUID, SKU oder Seriennummer auflösen",
        "Gefundenen Eintrag vor einer Lageraktion anzeigen",
        "Scanner-Code und Server-API gemeinsam im Repository prüfen",
      ],
    },
    trustTitle: "Die Schnittstelle ist Teil des Produkts, nicht ein Hintereingang.",
    trustCopy:
      "Die OpenAPI-3.1-Spezifikation liegt als YAML im Repository. Tokens werden gehasht gespeichert, können Ablaufdatum und Scopes tragen und lassen sich widerrufen. So bleiben Integrationen dokumentiert und begrenzbar.",
    trustPoints: [
      "Eingecheckter OpenAPI-Vertrag und interaktive Referenz",
      "Gehasht gespeicherte, widerrufbare Tokens mit Scopes",
      "Validierter CSV-Austausch als einfacher, offener Datenweg",
    ],
    items: [
      {
        icon: QrCode,
        title: "QR- und Barcode-Workflows",
        copy: "Scanne mit Kamera oder Foto, löse Inventarlinks, UUIDs, SKUs und Seriennummern auf und prüfe konfigurierbare Lageraktionen vor der idempotenten Ausführung.",
      },
      {
        icon: Barcode,
        title: "Eigene Etiketten",
        copy: "Entwirf wiederverwendbare Layouts im Browser – mit kurzem QR-Link, Code 128, optionalem Objektbild und Presets unter anderem für Brother 62 mm und 102 × 152 mm.",
      },
      {
        icon: FileSpreadsheet,
        title: "CSV-Import & -Export",
        copy: "Importiere und exportiere UTF-8-CSV. Zeilengenaue Validierung benennt Probleme klar; wiederholte Importe können idempotent verarbeitet werden.",
      },
      {
        icon: Fingerprint,
        title: "Dubletten sicher zusammenführen",
        copy: "Ein Scoring hilft beim Finden ähnlicher Einträge. Beim transaktionalen Zusammenführen bleiben zugehörige Daten konsistent, statt halbfertig verteilt zu werden.",
      },
      {
        icon: Globe2,
        title: "Gezielt öffentlich teilen",
        copy: "Erstelle widerrufbare öffentliche Freigaben für ausgewählte Inhalte, ohne dafür den gesamten Arbeitsbereich zu öffnen.",
      },
      {
        icon: Braces,
        title: "Dokumentierte REST-API",
        copy: "Die eingecheckte OpenAPI-3.1-Spezifikation, interaktive Referenz und gehashte, widerrufbare Tokens mit Ablaufdatum und Scopes machen Integrationen planbar.",
      },
    ],
  },
  {
    slug: "orte-raeume",
    menuTitle: "Orte, Karten & Räume",
    eyebrow: "05 · Orte & Räume",
    title: "Vom Kartenpunkt bis zum 3D-Raum",
    intro:
      "Standorte sind mehr als Freitext: Sie können geografisch, hierarchisch und auf kompatiblen Geräten räumlich erfasst werden.",
    description:
      "Inventar räumlich organisieren: Kartenpunkte und Polygone, automatische Zuordnung, optionale RoomPlan-Scans und navigierbare 3D-Räume.",
    detailIntro:
      "„Im Lager“ reicht selten, wenn ein Gegenstand schnell gefunden werden soll. Open Inventory verbindet Textorte, strukturierte Lagerorte, Kartenkoordinaten und optionale Raumscans. Einfache Bestände bleiben einfach; räumliche Tiefe kommt nur dort hinzu, wo sie wirklich hilft.",
    outcomes: [
      "Inventar mit Kartenpunkten, Flächen und strukturierten Lagerorten verbinden",
      "Räumliche Beziehungen aus Geometrien ableiten und weiterhin manuell übersteuern",
      "Kompatible iPhones optional für RoomPlan-Scans und Platzierung nutzen",
    ],
    workflowTitle: "Vom groben Ort zum konkreten Fundplatz",
    workflowIntro:
      "Jede Ebene ist optional. Ein Textort kann genügen; Karten- und Raumdaten erweitern ihn, wenn Gelände oder Gebäude komplexer werden.",
    workflow: [
      {
        title: "Standort anlegen",
        copy: "Nutze einen Inventareintrag als Raum, Schrank, Fahrzeug oder andere strukturierte Ablage.",
      },
      {
        title: "Geometrie ergänzen",
        copy: "Setze einen Kartenpunkt oder zeichne ein Polygon und bearbeite dessen Geometrie direkt in der Karte.",
      },
      {
        title: "Räumlich zuordnen",
        copy: "Liegt ein Punkt in einem Container-Polygon, kann daraus eine Beziehung entstehen. Manuelle Platzierung behält Vorrang.",
      },
      {
        title: "Raum optional erfassen",
        copy: "Vermesse mit einem LiDAR-fähigen iPhone Räume und Etagen und navigiere die Struktur anschließend im Web-Viewer.",
      },
    ],
    example: {
      eyebrow: "Beispiel · Standortkette",
      title: "Gelände, Gebäude, Raum, Schrank",
      copy: "Ein Messgerät liegt nicht nur „im Labor“. Kartenpunkt und Raumstruktur führen zum Gebäude, Beziehungen zum Raum und der konkrete Lagerort schließlich zu Schrank 3, Fach B.",
      facts: [
        { label: "Karte", value: "Gebäude Nord" },
        { label: "Raum", value: "Elektroniklabor" },
        { label: "Fundplatz", value: "Schrank 3 · Fach B" },
      ],
    },
    screenshot: {
      src: "/marketing/dashboard-mock-data.jpg",
      alt: "Open-Inventory-Dashboard mit Beispieldaten als Einstieg zu Standorten und Räumen",
      caption: "Bestand und Standorte in derselben selbst gehosteten Web-App · Beispieldaten",
    },
    ios: {
      title: "Raumerfassung ist nativ – und bewusst optional.",
      copy: "Auf LiDAR-fähigen iPhones kann die SwiftUI-App RoomPlan nutzen, um Räume, Etagen und zusammenhängende Strukturen zu vermessen. Die übrigen Karten- und Standortfunktionen benötigen kein Pro-Gerät.",
      points: [
        "RoomPlan-Strukturen auf kompatibler Hardware aufnehmen",
        "Inventar mit mobilen Fotos und Codes am Ort ergänzen",
        "Erfasste Räume später im Web durchsuchen und navigieren",
      ],
    },
    trustTitle: "Räumliche Daten bleiben Teil deines offenen Inventars.",
    trustCopy:
      "Kartenkoordinaten, GeoJSON, Beziehungen und RoomPlan-Artefakte werden von deiner Instanz verwaltet. Die iOS- und Web-Implementierung ist einsehbar; externe Karten- oder Derivat-Provider bleiben explizite Konfigurationsentscheidungen.",
    trustPoints: [
      "Web-Viewer und native Raumerfassung offen im Repository",
      "Explizite Trennung manueller und automatisch abgeleiteter Platzierung",
      "Optionale Provider-Grenzen statt versteckter Abhängigkeiten",
    ],
    items: [
      {
        icon: MapPinned,
        title: "Interaktive Karten",
        copy: "Bearbeite Punkte und Polygone, ziehe Geometriegriffe, wechsle Ebenen und Satellitenbild und ordne mehrere Einträge direkt auf der Karte zu.",
      },
      {
        icon: Layers3,
        title: "Automatische räumliche Zuordnung",
        copy: "Liegt ein Kartenpunkt in einem Container-Polygon, kann Open Inventory daraus eine räumliche Beziehung ableiten. Eine manuelle Platzierung hat bewusst Vorrang.",
      },
      {
        icon: Smartphone,
        title: "Optionale RoomPlan-Scans",
        copy: "Ein LiDAR-fähiges iPhone kann Räume, Etagen und zusammenhängende Strukturen vermessen. Das ist eine Pro-Geräte-Erweiterung, keine Voraussetzung für die übrige App.",
      },
      {
        icon: Search,
        title: "Navigierbare Räume 3D",
        copy: "Der Web-Viewer zeigt die gemessene RoomPlan-Struktur, durchsuchbare Inventarmarker und optional bereitgestellte fotorealistische Derivate – mit klarer Trennung der Koordinatensysteme.",
      },
    ],
  },
  {
    slug: "betrieb-sicherheit",
    menuTitle: "Betrieb & Sicherheit",
    eyebrow: "06 · Betreiben & absichern",
    title: "Open Source, aber nicht sorglos",
    intro:
      "Der offene Code gibt Kontrolle. Rollen, Tokens, persistente Daten und explizite Provider-Grenzen machen daraus einen betreibbaren Dienst.",
    description:
      "Open Inventory selbst hosten und kontrolliert betreiben: Rollen und Regeln, Docker Compose, PostgreSQL, persistente Uploads und MIT-lizenzierter Quellcode.",
    detailIntro:
      "Self-hosting verlagert Kontrolle und Verantwortung zur betreibenden Organisation. Open Inventory liefert dafür einen nachvollziehbaren Stack mit Compose-Dateien, Migrationen, Healthcheck, PostgreSQL und persistenten Uploads. Backups, Updates, TLS und Zugriffswege bleiben bewusste Betriebsaufgaben.",
    outcomes: [
      "Web-App, API und iOS-App auf eigener Infrastruktur betreiben und prüfen",
      "Rollen, granulare Berechtigungen und bedingte Zugriffsregeln festlegen",
      "Datenbank, Dateien, Secrets, Backups und optionale Provider bewusst verwalten",
    ],
    workflowTitle: "Ein offener Stack braucht klare Betriebsentscheidungen",
    workflowIntro:
      "Der schnelle Compose-Start ist der Anfang. Für einen dauerhaft erreichbaren Dienst gehören Identität, Datensicherung und Updates zum gewählten Betriebsmodell.",
    workflow: [
      {
        title: "Instanz starten",
        copy: "Nutze Docker Compose, PostgreSQL, Migrationen und Healthcheck als nachvollziehbare Grundlage.",
      },
      {
        title: "Zugriff begrenzen",
        copy: "Lege Konten, Rollen und Regeln fest und entscheide bewusst, ob die Instanz intern oder öffentlich erreichbar sein soll.",
      },
      {
        title: "Daten sichern",
        copy: "Sichere PostgreSQL und den gewählten Dateispeicher gemeinsam und teste die Wiederherstellung regelmäßig.",
      },
      {
        title: "Updates pflegen",
        copy: "Prüfe Änderungen im Repository, aktualisiere Images und Migrationen kontrolliert und beobachte den Healthcheck.",
      },
    ],
    example: {
      eyebrow: "Beispiel · Eigene Instanz",
      title: "Ein Stack mit sichtbaren Grenzen",
      copy: "Web-App und API laufen im Container, strukturierte Daten liegen in PostgreSQL und Uploads im persistenten Volume. Externe Auth-, KI- oder Speicheranbieter kommen nur hinzu, wenn du sie konfigurierst.",
      facts: [
        { label: "Anwendung", value: "Web · API · Jobs" },
        { label: "Daten", value: "PostgreSQL · Uploads" },
        { label: "Optional", value: "Auth · KI · Storage" },
      ],
    },
    screenshot: {
      src: "/marketing/dashboard-mock-data.jpg",
      alt: "Selbst gehostete Open-Inventory-Web-App mit Beispieldaten",
      caption: "Die Web-App auf dem offenen, selbst betreibbaren Stack · Beispieldaten",
    },
    ios: {
      title: "Auch die iOS-App spricht mit deiner Instanz.",
      copy: "Die native SwiftUI-App wird aus demselben offenen Repository gebaut und verbindet sich mit der von dir konfigurierten Server-URL. Erreichbarkeit und TLS gehören damit zu deinem Betriebsmodell.",
      points: [
        "Server-URL der eigenen Instanz konfigurieren",
        "Web, API und iOS gemeinsam im Quellcode nachvollziehen",
        "Öffentliche Verbindungen über HTTPS absichern",
      ],
    },
    trustTitle: "Open Source schafft Prüfbarkeit – nicht automatisch Betriebssicherheit.",
    trustCopy:
      "Die MIT-Lizenz erlaubt Prüfung, Anpassung, Betrieb und Weitergabe. Sie ersetzt keine Updates, Backups oder sichere Netzkonfiguration. Open Inventory benennt diese Grenze bewusst und liefert die technischen Bausteine offen aus.",
    trustPoints: [
      "MIT-Lizenz und vollständiger Quellcode für Web, API und iOS",
      "Docker Compose, Migrationen, Healthcheck und persistente Volumes",
      "Offene Issues und Pull Requests als nachvollziehbarer Beteiligungsweg",
    ],
    items: [
      {
        icon: ShieldCheck,
        title: "Rollen & bedingte Regeln",
        copy: "Verwalte lokale Konten, eigene Rollen, granulare Berechtigungen und inhaltsabhängige Zugriffsregeln. Auth0 kann optional als Identitätsanbieter ergänzt werden.",
      },
      {
        icon: Container,
        title: "Docker Compose & PostgreSQL",
        copy: "Container, Migrationen, Healthcheck sowie stabile Volumes für PostgreSQL und lokale Uploads sind eingecheckt. Konfiguration und Secrets bleiben bei der betreibenden Instanz.",
      },
      {
        icon: Database,
        title: "Wählbarer Dateispeicher",
        copy: "Speichere Uploads standardmäßig im persistenten lokalen Volume oder binde optional Openinary an. Datenbank und Dateien werden gemeinsam gesichert.",
      },
      {
        icon: Github,
        title: "MIT Open Source",
        copy: "Web-App, API und native iOS-App liegen offen in einem Repository. Unter der MIT-Lizenz darfst du den Code prüfen, anpassen, betreiben und weitergeben.",
      },
    ],
  },
];

export function getFeatureGroup(slug: string) {
  return featureGroups.find((group) => group.slug === slug);
}
