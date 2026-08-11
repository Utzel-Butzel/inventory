import SwiftUI

private enum StockBookingDirection: String, CaseIterable, Identifiable {
    case incoming
    case outgoing

    var id: Self { self }
    var localizedName: String { self == .incoming ? "Zugang" : "Abgang" }
}

private enum StockUnitCreationMode: String, CaseIterable, Identifiable {
    case generated
    case custom

    var id: Self { self }
    var localizedName: String { self == .generated ? "Automatisch" : "Eigene Codes" }
}

private enum StockHistoryFilter: String, CaseIterable, Identifiable {
    case all
    case incoming
    case outgoing

    var id: Self { self }

    var localizedName: String {
        switch self {
        case .all: "Alle"
        case .incoming: "Zugänge"
        case .outgoing: "Abgänge"
        }
    }
}

@MainActor
private final class StockManagementViewModel: ObservableObject {
    @Published private(set) var detail: StockDetailResponse?
    @Published private(set) var loading = false
    @Published private(set) var busy = false
    @Published var errorMessage: String?
    @Published var notice: String?

    @Published var direction: StockBookingDirection = .incoming {
        didSet {
            if !availableMovementTypes.contains(movementType) {
                movementType = direction == .incoming ? .receipt : .issue
            }
        }
    }
    @Published var movementQuantity = 1
    @Published var movementType: StockMovementType = .receipt
    @Published var movementReason = ""
    @Published var movementNote = ""
    @Published var movementLocation: String
    @Published var movementDate = Date()

    @Published var trackingMode: StockTrackingMode = .bulk
    @Published var minimumStock = 0
    @Published var reorderQuantity = 0
    @Published var leadTimeDays = 0
    @Published var unitName = "Einheit"

    @Published var unitCreationMode: StockUnitCreationMode = .generated
    @Published var unitCount = 1
    @Published var unitCodes = ""
    @Published var unitLocation: String
    @Published var acquiredAt = Date()
    @Published var historyFilter: StockHistoryFilter = .all

    let resourceID: UUID
    let resourceName: String

    init(resource: InventoryResource) {
        resourceID = resource.id
        resourceName = resource.name
        movementLocation = resource.location ?? ""
        unitLocation = resource.location ?? ""
    }

    var availableMovementTypes: [StockMovementType] {
        direction == .incoming
            ? [.receipt, .return, .adjustment, .transfer]
            : [.issue, .waste, .adjustment, .transfer]
    }

    var filteredMovements: [StockMovement] {
        guard let movements = detail?.movements else { return [] }
        return movements.filter { movement in
            switch historyFilter {
            case .all: true
            case .incoming: movement.delta > 0
            case .outgoing: movement.delta < 0
            }
        }
    }

    var trackingModeChanged: Bool {
        detail?.config.trackingMode != trackingMode
    }

