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
                ProgressView(L10n.text("ui_loading_requests_b60481e4"))
            } else if response == nil, let errorMessage {
                ContentUnavailableView {
                    Label(L10n.text("ui_requests_unavailable_a999f0b3"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button(L10n.text("ui_retry_948643cb")) { Task { await load() } }
                }
            } else {
                requestsList
            }
        }
        .navigationTitle(L10n.text("ui_internal_requests_32dc9d5c"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: L10n.text("ui_reference_person_or_item_b6ec2d61"))
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if canCreate {
                    Button {
                        showingCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(L10n.text("ui_new_request_d6b3176f"))
                }
                if loading {
                    ProgressView()
                } else {
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel(L10n.text("ui_refresh_96bf0098"))
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
            pendingConfirmation?.title ?? L10n.text("ui_update_request_4fba6e97"),
            isPresented: confirmationIsPresented,
            titleVisibility: .visible,
            presenting: pendingConfirmation
        ) { pending in
            Button(actionTitle(pending.action), role: actionRole(pending.action)) {
                Task { await perform(pending) }
            }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { }
        } message: { pending in
            Text(pending.message)
        }
        .alert(
            L10n.text("ui_could_not_update_request_7e3fe9ed"),
            isPresented: Binding(
                get: { errorMessage != nil && response != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button(L10n.text("ui_reload_status_1d404097")) { Task { await load() } }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
        }
    }

    private var requestsList: some View {
        List {
            Section {
                Picker(L10n.text("ui_status_920e413c"), selection: $filter) {
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
                        Label(L10n.text("ui_no_requests_found_337a994d"), systemImage: "clipboard")
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
        visibleRequests.count == 1 ? L10n.text("ui_1_request_6b6fab05") : L10n.text("ui_requests_0_0569614d", visibleRequests.count)
    }

    private var emptyDescription: String {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return L10n.text("ui_no_request_matches_the_current_search_2af49feb")
        }
        return filter == .active
            ? L10n.text("ui_there_are_no_open_requests_at_the_b12e9a24")
            : L10n.text("ui_there_are_no_requests_with_this_status_b949c24c")
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
            Section(L10n.text("ui_period_ab0f2fd5")) {
                DatePicker(
                    L10n.text("ui_start_0d95fd6a"),
                    selection: $startsAt,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .onChange(of: startsAt) { _, updated in
                    if dueAt <= updated {
                        dueAt = updated.addingTimeInterval(60 * 60)
                    }
                }
                DatePicker(
                    L10n.text("ui_return_6223760a"),
                    selection: $dueAt,
                    in: startsAt...,
                    displayedComponents: [.date, .hourAndMinute]
                )
            }

            Section {
                if let delivery {
                    LabeledContent(L10n.text("ui_location_or_project_985d0bbc")) {
                        Text(delivery.name)
                            .multilineTextAlignment(.trailing)
                    }
                    Button(L10n.text("ui_remove_delivery_destination_ef78c5fe"), role: .destructive) {
                        self.delivery = nil
                    }
                } else {
                    Button {
                        pickerPurpose = .delivery
                    } label: {
                        Label(L10n.text("ui_select_location_or_project_198d9e80"), systemImage: "mappin.and.ellipse")
                    }
                }
            } header: {
                Text(L10n.text("ui_delivery_destination_6227c31c"))
            } footer: {
                Text(L10n.text("ui_optional_where_the_requested_items_should_be_9074d3f5"))
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
                            .accessibilityLabel(L10n.text("ui_remove_0_41b0bdce", line.resource.name))
                        }
                        Stepper(
                            L10n.text("ui_quantity_0_ae0b74e1", line.quantity),
                            value: $line.quantity,
                            in: 1 ... 2_000_000_000
                        )
                        TextField(L10n.text("ui_note_for_this_line_5f61557b"), text: $line.note, axis: .vertical)
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
                    Label(L10n.text("ui_add_item_62272168"), systemImage: "plus.circle")
                }
                .disabled(lines.count >= 50)
            } header: {
                Text(L10n.text("ui_line_items_9253e170"))
            } footer: {
                Text(
                    lines.isEmpty
                        ? L10n.text("ui_at_least_one_lendable_item_is_required_5a3f520b")
                        : L10n.text("ui_0_of_up_to_50_line_items_bdc03daa", lines.count)
                )
            }

            Section(L10n.text("ui_note_74b487d9")) {
                TextField(L10n.text("ui_request_notes_ded67eb2"), text: $note, axis: .vertical)
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
        .navigationTitle(L10n.text("ui_new_request_d6b3176f"))
        .navigationBarTitleDisplayMode(.inline)
        .disabled(creating)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(L10n.text("ui_cancel_f7ff1178")) { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(L10n.text("ui_send_079bef4e")) { Task { await submit() } }
                    .disabled(validationMessage != nil || creating)
            }
        }
        .overlay {
            if creating {
                ProgressView(L10n.text("ui_sending_request_2b32bfac"))
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .sheet(item: $pickerPurpose) { purpose in
            NavigationStack {
                ResourcePickerView(
                    title: purpose == .item ? L10n.text("ui_add_item_62272168") : L10n.text("ui_delivery_destination_6227c31c"),
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
            L10n.text("ui_could_not_send_request_6903b2c5"),
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
        }
    }

    private var validationMessage: String? {
        if lines.isEmpty { return L10n.text("ui_add_at_least_one_item_19514e82") }
        if dueAt <= startsAt { return L10n.text("ui_the_return_must_be_after_the_start_4c506d74") }
        if dueAt.timeIntervalSince(startsAt) > 366 * 86_400 {
            return L10n.text("ui_the_period_must_not_exceed_366_days_b83d62a7")
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
            Section(L10n.text("ui_request_d131ffca")) {
                LabeledContent(L10n.text("ui_reference_e1311398"), value: request.reference)
                LabeledContent(L10n.text("ui_status_920e413c")) { requestStatusBadge(request.status) }
                LabeledContent(L10n.text("ui_requested_by_f2afcce2"), value: request.requester.name)
                if let email = request.requester.email, !email.isEmpty {
                    LabeledContent(L10n.text("ui_email_2fae6fb3"), value: email)
                }
                LabeledContent(
                    L10n.text("ui_start_0d95fd6a"),
                    value: request.startsAt.formatted(date: .long, time: .shortened)
                )
                LabeledContent(
                    L10n.text("ui_return_6223760a"),
                    value: request.dueAt.formatted(date: .long, time: .shortened)
                )
                if let delivery = request.delivery {
                    LabeledContent(L10n.text("ui_delivery_destination_6227c31c"), value: delivery.name)
                }
            }

            Section(L10n.text("ui_line_items_9253e170")) {
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
                                        ? L10n.text("ui_serialized_ce661476")
                                        : L10n.text("ui_bulk_8dff8f29")
                                )
                                Text(L10n.text("ui_stock_0_463cd367", line.resource.currentQuantity))
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
                Section(L10n.text("ui_notes_7800bd53")) {
                    if !request.note.isEmpty {
                        LabeledContent(L10n.text("ui_request_d131ffca")) {
                            Text(request.note)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    if !request.decisionNote.isEmpty {
                        LabeledContent(L10n.text("ui_decision_84b5bbbb")) {
                            Text(request.decisionNote)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
            }

            Section(L10n.text("ui_history_5fd70311")) {
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
                    .accessibilityLabel(L10n.text("ui_request_actions_9bf0478d"))
                }
            }
        }
        .confirmationDialog(
            pendingConfirmation?.title ?? L10n.text("ui_update_request_4fba6e97"),
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
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { }
        } message: { pending in
            Text(pending.message)
        }
        .alert(
            L10n.text("ui_action_failed_3a20cc65"),
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button(L10n.text("ui_reload_status_1d404097")) { Task { await reload() } }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
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
                    Label(L10n.text("ui_inventory_item_unavailable_9d3512e1"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button(L10n.text("ui_retry_948643cb")) { Task { await load() } }
                }
            } else {
                ProgressView(L10n.text("ui_loading_item_b6c8e052"))
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
        case .active: L10n.text("ui_open_64509e1a")
        case .all: L10n.text("ui_all_3801a35c")
        case .submitted: L10n.text("ui_submitted_7f8d92f4")
        case .approved: L10n.text("ui_approved_9b3015a9")
        case .fulfilled: L10n.text("ui_fulfilled_3d1f3473")
        case .rejected: L10n.text("ui_rejected_a9148e86")
        case .cancelled: L10n.text("ui_cancelled_0aa6a1fa")
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

    var title: String { L10n.text("ui_0_request_695a1133", actionTitle(action).lowercased()) }

    var message: String {
        L10n.text("ui_0_from_1_will_be_2_5de474ff", request.reference, request.requester.name, actionDescription(action))
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
    case .approve: L10n.text("ui_approve_0c78fbbf")
    case .reject: L10n.text("ui_reject_7be75ced")
    case .cancel: L10n.text("ui_cancel_81a5f66b")
    case .fulfill: L10n.text("ui_fulfill_5983746b")
    }
}

private func actionDescription(_ action: InternalRequestAction) -> String {
    switch action {
    case .approve: L10n.text("ui_approved_946c489d")
    case .reject: L10n.text("ui_rejected_e3109947")
    case .cancel: L10n.text("ui_cancelled_1678cafe")
    case .fulfill: L10n.text("ui_marked_as_fulfilled_4930365b")
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
    case .submitted: L10n.text("ui_submitted_7f8d92f4")
    case .approved: L10n.text("ui_approved_9b3015a9")
    case .rejected: L10n.text("ui_rejected_a9148e86")
    case .fulfilled: L10n.text("ui_fulfilled_3d1f3473")
    case .cancelled: L10n.text("ui_cancelled_0aa6a1fa")
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
