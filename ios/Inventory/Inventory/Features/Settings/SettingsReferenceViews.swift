import SwiftUI

struct RuntimeSettingsView: View {
    let client: APIClient?

    @State private var status: RuntimeSettingsResponse?
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let status {
                Section("Dienste") {
                    SettingsStatusRow(
                        title: "Dateispeicher",
                        detail: "\(status.storage.provider.capitalized)-Anbieter",
                        systemImage: status.storage.provider == "local" ? "internaldrive.fill" : "cloud.fill",
                        available: status.storage.configured
                    )
                    SettingsStatusRow(
                        title: "KI-Analyse",
                        detail: "Metadaten und Bilderkennung",
                        systemImage: "sparkles",
                        available: status.ai.analysis
                    )
                    SettingsStatusRow(
                        title: "Bildgenerierung",
                        detail: "\(status.ai.imageProvider.capitalized)-Anbieter",
                        systemImage: "photo.badge.plus",
                        available: status.ai.imageGeneration
                    )
                }

                Section("Anmeldung") {
                    SettingsStatusRow(
                        title: "Passwort-Anmeldung",
                        detail: "Lokale Benutzerkonten",
                        systemImage: "key.fill",
                        available: status.auth.password
                    )
                    SettingsStatusRow(
                        title: "Auth0",
                        detail: "Externer Identitätsanbieter",
                        systemImage: "person.badge.shield.checkmark.fill",
                        available: status.auth.auth0
                    )
                }
            } else if loading {
                SettingsLoadingRow(text: "Systemstatus wird geladen …")
            } else {
                SettingsErrorRow(message: errorMessage ?? "Der Systemstatus ist nicht verfügbar.")
            }

            Section {
                Text("Diese Angaben werden von der Serverkonfiguration bestimmt und sind in der App schreibgeschützt.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Systemstatus")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: client?.contextIdentifier) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    @MainActor
    private func load() async {
        guard let client else {
            status = nil
            loading = false
            errorMessage = "Es besteht keine Verbindung zum Server."
            return
        }

        loading = status == nil
        errorMessage = nil
        do {
            status = try await client.runtimeSettings()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}

struct PermissionsSettingsView: View {
    let client: APIClient?

    @State private var capabilities: CapabilitiesResponse?
    @State private var runtime: RuntimeSettingsResponse?
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let capabilities {
                Section("Identität") {
                    LabeledContent("Name", value: capabilities.name)
                    LabeledContent("Rolle", value: roleLabel)
                }

                Section("Berechtigungen") {
                    ForEach(orderedScopes, id: \.self) { scope in
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(scopeTitle(scope))
                                Text(scopeDescription(scope))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: scopeIcon(scope))
                        }
                    }
                }
            } else if loading {
                SettingsLoadingRow(text: "Berechtigungen werden geladen …")
            } else {
                SettingsErrorRow(message: errorMessage ?? "Die Berechtigungen sind nicht verfügbar.")
            }

            Section {
                Text("Die App zeigt die vom Server gewährten Rechte. Rollen und Zugänge werden in der Webverwaltung geändert.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Berechtigungen")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: client?.contextIdentifier) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private var roleLabel: String {
        switch runtime?.user.role {
        case "admin": "Administrator"
        case "editor": "Bearbeiten"
        case "viewer": "Nur lesen"
        case .some(let role): role.capitalized
        case nil: "API-Token"
        }
    }

    private var orderedScopes: [String] {
        let preferred = ["read", "write", "ai"]
        let available = Set(capabilities?.scopes ?? [])
        return preferred.filter(available.contains) + available.subtracting(preferred).sorted()
    }