    func load(using client: APIClient, showLoading: Bool = true) async {
        if showLoading { loading = true }
        errorMessage = nil
        do {
            let response = try await client.getStockDetail(resourceID: resourceID)
            apply(response, updateConfigForm: detail == nil)
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    func bookMovement(using client: APIClient) async {
        guard let detail else { return }
        guard detail.config.trackingMode == .bulk else {
            errorMessage = "Bei serialisiertem Bestand wird jede Einheit einzeln verwaltet."
            return
        }
        guard movementQuantity > 0 else {
            errorMessage = "Die Menge muss mindestens eins sein."
            return
        }
        if direction == .outgoing, movementQuantity > detail.resource.quantity {
            errorMessage = "Es sind nur \(detail.resource.quantity) Einheiten verfügbar."
            return
        }
        guard availableMovementTypes.contains(movementType) else {
            errorMessage = "Die Buchungsart passt nicht zur gewählten Richtung."
            return
        }

        let delta = direction == .incoming ? movementQuantity : -movementQuantity
        let bookedQuantity = movementQuantity
        await perform(using: client) {
            _ = try await client.bookStockMovement(
                resourceID: resourceID,
                delta: delta,
                type: movementType.rawValue,
                reason: movementReason.nilIfBlank,
                note: movementNote.nilIfBlank,
                location: movementLocation.nilIfBlank,
                occurredAt: movementDate,
                idempotencyKey: UUID()
            )
            try await refresh(using: client)
            movementQuantity = 1
            movementReason = ""
            movementNote = ""
            movementDate = Date()
            notice = delta > 0
                ? "\(bookedQuantity) Einheiten wurden eingebucht."
                : "\(bookedQuantity) Einheiten wurden ausgebucht."
        }
    }

    func saveConfig(using client: APIClient) async {
        guard minimumStock >= 0, reorderQuantity >= 0 else {
            errorMessage = "Mindestbestand und Nachbestellmenge dürfen nicht negativ sein."
            return
        }
        guard (0 ... 36_500).contains(leadTimeDays) else {
            errorMessage = "Die Lieferzeit muss zwischen 0 und 36.500 Tagen liegen."
            return
        }
        let normalizedUnitName = unitName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUnitName.isEmpty, normalizedUnitName.count <= 80 else {
            errorMessage = "Die Einheit muss zwischen einem und 80 Zeichen enthalten."
            return
        }

        await perform(using: client) {
            let result = try await client.updateStockConfig(
                resourceID: resourceID,
                request: StockConfigPatchRequest(
                    trackingMode: trackingMode,
                    minimumStock: minimumStock,
                    reorderQuantity: reorderQuantity,
                    leadTimeDays: leadTimeDays,
                    unitName: normalizedUnitName
                )
            )
            try await refresh(using: client)
            notice = result.unitsCreated > 0
                ? "Einstellungen gespeichert und \(result.unitsCreated) Einheiten angelegt."
                : "Bestandseinstellungen gespeichert."
        }
    }

    func createUnits(using client: APIClient) async {
        let request: StockUnitCreateRequest
        let createdCount: Int
        switch unitCreationMode {
        case .generated:
            guard (1 ... 100).contains(unitCount) else {
                errorMessage = "Lege zwischen einer und 100 Einheiten auf einmal an."
                return
            }
            request = StockUnitCreateRequest(
                count: unitCount,
                location: unitLocation.nilIfBlank,
                acquiredAt: acquiredAt
            )
            createdCount = unitCount
        case .custom:
            let codes = unitCodes
                .components(separatedBy: CharacterSet(charactersIn: ",\n"))
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            guard (1 ... 100).contains(codes.count) else {
                errorMessage = "Gib zwischen einem und 100 Codes ein."
                return
            }
            guard Set(codes.map { $0.lowercased() }).count == codes.count else {
                errorMessage = "Jeder Einheiten-Code muss eindeutig sein."
                return
            }
            guard codes.allSatisfy({ $0.count <= 180 }) else {
                errorMessage = "Ein Einheiten-Code darf höchstens 180 Zeichen lang sein."
                return
            }
            request = StockUnitCreateRequest(
                codes: codes,
                location: unitLocation.nilIfBlank,
                acquiredAt: acquiredAt
            )
            createdCount = codes.count
        }

        await perform(using: client) {
            _ = try await client.createStockUnits(resourceID: resourceID, request: request)
            try await refresh(using: client)
            unitCount = 1
            unitCodes = ""
            acquiredAt = Date()
            notice = "\(createdCount) serialisierte Einheiten wurden angelegt."
        }
    }

    func updateUnit(
        _ unit: StockUnit,
        request: StockUnitPatchRequest,
        using client: APIClient
    ) async {
        await perform(using: client) {
            _ = try await client.updateStockUnit(
                resourceID: resourceID,
                unitID: unit.id,
                request: request
            )
            try await refresh(using: client)
            notice = "Einheit \(unit.code) wurde aktualisiert."
        }
    }

    private func perform(
        using client: APIClient,
        operation: () async throws -> Void
    ) async {
        guard !busy else { return }
        busy = true
        errorMessage = nil
        notice = nil
        do {
            try await operation()
        } catch {
            errorMessage = error.localizedDescription
        }
        busy = false
    }

    private func refresh(using client: APIClient) async throws {
        let response = try await client.getStockDetail(resourceID: resourceID)
        apply(response, updateConfigForm: true)
    }

    private func apply(_ response: StockDetailResponse, updateConfigForm: Bool) {
        detail = response
        guard updateConfigForm else { return }
        trackingMode = response.config.trackingMode
        minimumStock = response.config.minimumStock
        reorderQuantity = response.config.reorderQuantity
        leadTimeDays = response.config.leadTimeDays
        unitName = response.config.unitName
    }
}

struct StockManagementView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: StockManagementViewModel
    @State private var confirmOutgoing = false
    @State private var confirmTrackingChange = false
    @State private var editingUnit: StockUnit?

    init(resource: InventoryResource) {
        _model = StateObject(wrappedValue: StockManagementViewModel(resource: resource))
    }

    var body: some View {
        NavigationStack {
            Group {
                if model.loading, model.detail == nil {
                    ProgressView("Bestand wird geladen …")
                } else if let detail = model.detail {
                    stockForm(detail)
                } else {
                    ContentUnavailableView(
                        "Bestand nicht verfügbar",
                        systemImage: "exclamationmark.triangle",
                        description: Text(model.errorMessage ?? "Die Bestandsdaten konnten nicht geladen werden.")
                    )
                }
            }
            .navigationTitle("Bestand verwalten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Schließen") { dismiss() }
                }
                if model.busy {
                    ToolbarItem(placement: .primaryAction) { ProgressView() }
                }
            }
        }
        .task {
            guard let client = state.client else { return }
            await model.load(using: client)
        }
        .confirmationDialog(
            "Bestand wirklich ausbuchen?",
            isPresented: $confirmOutgoing,
            titleVisibility: .visible
        ) {
            Button("\(model.movementQuantity) Einheiten ausbuchen", role: .destructive) {
                submitMovement()
            }
            Button("Abbrechen", role: .cancel) { }
        } message: {
            if let quantity = model.detail?.resource.quantity {
                Text("Der Bestand sinkt von \(quantity) auf \(max(0, quantity - model.movementQuantity)).")
            }
        }
        .confirmationDialog(
            "Tracking-Modus ändern?",
            isPresented: $confirmTrackingChange,
            titleVisibility: .visible
        ) {
            Button("Modus ändern") { saveConfig() }
            Button("Abbrechen", role: .cancel) { }
        } message: {
            Text(trackingChangeMessage)
        }
        .sheet(item: $editingUnit) { unit in
            StockUnitEditView(unit: unit) { request in
                guard let client = state.client else { return }
                Task { await model.updateUnit(unit, request: request, using: client) }
            }
        }
        .alert(
            "Aktion fehlgeschlagen",
            isPresented: Binding(
                get: { model.errorMessage != nil && model.detail != nil },
                set: { if !$0 { model.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "Unbekannter Fehler")
        }
    }

    private func stockForm(_ detail: StockDetailResponse) -> some View {
        Form {
            summarySection(detail)
            if detail.config.trackingMode == .bulk {
                bookingSection(detail)
            } else {
                serializedHintSection
            }
            planningSection(detail)
            if detail.config.trackingMode == .serialized {
                unitCreationSection
                unitsSection(detail)
            }
            historySection
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable {
            guard let client = state.client else { return }
            await model.load(using: client, showLoading: false)
        }
        .disabled(model.busy)
    }

    private func summarySection(_ detail: StockDetailResponse) -> some View {
        Section {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.resourceName).font(.headline)
                    Text(detail.config.trackingMode.localizedName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(detail.resource.quantity)")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text(detail.config.unitName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if detail.procurement.onOrder > 0 {
                LabeledContent("Im Zulauf", value: "+\(detail.procurement.onOrder)")
                LabeledContent("Prognostiziert", value: "\(detail.procurement.projectedQuantity)")
            }
            if detail.forecast.isBelowMinimum {
                Label("Mindestbestand unterschritten", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(InventoryTheme.warning)
            }
            if let notice = model.notice {
                Label(notice, systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(InventoryTheme.success)
            }
        }
    }

    private func bookingSection(_ detail: StockDetailResponse) -> some View {
        Section("Bestand buchen") {
            Picker("Richtung", selection: $model.direction) {
                ForEach(StockBookingDirection.allCases) { direction in
                    Text(direction.localizedName).tag(direction)
                }
            }
            .pickerStyle(.segmented)

            TextField("Menge", value: $model.movementQuantity, format: .number)
                .keyboardType(.numberPad)

            Picker("Buchungsart", selection: $model.movementType) {
                ForEach(model.availableMovementTypes, id: \.self) { type in
                    Text(type.localizedName).tag(type)
                }
            }
            TextField("Grund (optional)", text: $model.movementReason)
            TextField("Notiz (optional)", text: $model.movementNote, axis: .vertical)
                .lineLimit(2 ... 5)
            TextField("Ort (optional)", text: $model.movementLocation)
            DatePicker("Buchungszeitpunkt", selection: $model.movementDate)

            Button {
                if model.direction == .outgoing {
                    confirmOutgoing = true
                } else {
                    submitMovement()
                }
            } label: {
                Label(
                    model.direction == .incoming ? "Zugang buchen" : "Abgang buchen",
                    systemImage: model.direction == .incoming ? "plus.circle.fill" : "minus.circle.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(model.direction == .incoming ? InventoryTheme.ink : InventoryTheme.danger)
            .disabled(model.movementQuantity < 1 || (model.direction == .outgoing && detail.resource.quantity == 0))
        }
    }

    private var serializedHintSection: some View {
        Section("Bestand buchen") {
            Label(
                "Dieser Bestand wird über einzelne Einheiten und deren Status verändert.",
                systemImage: "barcode.viewfinder"
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
    }

    private func planningSection(_ detail: StockDetailResponse) -> some View {
        Section("Planung & Einstellungen") {
            Picker("Tracking", selection: $model.trackingMode) {
                ForEach(StockTrackingMode.allCases, id: \.self) { mode in
                    Text(mode.localizedName).tag(mode)
                }
            }

            TextField("Einheitenname", text: $model.unitName)
            TextField("Mindestbestand", value: $model.minimumStock, format: .number)
                .keyboardType(.numberPad)
            TextField("Nachbestellmenge", value: $model.reorderQuantity, format: .number)
                .keyboardType(.numberPad)
            TextField("Lieferzeit in Tagen", value: $model.leadTimeDays, format: .number)
                .keyboardType(.numberPad)

            if detail.forecast.averageDailyUsage > 0 {
                LabeledContent(
                    "Ø Verbrauch pro Tag",
                    value: detail.forecast.averageDailyUsage.formatted(.number.precision(.fractionLength(1 ... 2)))
                )
            }
            if let days = detail.forecast.daysUntilStockout {
                LabeledContent(
                    "Reichweite",
                    value: "\(days.formatted(.number.precision(.fractionLength(0 ... 1)))) Tage"
                )
            }
            if detail.forecast.suggestedReorderQuantity > 0 {
                LabeledContent(
                    "Bestellvorschlag",
                    value: "\(detail.forecast.suggestedReorderQuantity)"
                )
            }

            Button("Einstellungen speichern") {
                if model.trackingModeChanged {
                    confirmTrackingChange = true
                } else {
                    saveConfig()
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var unitCreationSection: some View {
        Section("Einheiten anlegen") {
            Picker("Codes", selection: $model.unitCreationMode) {
                ForEach(StockUnitCreationMode.allCases) { mode in
                    Text(mode.localizedName).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if model.unitCreationMode == .generated {
                Stepper(
                    "Anzahl: \(model.unitCount)",
                    value: $model.unitCount,
                    in: 1 ... 100
                )
            } else {
                TextField(
                    "Codes, getrennt durch Komma oder Zeilenumbruch",
                    text: $model.unitCodes,
                    axis: .vertical
                )
                .lineLimit(3 ... 8)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            }
            TextField("Ort (optional)", text: $model.unitLocation)
            DatePicker("Anschaffungsdatum", selection: $model.acquiredAt)
            Button("Einheiten anlegen") {
                guard let client = state.client else { return }
                Task { await model.createUnits(using: client) }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func unitsSection(_ detail: StockDetailResponse) -> some View {
        Section("Einzelne Einheiten") {
            if detail.units.isEmpty {
                Text("Noch keine Einheiten vorhanden.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(detail.units.prefix(200)) { unit in
                    Button { editingUnit = unit } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "barcode")
                                .foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(unit.code)
                                    .font(.subheadline.monospaced().weight(.semibold))
                                    .foregroundStyle(.primary)
                                Text(unit.location.nilIfBlank ?? "Kein Ort")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(unit.status.localizedName)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(unit.status.tint)
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                }
                if detail.units.count > 200 {
                    Text("Es werden die ersten 200 von \(detail.units.count) Einheiten angezeigt.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var historySection: some View {
        Section("Buchungsverlauf") {
            Picker("Filter", selection: $model.historyFilter) {
                ForEach(StockHistoryFilter.allCases) { filter in
                    Text(filter.localizedName).tag(filter)
                }
            }
            .pickerStyle(.segmented)

            if model.filteredMovements.isEmpty {
                Text("Keine passenden Buchungen vorhanden.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.filteredMovements.prefix(50)) { movement in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: movement.delta >= 0 ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                            .foregroundStyle(
                                movement.delta >= 0
                                    ? InventoryTheme.success
                                    : InventoryTheme.warning
                            )
                        VStack(alignment: .leading, spacing: 3) {
                            Text(movement.type.stockMovementLocalizedName)
                                .font(.subheadline.weight(.semibold))
                            if let reason = movement.reason.nilIfBlank {
                                Text(reason).font(.caption).foregroundStyle(.secondary)
                            }
                            Text(movement.occurredAt.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text(movement.delta > 0 ? "+\(movement.delta)" : "\(movement.delta)")
                                .font(.headline.monospacedDigit())
                            Text("Bestand \(movement.balanceAfter)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private var trackingChangeMessage: String {
        if model.trackingMode == .serialized {
            return "Der vorhandene Bestand wird in einzelne Einheiten mit automatisch erzeugten Codes umgewandelt."
        }
        return "Der Wechsel zurück zu Mengenbestand ist nur möglich, wenn keine serialisierten Einheiten existieren."
    }

    private func submitMovement() {
        guard let client = state.client else { return }
        Task { await model.bookMovement(using: client) }
    }

    private func saveConfig() {
        guard let client = state.client else { return }
        Task { await model.saveConfig(using: client) }
    }
}

private struct StockUnitEditView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var status: StockUnitStatus
    @State private var location: String
    @State private var reason = ""
    @State private var note = ""
    @State private var occurredAt = Date()

    let unit: StockUnit
    let onSave: (StockUnitPatchRequest) -> Void

    init(unit: StockUnit, onSave: @escaping (StockUnitPatchRequest) -> Void) {
        self.unit = unit
        self.onSave = onSave
        _status = State(initialValue: unit.status)
        _location = State(initialValue: unit.location ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Code", value: unit.code)
                    Picker("Status", selection: $status) {
                        ForEach(StockUnitStatus.allCases, id: \.self) { status in
                            Text(status.localizedName).tag(status)
                        }
                    }
                    TextField("Ort", text: $location)
                    DatePicker("Zeitpunkt", selection: $occurredAt)
                }

                Section("Buchungsdetails") {
                    TextField("Grund (optional)", text: $reason)
                    TextField("Notiz (optional)", text: $note, axis: .vertical)
                        .lineLimit(2 ... 5)
                }
            }
            .navigationTitle("Einheit bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern") {
                        onSave(
                            StockUnitPatchRequest(
                                status: status,
                                location: location.nilIfBlank,
                                occurredAt: occurredAt,
                                reason: reason.nilIfBlank,
                                note: note.nilIfBlank
                            )
                        )
                        dismiss()
                    }
                }
            }
        }
    }
}

private extension StockTrackingMode {
    var localizedName: String {
        self == .bulk ? "Mengenbestand" : "Serialisierte Einheiten"
    }
}

private extension StockMovementType {
    var localizedName: String {
        switch self {
        case .receipt: "Wareneingang"
        case .issue: "Entnahme"
        case .adjustment: "Korrektur"
        case .return: "Rückgabe"
        case .waste: "Verlust / Ausschuss"
        case .transfer: "Umlagerung"
        }
    }
}

private extension StockUnitStatus {
    var localizedName: String {
        switch self {
        case .available: "Verfügbar"
        case .reserved: "Reserviert"
        case .inUse: "In Benutzung"
        case .maintenance: "Wartung"
        case .consumed: "Verbraucht"
        case .lost: "Verloren"
        case .retired: "Ausgemustert"
        }
    }

    var tint: Color {
        switch self {
        case .available: InventoryTheme.success
        case .reserved, .inUse: InventoryTheme.info
        case .maintenance: InventoryTheme.warning
        case .lost: InventoryTheme.danger
        case .consumed, .retired: .secondary
        }
    }
}

private extension String {
    var stockMovementLocalizedName: String {
        switch self {
        case "receipt": "Wareneingang"
        case "issue": "Entnahme"
        case "adjustment": "Korrektur"
        case "return": "Rückgabe"
        case "waste": "Verlust / Ausschuss"
        case "transfer": "Umlagerung"
        case "unit-created": "Einheit angelegt"
        case "unit-status": "Einheitenstatus"
        case "unit-update": "Einheit aktualisiert"
        case "serialization-opening": "Serialisierung"
        default: replacingOccurrences(of: "-", with: " ").capitalized
        }
    }

    var nilIfBlank: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

private extension Optional where Wrapped == String {
    var nilIfBlank: String? {
        self?.nilIfBlank
    }
}
