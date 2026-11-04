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
                ProgressView(L10n.text("ui_loading_assignments_8a063f94"))
            } else if response == nil, let errorMessage {
                ContentUnavailableView {
                    Label(L10n.text("ui_assignments_unavailable_a19b731f"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button(L10n.text("ui_retry_948643cb")) { Task { await load() } }
                }
            } else {
                assignmentsList
            }
        }
        .navigationTitle(L10n.text("ui_assignment_1b436405"))
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
                    .accessibilityLabel(L10n.text("ui_refresh_96bf0098"))
                }

                if canEdit, response != nil {
                    Menu {
                        Button {
                            showCreation = true
                        } label: {
                            Label(L10n.text("ui_new_assignment_945507bd"), systemImage: "person.badge.plus")
                        }
                        Button {
                            showLendingSettings = true
                        } label: {
                            Label(L10n.text("ui_lending_rules_21ff147e"), systemImage: "gearshape")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(L10n.text("ui_add_an_assignment_or_edit_rules_6d10c2c6"))
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
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { }
        } message: { action in
            Text(action.message)
        }
        .alert(
            L10n.text("ui_action_failed_3a20cc65"),
            isPresented: Binding(
                get: { errorMessage != nil && response != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            if let retryMutation {
                Button(L10n.text("ui_retry_948643cb")) { Task { await perform(retryMutation) } }
            } else {
                Button(L10n.text("ui_retry_1b8b908f")) { Task { await load() } }
            }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) {
                retryMutation = nil
                errorMessage = nil
            }
        } message: {
            Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
        }
    }

    private var assignmentsList: some View {
        List {
            if let response {
                Section(L10n.text("ui_availability_98360c41")) {
                    LabeledContent(L10n.text("ui_available_3aa55273")) {
                        Text(response.availability.availableQuantity.formatted())
                            .foregroundStyle(.green)
                    }
                    LabeledContent(
                        L10n.text("ui_currently_assigned_de234b1b"),
                        value: response.availability.activeQuantity.formatted()
                    )
                    if response.availability.reservedQuantity > 0 {
                        LabeledContent(
                            L10n.text("ui_reserved_10814cd6"),
                            value: response.availability.reservedQuantity.formatted()
                        )
                    }
                    LabeledContent(
                        L10n.text("ui_stock_tracking_c0237f4d"),
                        value: response.trackingMode == .serialized
                            ? L10n.text("ui_serialized_ce661476")
                            : L10n.text("ui_bulk_8dff8f29")
                    )
                }
            }

            Section(L10n.text("ui_active_8163454f")) {
                if activeAssignments.isEmpty {
                    ContentUnavailableView {
                        Label(L10n.text("ui_no_active_assignment_d82ce91c"), systemImage: "shippingbox.and.arrow.backward")
                    } description: {
                        Text(L10n.text("ui_this_item_is_not_currently_assigned_or_2d72e37d"))
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
                Section(L10n.text("ui_history_5fd70311")) {
                    ForEach(historyAssignments) { assignment in
                        assignmentRow(assignment)
                    }
                }
            }

            if !canEdit {
                Section {
                    Label(
                        L10n.text("ui_you_can_view_this_item_s_assignments_f5a30bc6"),
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
                        L10n.text("ui_due_0_d4df2183", dueAt.formatted(date: .abbreviated, time: .shortened)),
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
                Text(L10n.text("ui_completed_0_03fa6bc1", completedAt.formatted(date: .abbreviated, time: .shortened)))
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
                    Label(L10n.text("ui_issue_b9eaa08e"), systemImage: "person.crop.circle.badge.checkmark")
                }
                .tint(InventoryTheme.accent)
                .disabled(actingID != nil)
            } else {
                Button {
                    requestMutation(assignment, operation: .complete(.returned))
                } label: {
                    Label(L10n.text("ui_return_96ee1fd4"), systemImage: "arrow.uturn.backward.circle")
                }
                .tint(.green)
                .disabled(actingID != nil)
            }

            Button(role: .destructive) {
                requestMutation(assignment, operation: .complete(.cancelled))
            } label: {
                Label(L10n.text("ui_cancel_81a5f66b"), systemImage: "xmark.circle")
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
        pendingConfirmation?.confirmationTitle ?? L10n.text("ui_update_assignment_6eba3209")
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
        if assignment.overdue { return L10n.text("ui_overdue_a1f573d6") }
        return switch assignment.status {
        case .active: L10n.text("ui_active_8163454f")
        case .returned: L10n.text("ui_returned_48d94b8b")
        case .cancelled: L10n.text("ui_cancelled_0aa6a1fa")
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
                Section(L10n.text("ui_action_a4ad259e")) {
                    Picker(L10n.text("ui_kind_75df3579"), selection: $kind) {
                        ForEach(availableKinds) { option in
                            Text(kindTitle(option)).tag(option)
                        }
                    }
                    .onChange(of: kind) { _, updated in
                        configureDates(for: updated)
                    }

                    Picker(L10n.text("ui_recipient_type_e70d5ca4"), selection: $recipientMode) {
                        Text(L10n.text("ui_external_person_or_group_5781efb7")).tag(AssignmentRecipientMode.label)
                        if !data.recipients.users.isEmpty {
                            Text(L10n.text("ui_registered_user_6ba4dc71")).tag(AssignmentRecipientMode.user)
                        }
                    }

                    if recipientMode == .user {
                        Picker(L10n.text("ui_recipient_2f3ce594"), selection: $selectedUserID) {
                            Text(L10n.text("ui_choose_a_user_516adb63")).tag(nil as UUID?)
                            ForEach(data.recipients.users) { user in
                                Text("\(user.name) · \(user.email)")
                                    .tag(user.id as UUID?)
                            }
                        }
                    } else {
                        TextField(L10n.text("ui_name_or_description_02845f9b"), text: $recipientLabel)
                            .onChange(of: recipientLabel) { _, value in
                                if value.count > 240 {
                                    recipientLabel = String(value.prefix(240))
                                }
                            }
                    }
                }

                Section(L10n.text("ui_stock_82cb99ec")) {
                    if data.trackingMode == .serialized, kind != .reservation {
                        Picker(L10n.text("ui_serialized_unit_bb072e4f"), selection: $selectedUnitID) {
                            Text(L10n.text("ui_select_unit_46f7d88b")).tag(nil as UUID?)
                            ForEach(data.availableUnits) { unit in
                                Text(unitLabel(unit)).tag(unit.id as UUID?)
                            }
                        }
                        if data.availableUnits.isEmpty {
                            Label(
                                L10n.text("ui_no_unit_is_available_2fdc7ef8"),
                                systemImage: "exclamationmark.triangle"
                            )
                            .font(.caption)
                            .foregroundStyle(.orange)
                        }
                    } else if data.trackingMode == .serialized {
                        Label(
                            L10n.text("ui_the_specific_unit_is_selected_when_the_a416561a"),
                            systemImage: "info.circle"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    } else {
                        TextField(L10n.text("ui_quantity_1bece813"), value: $quantity, format: .number)
                            .keyboardType(.numberPad)
                        LabeledContent(
                            L10n.text("ui_currently_available_334b022a"),
                            value: data.availability.availableQuantity.formatted()
                        )
                    }
                }

                if kind != .assignment {
                    Section(L10n.text("ui_period_ab0f2fd5")) {
                        DatePicker(
                            L10n.text("ui_start_0d95fd6a"),
                            selection: $startsAt,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        DatePicker(
                            L10n.text("ui_return_6223760a"),
                            selection: $dueAt,
                            in: startsAt...,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        Text(L10n.text("ui_maximum_loan_duration_0_days_f9ee256d", data.lending.maxDurationDays))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section(L10n.text("ui_note_74b487d9")) {
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
            .navigationTitle(L10n.text("ui_new_assignment_945507bd"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("ui_cancel_f7ff1178")) { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(submitTitle) { Task { await save() } }
                        .disabled(validationMessage != nil || saving)
                }
            }
            .interactiveDismissDisabled(saving)
            .alert(
                L10n.text("ui_could_not_create_the_assignment_6d27992e"),
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button(L10n.text("ui_retry_948643cb")) { Task { await save() } }
                Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
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
            return L10n.text("ui_select_a_registered_user_de45d9a4")
        }
        if recipientMode == .label,
           recipientLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return L10n.text("ui_enter_a_recipient_35117f58")
        }
        if quantity < 1 || quantity > 2_000_000_000 {
            return L10n.text("ui_the_quantity_must_be_a_positive_whole_5765d774")
        }
        if data.trackingMode == .serialized,
           kind != .reservation,
           selectedUnitID == nil {
            return L10n.text("ui_select_an_available_serialized_unit_b5d9b33c")
        }
        if kind != .reservation,
           !allowNegativeStock,
           quantity > data.availability.availableQuantity {
            return L10n.text("ui_the_quantity_exceeds_the_currently_available_stock_f81b9ffb")
        }
        if kind == .reservation, startsAt <= Date() {
            return L10n.text("ui_a_reservation_must_start_in_the_future_20cff5e4")
        }
        if kind != .assignment {
            guard dueAt > startsAt else {
                return L10n.text("ui_the_return_must_be_after_the_start_4c506d74")
            }
            let duration = dueAt.timeIntervalSince(startsAt) / 86_400
            if duration > Double(data.lending.maxDurationDays) {
                return L10n.text("ui_the_period_exceeds_the_maximum_loan_duration_ebb966ad")
            }
        }
        return nil
    }

    private var submitTitle: String {
        switch kind {
        case .checkout: L10n.text("ui_loans_ca70339f")
        case .assignment: L10n.text("ui_assign_3acf9bb7")
        case .reservation: L10n.text("ui_reserve_8d0f3cd8")
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
                    Toggle(L10n.text("ui_enable_loans_and_reservations_094f6a1d"), isOn: $settings.enabled)
                } footer: {
                    Text(L10n.text("ui_permanent_assignments_remain_available_when_lending_is_b171943c"))
                }

                Section(L10n.text("ui_duration_956ba2f5")) {
                    Stepper(
                        L10n.text("ui_default_0_days_b29d6b8b", settings.defaultDurationDays),
                        value: $settings.defaultDurationDays,
                        in: 1 ... settings.maxDurationDays
                    )
                    Stepper(
                        L10n.text("ui_maximum_0_days_c1993e97", settings.maxDurationDays),
                        value: $settings.maxDurationDays,
                        in: settings.defaultDurationDays ... 3_650
                    )
                }

                Section {
                    Toggle(L10n.text("ui_approval_required_251680d9"), isOn: $settings.approvalRequired)
                }
            }
            .navigationTitle(L10n.text("ui_lending_rules_21ff147e"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("ui_cancel_f7ff1178")) { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.text("ui_save_f6b2ff39")) { Task { await save() } }
                        .disabled(saving)
                }
            }
            .interactiveDismissDisabled(saving)
            .alert(
                L10n.text("ui_could_not_save_the_rules_1c378b1f"),
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button(L10n.text("ui_retry_948643cb")) { Task { await save() } }
                Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
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
                    LabeledContent(L10n.text("ui_recipient_2f3ce594"), value: assignment.assignee.label)
                    LabeledContent(L10n.text("ui_quantity_1bece813"), value: quantityLabel(assignment.quantity))
                }
                Section(L10n.text("ui_serialized_unit_bb072e4f")) {
                    Picker(L10n.text("ui_unit_d5ba1549"), selection: $selectedUnitID) {
                        Text(L10n.text("ui_select_unit_46f7d88b")).tag(nil as UUID?)
                        ForEach(availableUnits) { unit in
                            Text(unitLabel(unit)).tag(unit.id as UUID?)
                        }
                    }
                    if availableUnits.isEmpty {
                        Label(
                            L10n.text("ui_no_unit_is_available_2fdc7ef8"),
                            systemImage: "exclamationmark.triangle"
                        )
                        .font(.caption)
                        .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle(L10n.text("ui_issue_reservation_42772f5c"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("ui_cancel_f7ff1178")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.text("ui_issue_b9eaa08e")) {
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
        case .complete(.returned): L10n.text("ui_return_assignment_ba8be97e")
        case .complete(.cancelled): L10n.text("ui_cancel_assignment_6fde9eab")
        case .activate: L10n.text("ui_issue_reservation_6de0eb0c")
        }
    }

    var buttonTitle: String {
        switch operation {
        case .complete(.returned): L10n.text("ui_return_96ee1fd4")
        case .complete(.cancelled): L10n.text("ui_cancel_81a5f66b")
        case .activate: L10n.text("ui_issue_b9eaa08e")
        }
    }

    var buttonRole: ButtonRole? {
        operation == .complete(.cancelled) ? .destructive : nil
    }

    var message: String {
        switch operation {
        case .complete(.returned):
            L10n.text("ui_the_assignment_to_0_will_be_marked_0e0e138b", assignment.assignee.label)
        case .complete(.cancelled):
            L10n.text("ui_the_assignment_to_0_will_be_cancelled_4a81e4df", assignment.assignee.label)
        case .activate:
            L10n.text("ui_the_reservation_for_0_will_now_be_5e1d7b17", assignment.assignee.label)
        }
    }
}

private func kindTitle(_ kind: ResourceAssignmentKind) -> String {
    switch kind {
    case .checkout: L10n.text("ui_loans_7b19cf9d")
    case .assignment: L10n.text("ui_assignment_2505acf3")
    case .reservation: L10n.text("ui_reservation_2123f330")
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
    quantity == 1 ? L10n.text("ui_1_unit_f5489a1b") : L10n.text("ui_units_0_516a0351", quantity)
}

private func unitLabel(_ unit: AssignmentAvailableUnit) -> String {
    if let location = unit.location, !location.isEmpty {
        return "\(unit.code) · \(location)"
    }
    return unit.code
}
