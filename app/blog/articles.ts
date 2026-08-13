export const githubUrl = "https://github.com/Utzel-Butzel/inventory";

export type ArticleLink = {
  label: string;
  href: string;
  description: string;
  external?: boolean;
};

export type ArticleSection = {
  id: string;
  eyebrow?: string;
  title: string;
  paragraphs?: string[];
  steps?: Array<{
    title: string;
    body: string;
  }>;
  bullets?: string[];
  note?: {
    title: string;
    body: string;
    tone?: "brand" | "warning" | "success";
  };
};

export type BlogArticle = {
  slug: string;
  category: string;
  title: string;
  shortTitle: string;
  excerpt: string;
  description: string;
  publishedAt: string;
  publishedLabel: string;
  readingTime: string;
  accent: string;
  accentSoft: string;
  cover: {
    src: string;
    alt: string;
    width: number;
    height: number;
    caption: string;
  };
  takeaways: string[];
  sections: ArticleSection[];
  relatedLinks: ArticleLink[];
};

export const articles: BlogArticle[] = [
  {
    slug: "serienerfassung-in-sekunden",
    category: "Workflow",
    title: "Serienerfassung: Was beim Batch-Workflow Zeit spart",
    shortTitle: "Serienerfassung als Batch",
    excerpt:
      "Standort und Typ werden einmal gesetzt. Jede Aufnahme landet in einer Queue; Upload, Analyse und Cover laufen weiter, während du das nächste Objekt fotografierst.",
    description:
      "Technischer Überblick über Batch-Erfassung, Queue-Stufen und Idempotenz in Web-Client und nativer iOS-App.",
    publishedAt: "2026-08-13",
    publishedLabel: "13. August 2026",
    readingTime: "7 Min. Lesezeit",
    accent: "from-[#665cff] to-[#9088ff]",
    accentSoft: "bg-brand-soft text-brand",
    cover: {
      src: "/marketing/blog/series-capture.webp",
      alt: "Eine Person fotografiert ein gebrauchtes Werkzeug in einem Werkstattregal mit dem Smartphone.",
      width: 1536,
      height: 1024,
      caption:
        "Illustratives Bild zur Serienerfassung. Mit ImageGen erstellt; kein Foto einer realen Open-Inventory-Installation.",
    },
    takeaways: [
      "Gemeinsame Felder werden pro Batch wiederverwendet",
      "Resource-, Media-, Analyse- und Cover-Schritte laufen getrennt",
      "Stabile Idempotency-Keys verhindern Duplikate bei definierten Retries",
    ],
    sections: [
      {
        id: "warum-serienerfassung",
        eyebrow: "Das eigentliche Problem",
        title: "Welche Eingaben pro Batch wiederverwendet werden",
        paragraphs: [
          "Bei einer Serie kosten die wiederholten Kontextwechsel mehr Zeit als ein einzelnes Textfeld. Typ und Standort ändern sich innerhalb eines Regals oft nicht. Deshalb setzt du diese Werte einmal und übernimmst sie für die folgenden Aufnahmen.",
          "Für jedes Foto legt der Client einen eigenen Auftrag an. Der Server erstellt zuerst den Inventareintrag, danach die Medien. Analyse und Cover sind optionale, getrennte Schritte. Ein Fehler beim Cover muss also nicht die bereits hochgeladenen Fotos verwerfen.",
          "„In Sekunden statt Stunden“ beschreibt das Ziel für die Aufnahme vor Ort, nicht eine veröffentlichte Benchmark. Die Verarbeitung kann danach weiterlaufen. Gesamtdauer und Durchsatz hängen von Netz, Server, Bildgröße und aktivierten externen Diensten ab.",
        ],
      },
      {
        id: "workflow",
        eyebrow: "Der Ablauf",
        title: "Die Queue in fünf Schritten",
        steps: [
          {
            title: "Batch-Kontext setzen",
            body: "Wähle gemeinsame Werte, zum Beispiel Typ „Werkzeug“ und Standort „Werkstatt · Regal B2“. Cover-Erzeugung und Analyse bleiben optional.",
          },
          {
            title: "Aufnahmen lokal vorbereiten",
            body: "Nimm ein Hauptfoto und bei Bedarf weitere Blickwinkel auf. Modellnummern und Typenschilder gehören auf separate, scharfe Bilder.",
          },
          {
            title: "Resource und Medien anlegen",
            body: "Der Client erstellt den Eintrag und lädt anschließend die Bilder hoch. Beide Stufen haben eigene Status- und Fehlerzustände.",
          },
          {
            title: "Queue weiterarbeiten lassen",
            body: "Du startest die nächste Aufnahme, während frühere Jobs weiterlaufen. Definierte Wiederholungen nutzen stabile Operation-IDs und serverseitige Idempotency-Keys.",
          },
          {
            title: "Ergebnisse prüfen",
            body: "Kontrolliere Name, Tracking-Modus, Standort und Bilder. Seriennummern und benutzerdefinierte Felder werden nicht durch ein brauchbares Foto ersetzt.",
          },
        ],
        note: {
          title: "Pragmatische Fotoregel",
          body: "Ein gutes Foto spart mehr Zeit als drei unklare. Sorge für ruhiges Licht, fülle den Bildausschnitt mit dem Objekt und fotografiere Typenschilder separat.",
          tone: "success",
        },
      },
      {
        id: "browser-oder-ios",
        eyebrow: "Browser und iPhone",
        title: "Web-Client und iOS-App im Vergleich",
        paragraphs: [
          "Der Web-Client kombiniert Browser-Kamera und vorhandene Dateien. Das passt zu Laptop oder Tablet am Arbeitstisch. Die native SwiftUI-App nutzt AVFoundation direkt und enthält zusätzlich Code-Scanner und RoomPlan-Pfade.",
          "Unter iOS werden Fotos und Stage-Status in einer servergebundenen Outbox unter Application Support persistiert. Nach einem Neustart prüft die App den letzten bestätigten Schritt und setzt dort fort. Das ist keine Offline-Synchronisation des ganzen Datenmodells, sondern eine persistente Upload-Queue.",
        ],
        bullets: [
          "Browser-Kamera benötigt HTTPS oder localhost; alternativ lassen sich Fotos hochladen.",
          "Für die native App muss dein selbst gehosteter Server vom iPhone erreichbar sein. Öffentliche Verbindungen sollten HTTPS verwenden.",
          "Optionale KI-Schritte verlassen den eigenen Server: Analyse nutzt OpenAI, Cover können über OpenAI oder Google laufen, Fotozählung über Replicate.",
          "Barcode-Erkennung ersetzt keine inhaltliche Prüfung, wenn mehrere Artikel denselben oder gar keinen Code tragen.",
        ],
      },
      {
        id: "danach",
        eyebrow: "Nach der Aufnahme",
        title: "Nach der Verarbeitung: Felder und Bilder prüfen",
        paragraphs: [
          "Die Queue liefert zunächst einen bearbeitbaren Datensatz. Danach musst du prüfen, ob Standort, Tracking-Modus, Menge und Bilder zum realen Objekt passen. Für Seriennummern oder sicherheitsrelevante Angaben sollte kein Modellvorschlag ungeprüft übernommen werden.",
          "Der komplette Pfad liegt im MIT-lizenzierten Repository: Web-Client, REST-Routen und die SwiftUI-Outbox sind Open Source. Damit lassen sich Queue-Verhalten und Datenfluss direkt im Code prüfen und bei Bedarf ändern.",
        ],
      },
    ],
    relatedLinks: [
      {
        label: "Features ansehen",
        href: "/features",
        description: "Serienerfassung, Bilder, Standorte und Bestände im Überblick",
      },
      {
        label: "Usecase Familie",
        href: "/use-cases/familie",
        description: "Keller, Haushalt und gemeinsame Dinge ohne Tabellenchaos",
      },
      {
        label: "iOS-App kennenlernen",
        href: "/ios",
        description: "Native Kamera, Scanner und mobile Warteschlange",
      },
      {
        label: "Projekt auf GitHub",
        href: githubUrl,
        description: "MIT-lizenzierten Quellcode lesen und mitentwickeln",
        external: true,
      },
    ],
  },
  {
    slug: "mengenbestand-oder-serialisiert",
    category: "Grundlagen",
    title: "Mengenbestand oder serialisiert: Unterschiede im Datenmodell",
    shortTitle: "Bulk und serialisiert",
    excerpt:
      "Im Bulk-Modus wird eine Menge gebucht. Im serialisierten Modus hat jede Einheit Code, Status und Standort. Der Wechsel hat technische Nebenbedingungen.",
    description:
      "Technischer Vergleich von Bulk- und serialisiertem Tracking in Open Inventory, inklusive Bewegungen und Moduswechsel.",
    publishedAt: "2026-08-10",
    publishedLabel: "10. August 2026",
    readingTime: "8 Min. Lesezeit",
    accent: "from-[#1eaf82] to-[#8ff0cc]",
    accentSoft: "bg-success-soft text-success",
    cover: {
      src: "/marketing/blog/stock-models.webp",
      alt: "Lose Schrauben und Kabelbinder liegen neben einzeln nummerierten Messwerkzeugen auf einer Werkbank.",
      width: 1536,
      height: 1024,
      caption:
        "Illustratives Bild zu Bulk- und Einzelverfolgung. Mit ImageGen erstellt; kein Foto einer realen Open-Inventory-Installation.",
    },
    takeaways: [
      "`trackingMode: bulk` bucht Mengen pro Inventareintrag und Standort",
      "`trackingMode: serialized` speichert identifizierte Einheiten",
      "Ein Moduswechsel prüft Bestand, Varianten, Zuweisungen und Einheiten",
    ],
    sections: [
      {
        id: "unterschied",
        eyebrow: "Zwei Modelle",
        title: "trackingMode legt die Buchungslogik fest",
        paragraphs: [
          "In der API heißt der Schalter `trackingMode`; in PostgreSQL liegt er als `stock_settings.tracking_mode`. `bulk` erlaubt Mengenbuchungen und Bestände pro Standort. Das passt zu Schrauben, Kabelbindern oder identischen Ersatzteilen.",
          "Bei `serialized` erhält jede physische Einheit einen eigenen Datensatz mit Code, Status und Standort. Direkte Mengenbuchungen sind dann gesperrt. Stattdessen wird eine konkrete Einheit erstellt, verschoben oder im Status geändert.",
          "Beide Modelle schreiben Bewegungen in die Historie. Der Unterschied ist die kleinste adressierbare Einheit: eine Zahl im Bulk-Modus, ein identifiziertes Objekt im serialisierten Modus.",
        ],
      },
      {
        id: "entscheidung",
        eyebrow: "Entscheidungshilfe",
        title: "Entscheidungskriterien",
        steps: [
          {
            title: "Ist jede Einheit austauschbar?",
            body: "Wenn jede Einheit denselben Zweck erfüllt und keine eigene Historie braucht, reicht Bulk meistens aus.",
          },
          {
            title: "Braucht jede Einheit einen eigenen Status?",
            body: "Status wie `available`, `reserved`, `in-use`, `maintenance` oder `retired` benötigen eine identifizierte Einheit.",
          },
          {
            title: "Musst du den Standort einzeln kennen?",
            body: "Bulk speichert Mengen pro Standort. Wenn ein bestimmtes Messgerät auffindbar sein muss, braucht es eine eigene Einheit.",
          },
          {
            title: "Gibt es individuelle Merkmale?",
            body: "Seriennummer, Garantiedatum, Farbe, Kalibrierung oder Zuweisung lassen sich an einer serialisierten Einheit sauber abbilden.",
          },
          {
            title: "Ist der Pflegeaufwand gerechtfertigt?",
            body: "Jede Einheit einzeln zu registrieren und zu bewegen kostet Aufmerksamkeit. Serialisiere nur dort, wo die zusätzliche Information genutzt wird.",
          },
        ],
      },
      {
        id: "beispiele",
        eyebrow: "Praxis",
        title: "Beispiele für beide Modi",
        bullets: [
          "Makerspace: M4-Schrauben als Mengenbestand; Akkuschrauber mit Inventaretikett als serialisierte Einheiten.",
          "Familie: Umzugskartons als einzelne Inventareinträge oder Menge; Fahrräder mit Rahmennummer serialisiert.",
          "Startup: USB-C-Adapter als Mengenbestand; Firmenlaptops und Testtelefone serialisiert und Personen zugewiesen.",
          "Verein: Einwegbecher als Mengenbestand; Funkgeräte mit Ausleihe und Status serialisiert.",
          "Sammlung: Standardhüllen als Mengenbestand; jedes Werk mit Provenienz und individuellem Zustand serialisiert.",
        ],
        note: {
          title: "Beide Modi können parallel laufen",
          body: "`trackingMode` wird pro Inventareintrag gespeichert. Ein Workspace kann Verbrauchsmaterial als Bulk und Geräte serialisiert führen.",
          tone: "brand",
        },
      },
      {
        id: "wechsel",
        eyebrow: "Grenzen",
        title: "Was beim Moduswechsel geprüft wird",
        paragraphs: [
          "Beim Wechsel von Bulk zu serialisiert erzeugt Open Inventory eine Einheit pro vorhandener Menge. Dafür müssen Variantenbestände auf null stehen, aktive Zuweisungen oder Reservierungen beendet sein und Bulk-Bestand am Ort „Unassigned“ liegen. Pro Konvertierung gilt außerdem ein Limit von 5.000 Einheiten.",
          "Der Rückweg zu Bulk ist blockiert, solange identifizierte Einheiten existieren. Der Modus ist deshalb keine reine Darstellungsoption, sondern ändert erlaubte Buchungen und die gespeicherten Datensätze.",
          "Teste vor einem großen Import Wareneingang, Entnahme, Transfer, Ausleihe, Rückgabe und Inventur mit wenigen echten Objekten. Die Regeln stehen offen in `lib/stock.ts`, im Drizzle-Schema und in der OpenAPI-Spezifikation des MIT-lizenzierten Repositories.",
        ],
      },
    ],
    relatedLinks: [
      {
        label: "Inventory-Features",
        href: "/features",
        description: "Bestand, Bewegungsverlauf, Standorte und Inventurzyklen",
      },
      {
        label: "Usecase Startup",
        href: "/use-cases/startup",
        description: "Geräte, Zubehör und Zuweisungen im wachsenden Team",
      },
      {
        label: "Dokumentation",
        href: "/docs",
        description: "Installation, Konfiguration und API im Detail",
      },
      {
        label: "Open-Source-Code",
        href: githubUrl,
        description: "Datenmodell und MIT-Lizenz direkt auf GitHub prüfen",
        external: true,
      },
    ],
  },
  {
    slug: "qr-etiketten-im-makerspace",
    category: "Makerspace",
    title: "QR-Etiketten im Makerspace: Link, Layout und Scan-Workflow",
    shortTitle: "QR-Etiketten im Makerspace",
    excerpt:
      "Das Ressourcenetikett enthält einen kompakten Link unter /r/{code}. Layout, Material und Scan-Workflow entscheiden, ob es in der Werkstatt funktioniert.",
    description:
      "Technischer Überblick über kompakte Ressourcenlinks, Etikettenlayout, Druck und transaktionale Scan-Workflows.",
    publishedAt: "2026-08-07",
    publishedLabel: "7. August 2026",
    readingTime: "9 Min. Lesezeit",
    accent: "from-[#f09b32] to-[#f7c84d]",
    accentSoft: "bg-warning-soft text-warning",
    cover: {
      src: "/marketing/blog/qr-labels-makerspace.webp",
      alt: "Zwei Hände kleben ein QR-Etikett auf einen stark benutzten Werkzeugkoffer.",
      width: 1536,
      height: 1024,
      caption:
        "Illustratives Bild zum Etiketten-Workflow. Mit ImageGen erstellt; der abgebildete QR-Code ist kein Open-Inventory-Code.",
    },
    takeaways: [
      "Ressourcenlinks verwenden kurze Codes unter `/r/{code}`",
      "Etikett und ausführender Scan-Workflow sind getrennte Konzepte",
      "Druckmaß, Kontrast, Material und Scanabstand gehören in den Test",
    ],
    sections: [
      {
        id: "mehr-als-code",
        eyebrow: "Vor dem Druck",
        title: "Was im Ressourcen-QR steckt",
        paragraphs: [
          "`lib/resource-short-link.ts` erzeugt aus der Resource-UUID einen kurzen Code. Das Etikett kodiert dann eine URL unter `/r/{code}`. Die Route löst den Code serverseitig wieder in die UUID auf und leitet zum Datensatz weiter.",
          "Der Kurzlink umgeht keine Berechtigungen. Ohne gültige Sitzung landet der Browser zuerst bei der Anmeldung und wird danach zum Inventareintrag zurückgeführt. Name, Kennung und Standort sollten trotzdem als lesbarer Text auf dem Etikett stehen.",
          "Der Etikettendesigner kann QR-Code, Bild, Name, Identifier, Code 128, URL und Standort platzieren. Die Maße werden in Millimetern gespeichert. Presets sind nur Startwerte; Browser, Druckertreiber und reales Medium bleiben Teil der Ausgabe.",
        ],
      },
      {
        id: "workflow",
        eyebrow: "Werkstatt-Workflow",
        title: "Pilot mit echten Werkzeugen",
        steps: [
          {
            title: "Standorte und Rechte festlegen",
            body: "Lege Räume, Schränke und Regale als Standorte an. Prüfe getrennt, wer Datensätze ändern, Etiketten verwalten und Bestand buchen darf.",
          },
          {
            title: "Pilotgruppe inventarisieren",
            body: "Starte mit einer überschaubaren Gruppe, etwa Handmaschinen. Wähle serialisierte Einheiten für individuell verfolgte Geräte und Mengenbestand für austauschbares Verbrauchsmaterial.",
          },
          {
            title: "Layout in Millimetern bauen",
            body: "Drucke Name, kurze Kennung, Standort und einen ausreichend großen QR-Code. Vermeide kleine Schmuckelemente, die Lesbarkeit und Haltbarkeit nicht verbessern.",
          },
          {
            title: "Druck und Scan testen",
            body: "Scanne aus typischem Abstand, mit Werkstattlicht und einem nicht frisch gereinigten Etikett. Prüfe außerdem Anmeldung, mobile Ansicht und Rückweg zum Regal.",
          },
          {
            title: "Setup versionieren und wiederverwenden",
            body: "Passe Vorlage und Befestigung nach dem Pilot an. Gespeicherte Setups haben eine Revision und schützen parallele Änderungen vor stillem Überschreiben.",
          },
        ],
      },
      {
        id: "scan-workflows",
        eyebrow: "Zwei Arten von Scan",
        title: "Ressourcenlink und Scan-Ausführung sind getrennt",
        paragraphs: [
          "Ein Ressourcenetikett öffnet nur einen vorhandenen Datensatz. Konfigurierbare Scan-Workflows sind ein eigener Pfad: Sie lesen fremde Codes, extrahieren den relevanten Wert und können eine serialisierte Einheit nach einer Vorschau ändern.",
          "Vor der Mutation zeigt der Server Ziel und Diff. Die Ausführung läuft mit Idempotency-Key in einer Transaktion zusammen mit Bestandsbewegung und Audit-Eintrag. Ist die Vorschau veraltet, muss sie neu geladen werden. Für einfache Ausleihe kann das Öffnen des Datensatzes trotzdem der kürzere Weg sein.",
        ],
        bullets: [
          "Der visuelle Browser-Scanner benötigt HTTPS oder localhost und eine Kamerafreigabe.",
          "Alternativ kann ein QR-Foto hochgeladen oder der decodierte Inhalt eingefügt werden.",
          "Ein Scan-Workflow arbeitet derzeit mit serialisiertem Inventar, weil er eine konkrete Einheit identifiziert.",
          "Externe Codes sollten zunächst mit realen Exemplaren getestet werden; nicht jeder aufgedruckte Code enthält eine stabile, eindeutige Kennung.",
        ],
      },
      {
        id: "material",
        eyebrow: "Physische Realität",
        title: "Drucker und Material sind Teil des Systems",
        paragraphs: [
          "Staub, Öl, Abrieb, Rundungen und Metallflächen entscheiden über die Lebensdauer eines Etiketts. Reinige die Fläche, wähle ein für den Untergrund geeignetes Material und platziere den Code dort, wo er beim normalen Gebrauch nicht übergriffen wird. Bei kleinen, heißen oder stark beanspruchten Werkzeugen kann ein Anhänger besser sein als ein Aufkleber.",
          "Der Browser nutzt beim Drucken den Systemdialog. Ein Netzwerkdrucker muss deshalb im Betriebssystem eingerichtet, die richtige Mediengröße gewählt und die Seitenskalierung deaktiviert sein. Open Inventory kann den Druckinhalt vorbereiten, aber keine mechanischen Druckerprobleme oder ungeeignetes Verbrauchsmaterial ausgleichen.",
          "Open Inventory ist MIT-lizenziert und Open Source. Bei lokaler Speicherung laufen Anwendung, PostgreSQL und Uploads auf der eigenen Infrastruktur. Wer Openinary oder optionale KI-Anbieter konfiguriert, nutzt dagegen zusätzliche externe Datenpfade; diese gehören in die Betriebsdokumentation des Makerspaces.",
        ],
      },
    ],
    relatedLinks: [
      {
        label: "Usecase Makerspace",
        href: "/use-cases/makerspace",
        description: "Werkzeuge, Teile, Räume und gemeinsame Verantwortung",
      },
      {
        label: "Usecase Verein",
        href: "/use-cases/verein",
        description: "Gemeinsam genutztes Material transparent organisieren",
      },
      {
        label: "Alle Features",
        href: "/features",
        description: "QR, Barcodes, Etiketten, Standorte und Bewegungen",
      },
      {
        label: "GitHub & Issues",
        href: githubUrl,
        description: "Open Source unter MIT – nachvollziehen und verbessern",
        external: true,
      },
    ],
  },
  {
    slug: "warum-inventar-selbst-hosten",
    category: "Open Source",
    title: "Inventar selbst hosten: Komponenten und Betriebsaufgaben",
    shortTitle: "Self-Hosting im Betrieb",
    excerpt:
      "Next.js, PostgreSQL und Upload-Speicher lassen sich selbst betreiben. Dafür müssen Backups, TLS, Updates und externe Datenpfade sauber konfiguriert werden.",
    description:
      "Technischer Überblick über den selbst gehosteten Open-Inventory-Stack, externe Dienste und laufende Betriebsaufgaben.",
    publishedAt: "2026-08-04",
    publishedLabel: "4. August 2026",
    readingTime: "8 Min. Lesezeit",
    accent: "from-[#272936] to-[#665cff]",
    accentSoft: "bg-surface-muted text-foreground",
    cover: {
      src: "/marketing/blog/self-hosting-homelab.webp",
      alt: "Ein kleiner Homelab-Aufbau mit Mini-PC, NAS, Switch und sichtbaren Netzwerkkabeln.",
      width: 1536,
      height: 1024,
      caption:
        "Illustratives Bild eines kleinen Homelabs. Mit ImageGen erstellt; kein Foto einer realen Open-Inventory-Installation.",
    },
    takeaways: [
      "Anwendung und PostgreSQL laufen im Docker-Compose-Stack",
      "Uploads können lokal oder über Openinary gespeichert werden",
      "Backup, Restore-Test, TLS, Monitoring und Updates bleiben eigene Aufgaben",
    ],
    sections: [
      {
        id: "was-self-hosting-heisst",
        eyebrow: "Begriffe klären",
        title: "Welche Komponenten selbst laufen",
        paragraphs: [
          "Der eingecheckte Compose-Stack startet PostgreSQL, führt Migrationen aus und startet die Next.js-Anwendung. Persistente Volumes halten Datenbank und lokale Uploads außerhalb des Container-Dateisystems.",
          "Der Upload-Pfad ist konfigurierbar. Mit lokalem Storage bleiben Medien auf dem eigenen Volume. Mit Openinary werden Dateien an dessen Upload-API gesendet. Self-Hosting der Anwendung bedeutet also nicht automatisch, dass jeder Blob lokal bleibt.",
          "Fotos, Werte, Standorte und Zuweisungen sind Betriebsdaten. Du musst festlegen, wer den Host erreicht, wie TLS terminiert wird, wo Backups liegen und wie Restore-Tests dokumentiert werden.",
        ],
      },
      {
        id: "open-source",
        eyebrow: "Open Source unter MIT",
        title: "MIT-Lizenz, Quellcode und API",
        paragraphs: [
          "Open Inventory steht unter der MIT-Lizenz. Server, Web-Client, Datenbankschema und iOS-App liegen im selben offenen Repository und können geprüft, verändert und intern verteilt werden, solange die Lizenzbedingungen eingehalten werden.",
          "Offener Code ist kein Sicherheitsaudit. Er macht aber Berechtigungsprüfungen, Datenflüsse und Migrationen nachvollziehbar. Issues und Pull Requests sind öffentlich und technische Änderungen müssen nicht aus einer Produktbeschreibung abgeleitet werden.",
          "Die REST-Endpunkte sind in `public/openapi.yaml` dokumentiert. CSV deckt Kernfelder des Inventars ab, ist aber kein vollständiges Backup aller Medien, Nutzer und Workspace-Daten. Für Wiederherstellung brauchst du Datenbank und Upload-Speicher.",
        ],
      },
      {
        id: "start",
        eyebrow: "Praktischer Start",
        title: "Lokaler Start mit Docker Compose",
        steps: [
          {
            title: "Host und persistente Volumes vorbereiten",
            body: "Du brauchst Docker, ausreichend Speicher, eine Domain oder interne Adresse und ein Backup-Ziel für PostgreSQL und Uploads.",
          },
          {
            title: "Repository und `.env` vorbereiten",
            body: "Klone das MIT-lizenzierte Repository, kopiere `.env.example` und setze eigene Secrets, Hostnamen und Storage-Konfiguration.",
          },
          {
            title: "Migrationen und Anwendung starten",
            body: "Der eingecheckte Stack startet PostgreSQL, führt die gebündelten Migrationen aus und startet anschließend die Next.js-Anwendung mit persistenten Volumes.",
          },
          {
            title: "TLS und Rollen testen",
            body: "Veröffentliche die Anwendung nicht ungeschützt. Teste Anmeldung, Rollen und einen Restore, bevor echte Daten importiert werden.",
          },
          {
            title: "Mit Testdaten prüfen",
            body: "Prüfe Import, Bilder, Bestandsbewegungen und Etikettendruck zuerst in einem kleinen Workspace.",
          },
        ],
      },
      {
        id: "verantwortung",
        eyebrow: "Betrieb",
        title: "Backups, Updates, TLS und Monitoring",
        bullets: [
          "Backups: PostgreSQL und Uploads gemeinsam sichern; einen Restore regelmäßig auf einem getrennten Ziel testen.",
          "Updates: Diff und Migrationen lesen; neue Images zuerst gegen eine Kopie der Datenbank starten.",
          "TLS und Secrets: öffentliche Hosts nur über HTTPS betreiben; Secrets nicht in Compose-Dateien oder Images einchecken.",
          "Monitoring: freien Speicher, Datenbank, HTTP-Fehler und externe Bildverarbeitung beobachten.",
        ],
        note: {
          title: "Hinweis zu KI-Funktionen",
          body: "Self-Hosting hält nicht automatisch jede Verarbeitung lokal. Wenn du OpenAI, Google oder Replicate als Bildmodell-Anbieter konfigurierst, werden ausgewählte Bilder entsprechend deiner Konfiguration an diesen Dienst gesendet. Prüfe dessen Bedingungen und nutze KI nur dort, wo es für deine Daten passt.",
          tone: "warning",
        },
      },
      {
        id: "fuer-wen",
        eyebrow: "Gute Passung",
        title: "Wann Self-Hosting sinnvoll ist",
        paragraphs: [
          "Self-Hosting passt, wenn bereits Docker-Anwendungen betrieben werden, interne API-Integrationen nötig sind oder Datenflüsse selbst dokumentiert werden müssen. Ein kleiner Heimserver reicht für einen Test; produktiver Betrieb braucht trotzdem Backups und Updates.",
          "Wenn niemand Restore, TLS und Aktualisierungen übernimmt, ist der eigene Betrieb keine technische Abkürzung. Die MIT-Lizenz erlaubt Anpassungen, übernimmt aber keinen Betrieb für dich.",
        ],
      },
    ],
    relatedLinks: [
      {
        label: "Docker-Dokumentation",
        href: "/docs#docker",
        description: "Installation, Konfiguration und erster Start",
      },
      {
        label: "API-Referenz",
        href: "/api-docs",
        description: "OpenAPI-Endpunkte für eigene Integrationen",
      },
      {
        label: "Usecase Sammlung",
        href: "/use-cases/sammlung",
        description: "Eigene Daten zu Objekten und Provenienz bewahren",
      },
      {
        label: "MIT-Projekt auf GitHub",
        href: githubUrl,
        description: "Code, Lizenz, Issues und Projektverlauf ansehen",
        external: true,
      },
    ],
  },
  {
    slug: "iphone-lidar-inventarisierung",
    category: "iOS-App",
    title: "iOS-App: Kamera, Outbox, RoomPlan und LiDAR",
    shortTitle: "iOS, RoomPlan und LiDAR",
    excerpt:
      "Die SwiftUI-App nutzt AVFoundation für Fotos und Codes, eine persistente Outbox für Uploads und RoomPlan für parametrische Raumgeometrie.",
    description:
      "Technischer Überblick über AVFoundation, persistente Upload-Stufen, RoomPlan und ARKit in der Open-Source-iOS-App.",
    publishedAt: "2026-08-01",
    publishedLabel: "1. August 2026",
    readingTime: "9 Min. Lesezeit",
    accent: "from-[#409cff] to-[#8ff0cc]",
    accentSoft: "bg-brand-soft text-brand",
    cover: {
      src: "/marketing/blog/iphone-lidar-room.webp",
      alt: "Eine Person hält ein Smartphone vor sich und erfasst damit einen Werkstattraum.",
      width: 1536,
      height: 1024,
      caption:
        "Illustratives Bild zur Raumerfassung. Mit ImageGen erstellt; die Displaydarstellung ist keine echte App-Oberfläche.",
    },
    takeaways: [
      "AVFoundation liefert Fotos sowie QR- und Barcode-Erkennung",
      "Die Outbox persistiert Fotos, IDs und bestätigte API-Stufen",
      "RoomPlan liefert parametrische Geometrie, keinen fotorealistischen Scan",
    ],
    sections: [
      {
        id: "native-app",
        eyebrow: "Mehr als eine Webansicht",
        title: "Native Komponenten und unterstützte Codes",
        paragraphs: [
          "Die MIT-lizenzierte SwiftUI-App liegt unter `ios/Inventory`. AVFoundation liefert Kamerabilder und Metadaten für QR, EAN-8/13, UPC-E, Code 128, Data Matrix, PDF417 und Aztec.",
          "Die App löst UUID, Open-Inventory-Link, exakte SKU oder Seriennummer gegen den Server auf. Ein unbekannter Code kann als Identifier für einen neuen Eintrag übernommen werden. Danach folgen dieselben REST-Schritte wie im Web: Resource anlegen, Medien hochladen, optional analysieren und optional ein Cover erzeugen.",
          "Der Bearer-Token liegt im iOS-Schlüsselbund. Fotos, Resource-ID, Media-IDs und Stage-Status werden servergebunden unter Application Support gespeichert. Wiederholungen verwenden pro Stufe stabile Idempotency-Keys.",
        ],
      },
      {
        id: "schneller-rundgang",
        eyebrow: "Inventarisieren in Sekunden",
        title: "Persistente Outbox und stufenweise API-Aufrufe",
        steps: [
          {
            title: "Origin und Token setzen",
            body: "Die Root-URL bindet Queue-Einträge an einen Server. Öffentliche Hosts müssen HTTPS verwenden, bevor ein Bearer-Token gesendet wird.",
          },
          {
            title: "Code auflösen oder Resource vorbereiten",
            body: "Öffne einen vorhandenen Gegenstand über seinen Code oder erstelle einen neuen Eintrag mit bis zu zwölf Fotos.",
          },
          {
            title: "Request-Daten ergänzen",
            body: "Wähle Standort, optional GPS und – falls vorbereitet – den räumlichen Modus. Bei Bedarf kann ein Bestand direkt empfangen oder nach Bestätigung ausgegeben werden.",
          },
          {
            title: "Job in Application Support persistieren",
            body: "Die App kopiert Fotos in die Outbox und speichert die aktuelle Stufe. Danach können Upload und optionale KI-Schritte nacheinander laufen.",
          },
          {
            title: "Serverzustand prüfen",
            body: "Nach jeder Stufe speichert die App die zurückgegebenen IDs. Bei einem Neustart setzt sie beim letzten bestätigten Zustand fort; fachliche Felder müssen trotzdem geprüft werden.",
          },
        ],
      },
      {
        id: "lidar",
        eyebrow: "RoomPlan",
        title: "RoomPlan-Geometrie und Objektpositionen",
        paragraphs: [
          "Auf einem LiDAR-fähigen iPhone nimmt RoomPlan Wände, Öffnungen, Böden und erkannte Einrichtungsobjekte als parametrische Szene auf. Räume desselben Durchlaufs teilen sich ein ARKit-Koordinatensystem und können im Web gemeinsam gerendert werden.",
          "Für ein Inventarobjekt relokalisiert sich die App im gespeicherten AR-Raum. Die Position kommt bevorzugt aus LiDAR-Tiefe, ersatzweise aus einer Ebenenschätzung. Foto, Raum-ID, Transform und Referenzframe laufen danach durch die normale Upload-Queue.",
          "RoomPlan speichert kein fotorealistisches Mesh. Die Geometrie ist vereinfacht und kann Türen, Spiegel oder unklare Übergänge falsch klassifizieren. Deshalb bleiben manuelle Raumauswahl und reale Gerätetests nötig.",
        ],
        note: {
          title: "Hardware-Voraussetzung",
          body: "Für den aktuellen räumlichen Workflow nennt das Repository iOS 17 oder neuer, Xcode 26 oder neuer zum Bauen sowie ein LiDAR-fähiges iPhone, typischerweise ein neueres Pro-Modell. Kamera, RoomPlan, Relokalisierung und Positionsgenauigkeit müssen auf einem physischen Gerät getestet werden.",
          tone: "warning",
        },
      },
      {
        id: "grenzen",
        eyebrow: "Vor dem Einsatz",
        title: "Grenzen von Netz, Hardware und Umgebung",
        bullets: [
          "Der Server muss vom iPhone erreichbar sein; Bearer-Tokens werden für öffentliche Hosts nicht über unverschlüsseltes HTTP gesendet.",
          "Der Simulator eignet sich für Teile von API und Oberfläche, nicht als Abnahme für Kamera, Scanner, LiDAR oder räumliche Genauigkeit.",
          "Spiegelnde, strukturlose oder bewegte Szenen können AR-Erfassung und visuelle Wiedererkennung erschweren.",
          "KI-Bilderkennung ist ein optionaler externer Verarbeitungsschritt, wenn ein entsprechender Anbieter konfiguriert wurde.",
          "Ein räumlicher Marker ergänzt den Inventareintrag; fachlich wichtige Standortangaben sollten weiterhin verständlich benannt werden.",
        ],
      },
      {
        id: "offen",
        eyebrow: "Offen weiterbauen",
        title: "Codepfade im offenen Repository",
        paragraphs: [
          "Server-Routen, DTOs, `APIClient`, `IntakeQueue`, RoomPlan-Controller und SwiftUI-Oberflächen liegen gemeinsam im Open-Source-Repository. Dadurch lässt sich der mobile Request-Pfad vom Foto bis zum Datenbankeintrag direkt nachvollziehen.",
          "Die MIT-Lizenz erlaubt eigene Builds und Änderungen. Für Signierung, Kamera, LiDAR und RoomPlan brauchst du trotzdem Apple-Werkzeuge sowie Tests auf einem physischen Gerät. Der Simulator deckt diese Hardwarepfade nicht ab.",
        ],
      },
    ],
    relatedLinks: [
      {
        label: "iOS-Features",
        href: "/ios",
        description: "Native Kamera, QR-Scanner und Raumaufnahme ansehen",
      },
      {
        label: "Usecase Makerspace",
        href: "/use-cases/makerspace",
        description: "Werkzeuge und Material dort finden, wo sie genutzt werden",
      },
      {
        label: "Usecase Sammlung",
        href: "/use-cases/sammlung",
        description: "Objekte, Bilder, Orte und individuelle Details verbinden",
      },
      {
        label: "iOS-Quellcode auf GitHub",
        href: `${githubUrl}/tree/main/ios/Inventory`,
        description: "Native App im offenen MIT-Repository untersuchen",
        external: true,
      },
    ],
  },
];

export function getArticle(slug: string) {
  return articles.find((article) => article.slug === slug);
}
