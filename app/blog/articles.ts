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
  heroLabel: string;
  takeaways: string[];
  sections: ArticleSection[];
  relatedLinks: ArticleLink[];
};

export const articles: BlogArticle[] = [
  {
    slug: "serienerfassung-in-sekunden",
    category: "Workflow",
    title: "Serienerfassung: Inventarisieren in Sekunden statt Stunden",
    shortTitle: "Serienerfassung in Sekunden",
    excerpt:
      "Foto aufnehmen, gemeinsame Vorgaben übernehmen und direkt zum nächsten Gegenstand wechseln. So wird aus einer langen Inventurliste ein flüssiger Ablauf.",
    description:
      "Ein praktischer Workflow für schnelle Serienerfassung mit Open Inventory im Browser und in der nativen iOS-App.",
    publishedAt: "2026-08-13",
    publishedLabel: "13. August 2026",
    readingTime: "7 Min. Lesezeit",
    accent: "from-[#665cff] to-[#9088ff]",
    accentSoft: "bg-brand-soft text-brand",
    heroLabel: "Ein Regal, ein Rundgang, eine ruhige Warteschlange",
    takeaways: [
      "Vorgaben einmal für eine ganze Aufnahmeserie setzen",
      "Das nächste Objekt fotografieren, während das vorige verarbeitet wird",
      "KI-Vorschläge prüfen, statt Datenfelder von Grund auf auszufüllen",
    ],
    sections: [
      {
        id: "warum-serienerfassung",
        eyebrow: "Das eigentliche Problem",
        title: "Nicht das Tippen beschleunigen – das Tippen vermeiden",
        paragraphs: [
          "Klassische Inventarisierung zwingt zu einem ständigen Wechsel: Gegenstand ansehen, Namen eintippen, Kategorie wählen, Standort notieren, Foto ablegen und wieder von vorn. Bei einem vollen Regal ist nicht ein einzelner Schritt langsam, sondern die Summe der Unterbrechungen.",
          "Open Inventory dreht den Ablauf um. Du legst gemeinsame Angaben wie Typ und Standort vor der Serie fest, fotografierst einen Gegenstand und gibst ihn an die Warteschlange weiter. Die KI kann Titel, Beschreibung, Tags und ein aufgeräumtes Titelbild vorschlagen. Anschließend prüfst du das Ergebnis – die Entscheidung bleibt bei dir.",
          "„In Sekunden statt Stunden“ ist dabei ein Arbeitsprinzip, kein pauschales Zeitversprechen: Die Erfassung pro Gegenstand soll nur einen kurzen Moment beanspruchen. Wie schnell eine gesamte Inventur wird, hängt unter anderem von Objekten, Netz, Server und gewünschter Detailtiefe ab.",
        ],
      },
      {
        id: "workflow",
        eyebrow: "Der Ablauf",
        title: "Ein Rundgang in fünf Schritten",
        steps: [
          {
            title: "Serie vorbereiten",
            body: "Öffne die Serienerfassung und wähle gemeinsame Vorgaben: etwa „Werkzeug“ und „Werkstatt · Regal B2“. Aktiviere ein KI-Titelbild nur, wenn du es wirklich brauchst.",
          },
          {
            title: "Einen Gegenstand fotografieren",
            body: "Nimm ein klares Hauptfoto auf. Weitere Blickwinkel sind möglich, wenn Modell, Anschluss oder Typenschild sonst nicht erkennbar wären.",
          },
          {
            title: "Auftrag abschicken",
            body: "Open Inventory legt den Eintrag an, lädt die Fotos hoch und startet die ausgewählten Verarbeitungsschritte. Die Fotoablage wird für das nächste Objekt frei.",
          },
          {
            title: "Ohne Warten weitergehen",
            body: "Erfasse das nächste Objekt, während laufende und abgeschlossene Aufträge in der Hintergrundwarteschlange sichtbar bleiben. Wiederholungen sind gegen versehentliche Duplikate abgesichert.",
          },
          {
            title: "Ergebnisse gesammelt prüfen",
            body: "Kontrolliere Namen, Bestand, Typ, Standort und Bilder. Ergänze Seriennummern oder benutzerdefinierte Felder dort, wo sie fachlich nötig sind.",
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
        title: "Nutze die Oberfläche, die zum Ort passt",
        paragraphs: [
          "Im Browser eignet sich die Serienerfassung für einen Laptop oder ein Tablet am Arbeitstisch. Kamera und vorhandene Bilddateien können kombiniert werden. Für mobilen Einsatz bietet das Open-Source-Repository zusätzlich eine native SwiftUI-App für iOS.",
          "Die iOS-App nutzt die rückseitige Kamera direkt, erkennt QR- und gängige Barcodes und führt neue Aufnahmen über eine dauerhafte Upload-Warteschlange durch. Vorbereitete Bilder bleiben lokal in einer ausfallsicheren Outbox, bis die einzelnen Server-Schritte bestätigt sind. Dadurch kann man sich durch einen Raum bewegen, ohne jede Netzwerkpause zum Arbeitsschritt zu machen.",
        ],
        bullets: [
          "Browser-Kamera benötigt HTTPS oder localhost; alternativ lassen sich Fotos hochladen.",
          "Für die native App muss dein selbst gehosteter Server vom iPhone erreichbar sein. Öffentliche Verbindungen sollten HTTPS verwenden.",
          "KI-Analyse und Cover-Erstellung benötigen einen konfigurierten, unterstützten Bildmodell-Anbieter und verursachen je nach Anbieter externe Verarbeitung.",
          "Barcode-Erkennung ersetzt keine inhaltliche Prüfung, wenn mehrere Artikel denselben oder gar keinen Code tragen.",
        ],
      },
      {
        id: "danach",
        eyebrow: "Nach der Aufnahme",
        title: "Schnell erfassen, bewusst strukturieren",
        paragraphs: [
          "Eine schnelle Erfassung liefert den Rohbestand. Den dauerhaften Nutzen schaffen konsistente Standorte, passende Inventartypen und die Entscheidung zwischen Mengenbestand und serialisierten Einheiten. Für wiederkehrende Objekte lohnt es sich, zuerst diese Regeln festzulegen.",
          "Open Inventory ist MIT-lizenziert, Open Source und selbst hostbar. Du kannst den Ablauf im Quellcode nachvollziehen, über die REST-API automatisieren und ihn an die Prozesse deiner Familie, deines Makerspaces, Vereins oder Startups anpassen.",
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
    title: "Mengenbestand oder serialisiert? Das richtige Modell wählen",
    shortTitle: "Bulk vs. serialisiert",
    excerpt:
      "Schrauben zählt man, Laptops verfolgt man einzeln. Dazwischen entscheidet der Arbeitsablauf – nicht der Gegenstand allein.",
    description:
      "Entscheidungshilfe für Mengenbestand und serialisierte Einheiten in Open Inventory, inklusive Beispielen, Grenzen und Migrationsfragen.",
    publishedAt: "2026-08-10",
    publishedLabel: "10. August 2026",
    readingTime: "8 Min. Lesezeit",
    accent: "from-[#1eaf82] to-[#8ff0cc]",
    accentSoft: "bg-success-soft text-success",
    heroLabel: "Die passende Tiefe für jeden Bestand",
    takeaways: [
      "Mengenbestand für austauschbare Teile und Verbrauchsmaterial",
      "Serialisierte Erfassung für Identität, Status und Standort jeder Einheit",
      "Entscheidung vor Import und Etikettierung treffen",
    ],
    sections: [
      {
        id: "unterschied",
        eyebrow: "Zwei Modelle",
        title: "Zahl oder Identität?",
        paragraphs: [
          "Beim Mengenbestand beantwortest du vor allem die Frage: Wie viele Einheiten sind an welchem Ort verfügbar? Eine Buchung erhöht, verringert oder verschiebt eine Menge. Das passt zu Schrauben, Kabelbindern, Versandkartons, Getränkekisten oder identischen Ersatzteilen.",
          "Bei serialisiertem Bestand erhält jede physische Einheit eine eigene Identität. Neben dem lesbaren Einheitscode können Standort, Lebenszyklusstatus, Anschaffungsdatum und individuelle Metadaten gepflegt werden. Das passt zu Laptops, Messgeräten, Maschinen, Leihwerkzeug oder Sammlungsstücken.",
          "Beide Modelle schreiben Bewegungen in eine datierte Historie. Bei Mengenbestand liegt die Wahrheit im Saldo und seinen Buchungen; bei serialisiertem Bestand zusätzlich im aktuellen Zustand jeder Einheit.",
        ],
      },
      {
        id: "entscheidung",
        eyebrow: "Entscheidungshilfe",
        title: "Fünf Fragen, die Klarheit schaffen",
        steps: [
          {
            title: "Ist jede Einheit austauschbar?",
            body: "Wenn es keine Rolle spielt, welche konkrete Einheit entnommen wird, ist Mengenbestand meistens ausreichend.",
          },
          {
            title: "Braucht jede Einheit einen eigenen Status?",
            body: "„Verfügbar“, „ausgeliehen“, „in Reparatur“ oder „installiert“ sprechen für serialisierte Erfassung.",
          },
          {
            title: "Musst du den Standort einzeln kennen?",
            body: "Ein Gesamtbestand pro Regal genügt für Bulk. Ein bestimmtes Messgerät in einem bestimmten Raum braucht eine Einheit.",
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
        title: "So sieht die Wahl im Alltag aus",
        bullets: [
          "Makerspace: M4-Schrauben als Mengenbestand; Akkuschrauber mit Inventaretikett als serialisierte Einheiten.",
          "Familie: Umzugskartons als einzelne Inventareinträge oder Menge; Fahrräder mit Rahmennummer serialisiert.",
          "Startup: USB-C-Adapter als Mengenbestand; Firmenlaptops und Testtelefone serialisiert und Personen zugewiesen.",
          "Verein: Einwegbecher als Mengenbestand; Funkgeräte mit Ausleihe und Status serialisiert.",
          "Sammlung: Standardhüllen als Mengenbestand; jedes Werk mit Provenienz und individuellem Zustand serialisiert.",
        ],
        note: {
          title: "Eine Mischform ist normal",
          body: "Ein Workspace muss sich nicht für ein einziges Modell entscheiden. Open Inventory speichert den Tracking-Modus pro Inventareintrag – genau dort, wo die fachliche Entscheidung hingehört.",
          tone: "brand",
        },
      },
      {
        id: "wechsel",
        eyebrow: "Grenzen",
        title: "Ein späterer Wechsel ist möglich, aber nicht kostenlos",
        paragraphs: [
          "Wer von Mengenbestand zu serialisiert wechselt, muss die vorhandene Zahl in konkrete Einheiten mit eigenen Codes übersetzen. Der umgekehrte Weg entfernt die Steuerelemente für einzelne Einheiten. Installierte serialisierte Komponenten müssen zunächst aus ihren Baugruppen entfernt werden, bevor eine Rückkehr zum Mengenbestand möglich ist.",
          "Plane deshalb vor einem großen CSV-Import oder Etikettendruck eine kleine Probe mit realen Abläufen: Wareneingang, Entnahme, Transfer, Ausleihe, Rückgabe und Inventur. Nicht die schönste Datenstruktur gewinnt, sondern diejenige, die dein Team im Alltag korrekt pflegt.",
          "Open Inventory bleibt dabei transparent: Das Projekt ist Open Source unter MIT-Lizenz, kann selbst gehostet werden und dokumentiert sein Bestandsmodell offen im Repository und über die OpenAPI-Schnittstelle.",
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
    title: "QR-Etiketten im Makerspace: vom Regal direkt zum Datensatz",
    shortTitle: "QR-Etiketten im Makerspace",
    excerpt:
      "Ein gut geplantes Etikett verbindet Werkzeug, Standort und digitalen Verlauf. So bleibt es auch mit vielen Händen verständlich.",
    description:
      "Praxisleitfaden für robuste QR-Etiketten, Scan-Abläufe und Bestandsorganisation in Makerspaces mit Open Inventory.",
    publishedAt: "2026-08-07",
    publishedLabel: "7. August 2026",
    readingTime: "9 Min. Lesezeit",
    accent: "from-[#f09b32] to-[#f7c84d]",
    accentSoft: "bg-warning-soft text-warning",
    heroLabel: "Scannen, verstehen, handeln",
    takeaways: [
      "Etiketten nach Umgebung und Scanabstand gestalten",
      "QR-Ziel und betriebliche Aktion bewusst trennen",
      "Drucken, kleben und Rückgabe als einen Workflow testen",
    ],
    sections: [
      {
        id: "mehr-als-code",
        eyebrow: "Vor dem Druck",
        title: "Ein Etikett ist eine kleine Benutzeroberfläche",
        paragraphs: [
          "Im Makerspace wechseln Werkzeuge, Projekte und Menschen häufig. Ein QR-Code allein löst das Organisationsproblem nicht. Das Etikett muss auch ohne Smartphone verständlich bleiben: Name, kurze Kennung und Standort helfen beim Einsortieren; der Code öffnet die aktuelle digitale Information.",
          "Open Inventory erzeugt für Inventareinträge kompakte Links. Angemeldete Personen gelangen nach dem Scan direkt zum Gegenstand; ohne Sitzung führt der Zugriff über die Anmeldung und anschließend zurück zum Ziel. Die vorhandene Zugriffskontrolle wird durch das gedruckte Etikett nicht umgangen.",
          "Im visuellen Etikettendesigner lassen sich QR-Code, Titelbild, Name, SKU oder Ressourcenkennung, Code 128, URL und Standort platzieren. Voreinstellungen für gängige Brother-Endlosrollen und großformatige Medien geben einen Startpunkt, den du an Drucker und Material anpassen kannst.",
        ],
      },
      {
        id: "workflow",
        eyebrow: "Werkstatt-Workflow",
        title: "Von der Bestandsaufnahme bis zum ersten Scan",
        steps: [
          {
            title: "Bereiche und Verantwortlichkeit festlegen",
            body: "Definiere Räume, Schränke und Regale als verständliche Standorte. Entscheide, wer Datensätze ändern, Etiketten verwalten und Bestand buchen darf.",
          },
          {
            title: "Pilotgruppe inventarisieren",
            body: "Starte mit einer überschaubaren Gruppe, etwa Handmaschinen. Wähle serialisierte Einheiten für individuell verfolgte Geräte und Mengenbestand für austauschbares Verbrauchsmaterial.",
          },
          {
            title: "Ein reduziertes Layout bauen",
            body: "Drucke Name, kurze Kennung, Standort und einen ausreichend großen QR-Code. Vermeide kleine Schmuckelemente, die Lesbarkeit und Haltbarkeit nicht verbessern.",
          },
          {
            title: "Unter echten Bedingungen testen",
            body: "Scanne aus typischem Abstand, mit Werkstattlicht und einem nicht frisch gereinigten Etikett. Prüfe außerdem Anmeldung, mobile Ansicht und Rückweg zum Regal.",
          },
          {
            title: "Erst danach ausrollen",
            body: "Passe Vorlage und Befestigung nach dem Pilot an. Nutze anschließend dieselbe gespeicherte Einrichtung für konsistente Etiketten.",
          },
        ],
      },
      {
        id: "scan-workflows",
        eyebrow: "Zwei Arten von Scan",
        title: "Datensatz öffnen oder einen Prozess ausführen",
        paragraphs: [
          "Das Ressourcenetikett öffnet einen vorhandenen Inventareintrag. Daneben können konfigurierbare QR-Scan-Workflows fremde oder produktspezifische Codes auswerten und eine serialisierte Einheit nach einer Vorschau aktualisieren. Ein Workflow kann den vollständigen Wert verwenden, ein Präfix entfernen oder einen URL-Parameter auslesen.",
          "Diese Prozess-Scans sind bewusst überprüfbar: Der Nutzer sieht Ziel und Änderungen vor der Bestätigung. Ausführung, Bestandsbewegung und Audit-Eintrag werden zusammen behandelt; ein veralteter Vorschauzustand muss neu geprüft werden. Für einfache Ausleihe kann dagegen schon das Öffnen des Datensatzes und die dortige Zuweisung der klarere Weg sein.",
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
        title: "Kleber, Oberfläche und Drucker gehören zum System",
        paragraphs: [
          "Staub, Öl, Abrieb, Rundungen und Metallflächen entscheiden über die Lebensdauer eines Etiketts. Reinige die Fläche, wähle ein für den Untergrund geeignetes Material und platziere den Code dort, wo er beim normalen Gebrauch nicht übergriffen wird. Bei kleinen, heißen oder stark beanspruchten Werkzeugen kann ein Anhänger besser sein als ein Aufkleber.",
          "Der Browser nutzt beim Drucken den Systemdialog. Ein Netzwerkdrucker muss deshalb im Betriebssystem eingerichtet, die richtige Mediengröße gewählt und die Seitenskalierung deaktiviert sein. Open Inventory kann den Druckinhalt vorbereiten, aber keine mechanischen Druckerprobleme oder ungeeignetes Verbrauchsmaterial ausgleichen.",
          "Gerade für gemeinschaftliche Werkstätten ist Self-Hosting attraktiv: Open Inventory ist Open Source, MIT-lizenziert und lässt sich auf eigener Infrastruktur betreiben. Der Makerspace kontrolliert Benutzer, Daten und Updates – und kann Verbesserungen zurück ins offene Projekt tragen.",
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
    title: "Warum Inventar selbst hosten? Kontrolle mit Verantwortung",
    shortTitle: "Warum selbst hosten?",
    excerpt:
      "Datenhoheit ist mehr als ein Serverstandort. Self-Hosting macht Betrieb, Sicherung und Weiterentwicklung zur bewussten Entscheidung.",
    description:
      "Was Self-Hosting und MIT-lizenziertes Open Source bei Inventarsoftware bedeuten – mit Vorteilen, Voraussetzungen und Pflichten.",
    publishedAt: "2026-08-04",
    publishedLabel: "4. August 2026",
    readingTime: "8 Min. Lesezeit",
    accent: "from-[#272936] to-[#665cff]",
    accentSoft: "bg-surface-muted text-foreground",
    heroLabel: "Deine Daten, dein Betrieb, nachvollziehbarer Code",
    takeaways: [
      "Anwendung und Datenbank auf eigener Infrastruktur betreiben",
      "MIT-lizenzierten Quellcode prüfen, verändern und integrieren",
      "Backups, Updates und sichere Erreichbarkeit bewusst übernehmen",
    ],
    sections: [
      {
        id: "was-self-hosting-heisst",
        eyebrow: "Begriffe klären",
        title: "Self-hosted heißt nicht automatisch sorgenfrei",
        paragraphs: [
          "Beim Self-Hosting betreibst du Open Inventory auf Infrastruktur, die du auswählst und administrierst – beispielsweise auf einem eigenen Server oder bei einem Hosting-Anbieter deines Vertrauens. Anwendung, PostgreSQL-Datenbank und Upload-Speicher bleiben unter deiner betrieblichen Kontrolle.",
          "Das ist besonders relevant, wenn Fotos, Anschaffungswerte, Standorte, Seriennummern und Zuweisungen interne Abläufe abbilden. Du legst fest, wer den Server erreicht, wann aktualisiert wird, wo Sicherungen liegen und wie lange Daten aufbewahrt werden.",
          "Gleichzeitig übernimmt kein externer SaaS-Betreiber automatisch Wartung und Wiederherstellung. Self-Hosting tauscht Abhängigkeit gegen Gestaltungsspielraum – und gegen konkrete Verantwortung.",
        ],
      },
      {
        id: "open-source",
        eyebrow: "Open Source unter MIT",
        title: "Transparenz endet nicht an der Benutzeroberfläche",
        paragraphs: [
          "Open Inventory ist Open Source und unter der permissiven MIT-Lizenz veröffentlicht. Du kannst den Quellcode lesen, für eigene Zwecke verändern, interne Integrationen bauen und Änderungen weitergeben – unter Beachtung der kurzen Lizenzbedingungen.",
          "Offener Code ist kein automatisches Sicherheitszertifikat. Er schafft aber die Möglichkeit, Datenflüsse und Berechtigungslogik selbst oder durch Dritte zu prüfen. Fehler und Verbesserungsvorschläge können über GitHub nachvollziehbar diskutiert werden, statt in einer geschlossenen Produkt-Roadmap zu verschwinden.",
          "Die dokumentierte REST- und OpenAPI-Schnittstelle reduziert außerdem Lock-in: Inventardaten können mit vorhandenen Prozessen verbunden und vollständig als CSV ausgetauscht werden. Open Source ist hier nicht nur ein Lizenzhinweis, sondern eine praktische Integrationsstrategie.",
        ],
      },
      {
        id: "start",
        eyebrow: "Praktischer Start",
        title: "Vom Repository zum eigenen Workspace",
        steps: [
          {
            title: "Voraussetzungen schaffen",
            body: "Plane einen aktuellen Docker-Host, persistenten Speicher, eine erreichbare Domain und HTTPS. Für produktive Nutzung gehören auch Monitoring und ein Backup-Ziel dazu.",
          },
          {
            title: "Repository und Umgebung vorbereiten",
            body: "Klone das MIT-lizenzierte Projekt, kopiere die Beispielumgebung und erzeuge eigene Geheimnisse sowie ein Passwort-Hash gemäß Dokumentation.",
          },
          {
            title: "Compose-Stack starten",
            body: "Der eingecheckte Stack startet PostgreSQL, führt die gebündelten Migrationen aus und startet anschließend die Next.js-Anwendung mit persistenten Volumes.",
          },
          {
            title: "Zugriff begrenzen",
            body: "Lege Rollen nach dem Prinzip minimaler Rechte an. Veröffentliche die Anwendung nicht ungeschützt und teste Anmeldung sowie Wiederherstellung, bevor echte Daten importiert werden.",
          },
          {
            title: "Klein beginnen",
            body: "Inventarisiere einen begrenzten Bereich, überprüfe Datenmodell und Alltagstauglichkeit und erweitere erst dann auf weitere Teams oder Standorte.",
          },
        ],
      },
      {
        id: "verantwortung",
        eyebrow: "Betrieb",
        title: "Vier Dinge, die du nicht delegieren kannst",
        bullets: [
          "Backups: Datenbank und Uploads regelmäßig sichern und die Rücksicherung tatsächlich testen.",
          "Updates: Release-Änderungen lesen, Migrationen einplanen und vor produktiver Übernahme prüfen.",
          "Sicherheit: HTTPS, starke Geheimnisse, restriktive Rollen und begrenzte Netzwerkfreigaben betreiben.",
          "Kapazität: Speicher, Datenbank und Bildverarbeitung beobachten, bevor ein Engpass die Aufnahme blockiert.",
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
        title: "Wann sich der eigene Betrieb lohnt",
        paragraphs: [
          "Self-Hosting passt besonders zu Teams, die bereits Anwendungen betreiben, Inventardaten in interne Prozesse integrieren oder Datenflüsse selbst kontrollieren wollen. Ein Startup kann die API anbinden, ein Verein einen kleinen Server gemeinsam verwalten und eine Familie das System im Heimnetz betreiben.",
          "Wer keinen verlässlichen Betrieb, keine Backups und keine Updates organisieren kann, sollte diese Lücke zuerst lösen. Die Freiheit von Open Source besteht auch darin, die eigenen Voraussetzungen ehrlich zu bewerten.",
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
    title: "Mit iPhone und LiDAR Räume erfassen – und Inventar darin verorten",
    shortTitle: "iPhone, LiDAR und Räume",
    excerpt:
      "Die native iOS-App verbindet schnelle Kameraerfassung mit RoomPlan. Was der räumliche Workflow kann – und was nicht.",
    description:
      "Open Inventory auf dem iPhone: Kamera, QR-Scanner, ausfallsichere Uploads und räumliche Inventarisierung mit LiDAR und RoomPlan.",
    publishedAt: "2026-08-01",
    publishedLabel: "1. August 2026",
    readingTime: "9 Min. Lesezeit",
    accent: "from-[#409cff] to-[#8ff0cc]",
    accentSoft: "bg-brand-soft text-brand",
    heroLabel: "Vom Kamerabild zum Platz im Raum",
    takeaways: [
      "Native Kamera und Codescanner für den mobilen Rundgang",
      "RoomPlan-Strukturen und räumlich positionierte Gegenstände",
      "LiDAR-Funktionen erfordern kompatible Hardware und reale Gerätetests",
    ],
    sections: [
      {
        id: "native-app",
        eyebrow: "Mehr als eine Webansicht",
        title: "Eine native Begleit-App im Open-Source-Repository",
        paragraphs: [
          "Zum MIT-lizenzierten Open-Inventory-Projekt gehört eine native SwiftUI-App. Sie nutzt AVFoundation für Fotos sowie QR- und Barcode-Erkennung und spricht direkt mit deinem selbst gehosteten Server. Unterstützt werden unter anderem QR, EAN-8/13, UPC-E, Code 128, Data Matrix, PDF417 und Aztec.",
          "Bekannte Ressourcen können über UUID, Inventory-Link, exakte SKU oder Seriennummer gefunden werden. Ein unbekannter Code lässt sich als Ausgangspunkt für einen neuen Eintrag verwenden. Die eigentliche Erfassung folgt derselben Kette wie im Browser: Eintrag anlegen, Medien hochladen, optional analysieren und auf Wunsch ein Titelbild erzeugen.",
          "Der Anmeldetoken liegt im iOS-Schlüsselbund. Vorbereitete Fotos und Auftragsstatus werden in einer dauerhaften, an den Server gebundenen Warteschlange gesichert. Wiederholte Netzwerkversuche sollen dadurch weder Einträge noch KI-Arbeit duplizieren.",
        ],
      },
      {
        id: "schneller-rundgang",
        eyebrow: "Inventarisieren in Sekunden",
        title: "Kamera auf, Objekt erfassen, weitergehen",
        steps: [
          {
            title: "Server verbinden",
            body: "Trage die Root-URL deines erreichbaren Open-Inventory-Servers ein und melde dich mit einem Workspace-Konto an.",
          },
          {
            title: "Code scannen oder neu aufnehmen",
            body: "Öffne einen vorhandenen Gegenstand über seinen Code oder erstelle einen neuen Eintrag mit bis zu zwölf Fotos.",
          },
          {
            title: "Kontext ergänzen",
            body: "Wähle Standort, optional GPS und – falls vorbereitet – den räumlichen Modus. Bei Bedarf kann ein Bestand direkt empfangen oder nach Bestätigung ausgegeben werden.",
          },
          {
            title: "Auftrag der Outbox übergeben",
            body: "Die App arbeitet Upload und optionale KI-Schritte stufenweise ab. Du kannst mit der nächsten Aufnahme fortfahren, statt neben dem Objekt auf jede Antwort zu warten.",
          },
          {
            title: "Ergebnis prüfen",
            body: "Öffne fertige Einträge, kontrolliere Vorschläge und korrigiere Details. Schnelligkeit entsteht durch den Fluss, nicht durch ungeprüfte Automatik.",
          },
        ],
      },
      {
        id: "lidar",
        eyebrow: "RoomPlan",
        title: "Erst den Raum messen, dann Gegenstände darin platzieren",
        paragraphs: [
          "Auf einem LiDAR-fähigen iPhone kann die App zusammenhängende Räume mit Apple RoomPlan aufnehmen. Wände, Öffnungen, Böden und erkannte Einrichtung werden als gemessene, parametrische Szene gespeichert. Mehrere Räume eines durchgehenden Durchlaufs teilen sich ein Koordinatensystem und können als Struktur im Web betrachtet werden.",
          "Für einen Gegenstand wählst du anschließend den Raum und richtest das Fadenkreuz auf das Objekt. Die App wartet auf die Relokalisierung im gespeicherten AR-Raum und nutzt zuerst LiDAR-Tiefendaten, alternativ eine Ebenenschätzung. Foto, Raumzuordnung und Position laufen danach durch dieselbe robuste Upload-Pipeline wie eine normale Aufnahme.",
          "Das Ergebnis ist kein magisches Digital-Twin-Versprechen. RoomPlan liefert ein gemessenes, vereinfachtes Raummodell und keinen fotorealistischen Scan. Automatische Raumerkennung kann an Türen oder bei unklaren Grundrissen Hilfe brauchen; deshalb bleibt eine manuelle Auswahl verfügbar.",
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
        title: "Netz, Datenschutz und Umgebung mitdenken",
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
        title: "iOS-App und Server entwickeln sich gemeinsam",
        paragraphs: [
          "Weil Server, API-Verträge und SwiftUI-App gemeinsam Open Source sind, lässt sich der gesamte mobile Pfad nachvollziehen. Teams können eigene Builds signieren, Anforderungen diskutieren und Integrationen ergänzen, ohne auf eine geschlossene App-Cloud festgelegt zu sein.",
          "Die MIT-Lizenz gibt dabei viel Freiheit, ersetzt aber weder Apple-Entwicklerwerkzeuge noch einen gepflegten Serverbetrieb. Für Makerspaces, Sammlungen oder Startups mit räumlichem Bedarf ist das eine ehrliche Grundlage: leistungsfähige Bausteine, klar benannte Voraussetzungen und eigener Gestaltungsspielraum.",
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
