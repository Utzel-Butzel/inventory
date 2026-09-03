import SwiftUI

struct InternalRequestsView: View {
    @EnvironmentObject private var state: AppState
    @State private var response: InternalRequestsResponse?
    @State private var filter = InternalRequestFilter.active
    @State private var query = ""
    @State private var loading = false
    @State private var actingID: UUID?
    @State private var pendingConfirmation: PendingInternalRequestAction?
    @State private var showingCreate = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if loading && response == nil {
                ProgressView("Anfragen werden geladen …")
            } else if response == nil, let errorMessage {
                ContentUnavailableView {
                    Label("Anfragen nicht verfügbar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Erneut versuchen") { Task { await load() } }
                }
            } else {
                requestsList
            }
        }
        .navigationTitle("Interne Anfragen")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Referenz, Person oder Eintrag")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if canCreate {
                    Button {
                        showingCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Neue Anfrage")
                }
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
            }
        }
        .sheet(isPresented: $showingCreate) {
            NavigationStack {
                InternalRequestCreateView { created in
                    replaceRequest(created)
                    filter = .active
                }
            }
        }
        .task(id: state.client?.contextIdentifier) { await load() }
        .confirmationDialog(
            pendingConfirmation?.title ?? "Anfrage aktualisieren?",
            isPresented: confirmationIsPresented,
            titleVisibility: .visible,
            presenting: pendingConfirmation
        ) { pending in
            Button(actionTitle(pending.action), role: actionRole(pending.action)) {
                Task { await perform(pending) }
            }
            Button("Abbrechen", role: .cancel) { }
        } message: { pending in
            Text(pending.message)
        }
        .alert(
            "Anfrage konnte nicht aktualisiert werden",
            isPresented: Binding(
                get: { errorMessage != nil && response != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("Stand neu laden") { Task { await load() } }
            Button("Abbrechen", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
    }

    private var requestsList: some View {
        List {
            Section {
                Picker("Status", selection: $filter) {
                    ForEach(InternalRequestFilter.allCases) { option in
                        Text("\(option.title) (\(count(for: option)))")
                            .tag(option)
                    }
                }
                .pickerStyle(.menu)
            } footer: {
                Text(resultCountLabel)
            }

            if visibleRequests.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("Keine Anfragen gefunden", systemImage: "clipboard")
                    } description: {
                        Text(emptyDescription)
                    }
                }
            } else {
                Section {
                    ForEach(visibleRequests) { request in
                        NavigationLink {
                            InternalRequestDetailView(
                                initialRequest: request,
                                canManage: canManage
                            ) { updated in
                                replaceRequest(updated)
                            }
                        } label: {
                            requestLabel(request)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            requestActionButtons(request)
                        }
                        .contextMenu {
                            requestActionButtons(request)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    private func requestLabel(_ request: InventoryInternalRequest) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(request.reference)
                    .font(.subheadline.monospaced().weight(.semibold))
                Spacer(minLength: 4)
                requestStatusBadge(request.status)
            }

            Label(request.requester.name, systemImage: "person")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Label(
                    request.startsAt.formatted(date: .abbreviated, time: .shortened),
                    systemImage: "calendar"
                )
                Label(
                    request.dueAt.formatted(date: .abbreviated, time: .shortened),
                    systemImage: "clock"
                )
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let delivery = request.delivery {
                Label(delivery.name, systemImage: "mappin.and.ellipse")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(lineSummary(request.lines))
                .font(.caption)
                .foregroundStyle(.tertiary)
                .lineLimit(2)

            if actingID == request.id {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func requestActionButtons(_ request: InventoryInternalRequest) -> some View {
        ForEach(availableActions(for: request, canManage: canManage)) { action in
            Button(role: actionRole(action)) {
                trigger(action, for: request)
            } label: {
                Label(actionTitle(action), systemImage: actionSymbol(action))
            }
            .tint(actionColor(action))
            .disabled(actingID != nil)
        }
    }

    private var confirmationIsPresented: Binding<Bool> {
        Binding(
            get: { pendingConfirmation != nil },
            set: { if !$0 { pendingConfirmation = nil } }
        )
    }

    private var canManage: Bool {
        response?.capabilities.canManage == true && state.canManageRequests
    }

    private var canCreate: Bool {
        response?.capabilities.canCreate == true && state.canCreateRequests &&
            state.canReadInventory
    }

    private var requests: [InventoryInternalRequest] {
        response?.requests ?? []
    }

    private var visibleRequests: [InventoryInternalRequest] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedLowercase
        return requests.filter { request in
            guard filter.matches(request.status) else { return false }
            guard !normalizedQuery.isEmpty else { return true }
            let candidates: [String?] = [
                request.reference,
                request.requester.name,
                request.requester.email,
                request.delivery?.name,
                request.note,
            ] + request.lines.flatMap { [$0.resource.name, $0.resource.sku, $0.note] }
            return candidates
                .compactMap { $0?.localizedLowercase }
                .contains { $0.contains(normalizedQuery) }
        }
    }

    private var resultCountLabel: String {
        visibleRequests.count == 1 ? "1 Anfrage" : "\(visibleRequests.count) Anfragen"
    }

    private var emptyDescription: String {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Keine Anfrage entspricht der aktuellen Suche."
        }
        return filter == .active
            ? "Es gibt derzeit keine offenen Anfragen."
            : "Für diesen Status sind keine Anfragen vorhanden."
    }

    private func count(for option: InternalRequestFilter) -> Int {
        requests.count(where: { option.matches($0.status) })
    }

    private func trigger(
        _ action: InternalRequestAction,
        for request: InventoryInternalRequest
    ) {
        let pending = PendingInternalRequestAction(request: request, action: action)
        if action == .approve {
            Task { await perform(pending) }
        } else {
            pendingConfirmation = pending
        }
    }

    private func perform(_ pending: PendingInternalRequestAction) async {
        guard actingID == nil, let client = state.client else { return }
        pendingConfirmation = nil
        actingID = pending.request.id
        defer { actingID = nil }
        do {
            let updated = try await client.transitionInternalRequest(
                id: pending.request.id,
                action: pending.action
            ).request
            replaceRequest(updated)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func replaceRequest(_ updated: InventoryInternalRequest) {
        guard let response else { return }
        var requests = response.requests
        if let index = requests.firstIndex(where: { $0.id == updated.id }) {
            requests[index] = updated
        } else {
            requests.insert(updated, at: 0)
        }
        self.response = InternalRequestsResponse(
            requests: requests,
            capabilities: response.capabilities
        )
    }

    private func load() async {
        guard let client = state.client else { return }
        loading = true
        defer { loading = false }
        do {
            let updated = try await client.listInternalRequests()
            try Task.checkCancellation()
            response = updated
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct InternalRequestCreateView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: AppState
    @State private var startsAt: Date
    @State private var dueAt: Date
    @State private var note = ""
    @State private var delivery: InventoryResource?
    @State private var lines: [InternalRequestDraftLine] = []
    @State private var pickerPurpose: InternalRequestPickerPurpose?
    @State private var creating = false
    @State private var submissionIdentity: InternalRequestSubmissionIdentity?
    @State private var errorMessage: String?
    let onCreated: (InventoryInternalRequest) -> Void

    init(onCreated: @escaping (InventoryInternalRequest) -> Void) {
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: .now) ?? .now
        let start = calendar.date(
            bySettingHour: 9,
            minute: 0,
            second: 0,
            of: tomorrow
        ) ?? tomorrow
        _startsAt = State(initialValue: start)
        _dueAt = State(initialValue: start.addingTimeInterval(8 * 60 * 60))
        self.onCreated = onCreated
    }

    var body: some View {
        Form {
            Section("Zeitraum") {
                DatePicker(
                    "Beginn",
                    selection: $startsAt,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .onChange(of: startsAt) { _, updated in
                    if dueAt <= updated {
                        dueAt = updated.addingTimeInterval(60 * 60)
                    }
                }
                DatePicker(
                    "Rückgabe",
                    selection: $dueAt,
                    in: startsAt...,
                    displayedComponents: [.date, .hourAndMinute]
                )
            }

            Section {
                if let delivery {
                    LabeledContent("Ort oder Projekt") {
                        Text(delivery.name)
                            .multilineTextAlignment(.trailing)
                    }
                    Button("Bereitstellung entfernen", role: .destructive) {
                        self.delivery = nil
                    }
                } else {
                    Button {
                        pickerPurpose = .delivery
                    } label: {
                        Label("Ort oder Projekt auswählen", systemImage: "mappin.and.ellipse")
                    }
                }
            } header: {
                Text("Bereitstellung")
            } footer: {
                Text("Optional: Wo die angefragten Artikel bereitgestellt werden sollen.")
            }

            Section {
                ForEach($lines) { $line in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(line.resource.name)
                                    .font(.subheadline.weight(.semibold))
                                Text(line.resource.sku ?? line.resource.type.localizedName)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(role: .destructive) {
                                lines.removeAll { $0.id == line.id }
                            } label: {
                                Image(systemName: "trash")
                            }
                            .accessibilityLabel("\(line.resource.name) entfernen")
                        }
                        Stepper(
                            "Menge: \(line.quantity)",
                            value: $line.quantity,
                            in: 1 ... 2_000_000_000
                        )
                        TextField("Notiz zu dieser Position", text: $line.note, axis: .vertical)
                            .lineLimit(1 ... 4)
                            .onChange(of: line.note) { _, updated in
                                if updated.count > 20_000 {
                                    line.note = String(updated.prefix(20_000))
                                }
                            }
                    }
                    .padding(.vertical, 3)
                }

                Button {
                    pickerPurpose = .item
                } label: {
                    Label("Artikel hinzufügen", systemImage: "plus.circle")
                }
                .disabled(lines.count >= 50)
            } header: {
                Text("Positionen")
            } footer: {
                Text(
                    lines.isEmpty
                        ? "Mindestens ein ausleihbarer Artikel ist erforderlich."
                        : "\(lines.count) von maximal 50 Positionen"
                )
            }

            Section("Notiz") {
                TextField("Hinweise zur Anfrage", text: $note, axis: .vertical)
                    .lineLimit(3 ... 8)
                    .onChange(of: note) { _, updated in
                        if updated.count > 20_000 {
                            note = String(updated.prefix(20_000))
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
        .navigationTitle("Neue Anfrage")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(creating)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Abbrechen") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Senden") { Task { await submit() } }
                    .disabled(validationMessage != nil || creating)
            }
        }
        .overlay {
            if creating {
                ProgressView("Anfrage wird gesendet …")
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .sheet(item: $pickerPurpose) { purpose in
            NavigationStack {
                ResourcePickerView(
                    title: purpose == .item ? "Artikel hinzufügen" : "Bereitstellung",
                    excludedResourceIDs: purpose == .item ? Set(lines.map(\.id)) : [],
                    loanableOnly: purpose == .item
                ) { resource in
                    if purpose == .item {
                        guard !lines.contains(where: { $0.id == resource.id }) else { return }
                        lines.append(InternalRequestDraftLine(resource: resource))
                    } else {
                        delivery = resource
                    }
                }
            }
        }
        .alert(
            "Anfrage konnte nicht gesendet werden",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
    }

    private var validationMessage: String? {
        if lines.isEmpty { return "Füge mindestens einen Artikel hinzu." }
        if dueAt <= startsAt { return "Die Rückgabe muss nach dem Beginn liegen." }
        if dueAt.timeIntervalSince(startsAt) > 366 * 86_400 {
            return "Der Zeitraum darf höchstens 366 Tage umfassen."
        }
        return nil
    }

    private var input: InternalRequestCreateRequest {
        InternalRequestCreateRequest(
            deliveryResourceId: delivery?.id,
            startsAt: startsAt,
            dueAt: dueAt,
            note: note,
            lines: lines.map {
                InternalRequestCreateLineRequest(
                    resourceId: $0.resource.id,
                    quantity: $0.quantity,
                    note: $0.note
                )
            }
        )
    }

    private var fingerprint: String {
        let lineValue = lines.map {
            "\($0.id.uuidString.lowercased()):\($0.quantity):\($0.note)"
        }.joined(separator: "|")
        return [
            delivery?.id.uuidString.lowercased() ?? "",
            String(startsAt.timeIntervalSince1970),
            String(dueAt.timeIntervalSince1970),
            note,
            lineValue,
        ].joined(separator: "\u{1f}")
    }

    private func submit() async {
        guard validationMessage == nil, !creating, let client = state.client else { return }
        let identity: InternalRequestSubmissionIdentity
        if let submissionIdentity, submissionIdentity.fingerprint == fingerprint {
            identity = submissionIdentity
        } else {
            identity = InternalRequestSubmissionIdentity(
                fingerprint: fingerprint,
                idempotencyKey: UUID()
            )
            submissionIdentity = identity
        }
        creating = true
        defer { creating = false }
        do {
            let created = try await client.createInternalRequest(
                input: input,
                idempotencyKey: identity.idempotencyKey
            ).request
            submissionIdentity = nil
            onCreated(created)
            dismiss()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct InternalRequestDraftLine: Identifiable {
    let resource: InventoryResource
    var quantity = 1
    var note = ""

    var id: UUID { resource.id }
}

private enum InternalRequestPickerPurpose: String, Identifiable {
    case item
    case delivery

    var id: Self { self }
}

private struct InternalRequestSubmissionIdentity {
    let fingerprint: String
    let idempotencyKey: UUID
}

private struct InternalRequestDetailView: View {
    @EnvironmentObject private var state: AppState
    @State private var request: InventoryInternalRequest
    @State private var acting = false
    @State private var pendingConfirmation: PendingInternalRequestAction?
    @State private var errorMessage: String?
    let canManage: Bool
    let onUpdated: (InventoryInternalRequest) -> Void

    init(
        initialRequest: InventoryInternalRequest,
        canManage: Bool,
        onUpdated: @escaping (InventoryInternalRequest) -> Void
    ) {
        _request = State(initialValue: initialRequest)
        self.canManage = canManage
        self.onUpdated = onUpdated
    }

    var body: some View {
        List {
            Section("Anfrage") {
                LabeledContent("Referenz", value: request.reference)
                LabeledContent("Status") { requestStatusBadge(request.status) }
                LabeledContent("Anfragende Person", value: request.requester.name)
                if let email = request.requester.email, !email.isEmpty {
                    LabeledContent("E-Mail", value: email)
                }
                LabeledContent(
                    "Beginn",
                    value: request.startsAt.formatted(date: .long, time: .shortened)
                )
                LabeledContent(
                    "Rückgabe",
                    value: request.dueAt.formatted(date: .long, time: .shortened)
                )
                if let delivery = request.delivery {
                    LabeledContent("Bereitstellung", value: delivery.name)
                }
            }

            Section("Positionen") {
                ForEach(request.lines) { line in
                    NavigationLink {
                        InternalRequestResourceDestinationView(resourceID: line.resource.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(line.resource.name)
                                    .font(.subheadline.weight(.semibold))
                                Spacer()
                                Text("\(line.quantity) ×")
                                    .font(.subheadline.monospacedDigit().weight(.semibold))
                            }
                            HStack(spacing: 6) {
                                Text(
                                    line.resource.trackingMode == .serialized
                                        ? "Serialisiert"
                                        : "Mengenbestand"
                                )
                                Text("· Bestand \(line.resource.currentQuantity)")
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            if !line.note.isEmpty {
                                Text(line.note)
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .padding(.vertical, 3)
                    }
                }
            }

            if !request.note.isEmpty || !request.decisionNote.isEmpty {
                Section("Notizen") {
                    if !request.note.isEmpty {
                        LabeledContent("Anfrage") {
                            Text(request.note)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    if !request.decisionNote.isEmpty {
                        LabeledContent("Entscheidung") {
                            Text(request.decisionNote)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
            }

            Section("Verlauf") {
                ForEach(request.events) { event in
                    HStack(alignment: .top, spacing: 10) {
                        Circle()
                            .fill(requestStatusColor(event.type))
                            .frame(width: 8, height: 8)
                            .padding(.top, 6)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(requestStatusTitle(event.type))
                                .font(.subheadline.weight(.semibold))
                            Text(
                                "\(event.occurredAt.formatted(date: .abbreviated, time: .shortened)) · \(event.actor)"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            if !event.note.isEmpty {
                                Text(event.note)
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .navigationTitle(request.reference)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if acting {
                    ProgressView()
                } else if !availableActions(for: request, canManage: canManage).isEmpty {
                    Menu {
                        ForEach(availableActions(for: request, canManage: canManage)) { action in
                            Button(role: actionRole(action)) {
                                trigger(action)
                            } label: {
                                Label(actionTitle(action), systemImage: actionSymbol(action))
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Anfrageaktionen")
                }
            }
        }
        .confirmationDialog(
            pendingConfirmation?.title ?? "Anfrage aktualisieren?",
            isPresented: Binding(
                get: { pendingConfirmation != nil },
                set: { if !$0 { pendingConfirmation = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingConfirmation
        ) { pending in
            Button(actionTitle(pending.action), role: actionRole(pending.action)) {
                Task { await perform(pending.action) }
            }
            Button("Abbrechen", role: .cancel) { }
        } message: { pending in
            Text(pending.message)
        }
        .alert(
            "Aktion fehlgeschlagen",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("Stand neu laden") { Task { await reload() } }
            Button("Abbrechen", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
    }

    private func trigger(_ action: InternalRequestAction) {
        if action == .approve {
            Task { await perform(action) }
        } else {
            pendingConfirmation = PendingInternalRequestAction(
                request: request,
                action: action
            )
        }
    }

    private func perform(_ action: InternalRequestAction) async {
        guard !acting, let client = state.client else { return }
        pendingConfirmation = nil
        acting = true
        defer { acting = false }
        do {
            let updated = try await client.transitionInternalRequest(
                id: request.id,
                action: action
            ).request
            request = updated
            onUpdated(updated)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func reload() async {
        guard let client = state.client else { return }
        do {
            let updated = try await client.internalRequest(id: request.id).request
            request = updated
            onUpdated(updated)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct InternalRequestResourceDestinationView: View {
    @EnvironmentObject private var state: AppState
    let resourceID: UUID
    @State private var resource: InventoryResource?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let resource {
                ResourceDetailView(resource: resource)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Eintrag nicht verfügbar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Erneut versuchen") { Task { await load() } }
                }
            } else {
                ProgressView("Eintrag wird geladen …")
            }
        }
        .task(id: state.client?.contextIdentifier) { await load() }
    }

    private func load() async {
        guard let client = state.client else { return }
        do {
            resource = try await client.getResource(id: resourceID)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum InternalRequestFilter: String, CaseIterable, Identifiable {
    case active
    case all
    case submitted
    case approved
    case fulfilled
    case rejected
    case cancelled

    var id: Self { self }

    var title: String {
        switch self {
        case .active: "Offen"
        case .all: "Alle"
        case .submitted: "Eingereicht"
        case .approved: "Genehmigt"
        case .fulfilled: "Erfüllt"
        case .rejected: "Abgelehnt"
        case .cancelled: "Storniert"
        }
    }

    func matches(_ status: InternalRequestStatus) -> Bool {
        switch self {
        case .active: status == .submitted || status == .approved
        case .all: true
        case .submitted: status == .submitted
        case .approved: status == .approved
        case .fulfilled: status == .fulfilled
        case .rejected: status == .rejected
        case .cancelled: status == .cancelled
        }
    }
}

private struct PendingInternalRequestAction: Sendable {
    let request: InventoryInternalRequest
    let action: InternalRequestAction

    var title: String { "Anfrage \(actionTitle(action).lowercased())?" }

    var message: String {
        "\(request.reference) von \(request.requester.name) wird \(actionDescription(action))."
    }
}

private func availableActions(
    for request: InventoryInternalRequest,
    canManage: Bool
) -> [InternalRequestAction] {
    var actions: [InternalRequestAction] = []
    if canManage, request.status == .submitted {
        actions.append(contentsOf: [.approve, .reject])
    } else if canManage, request.status == .approved {
        actions.append(.fulfill)
    }
    if request.canCancel {
        actions.append(.cancel)
    }
    return actions
}

private func actionTitle(_ action: InternalRequestAction) -> String {
    switch action {
    case .approve: "Genehmigen"
    case .reject: "Ablehnen"
    case .cancel: "Stornieren"
    case .fulfill: "Erfüllen"
    }
}

private func actionDescription(_ action: InternalRequestAction) -> String {
    switch action {
    case .approve: "genehmigt"
    case .reject: "abgelehnt"
    case .cancel: "storniert"
    case .fulfill: "als erfüllt markiert"
    }
}

private func actionSymbol(_ action: InternalRequestAction) -> String {
    switch action {
    case .approve: "checkmark.circle"
    case .reject: "xmark.circle"
    case .cancel: "nosign"
    case .fulfill: "shippingbox.and.arrow.backward"
    }
}

private func actionRole(_ action: InternalRequestAction) -> ButtonRole? {
    action == .reject || action == .cancel ? .destructive : nil
}

private func actionColor(_ action: InternalRequestAction) -> Color {
    switch action {
    case .approve, .fulfill: .green
    case .reject, .cancel: .red
    }
}

@ViewBuilder
private func requestStatusBadge(_ status: InternalRequestStatus) -> some View {
    Text(requestStatusTitle(status))
        .font(.caption2.weight(.semibold))
        .foregroundStyle(requestStatusColor(status))
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(requestStatusColor(status).opacity(0.12), in: Capsule())
}

private func requestStatusTitle(_ status: InternalRequestStatus) -> String {
    switch status {
    case .submitted: "Eingereicht"
    case .approved: "Genehmigt"
    case .rejected: "Abgelehnt"
    case .fulfilled: "Erfüllt"
    case .cancelled: "Storniert"
    }
}

private func requestStatusColor(_ status: InternalRequestStatus) -> Color {
    switch status {
    case .submitted: .orange
    case .approved: InventoryTheme.accent
    case .rejected: .red
    case .fulfilled: .green
    case .cancelled: .secondary
    }
}

private func lineSummary(_ lines: [InternalRequestLine]) -> String {
    let values = lines.prefix(3).map { "\($0.quantity) × \($0.resource.name)" }
    let suffix = lines.count > 3 ? " · +\(lines.count - 3)" : ""
    return values.joined(separator: " · ") + suffix
}
