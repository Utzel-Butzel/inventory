import SwiftUI

struct ResourceAssignmentsView: View {
    @EnvironmentObject private var state: AppState
    let resourceID: UUID
    let canEdit: Bool
    let onInventoryChanged: () -> Void

    @State private var response: ResourceAssignmentsResponse?
    @State private var loading = false
    @State private var actingID: UUID?
    @State private var showCreation = false
    @State private var showLendingSettings = false
    @State private var checkoutAssignment: ResourceAssignment?
    @State private var pendingConfirmation: PendingResourceAssignmentAction?
    @State private var retryMutation: PendingResourceAssignmentAction?
    @State private var errorMessage: String?

    init(
        resourceID: UUID,
        canEdit: Bool,
        onInventoryChanged: @escaping () -> Void = {}
    ) {
        self.resourceID = resourceID
        self.canEdit = canEdit
        self.onInventoryChanged = onInventoryChanged
    }

    var body: some View {
        Group {
            if loading && response == nil {
                ProgressView("Nutzungen werden geladen …")
            } else if response == nil, let errorMessage {
                ContentUnavailableView {
                    Label("Nutzungen nicht verfügbar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Erneut versuchen") { Task { await load() } }
                }
            } else {
                assignmentsList
            }
        }
        .navigationTitle("Nutzung")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if loading {
                    ProgressView()
                } else {
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Aktualisieren")
                }

                if canEdit, response != nil {
                    Menu {
                        Button {
                            showCreation = true
                        } label: {
                            Label("Neue Nutzung", systemImage: "person.badge.plus")
                        }
                        Button {
                            showLendingSettings = true
                        } label: {
                            Label("Ausleihregeln", systemImage: "gearshape")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Nutzung hinzufügen oder Regeln bearbeiten")
                }
            }
        }
        .task(id: loadKey) { await load() }
        .sheet(isPresented: $showCreation) {
            if let response, let client = state.client {
                ResourceAssignmentCreateView(
                    data: response,
                    allowNegativeStock: state.allowsNegativeStock,
                    client: client
                ) {
                    showCreation = false
                    onInventoryChanged()
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $showLendingSettings) {
            if let response, let client = state.client {
                ResourceLendingSettingsView(
                    resourceID: resourceID,
                    initialSettings: response.lending,
                    client: client
                ) {
                    showLendingSettings = false
                    Task { await load() }
                }
            }
        }
        .sheet(item: $checkoutAssignment) { assignment in
            if let response {
                ReservationCheckoutView(
                    assignment: assignment,
                    availableUnits: response.availableUnits
                ) { stockUnitID in
                    checkoutAssignment = nil
                    let action = PendingResourceAssignmentAction(
                        assignment: assignment,
                        operation: .activate(stockUnitID: stockUnitID),
                        idempotencyKey: UUID()
                    )
                    Task { await perform(action) }
                }
            }
        }
        .confirmationDialog(
            confirmationTitle,
            isPresented: confirmationIsPresented,
            titleVisibility: .visible,
            presenting: pendingConfirmation
        ) { action in
            Button(action.buttonTitle, role: action.buttonRole) {
                Task { await perform(action) }
            }
            Button("Abbrechen", role: .cancel) { }
        } message: { action in
            Text(action.message)
        }
        .alert(
            "Aktion fehlgeschlagen",
            isPresented: Binding(
                get: { errorMessage != nil && response != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            if let retryMutation {
                Button("Erneut versuchen") { Task { await perform(retryMutation) } }
            } else {
                Button("Erneut laden") { Task { await load() } }
            }
            Button("Abbrechen", role: .cancel) {
                retryMutation = nil
                errorMessage = nil
            }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
    }

    private var assignmentsList: some View {
        List {
            if let response {
                Section("Verfügbarkeit") {
                    LabeledContent("Verfügbar") {
                        Text(response.availability.availableQuantity.formatted())
                            .foregroundStyle(.green)
                    }
                    LabeledContent(
                        "Aktiv zugeordnet",
                        value: response.availability.activeQuantity.formatted()
                    )
                    if response.availability.reservedQuantity > 0 {
                        LabeledContent(
                            "Reserviert",
                            value: response.availability.reservedQuantity.formatted()
                        )
                    }
                    LabeledContent(
                        "Bestandsführung",
                        value: response.trackingMode == .serialized
                            ? "Serialisiert"
                            : "Mengenbestand"
                    )
                }
            }

            Section("Aktiv") {
                if activeAssignments.isEmpty {
                    ContentUnavailableView {
                        Label("Keine aktive Nutzung", systemImage: "shippingbox.and.arrow.backward")
                    } description: {
                        Text("Dieser Eintrag ist derzeit niemandem zugeordnet oder ausgeliehen.")
                    }
                } else {
                    ForEach(activeAssignments) { assignment in
                        assignmentRow(assignment)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                assignmentActions(assignment)
                            }
                            .contextMenu {
                                assignmentActions(assignment)
                            }
                    }
                }
            }

            if !historyAssignments.isEmpty {
                Section("Verlauf") {
                    ForEach(historyAssignments) { assignment in
                        assignmentRow(assignment)
                    }
                }
            }

            if !canEdit {
                Section {
                    Label(
                        "Du kannst die Nutzungen dieses Eintrags ansehen, aber nicht ändern.",
                        systemImage: "lock.fill"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    private func assignmentRow(_ assignment: ResourceAssignment) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(assignment.assignee.label)
                    .font(.headline)
                    .lineLimit(2)
                Spacer(minLength: 4)
                statusBadge(assignment)
            }

            if let detail = assignment.assignee.detail, !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                Label(kindTitle(assignment.kind), systemImage: kindSymbol(assignment.kind))
                Label(
                    assignment.stockUnit?.code ?? quantityLabel(assignment.quantity),
                    systemImage: assignment.stockUnit == nil ? "shippingbox" : "barcode"
                )
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Label(
                    assignment.startsAt.formatted(date: .abbreviated, time: .shortened),
                    systemImage: "calendar"
                )
                if let dueAt = assignment.dueAt {
                    Label(
                        "Fällig \(dueAt.formatted(date: .abbreviated, time: .shortened))",
                        systemImage: "clock"
                    )
                    .foregroundStyle(assignment.overdue ? .red : .secondary)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if !assignment.note.isEmpty {
                Text(assignment.note)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(3)
            }

            if let completedAt = assignment.completedAt {
                Text("Abgeschlossen \(completedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if actingID == assignment.id {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func statusBadge(_ assignment: ResourceAssignment) -> some View {
        Text(statusTitle(assignment))
            .font(.caption2.weight(.semibold))
            .foregroundStyle(statusColor(assignment))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(statusColor(assignment).opacity(0.12), in: Capsule())
    }

    @ViewBuilder
    private func assignmentActions(_ assignment: ResourceAssignment) -> some View {
        if canEdit, assignment.status == .active {
            if assignment.kind == .reservation {
                Button {
                    prepareCheckout(assignment)
                } label: {
                    Label("Ausgeben", systemImage: "person.crop.circle.badge.checkmark")
                }
                .tint(InventoryTheme.accent)
                .disabled(actingID != nil)
            } else {
                Button {
                    requestMutation(assignment, operation: .complete(.returned))
                } label: {
                    Label("Zurückgeben", systemImage: "arrow.uturn.backward.circle")
                }
                .tint(.green)
                .disabled(actingID != nil)
            }

            Button(role: .destructive) {
                requestMutation(assignment, operation: .complete(.cancelled))
            } label: {
                Label("Stornieren", systemImage: "xmark.circle")
            }
            .disabled(actingID != nil)
        }
    }

    private var loadKey: ResourceAssignmentsLoadKey {
        ResourceAssignmentsLoadKey(
            contextIdentifier: state.client?.contextIdentifier,
            resourceID: resourceID
        )
    }

    private var activeAssignments: [ResourceAssignment] {
        response?.assignments.filter { $0.status == .active } ?? []
    }

    private var historyAssignments: [ResourceAssignment] {
        response?.assignments.filter { $0.status != .active } ?? []
    }

    private var confirmationIsPresented: Binding<Bool> {
        Binding(
            get: { pendingConfirmation != nil },
            set: { if !$0 { pendingConfirmation = nil } }
        )
    }

    private var confirmationTitle: String {
        pendingConfirmation?.confirmationTitle ?? "Nutzung aktualisieren?"
    }

    private func prepareCheckout(_ assignment: ResourceAssignment) {
        guard let response else { return }
        if response.trackingMode == .serialized {
            checkoutAssignment = assignment
        } else {
            requestMutation(assignment, operation: .activate(stockUnitID: nil))
        }
    }

    private func requestMutation(
        _ assignment: ResourceAssignment,
        operation: ResourceAssignmentOperation
    ) {
        pendingConfirmation = PendingResourceAssignmentAction(
            assignment: assignment,
            operation: operation,
            idempotencyKey: UUID()
        )
    }

    private func perform(_ action: PendingResourceAssignmentAction) async {
        guard actingID == nil, let client = state.client else { return }
        pendingConfirmation = nil
        retryMutation = nil
        actingID = action.assignment.id
        defer { actingID = nil }
        do {
            switch action.operation {
            case .complete(let status):
                try await client.completeAssignment(
                    id: action.assignment.id,
                    status: status,
                    idempotencyKey: action.idempotencyKey
                )
            case .activate(let stockUnitID):
                try await client.activateReservation(
                    id: action.assignment.id,
                    stockUnitID: stockUnitID,
                    idempotencyKey: action.idempotencyKey
                )
            }
            errorMessage = nil
            onInventoryChanged()
            await load()
        } catch is CancellationError {
            return
        } catch {
            retryMutation = action
            errorMessage = error.localizedDescription
        }
    }

    private func load() async {
        guard let client = state.client else { return }
        loading = true
        defer { loading = false }
        do {
            let updated = try await client.resourceAssignments(resourceID: resourceID)
            try Task.checkCancellation()
            response = updated
            retryMutation = nil
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func statusTitle(_ assignment: ResourceAssignment) -> String {
        if assignment.overdue { return "Überfällig" }
        return switch assignment.status {
        case .active: "Aktiv"
        case .returned: "Zurückgegeben"
        case .cancelled: "Storniert"
        }
    }

    private func statusColor(_ assignment: ResourceAssignment) -> Color {
        if assignment.overdue { return .red }
        return switch assignment.status {
        case .active: InventoryTheme.accent
        case .returned: .green
        case .cancelled: .secondary
        }
    }
}

private struct ResourceAssignmentCreateView: View {
    @Environment(\.dismiss) private var dismiss
    let data: ResourceAssignmentsResponse
    let allowNegativeStock: Bool
    let client: APIClient
    let onSaved: () -> Void

    @State private var kind: ResourceAssignmentKind
    @State private var recipientMode = AssignmentRecipientMode.label
    @State private var recipientLabel = ""
    @State private var selectedUserID: UUID?
    @State private var selectedUnitID: UUID?
    @State private var quantity = 1
    @State private var startsAt: Date
    @State private var dueAt: Date
    @State private var note = ""
    @State private var saving = false
    @State private var pendingAttempt: PendingAssignmentCreation?
    @State private var errorMessage: String?

    init(
        data: ResourceAssignmentsResponse,
        allowNegativeStock: Bool,
        client: APIClient,
        onSaved: @escaping () -> Void
    ) {
        self.data = data
        self.allowNegativeStock = allowNegativeStock
        self.client = client
        self.onSaved = onSaved
        let initialKind: ResourceAssignmentKind = data.lending.enabled
            ? .checkout
            : .assignment
        let initialStart = Date()
        _kind = State(initialValue: initialKind)
        _startsAt = State(initialValue: initialStart)
        _dueAt = State(
            initialValue: initialStart.addingTimeInterval(
                TimeInterval(data.lending.defaultDurationDays * 86_400)
            )
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Aktion") {
                    Picker("Art", selection: $kind) {
                        ForEach(availableKinds) { option in
                            Text(kindTitle(option)).tag(option)
                        }
                    }
                    .onChange(of: kind) { _, updated in
                        configureDates(for: updated)
                    }

                    Picker("Empfängertyp", selection: $recipientMode) {
                        Text("Externe Person oder Gruppe").tag(AssignmentRecipientMode.label)
                        if !data.recipients.users.isEmpty {
                            Text("Registrierter Benutzer").tag(AssignmentRecipientMode.user)
                        }
                    }

                    if recipientMode == .user {
                        Picker("Empfänger", selection: $selectedUserID) {
                            Text("Benutzer auswählen").tag(nil as UUID?)
                            ForEach(data.recipients.users) { user in
                                Text("\(user.name) · \(user.email)")
                                    .tag(user.id as UUID?)
                            }
                        }
                    } else {
                        TextField("Name oder Bezeichnung", text: $recipientLabel)
                            .onChange(of: recipientLabel) { _, value in
                                if value.count > 240 {
                                    recipientLabel = String(value.prefix(240))
                                }
                            }
                    }
                }

                Section("Bestand") {
                    if data.trackingMode == .serialized, kind != .reservation {
                        Picker("Serialisierte Einheit", selection: $selectedUnitID) {
                            Text("Einheit auswählen").tag(nil as UUID?)
                            ForEach(data.availableUnits) { unit in
                                Text(unitLabel(unit)).tag(unit.id as UUID?)
                            }
                        }
                        if data.availableUnits.isEmpty {
                            Label(
                                "Es ist keine verfügbare Einheit vorhanden.",
                                systemImage: "exclamationmark.triangle"
                            )
                            .font(.caption)
                            .foregroundStyle(.orange)
                        }
                    } else if data.trackingMode == .serialized {
                        Label(
                            "Die konkrete Einheit wird erst bei der Ausgabe ausgewählt.",
                            systemImage: "info.circle"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    } else {
                        TextField("Menge", value: $quantity, format: .number)
                            .keyboardType(.numberPad)
                        LabeledContent(
                            "Aktuell verfügbar",
                            value: data.availability.availableQuantity.formatted()
                        )
                    }
                }

                if kind != .assignment {
                    Section("Zeitraum") {
                        DatePicker(
                            "Beginn",
                            selection: $startsAt,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        DatePicker(
                            "Rückgabe",
                            selection: $dueAt,
                            in: startsAt...,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        Text("Maximale Ausleihdauer: \(data.lending.maxDurationDays) Tage")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Notiz") {
                    TextEditor(text: $note)
                        .frame(minHeight: 90)
                        .onChange(of: note) { _, value in
                            if value.count > 20_000 {
                                note = String(value.prefix(20_000))
                            }
                        }
                }

                if let validationMessage {
                    Section {
                        Label(validationMessage, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle("Neue Nutzung")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(submitTitle) { Task { await save() } }
                        .disabled(validationMessage != nil || saving)
                }
            }
            .interactiveDismissDisabled(saving)
            .alert(
                "Nutzung konnte nicht angelegt werden",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("Erneut versuchen") { Task { await save() } }
                Button("Abbrechen", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private var availableKinds: [ResourceAssignmentKind] {
        data.lending.enabled
            ? [.checkout, .reservation, .assignment]
            : [.assignment]
    }

    private var request: ResourceAssignmentCreateRequest? {
        guard validationMessage == nil else { return nil }
        let recipient: AssignmentRecipientRequest
        if recipientMode == .user, let selectedUserID {
            recipient = .user(selectedUserID)
        } else {
            recipient = .label(recipientLabel)
        }
        return ResourceAssignmentCreateRequest(
            kind: kind,
            quantity: data.trackingMode == .serialized ? 1 : quantity,
            stockUnitId: data.trackingMode == .serialized && kind != .reservation
                ? selectedUnitID
                : nil,
            recipient: recipient,
            startsAt: kind == .assignment ? nil : startsAt,
            dueAt: kind == .assignment ? nil : dueAt,
            note: note
        )
    }

    private var validationMessage: String? {
        if recipientMode == .user, selectedUserID == nil {
            return "Wähle einen registrierten Benutzer aus."
        }
        if recipientMode == .label,
           recipientLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Gib einen Empfänger ein."
        }
        if quantity < 1 || quantity > 2_000_000_000 {
            return "Die Menge muss eine positive ganze Zahl sein."
        }
        if data.trackingMode == .serialized,
           kind != .reservation,
           selectedUnitID == nil {
            return "Wähle eine verfügbare serialisierte Einheit aus."
        }
        if kind != .reservation,
           !allowNegativeStock,
           quantity > data.availability.availableQuantity {
            return "Die Menge überschreitet den aktuell verfügbaren Bestand."
        }
        if kind == .reservation, startsAt <= Date() {
            return "Eine Reservierung muss in der Zukunft beginnen."
        }
        if kind != .assignment {
            guard dueAt > startsAt else {
                return "Die Rückgabe muss nach dem Beginn liegen."
            }
            let duration = dueAt.timeIntervalSince(startsAt) / 86_400
            if duration > Double(data.lending.maxDurationDays) {
                return "Der Zeitraum überschreitet die maximale Ausleihdauer."
            }
        }
        return nil
    }

    private var submitTitle: String {
        switch kind {
        case .checkout: "Ausleihen"
        case .assignment: "Zuweisen"
        case .reservation: "Reservieren"
        }
    }

    private func configureDates(for updatedKind: ResourceAssignmentKind) {
        selectedUnitID = updatedKind == .reservation ? nil : selectedUnitID
        guard updatedKind != .assignment else { return }
        startsAt = updatedKind == .reservation
            ? Date().addingTimeInterval(86_400)
            : Date()
        dueAt = startsAt.addingTimeInterval(
            TimeInterval(data.lending.defaultDurationDays * 86_400)
        )
    }

    private func save() async {
        guard !saving, let request else { return }
        let attempt = pendingAttempt?.request == request
            ? pendingAttempt!
            : PendingAssignmentCreation(request: request, idempotencyKey: UUID())
        pendingAttempt = attempt
        saving = true
        defer { saving = false }
        do {
            try await client.createResourceAssignment(
                resourceID: data.resource.id,
                input: request,
                idempotencyKey: attempt.idempotencyKey
            )
            pendingAttempt = nil
            errorMessage = nil
            onSaved()
            dismiss()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ResourceLendingSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    let resourceID: UUID
    let client: APIClient
    let onSaved: () -> Void

    @State private var settings: ResourceLendingSettings
    @State private var saving = false
    @State private var errorMessage: String?

    init(
        resourceID: UUID,
        initialSettings: ResourceLendingSettings,
        client: APIClient,
        onSaved: @escaping () -> Void
    ) {
        self.resourceID = resourceID
        self.client = client
        self.onSaved = onSaved
        _settings = State(initialValue: initialSettings)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Ausleihen und Reservierungen aktivieren", isOn: $settings.enabled)
                } footer: {
                    Text("Dauerhafte Zuweisungen bleiben auch bei deaktivierter Ausleihe möglich.")
                }

                Section("Laufzeit") {
                    Stepper(
                        "Standard: \(settings.defaultDurationDays) Tage",
                        value: $settings.defaultDurationDays,
                        in: 1 ... settings.maxDurationDays
                    )
                    Stepper(
                        "Maximum: \(settings.maxDurationDays) Tage",
                        value: $settings.maxDurationDays,
                        in: settings.defaultDurationDays ... 3_650
                    )
                }

                Section {
                    Toggle("Genehmigung erforderlich", isOn: $settings.approvalRequired)
                }
            }
            .navigationTitle("Ausleihregeln")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern") { Task { await save() } }
                        .disabled(saving)
                }
            }
            .interactiveDismissDisabled(saving)
            .alert(
                "Regeln konnten nicht gespeichert werden",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("Erneut versuchen") { Task { await save() } }
                Button("Abbrechen", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await client.updateResourceLendingSettings(
                resourceID: resourceID,
                settings: settings
            )
            errorMessage = nil
            onSaved()
            dismiss()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ReservationCheckoutView: View {
    @Environment(\.dismiss) private var dismiss
    let assignment: ResourceAssignment
    let availableUnits: [AssignmentAvailableUnit]
    let onCheckout: (UUID) -> Void
    @State private var selectedUnitID: UUID?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Empfänger", value: assignment.assignee.label)
                    LabeledContent("Menge", value: quantityLabel(assignment.quantity))
                }
                Section("Serialisierte Einheit") {
                    Picker("Einheit", selection: $selectedUnitID) {
                        Text("Einheit auswählen").tag(nil as UUID?)
                        ForEach(availableUnits) { unit in
                            Text(unitLabel(unit)).tag(unit.id as UUID?)
                        }
                    }
                    if availableUnits.isEmpty {
                        Label(
                            "Es ist keine verfügbare Einheit vorhanden.",
                            systemImage: "exclamationmark.triangle"
                        )
                        .font(.caption)
                        .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle("Reservierung ausgeben")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Ausgeben") {
                        guard let selectedUnitID else { return }
                        onCheckout(selectedUnitID)
                        dismiss()
                    }
                    .disabled(selectedUnitID == nil)
                }
            }
        }
    }
}

private struct ResourceAssignmentsLoadKey: Hashable {
    let contextIdentifier: String?
    let resourceID: UUID
}

private enum AssignmentRecipientMode: Hashable {
    case label
    case user
}

private struct PendingAssignmentCreation: Sendable {
    let request: ResourceAssignmentCreateRequest
    let idempotencyKey: UUID
}

private enum ResourceAssignmentOperation: Equatable, Sendable {
    case complete(AssignmentCompletionStatus)
    case activate(stockUnitID: UUID?)
}

private struct PendingResourceAssignmentAction: Sendable {
    let assignment: ResourceAssignment
    let operation: ResourceAssignmentOperation
    let idempotencyKey: UUID

    var confirmationTitle: String {
        switch operation {
        case .complete(.returned): "Nutzung zurückgeben?"
        case .complete(.cancelled): "Nutzung stornieren?"
        case .activate: "Reservierung ausgeben?"
        }
    }

    var buttonTitle: String {
        switch operation {
        case .complete(.returned): "Zurückgeben"
        case .complete(.cancelled): "Stornieren"
        case .activate: "Ausgeben"
        }
    }

    var buttonRole: ButtonRole? {
        operation == .complete(.cancelled) ? .destructive : nil
    }

    var message: String {
        switch operation {
        case .complete(.returned):
            "Die Nutzung durch „\(assignment.assignee.label)“ wird als zurückgegeben markiert."
        case .complete(.cancelled):
            "Die Nutzung durch „\(assignment.assignee.label)“ wird storniert."
        case .activate:
            "Die Reservierung für „\(assignment.assignee.label)“ wird jetzt ausgegeben."
        }
    }
}

private func kindTitle(_ kind: ResourceAssignmentKind) -> String {
    switch kind {
    case .checkout: "Ausleihe"
    case .assignment: "Zuweisung"
    case .reservation: "Reservierung"
    }
}

private func kindSymbol(_ kind: ResourceAssignmentKind) -> String {
    switch kind {
    case .checkout: "hand.raised"
    case .assignment: "person.crop.circle.badge.checkmark"
    case .reservation: "calendar.badge.clock"
    }
}

private func quantityLabel(_ quantity: Int) -> String {
    quantity == 1 ? "1 Einheit" : "\(quantity) Einheiten"
}

private func unitLabel(_ unit: AssignmentAvailableUnit) -> String {
    if let location = unit.location, !location.isEmpty {
        return "\(unit.code) · \(location)"
    }
    return unit.code
}