    @MainActor
    private func load() async {
        guard let client else {
            capabilities = nil
            runtime = nil
            loading = false
            errorMessage = "Es besteht keine Verbindung zum Server."
            return
        }

        loading = capabilities == nil
        errorMessage = nil
        do {
            async let capabilitiesRequest = client.capabilities()
            async let runtimeRequest = client.runtimeSettings()
            let (nextCapabilities, nextRuntime) = try await (
                capabilitiesRequest,
                runtimeRequest
            )
            capabilities = nextCapabilities
            runtime = nextRuntime
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    private func scopeTitle(_ scope: String) -> String {
        switch scope {
        case "read": "Lesen"
        case "write": "Bearbeiten"
        case "ai": "KI-Funktionen"
        default: scope
        }
    }

    private func scopeDescription(_ scope: String) -> String {
        switch scope {
        case "read": "Inventar, Medien und Statistiken ansehen"
        case "write": "Inventar, Bestand und Uploads ändern"
        case "ai": "Analyse und Bildgenerierung verwenden"
        default: "Vom Server gewährte Berechtigung"
        }
    }

    private func scopeIcon(_ scope: String) -> String {
        switch scope {
        case "read": "eye.fill"
        case "write": "square.and.pencil"
        case "ai": "sparkles"
        default: "checkmark.shield.fill"
        }
    }
}

private struct SettingsStatusRow: View {
    let title: String
    let detail: String
    let systemImage: String
    let available: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .frame(width: 24)
                .foregroundStyle(available ? .primary : .secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Label(
                available ? "Bereit" : "Nicht eingerichtet",
                systemImage: available ? "checkmark.circle.fill" : "minus.circle"
            )
            .font(.caption)
            .foregroundStyle(available ? .green : .secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct SettingsLoadingRow: View {
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(text)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SettingsErrorRow: View {
    let message: String

    var body: some View {
        Label {
            Text(message)
                .foregroundStyle(.secondary)
        } icon: {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(.orange)
        }
    }
}

struct InventoryTypesSettingsView: View {
    let client: APIClient?

    @State private var types: [InventoryTypeDefinition] = []
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if !types.isEmpty {
                Section("Aktive Typen") {
                    ForEach(types) { type in
                        NavigationLink {
                            InventoryTypeSettingsDetailView(type: type)
                        } label: {
                            InventoryTypeSettingsRow(type: type)
                        }
                    }
                }
            } else if loading {
                SettingsLoadingRow(text: "Inventartypen werden geladen …")
            } else if let errorMessage {
                SettingsErrorRow(message: errorMessage)
            } else {
                Section {
                    Label("Keine Inventartypen vorhanden", systemImage: "shippingbox")
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Text("Inventartypen legen fest, welche Gegenstände als Räume, Container, Geräte oder andere Strukturen verwendet werden können. Änderungen erfolgen in der Webverwaltung.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Inventartypen")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: client?.contextIdentifier) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    @MainActor
    private func load() async {
        guard let client else {
            types = []
            loading = false
            errorMessage = "Es besteht keine Verbindung zum Server."
            return
        }

        loading = types.isEmpty
        errorMessage = nil
        do {
            let response = try await client.inventoryTypes()
            types = response.types.sorted {
                $0.position == $1.position
                    ? $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
                    : $0.position < $1.position
            }
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}

private struct InventoryTypeSettingsRow: View {
    let type: InventoryTypeDefinition

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(settingsColor(type.color))
                .frame(width: 12, height: 12)
                .overlay {
                    Circle().stroke(.primary.opacity(0.12), lineWidth: 1)
                }

            VStack(alignment: .leading, spacing: 3) {
                Text(type.label)
                HStack(spacing: 6) {
                    Text(type.key)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    if type.canContain {
                        Text("Container")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct InventoryTypeSettingsDetailView: View {
    let type: InventoryTypeDefinition

    var body: some View {
        List {
            Section("Typ") {
                HStack {
                    Circle()
                        .fill(settingsColor(type.color))
                        .frame(width: 16, height: 16)
                    Text(type.label)
                    Spacer()
                    if type.isSystem {
                        Text("System")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                LabeledContent("API-Schlüssel", value: type.key)
                if !type.description.isEmpty {
                    Text(type.description)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Struktur") {
                LabeledContent("Kann Inhalte enthalten") {
                    SettingsBooleanValue(value: type.canContain)
                }
                LabeledContent("Automatisch aus Karte") {
                    SettingsBooleanValue(value: type.spatialContainment)
                }
                LabeledContent("Sortierung", value: "\(type.position)")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(type.label)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct CustomFieldsSettingsView: View {
    let client: APIClient?

    @State private var definitions: [CustomFieldDefinition] = []
    @State private var selectedEntity: CustomFieldEntityType = .inventory
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Picker("Bereich", selection: $selectedEntity) {
                    Text("Inventar").tag(CustomFieldEntityType.inventory)
                    Text("Bestandseinheiten").tag(CustomFieldEntityType.stockUnit)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            if !visibleDefinitions.isEmpty {
                Section("Felder") {
                    ForEach(visibleDefinitions) { definition in
                        NavigationLink {
                            CustomFieldSettingsDetailView(definition: definition)
                        } label: {
                            CustomFieldSettingsRow(definition: definition)
                        }
                    }
                }
            } else if loading {
                SettingsLoadingRow(text: "Benutzerdefinierte Felder werden geladen …")
            } else if let errorMessage {
                SettingsErrorRow(message: errorMessage)
            } else {
                Section {
                    Label(
                        selectedEntity == .inventory
                            ? "Keine zusätzlichen Inventarfelder"
                            : "Keine zusätzlichen Felder für Bestandseinheiten",
                        systemImage: "text.badge.plus"
                    )
                    .foregroundStyle(.secondary)
                }
            }

            Section {
                Text("Felddefinitionen und ihre Zielgruppen sind in der App schreibgeschützt. Änderungen erfolgen in der Webverwaltung.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Eigene Felder")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: client?.contextIdentifier) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private var visibleDefinitions: [CustomFieldDefinition] {
        definitions
            .filter { $0.entityType == selectedEntity }
            .sorted {
                $0.position == $1.position
                    ? $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
                    : $0.position < $1.position
            }
    }

    @MainActor
    private func load() async {
        guard let client else {
            definitions = []
            loading = false
            errorMessage = "Es besteht keine Verbindung zum Server."
            return
        }

        loading = definitions.isEmpty
        errorMessage = nil
        do {
            definitions = try await client.customFieldDefinitions().definitions
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}

private struct CustomFieldSettingsRow: View {
    let definition: CustomFieldDefinition

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(definition.label)
                    if definition.required {
                        Text("Pflicht")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.orange)
                    }
                }
                Text("\(definition.key) · \(definition.fieldType.localizedTitle)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: definition.fieldType.systemImage)
        }
    }
}

private struct CustomFieldSettingsDetailView: View {
    let definition: CustomFieldDefinition

    var body: some View {
        List {
            Section("Feld") {
                LabeledContent("API-Schlüssel", value: definition.key)
                LabeledContent("Feldtyp", value: definition.fieldType.localizedTitle)
                LabeledContent("Pflichtfeld") {
                    SettingsBooleanValue(value: definition.required)
                }
                LabeledContent("Sortierung", value: "\(definition.position)")
                if !definition.description.isEmpty {
                    LabeledContent("Beschreibung") {
                        Text(definition.description)
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(.secondary)
                    }
                }
                if !definition.placeholder.isEmpty {
                    LabeledContent("Platzhalter", value: definition.placeholder)
                }
            }

            if definition.fieldType == .number {
                Section("Zahlenbereich") {
                    if let minimum = definition.minValue {
                        LabeledContent("Minimum", value: formattedNumber(minimum))
                    }
                    if let maximum = definition.maxValue {
                        LabeledContent("Maximum", value: formattedNumber(maximum))
                    }
                    if let step = definition.step {
                        LabeledContent("Schrittweite", value: formattedNumber(step))
                    }
                    if definition.minValue == nil,
                       definition.maxValue == nil,
                       definition.step == nil {
                        Text("Keine Einschränkungen")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !definition.options.isEmpty {
                Section("Auswahloptionen") {
                    ForEach(definition.options) { option in
                        HStack(spacing: 10) {
                            Circle()
                                .fill(settingsColor(option.color ?? ""))
                                .frame(width: 10, height: 10)
                            Text(option.label)
                            Spacer()
                            Text(option.value)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section("Gültig für") {
                LabeledContent("Inventartypen") {
                    Text(definition.resourceTypes.isEmpty
                         ? "Alle"
                         : definition.resourceTypes.joined(separator: ", "))
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent("Kategorien") {
                    Text(definition.categories.isEmpty
                         ? "Alle"
                         : definition.categories.joined(separator: ", "))
                        .multilineTextAlignment(.trailing)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(definition.label)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func formattedNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0 ... 4)))
    }
}

private struct SettingsBooleanValue: View {
    let value: Bool

    var body: some View {
        Label(value ? "Ja" : "Nein", systemImage: value ? "checkmark.circle.fill" : "minus.circle")
            .labelStyle(.titleAndIcon)
            .foregroundStyle(value ? .green : .secondary)
    }
}

private extension CustomFieldValueType {
    var localizedTitle: String {
        switch self {
        case .text: "Text"
        case .textarea: "Langer Text"
        case .number: "Zahl"
        case .boolean: "Ja / Nein"
        case .date: "Datum"
        case .datetime: "Datum und Uhrzeit"
        case .select: "Auswahl"
        case .multiSelect: "Mehrfachauswahl"
        case .reference: "Referenz"
        case .email: "E-Mail-Adresse"
        case .url: "URL"
        }
    }

    var systemImage: String {
        switch self {
        case .text, .textarea: "textformat"
        case .number: "number"
        case .boolean: "checkmark.circle"
        case .date, .datetime: "calendar"
        case .select, .multiSelect: "list.bullet"
        case .reference: "arrowshape.turn.up.right"
        case .email: "envelope"
        case .url: "link"
        }
    }
}

private func settingsColor(_ value: String) -> Color {
    let normalized = value.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    guard normalized.count == 6,
          let number = UInt64(normalized, radix: 16) else {
        return .gray
    }
    return Color(
        red: Double((number >> 16) & 0xff) / 255,
        green: Double((number >> 8) & 0xff) / 255,
        blue: Double(number & 0xff) / 255
    )
}
