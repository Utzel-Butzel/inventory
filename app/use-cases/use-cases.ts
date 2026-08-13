export type UseCaseIcon =
  | "api"
  | "camera"
  | "csv"
  | "history"
  | "labels"
  | "languages"
  | "locations"
  | "orders"
  | "relations"
  | "roles"
  | "sharing"
  | "stock";

export type UseCaseFeature = {
  icon: UseCaseIcon;
  title: string;
  description: string;
};

export type UseCase = {
  slug: string;
  name: string;
  eyebrow: string;
  title: string;
  cardCopy: string;
  description: string;
  image?: string;
  imageAlt?: string;
  visual:
    | "makerspace"
    | "family"
    | "startup"
    | "club"
    | "collection"
    | "school"
    | "trades"
    | "lab";
  accent: string;
  softAccent: string;
  challenge: string;
  promises: string[];
  mockData: Array<{
    name: string;
    meta: string;
    status: string;
  }>;
  steps: Array<{
    title: string;
    description: string;
  }>;
  features: UseCaseFeature[];
  iosTitle: string;
  iosCopy: string;
  iosPoints: string[];
  openSourceTitle: string;
  openSourceCopy: string;
};

export const useCases: UseCase[] = [
  {
    slug: "makerspace",
    name: "Makerspace",
    eyebrow: "Werkstatt & geteilte Technik",
    title: "Werkzeug finden, ausleihen und vollständig zurückbekommen.",
    cardCopy:
      "Maschinen, Handwerkzeug und Verbrauchsmaterial mit QR-Codes, Standorten und nachvollziehbaren Bewegungen organisieren.",
    description:
      "Open Inventory verbindet Werkzeugkatalog, Lagerbestand und Ausgabe in einem selbst gehosteten System. Neue Gegenstände starten mit einem Foto; Mitglieder finden anschließend das richtige Werkzeug, den Lagerort und den aktuellen Bestand.",
    image: "/marketing/usecase-makerspace-v2.webp",
    imageAlt:
      "Mitarbeitende in einer gut genutzten offenen Werkstatt mit beschrifteten Werkzeugen",
    visual: "makerspace",
    accent: "text-[#5f55e8]",
    softAccent: "bg-[#eeedff] text-[#5147d9]",
    challenge:
      "In einer offenen Werkstatt wechseln Geräte, Einzelteile und Verbrauchsmaterial ständig den Ort. Tabellen zeigen selten, wer etwas hat, welche Seriennummer betroffen ist oder wann Bestand nachbestellt werden sollte.",
    promises: [
      "Werkzeug per Suche, QR-Code oder Barcode direkt finden",
      "Mengenware und einzelne Maschinen getrennt nachverfolgen",
      "Ausgabe, Rückgabe, Reservierung und Standortwechsel dokumentieren",
    ],
    mockData: [
      {
        name: "Akkuschrauber 18 V",
        meta: "Werkzeugwand A · 7 verfügbar",
        status: "Verfügbar",
      },
      {
        name: "Lasercutter Schutzbrille",
        meta: "Sicherheitsregal · 18 Stück",
        status: "Auf Lager",
      },
      {
        name: "Oszilloskop Rigol DS1054Z",
        meta: "Elektronikbank · SN 043918",
        status: "Ausgegeben",
      },
    ],
    steps: [
      {
        title: "Foto aufnehmen",
        description:
          "Mit Browser oder iPhone fotografierst du ein neues Werkzeug. Die optionale KI schlägt Titel, Beschreibung, Typ und Tags zur Prüfung vor.",
      },
      {
        title: "Bestand festlegen",
        description:
          "Verbrauchsteile führst du als Menge, Maschinen als einzeln identifizierte Einheiten mit Code, Zustand und Standort.",
      },
      {
        title: "Etikett anbringen",
        description:
          "Erstelle wiederverwendbare Etiketten mit kompaktem QR-Link, Code 128, Text und optionalem Objektbild direkt im Browser.",
      },
      {
        title: "Bewegung buchen",
        description:
          "Scans führen zu geprüften Ausgabe-, Rückgabe- oder Standortabläufen. Der datierte Bewegungsverlauf bleibt nachvollziehbar.",
      },
    ],
    features: [
      {
        icon: "stock",
        title: "Mengen & Einzelgeräte",
        description:
          "Schrauben werden als Mengenbestand geführt, Fräsen oder Messgeräte als serialisierte Einheiten mit eigenem Status und Standort.",
      },
      {
        icon: "labels",
        title: "QR- und Barcode-Etiketten",
        description:
          "Gestalte Druckvorlagen im Browser und scanne Codes per Kamera, Foto oder Handscanner. Änderungen werden vor dem Buchen geprüft.",
      },
      {
        icon: "history",
        title: "Ausgabe mit Verlauf",
        description:
          "Bestand kann an Nutzer, Inventarobjekte oder Freitext-Empfänger ausgegeben, reserviert oder fest zugewiesen werden.",
      },
      {
        icon: "locations",
        title: "Standorte & Karten",
        description:
          "Ordne Dinge Werkstätten und Lagerorten zu. Karten, Beziehungen und die iOS-Raumerfassung helfen bei komplexeren Räumen.",
      },
      {
        icon: "orders",
        title: "Nachschub & Baugruppen",
        description:
          "Mindestbestände, Bestellungen und Teilwareneingänge machen Nachschub sichtbar; Stücklisten dokumentieren verbautes Material.",
      },
      {
        icon: "roles",
        title: "Präzise Zugriffsrechte",
        description:
          "Eigene Rollen, granulare Berechtigungen und bedingte Regeln trennen Ausgabe, Bearbeitung, Einkauf und Administration.",
      },
    ],
    iosTitle: "Die Werkzeugausgabe passt in die Hosentasche.",
    iosCopy:
      "Die native SwiftUI-App liegt direkt im Open-Source-Repository. Sie nutzt die iPhone-Kamera für Fotos und Code-Erkennung und arbeitet gegen deine eigene Open-Inventory-Instanz.",
    iosPoints: [
      "QR, EAN, Code 128, Data Matrix, PDF417 und Aztec erkennen",
      "Gescannten Bestand einbuchen oder nach Bestätigung ausgeben",
      "Fehlgeschlagene Uploads mit stabilen Idempotenzschlüsseln wiederholen",
    ],
    openSourceTitle: "Werkstattwissen gehört der Werkstatt.",
    openSourceCopy:
      "Open Inventory ist MIT-lizenziert und selbst hostbar. Datenmodell, API und native iOS-App sind einsehbar; eigene Integrationen können auf der dokumentierten OpenAPI aufbauen.",
  },
  {
    slug: "familie",
    name: "Familie",
    eyebrow: "Haushalt & gemeinsames Eigentum",
    title: "Wissen, was da ist — und in welchem Karton es liegt.",
    cardCopy:
      "Keller, Dachboden, Dokumente und geteilte Dinge ohne komplizierte Listen gemeinsam übersichtlich halten.",
    description:
      "Open Inventory macht aus Fotos ein durchsuchbares Familieninventar. Orte, Behälter, Bilder und eigene Felder schaffen Ordnung, ohne dass jedes Familienmitglied zuerst ein Warenwirtschaftssystem lernen muss.",
    image: "/marketing/usecase-family-v2.webp",
    imageAlt:
      "Familie beim gemeinsamen Sortieren und Beschriften von Aufbewahrungsboxen",
    visual: "family",
    accent: "text-[#08765e]",
    softAccent: "bg-[#e0f8ef] text-[#08765e]",
    challenge:
      "Saisonales, geliehene Dinge und Erinnerungsstücke verschwinden schnell in Schränken und Kisten. Eine gute Lösung muss schnell genug für den Alltag sein und trotzdem Details und Fotos bewahren.",
    promises: [
      "Vom Foto zum prüfbaren Eintrag, ohne lange Formulare",
      "Kisten, Räume und enthaltene Gegenstände miteinander verknüpfen",
      "Ausgewählte Bestände per schreibgeschütztem Link teilen",
    ],
    mockData: [
      {
        name: "Campingkocher",
        meta: "Keller · Regal 2 · Kiste Outdoor",
        status: "Zuhause",
      },
      {
        name: "Kinder-Skijacke Größe 128",
        meta: "Dachboden · Winterkleidung",
        status: "Verliehen",
      },
      {
        name: "Heimwerker-Bohrmaschine",
        meta: "Abstellraum · Fach links",
        status: "Verfügbar",
      },
    ],
    steps: [
      {
        title: "Einfach fotografieren",
        description:
          "Nimm ein oder mehrere Bilder auf. Die optionale Bildanalyse erstellt Vorschläge; Originalfotos bleiben am Datensatz erhalten.",
      },
      {
        title: "Ort kurz ergänzen",
        description:
          "Raum, Kiste oder Schrank werden als Standort oder Beziehung hinterlegt. Eigene Felder erfassen etwa Größe, Garantie oder Besitzer.",
      },
      {
        title: "Bei Bedarf markieren",
        description:
          "Für Boxen und häufig geteilte Dinge kannst du QR- oder Barcode-Etiketten direkt im Browser gestalten und drucken.",
      },
      {
        title: "Später sofort finden",
        description:
          "Suche nach Name, SKU, Seriennummer, Tags, Kategorien und weiteren Daten — oder öffne den Datensatz mit einem Scan.",
      },
    ],
    features: [
      {
        icon: "camera",
        title: "Fotos statt Tipparbeit",
        description:
          "Mehrere Medien pro Gegenstand, EXIF-Ortserkennung und clientseitige Bildoptimierung machen die Erfassung alltagstauglich.",
      },
      {
        icon: "relations",
        title: "Kisten, Räume, Zusammenhänge",
        description:
          "Konfigurierbare Beziehungen bilden ab, dass ein Gegenstand in einer Box liegt oder zu einem anderen Objekt gehört.",
      },
      {
        icon: "locations",
        title: "Standorte & Karten",
        description:
          "Speichere Räume, Textorte, GPS-Positionen oder Geometrien. So funktioniert das Inventar in der Wohnung und unterwegs.",
      },
      {
        icon: "sharing",
        title: "Gezielt teilen",
        description:
          "Erstelle öffentliche Links mit Lesezugriff für ausgewählte Sammlungen, ohne dafür Bearbeitungsrechte zu vergeben.",
      },
      {
        icon: "csv",
        title: "Daten mitnehmen",
        description:
          "Validierter UTF-8-CSV-Import und -Export erleichtert den Einstieg aus einer Liste und hält einen einfachen Ausweg offen.",
      },
      {
        icon: "roles",
        title: "Gemeinsam, aber kontrolliert",
        description:
          "Lokale Konten und eigene Rollen legen fest, wer nur ansehen, neue Dinge erfassen oder Einstellungen verwalten darf.",
      },
    ],
    iosTitle: "Erfassen, während du die Kiste ohnehin in der Hand hast.",
    iosCopy:
      "Mit der nativen iOS-App nimmst du Fotos auf, liest vorhandene Codes und findest Einträge direkt am Regal. Die App verbindet sich per HTTPS mit deiner eigenen Instanz.",
    iosPoints: [
      "Bis zu zwölf Fotos aufnehmen oder auswählen",
      "Bekannte SKU, Seriennummer oder Inventarlink exakt auflösen",
      "Upload-Aufträge nach einem App-Neustart sicher fortsetzen",
    ],
    openSourceTitle: "Kein Familienarchiv in einer geschlossenen Plattform.",
    openSourceCopy:
      "Open Inventory ist Open Source unter der MIT-Lizenz. Du kannst es mit Docker selbst betreiben, prüfen, anpassen und deine Daten jederzeit per API oder CSV weiterverwenden.",
  },
  {
    slug: "startup",
    name: "Startup",
    eyebrow: "Assets & wachsende Teams",
    title: "Assets sauber verwalten, bevor die erste Tabelle kippt.",
    cardCopy:
      "Laptops, Testgeräte, Büroausstattung und Einkauf mit Rollen, Seriennummern und offener API skalierbar organisieren.",
    description:
      "Open Inventory gibt jungen Teams früh einen belastbaren Überblick: Wer nutzt welches Gerät? Was ist unterwegs? Was kommt mit der nächsten Bestellung? Der Einstieg bleibt schnell, die Struktur wächst mit.",
    image: "/marketing/usecase-startup-v2.webp",
    imageAlt:
      "Kleines Startup-Team bei der Erfassung von Laptops und technischer Ausstattung",
    visual: "startup",
    accent: "text-[#aa4b08]",
    softAccent: "bg-[#fff1df] text-[#9a4308]",
    challenge:
      "Wenn ein Team wächst, werden Kaufbelege, Gerätezuordnung und Seriennummern schnell über mehrere Tabellen verteilt. Spätestens beim Onboarding, Offboarding oder Audit fehlen verlässliche Antworten.",
    promises: [
      "Seriennummer, Nutzer, Zustand und Standort pro Gerät sehen",
      "Wareneingänge und offene Bestellungen nachvollziehen",
      "Mit OpenAPI und scoped Tokens an bestehende Abläufe anbinden",
    ],
    mockData: [
      {
        name: "MacBook Pro 14\" · M4",
        meta: "SN C02X-41K · Zugewiesen an Mira",
        status: "In Benutzung",
      },
      {
        name: "iPhone Testgerät 03",
        meta: "Mobile Lab · iOS Testpool",
        status: "Verfügbar",
      },
      {
        name: "USB-C Dock Gen 2",
        meta: "12 auf Lager · 8 im Einsatz",
        status: "Nachbestellen",
      },
    ],
    steps: [
      {
        title: "Bestand übernehmen",
        description:
          "Importiere eine validierte UTF-8-CSV oder erfasse neue Geräte per Foto. Jede Zeile und jeder KI-Vorschlag kann geprüft werden.",
      },
      {
        title: "Struktur definieren",
        description:
          "Inventartypen, eigene Felder, Tags und Kategorien bilden Team, Kostenstelle, Garantie oder Gerätekonfiguration ab.",
      },
      {
        title: "Geräte zuweisen",
        description:
          "Serialisierte Einheiten erhalten Code, Status, Standort und Metadaten. Zuweisungen und Bewegungen bleiben historisch nachvollziehbar.",
      },
      {
        title: "Abläufe verbinden",
        description:
          "Dokumentierte REST-Endpunkte und scoped API-Tokens binden Inventardaten an interne Tools und Automationen an.",
      },
    ],
    features: [
      {
        icon: "stock",
        title: "Asset- und Bestandsmodell",
        description:
          "Führe Einzelgeräte serialisiert und Zubehör als Mengenbestand — jeweils mit Standort, Status und vollständigem Bewegungsverlauf.",
      },
      {
        icon: "history",
        title: "Zuweisung & Rückgabe",
        description:
          "Geräte lassen sich Nutzern, anderen Assets oder Freitext-Empfängern zuweisen, reservieren oder zeitweise ausgeben.",
      },
      {
        icon: "orders",
        title: "Bestellungen & Wareneingang",
        description:
          "Offene Bestellmengen fließen in die Prognose ein; Teilwareneingänge reduzieren sie und erzeugen nachvollziehbare Zugänge.",
      },
      {
        icon: "roles",
        title: "Rollen bis auf Aktionsebene",
        description:
          "Konfiguriere Rollen für IT, Operations und Mitarbeitende mit granularen Rechten und bedingten Regeln auf Inventardaten.",
      },
      {
        icon: "api",
        title: "OpenAPI & scoped Tokens",
        description:
          "Die eingecheckte OpenAPI-Spezifikation dokumentiert die REST-API; Tokens sind gehasht, widerrufbar, befristbar und einschränkbar.",
      },
      {
        icon: "csv",
        title: "CSV ohne Blindflug",
        description:
          "Importe werden zeilenweise validiert und überschreiben bestehende Einträge nicht stillschweigend. Exporte halten die Daten portabel.",
      },
    ],
    iosTitle: "Onboarding direkt am ausgepackten Gerät.",
    iosCopy:
      "Die iOS-App fotografiert neue Assets, scannt Hersteller- oder eigene Inventarcodes und kann denselben Analyse- und Cover-Ablauf wie die Browser-Erfassung anstoßen.",
    iosPoints: [
      "Neue Assets aus unbekannten Codes anlegen",
      "Bestand direkt nach einem Scan ein- oder ausbuchen",
      "Zugangstoken geschützt im iOS-Keychain speichern",
    ],
    openSourceTitle: "Eine Asset-Basis, die das Team kontrolliert.",
    openSourceCopy:
      "Open Inventory ist MIT-lizenzierte Open-Source-Software. Self-Hosting mit Docker, offenes Datenmodell und dokumentierte API verhindern, dass der frühe Prozess zur späteren Sackgasse wird.",
  },
  {
    slug: "verein",
    name: "Verein",
    eyebrow: "Material & Ehrenamt",
    title: "Gemeinsames Material ohne Übergabe-Chaos verwalten.",
    cardCopy:
      "Vom Veranstaltungskabel bis zum Trikot: Ausgabe, Lagerorte und Berechtigungen so dokumentieren, dass Ehrenamt einfach bleibt.",
    description:
      "Open Inventory schafft einen gemeinsamen, durchsuchbaren Materialstand für Vereinsheim, Lager und Veranstaltungen. Einfache Scan-Abläufe helfen bei der Ausgabe; Rollen schützen sensible Änderungen.",
    image: "/marketing/usecase-club-v2.webp",
    imageAlt:
      "Ehrenamtliche prüfen gemeinsam gebrauchte Veranstaltungstechnik in einem Vereinslager",
    visual: "club",
    accent: "text-[#08765e]",
    softAccent: "bg-[#e0f8ef] text-[#08765e]",
    challenge:
      "Vereinsmaterial wandert zwischen Lager, Veranstaltungen und Mitgliedern. Verantwortliche wechseln, Übergaben passieren nebenbei — und trotzdem soll der Bestand für alle verständlich bleiben.",
    promises: [
      "Materialkatalog lesbar teilen, Bearbeitung gezielt vergeben",
      "Ausgaben und Rückgaben mit Empfänger dokumentieren",
      "Verbrauchsmaterial und einzelne Geräte passend führen",
    ],
    mockData: [
      {
        name: "Funkmikrofon Set A",
        meta: "Techniklager · Koffer 4",
        status: "Reserviert",
      },
      {
        name: "Markierungsleibchen Gelb",
        meta: "Sporthalle · 24 Stück",
        status: "Auf Lager",
      },
      {
        name: "Pavillon 3 × 6 m",
        meta: "Außenlager · Ausgabe an Sommerfest-Team",
        status: "Ausgegeben",
      },
    ],
    steps: [
      {
        title: "Vorhandenes erfassen",
        description:
          "Starte per CSV, Browser oder iPhone-Kamera. Kategorien und eigene Felder passen den Katalog an Sport, Kultur oder Technik an.",
      },
      {
        title: "Lager sichtbar machen",
        description:
          "Ordne Material Orten, Behältern und miteinander verbundenen Gegenständen zu. Bilder erleichtern die eindeutige Auswahl.",
      },
      {
        title: "Ausgabe vereinfachen",
        description:
          "Ein Scan öffnet den passenden Eintrag. Ausgabe und Rückgabe werden bestätigt und mit Nutzer oder Freitext-Empfänger gespeichert.",
      },
      {
        title: "Verantwortung verteilen",
        description:
          "Eigene Rollen geben Teams genau die Rechte, die sie brauchen; ein öffentlicher Leselink kann den Katalog separat zeigen.",
      },
    ],
    features: [
      {
        icon: "sharing",
        title: "Öffentlicher Materialkatalog",
        description:
          "Ausgewählte Bestände können über einen öffentlichen Link mit Lesezugriff veröffentlicht werden, ohne den Arbeitsbereich zu öffnen.",
      },
      {
        icon: "history",
        title: "Ausgabe & Reservierung",
        description:
          "Buche Material an Nutzer oder Freitext-Empfänger aus, reserviere es für Termine und behalte den Bewegungsverlauf im Blick.",
      },
      {
        icon: "labels",
        title: "Scannbare Etiketten",
        description:
          "Eigene Etikettenvorlagen kombinieren QR-Link, Barcode, Text und Objektbild für Kisten, Geräte oder Materialsets.",
      },
      {
        icon: "roles",
        title: "Rollen fürs Ehrenamt",
        description:
          "Trenne Leserechte, Inventarpflege, Ausgabe, Einkauf und Administration — auch mit bedingten Regeln für bestimmte Einträge.",
      },
      {
        icon: "stock",
        title: "Stückzahl oder Einzelstück",
        description:
          "Verwalte Trikots als Menge und teure Technik als einzelne Einheit mit Seriennummer, Status und eigenem Lagerort.",
      },
      {
        icon: "orders",
        title: "Bedarf & Beschaffung",
        description:
          "Mindestmengen, Verbrauchsraten, Bestellungen und Teilwareneingänge unterstützen die Planung für Training und Veranstaltung.",
      },
    ],
    iosTitle: "Beim Aufbau scannen, nicht später nachtragen.",
    iosCopy:
      "Mit der nativen iPhone-App lässt sich Material dort erfassen und bewegen, wo es genutzt wird. Die Kamera bleibt derselbe Einstieg für Foto, Code und Bestandsaktion.",
    iosPoints: [
      "Material per Code, SKU oder Seriennummer aufrufen",
      "Fotos direkt am Lagerort aufnehmen und hochladen",
      "Buchungen vor der Bestätigung noch einmal prüfen",
    ],
    openSourceTitle: "Offen genug für wechselnde Verantwortliche.",
    openSourceCopy:
      "Als MIT-lizenziertes Open-Source-Projekt lässt sich Open Inventory unabhängig betreiben und dokumentiert übergeben. Verein und Daten bleiben nicht an einen Anbieter gebunden.",
  },
  {
    slug: "sammlung",
    name: "Sammlung",
    eyebrow: "Objekte & dokumentierte Herkunft",
    title: "Eine Sammlung, die mehr weiß als ihre Regalfächer.",
    cardCopy:
      "Fotos, Zustand, Standort, Beziehungen und eigene Metadaten in einem offenen, durchsuchbaren Katalog bewahren.",
    description:
      "Open Inventory verbindet visuelle Dokumentation mit frei konfigurierbaren Daten. So entsteht aus vielen Einzelobjekten ein konsistenter Katalog, der privat bleiben oder gezielt lesbar geteilt werden kann.",
    image: "/marketing/usecase-collection-v2.webp",
    imageAlt:
      "Sammler dokumentiert gebrauchte Kameras und Alltagsobjekte an einem einfachen Arbeitstisch",
    visual: "collection",
    accent: "text-[#aa4b08]",
    softAccent: "bg-[#fff1df] text-[#9a4308]",
    challenge:
      "Bei wachsenden Sammlungen reichen Dateinamen und Regalnummern nicht aus. Zustand, Herkunft, Beziehungen und mehrere Ansichten eines Objekts sollen zusammenbleiben und exportierbar sein.",
    promises: [
      "Mehrere Fotos und strukturierte Metadaten pro Objekt bewahren",
      "Objekte über Orte, Behälter und Beziehungen erschließen",
      "Kataloge lesen lassen, ohne Bearbeitung freizugeben",
    ],
    mockData: [
      {
        name: "Analoge Kamera · 1978",
        meta: "Vitrine Nord · Erwerb 2019",
        status: "Dokumentiert",
      },
      {
        name: "Sonderdruck Bauhaus",
        meta: "Archivbox P-14 · Zustand sehr gut",
        status: "Nicht ausgestellt",
      },
      {
        name: "Keramikvase · Werkstattmarke AB",
        meta: "Wohnraum · Regal oben",
        status: "Ausgestellt",
      },
    ],
    steps: [
      {
        title: "Ansichten fotografieren",
        description:
          "Hinterlege mehrere Bilder, Alt-Texte und geordnete Medien. Eine optionale KI-Analyse kann beschreibende Felder zur Prüfung vorschlagen.",
      },
      {
        title: "Schema anpassen",
        description:
          "Eigene Inventartypen und typisierte Felder erfassen Epoche, Material, Provenienz, Zustand oder beliebige weitere Merkmale.",
      },
      {
        title: "Kontext verbinden",
        description:
          "Beziehungen verknüpfen Sets, Serien und Behälter. Standorte reichen vom Regalfach bis zur GPS-Position oder Kartenfläche.",
      },
      {
        title: "Katalog nutzen",
        description:
          "Suche und filtere die Sammlung, exportiere sie als CSV oder veröffentliche eine ausgewählte Ansicht als schreibgeschützten Link.",
      },
    ],
    features: [
      {
        icon: "camera",
        title: "Geordnete Medien",
        description:
          "Speichere mehrere Fotos und weitere unterstützte Medien, bestimme das Titelbild und pflege zugängliche Alt-Texte.",
      },
      {
        icon: "relations",
        title: "Beziehungen & Behälter",
        description:
          "Konfigurierbare gerichtete Beziehungen verbinden Serien, Bestandteile, Gegenstücke oder die Box, in der ein Objekt liegt.",
      },
      {
        icon: "locations",
        title: "Präzise Fundorte",
        description:
          "Textorte, Inventarlager, GPS-Koordinaten und GeoJSON-kompatible Kartenobjekte halten physische Fundorte nachvollziehbar.",
      },
      {
        icon: "languages",
        title: "Mehrsprachige Inhalte",
        description:
          "Eine kanonische Sprache und prüfbare KI-Übersetzungen können Beschreibungen, passende eigene Felder und Alt-Texte ergänzen.",
      },
      {
        icon: "sharing",
        title: "Lesbarer Online-Katalog",
        description:
          "Öffentliche Freigaben zeigen ausgewählte Inhalte schreibgeschützt; der interne Arbeitsbereich und seine Rechte bleiben getrennt.",
      },
      {
        icon: "csv",
        title: "Offener Export",
        description:
          "CSV-Export und REST-API machen die Katalogdaten für Backups, Auswertungen oder eine spätere Weiterverwendung erreichbar.",
      },
    ],
    iosTitle: "Dokumentieren, solange das Objekt vor dir liegt.",
    iosCopy:
      "Die native iOS-App nimmt mehrere Fotos auf, ergänzt optional den GPS-Ort und lädt den Datensatz über eine wiederaufnehmbare Warteschlange in deine Instanz.",
    iosPoints: [
      "Bis zu zwölf Fotos pro Erfassung vorbereiten",
      "Optional eine saubere quadratische Cover-Version erzeugen lassen",
      "Vorhandene Objekte über eigene Etiketten wiederfinden",
    ],
    openSourceTitle: "Der Katalog bleibt so offen wie die Forschung daran.",
    openSourceCopy:
      "Open Inventory ist Open Source und MIT-lizenziert. Self-Hosting, CSV und OpenAPI geben dir Kontrolle über Bilder, Metadaten und die langfristige Weiterverwendung.",
  },
  {
    slug: "schule",
    name: "Schule",
    eyebrow: "Leihgeräte & Fachräume",
    title: "Gemeinsame Geräte verwalten, ohne den Unterricht auszubremsen.",
    cardCopy:
      "Tablets, Experimentierkoffer und Fachraumausstattung schnell erfassen, ausgeben und regelmäßig prüfen.",
    description:
      "Open Inventory verbindet Fotodokumentation, Gerätewagen, Etiketten und Inventurzyklen in einer selbst gehosteten Anwendung. Lehrkräfte finden Ausstattung schnell, während Verwaltung und Technik verlässliche Bestandsdaten behalten.",
    image: "/marketing/usecase-school-v2.webp",
    imageAlt:
      "Zwei Schulmitarbeitende prüfen einen sichtbar gebrauchten Wagen mit gemeinsam genutzten Tablets",
    visual: "school",
    accent: "text-[#3f5fc7]",
    softAccent: "bg-[#e8edff] text-[#3955b8]",
    challenge:
      "Geräte wechseln zwischen Klassen, Fachräumen und Ausleihe. Wenn Seriennummern, Zustände und Rückgaben nur in einzelnen Listen stehen, fehlt bei Übergaben schnell der gemeinsame Überblick.",
    promises: [
      "Gerätewagen und Einzelgeräte per Foto oder Code erfassen",
      "Ausgabe, Rückgabe und nächsten Inventurtermin nachvollziehen",
      "Rollen für Lehrkräfte, Technik und Verwaltung sauber trennen",
    ],
    mockData: [
      { name: "Tablet 8 · Wagen Nord", meta: "SN EDU-208 · Raum 2.14", status: "Verfügbar" },
      { name: "Mikroskop Schülerplatz 12", meta: "Biologie · Schrank B", status: "Zu prüfen" },
      { name: "Experimentierkoffer Elektrik", meta: "Physik · Ausgabe an 9b", status: "Ausgegeben" },
    ],
    steps: [
      { title: "Wagen fotografieren", description: "Erfasse neue Geräte direkt im Fachraum. Fotos und prüfbare Vorschläge verkürzen den Start, ohne Daten ungeprüft zu übernehmen." },
      { title: "Einheiten serialisieren", description: "Jedes Tablet oder Messgerät erhält einen eigenen Code, Status und Standort; Verbrauchsteile bleiben als Mengenbestand handlich." },
      { title: "Ausgabe scannen", description: "Ein Code führt zum richtigen Gerät. Ausgabe und Rückgabe werden bestätigt und mit Empfänger oder Raum dokumentiert." },
      { title: "Inventur planen", description: "Wiederkehrende Prüfzyklen zeigen fällige Geräte und halten den gezählten Bestand je Standort nachvollziehbar." },
    ],
    features: [
      { icon: "stock", title: "Geräte & Mengenbestand", description: "Verwalte Tablets als einzelne Einheiten und Kabel, Sensoren oder Verbrauchsmaterial als Mengenbestand im selben System." },
      { icon: "labels", title: "QR- und Barcode-Etiketten", description: "Eigene Vorlagen verbinden Geräte, Wagen und Schränke mit dem passenden offenen Datensatz." },
      { icon: "history", title: "Ausgabe & Rückgabe", description: "Dokumentiere Ausleihen, Reservierungen und Rückgaben, ohne ältere Bewegungen zu überschreiben." },
      { icon: "locations", title: "Fachräume & Schränke", description: "Ordne Geräte Räumen, Wagen und Lagerorten zu und finde sie über Suche oder Scan wieder." },
      { icon: "roles", title: "Rollen nach Aufgabe", description: "Trenne Lesen, Erfassen, Ausgeben und Administration für Lehrkräfte, Technik und Verwaltung." },
      { icon: "csv", title: "Offener Datenaustausch", description: "Validierte CSV-Importe erleichtern den Einstieg; CSV und REST-API halten die Daten portabel." },
    ],
    iosTitle: "Inventur direkt am Gerätewagen.",
    iosCopy:
      "Die native SwiftUI-App liegt im selben Open-Source-Repository. Mit der iPhone-Kamera lassen sich Codes prüfen, Geräte fotografieren und Bestandsaktionen gegen die eigene Instanz ausführen.",
    iosPoints: [
      "Geräte per Inventarcode oder Seriennummer auflösen",
      "Fotos und Zustand dort ergänzen, wo das Gerät steht",
      "Wiederholbare Upload-Aufträge ohne doppelte Einträge",
    ],
    openSourceTitle: "Schuldaten und Gerätebestand bleiben in eigener Verantwortung.",
    openSourceCopy:
      "Open Inventory ist MIT-lizenziert und mit Docker selbst betreibbar. Web-App, API, Migrationen und iOS-Code sind einsehbar; externe Provider bleiben bewusste, konfigurierbare Entscheidungen.",
  },
  {
    slug: "handwerk",
    name: "Handwerk",
    eyebrow: "Fahrzeuge & Baustellen",
    title: "Werkzeug dort buchen, wo es gerade eingesetzt wird.",
    cardCopy:
      "Fahrzeugbestände, Elektrowerkzeuge und Verbrauchsmaterial mobil erfassen und verlässlich nachbestellen.",
    description:
      "Open Inventory macht Servicefahrzeuge und Lager zu nachvollziehbaren Standorten. Mitarbeitende scannen oder fotografieren vor Ort; Bestand, Ausgabe und Nachbestellung greifen im selbst gehosteten System zusammen.",
    image: "/marketing/usecase-trades-v2.webp",
    imageAlt:
      "Servicetechniker dokumentiert Werkzeugkoffer in den gebrauchten Regalen eines Arbeitsfahrzeugs",
    visual: "trades",
    accent: "text-[#a54c0b]",
    softAccent: "bg-[#fff0df] text-[#914108]",
    challenge:
      "Werkzeug und Material verteilen sich auf Werkstatt, Fahrzeuge und Baustellen. Ohne einfache Buchung bleibt unklar, welches Team etwas nutzt und was vor dem nächsten Einsatz fehlt.",
    promises: [
      "Bestand je Fahrzeug, Lager und Baustelle sehen",
      "Werkzeuge serialisieren und Mitarbeitenden zuweisen",
      "Verbrauch und offene Bestellungen in der Prognose verbinden",
    ],
    mockData: [
      { name: "Akku-Bohrhammer 18 V", meta: "Servicewagen 4 · Fach C", status: "Im Einsatz" },
      { name: "WAGO-Klemmen 221", meta: "Zentrallager · 86 Stück", status: "Nachbestellen" },
      { name: "Kabelprüfgerät", meta: "SN KP-1048 · Team Nord", status: "Zugewiesen" },
    ],
    steps: [
      { title: "Vor Ort erfassen", description: "Foto oder bestehender Code startet den Eintrag. Der Vorschlag wird geprüft, bevor das Gerät oder Material gespeichert wird." },
      { title: "Fahrzeug zuordnen", description: "Fahrzeuge, Lager und Baustellen werden zu strukturierten Standorten mit eigener Bestandsverteilung." },
      { title: "Nutzung buchen", description: "Serialisierte Werkzeuge lassen sich zuweisen; Verbrauchsmaterial wird als Zu- oder Abgang mit Verlauf gebucht." },
      { title: "Nachschub planen", description: "Mindestbestand, Verbrauchsrate und offene Bestellungen ergeben einen nachvollziehbaren Vorschlag statt einer Bauchentscheidung." },
    ],
    features: [
      { icon: "locations", title: "Bestand je Fahrzeug", description: "Führe jeden Servicewagen und jedes Lager als eigenen Standort, ohne die Gesamtmenge aus dem Blick zu verlieren." },
      { icon: "stock", title: "Bulk & serialisiert", description: "Schrauben und Kabel als Menge, Mess- und Elektrowerkzeuge als einzelne Einheit mit Status und Code." },
      { icon: "history", title: "Zuweisung mit Verlauf", description: "Buche Werkzeuge an Teams, Nutzer oder Projekte und dokumentiere Rückgabe oder Transfer append-only." },
      { icon: "orders", title: "Mindestbestand & Einkauf", description: "Verbrauch, Lieferzeit und Bestellungen fließen in Warnungen und begründete Nachbestellmengen ein." },
      { icon: "labels", title: "Robuste Scan-Abläufe", description: "QR, Code 128 und weitere Codes öffnen den passenden Gegenstand oder eine vorkonfigurierte Lageraktion." },
      { icon: "api", title: "Offene Integration", description: "OpenAPI 3.1 und scoped Tokens verbinden Bestandsdaten mit eigenen Einsatz- oder Einkaufssystemen." },
    ],
    iosTitle: "Das iPhone ist schon auf der Baustelle.",
    iosCopy:
      "Die native App nutzt Kamera, Code-Erkennung und eine wiederaufnehmbare Warteschlange. Sie verbindet sich per HTTPS mit der eigenen Open-Inventory-Instanz.",
    iosPoints: [
      "Werkzeug und Material per Code sofort öffnen",
      "Zu- und Abgänge vor der Buchung prüfen",
      "Fotos neuer Geräte direkt am Fahrzeug aufnehmen",
    ],
    openSourceTitle: "Ein Betriebssystem für Dinge – ohne Anbieterzwang.",
    openSourceCopy:
      "Der MIT-lizenzierte Code, Docker/PostgreSQL und die dokumentierte API erlauben eigene Prozesse und Integrationen. Backups, Updates und externe Provider bleiben transparent in der Hand des Betriebs.",
  },
  {
    slug: "labor",
    name: "Labor",
    eyebrow: "Messgeräte & Prototyping",
    title: "Messgeräte, Teile und Aufbauten verlässlich wiederfinden.",
    cardCopy:
      "Geräte, Komponenten und Prototypteile mit Seriennummer, Standort, Stückliste und offenen Schnittstellen organisieren.",
    description:
      "Open Inventory ist kein LIMS, sondern ein offener Inventarbaustein für technische Labore und Prototyping. Messgeräte, Teileboxen und Baugruppen werden fotografiert, strukturiert und nachvollziehbar bewegt.",
    image: "/marketing/usecase-lab-v2.webp",
    imageAlt:
      "Mitarbeiter dokumentiert ein sichtbar gebrauchtes Messgerät an einem realistischen Elektronikarbeitsplatz",
    visual: "lab",
    accent: "text-[#08765e]",
    softAccent: "bg-[#e0f8ef] text-[#08765e]",
    challenge:
      "In gemeinsam genutzten Laboren wandern Messgeräte, Komponenten und Prototypteile zwischen Arbeitsplätzen. Seriennummer, Zubehör und aktueller Aufbau sollen zusammenbleiben, ohne ein geschlossenes Spezialprodukt zu erzwingen.",
    promises: [
      "Messgeräte und Zubehör als Beziehungen oder Stückliste verbinden",
      "Eigene Felder für Prüf- und Beschaffungsdaten nutzen",
      "Daten über CSV und dokumentierte OpenAPI weiterverarbeiten",
    ],
    mockData: [
      { name: "Digitaloszilloskop 100 MHz", meta: "Elektronikplatz 3 · SN LAB-021", status: "Verfügbar" },
      { name: "Sensorboard Revision C", meta: "Prototypenbox P-08 · 14 Stück", status: "Auf Lager" },
      { name: "Netzteil 0–30 V", meta: "Messplatz 1 · Prüfung 11/2026", status: "Zugewiesen" },
    ],
    steps: [
      { title: "Gerät fotografieren", description: "Erfasse Typenschild, Zubehör und Zustand mit mehreren Bildern. Vorschläge bleiben vor der Übernahme prüfbar." },
      { title: "Felder ergänzen", description: "Eigene Typen und Felder bilden Prüfdatum, Herstellerdaten, Revision oder Verantwortungsbereich passend zum Labor ab." },
      { title: "Aufbau verbinden", description: "Beziehungen und Stücklisten verbinden Gerät, Tastkopf, Halterung und verbrauchte Komponenten zu einem nachvollziehbaren Aufbau." },
      { title: "Nutzung dokumentieren", description: "Zuweisung, Standortwechsel und Inventur werden datiert gespeichert; offene Datenwege ermöglichen weitere Auswertung." },
    ],
    features: [
      { icon: "camera", title: "Mehrere Ansichten", description: "Dokumentiere Gerät, Typenschild, Zubehör und Zustand mit geordneten Fotos und zugänglichen Alt-Texten." },
      { icon: "stock", title: "Geräte & Teilemengen", description: "Seriennummern für Messgeräte, Mengenbestand für Sensoren, Stecker und andere gleichartige Teile." },
      { icon: "relations", title: "Beziehungen & Stücklisten", description: "Verknüpfe Zubehör, Gegenstücke und Prototypkomponenten; Montagebuchungen verbrauchen Teile atomar." },
      { icon: "locations", title: "Arbeitsplätze & Räume", description: "Strukturierte Orte und optional räumliche Erfassung helfen bei gemeinsam genutzten Arbeitsbereichen." },
      { icon: "history", title: "Bewegungen & Inventur", description: "Transfers, Zuweisungen und wiederkehrende Zählungen bleiben nachvollziehbar, ohne ältere Werte zu überschreiben." },
      { icon: "api", title: "OpenAPI-Vertrag", description: "Die eingecheckte Spezifikation und widerrufbare Tokens machen eigene Auswertungen und Automationen planbar." },
    ],
    iosTitle: "Erfassen direkt am Messplatz.",
    iosCopy:
      "Die native iOS-App fotografiert Geräte, erkennt Codes und nutzt dieselbe offene API wie die Web-App. Der Server bleibt die eigene Instanz.",
    iosPoints: [
      "Bis zu zwölf Fotos pro Erfassung vorbereiten",
      "Codes und Seriennummern direkt am Gerät auflösen",
      "Übertragungen nach Unterbrechungen sicher wiederholen",
    ],
    openSourceTitle: "Technische Dokumentation braucht einen offenen Ausgang.",
    openSourceCopy:
      "Open Inventory veröffentlicht Web-App, API, Migrationen und iOS-App unter MIT. Daten lassen sich per CSV und OpenAPI weiterverwenden; externe KI- oder Speicheranbieter sind optionale Konfigurationen.",
  },
];

export function getUseCase(slug: string) {
  return useCases.find((useCase) => useCase.slug === slug);
}
