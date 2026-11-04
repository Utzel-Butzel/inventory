import SwiftUI

struct LoansOverviewView: View {
    @EnvironmentObject private var state: AppState
    @State private var response: LoansResponse?
    @State private var filter = LoanFilter.active
    @State private var query = ""
    @State private var loading = false
    @State private var actingID: UUID?
    @State private var pendingConfirmation: PendingLoanAction?
    @State private var retryMutation: PendingLoanAction?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if loading && response == nil {
                ProgressView(L10n.text("ui_loading_loans_695d710d"))
            } else if response == nil, let errorMessage {
                ContentUnavailableView {
                    Label(L10n.text("ui_loans_unavailable_0df7883f"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button(L10n.text("ui_retry_948643cb")) { Task { await load() } }
                }
            } else {
                loansList
            }
        }
        .navigationTitle(L10n.text("ui_loans_ca70339f"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: L10n.text("ui_resource_or_recipient_0b709d42"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
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
        .task(id: state.client?.contextIdentifier) { await load() }
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
            L10n.text("ui_could_not_update_the_loan_713a3b06"),
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

    private var loansList: some View {
        List {
            Section {
                Picker(L10n.text("ui_view_a6d6105c"), selection: $filter) {
                    ForEach(LoanFilter.allCases) { option in
                        Label(
                            "\(option.title) (\(count(for: option)))",
                            systemImage: option.systemImage
                        )
                        .tag(option)
                    }
                }
                .pickerStyle(.menu)
            } footer: {
                Text(resultCountLabel)
            }

            if visibleAssignments.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label(L10n.text("ui_no_loans_found_4c92c955"), systemImage: "shippingbox.and.arrow.backward")
                    } description: {
                        Text(emptyDescription)
                    }
                }
            } else {
                Section {
                    ForEach(visibleAssignments) { assignment in
                        NavigationLink {
                            LoanResourceDestinationView(resourceID: assignment.resourceId)
                        } label: {
                            assignmentLabel(assignment)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            assignmentActions(assignment)
                        }
                        .contextMenu {
                            assignmentActions(assignment)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    private func assignmentLabel(_ assignment: LoanAssignment) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(assignment.resource.name)
                    .font(.headline)
                    .lineLimit(2)
                Spacer(minLength: 4)
                statusBadge(assignment)
            }

            HStack(spacing: 5) {
                Image(systemName: assigneeSymbol(assignment.assignee.type))
                Text(assignment.assignee.label)
                if let detail = assignment.assignee.detail, !detail.isEmpty {
                    Text("· \(detail)")
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)

            HStack(spacing: 12) {
                Label(quantityLabel(assignment.quantity), systemImage: "shippingbox")
                if let stockUnit = assignment.stockUnit {
                    Label(stockUnit.code, systemImage: "barcode")
                } else if let sku = assignment.resource.sku, !sku.isEmpty {
                    Label(sku, systemImage: "number")
                }
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
                    .lineLimit(2)
            }

            if actingID == assignment.id {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func statusBadge(_ assignment: LoanAssignment) -> some View {
        Text(statusTitle(assignment))
            .font(.caption2.weight(.semibold))
            .foregroundStyle(statusColor(assignment))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(statusColor(assignment).opacity(0.12), in: Capsule())
    }

    @ViewBuilder
    private func assignmentActions(_ assignment: LoanAssignment) -> some View {
        if canManage, assignment.status == .active {
            if assignment.kind == .checkout {
                Button {
                    requestCompletion(of: assignment, status: .returned)
                } label: {
                    Label(L10n.text("ui_return_96ee1fd4"), systemImage: "arrow.uturn.backward.circle")
                }
                .tint(.green)
                .disabled(actingID != nil)
            } else {
                Button(role: .destructive) {
                    requestCompletion(of: assignment, status: .cancelled)
                } label: {
                    Label(L10n.text("ui_cancel_81a5f66b"), systemImage: "xmark.circle")
                }
                .disabled(actingID != nil)
            }
        }
    }

    private var confirmationIsPresented: Binding<Bool> {
        Binding(
            get: { pendingConfirmation != nil },
            set: { if !$0 { pendingConfirmation = nil } }
        )
    }

    private var confirmationTitle: String {
        pendingConfirmation?.status == .returned
            ? L10n.text("ui_return_loan_620ef27e")
            : L10n.text("ui_cancel_reservation_34dae46c")
    }

    private var canManage: Bool {
        response?.capabilities.canManage == true
            && state.canManageAssignments
            && state.activeOrganization?.isReadOnly != true
    }

    private var assignments: [LoanAssignment] {
        response?.assignments ?? []
    }

    private var visibleAssignments: [LoanAssignment] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedLowercase
        return assignments.filter { assignment in
            guard filter.matches(assignment) else { return false }
            guard !normalizedQuery.isEmpty else { return true }
            return [
                assignment.resource.name,
                assignment.resource.sku,
                assignment.assignee.label,
                assignment.assignee.detail,
                assignment.stockUnit?.code,
                assignment.note,
            ]
            .compactMap { $0?.localizedLowercase }
            .contains { $0.contains(normalizedQuery) }
        }
    }

    private var resultCountLabel: String {
        let count = visibleAssignments.count
        return count == 1 ? L10n.text("ui_1_transaction_a8514963") : L10n.text("ui_transactions_0_d180f8b5", count)
    }

    private var emptyDescription: String {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return L10n.text("ui_no_loan_matches_the_current_search_7bf45d2e")
        }
        return filter.emptyDescription
    }

    private func count(for option: LoanFilter) -> Int {
        assignments.count(where: option.matches)
    }

    private func requestCompletion(
        of assignment: LoanAssignment,
        status: AssignmentCompletionStatus
    ) {
        pendingConfirmation = PendingLoanAction(
            assignment: assignment,
            status: status,
            idempotencyKey: UUID()
        )
    }

    private func perform(_ action: PendingLoanAction) async {
        guard actingID == nil, let client = state.client else { return }
        pendingConfirmation = nil
        retryMutation = nil
        actingID = action.assignment.id
        defer { actingID = nil }
        do {
            try await client.completeAssignment(
                id: action.assignment.id,
                status: action.status,
                idempotencyKey: action.idempotencyKey
            )
            errorMessage = nil
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
            let updated = try await client.listLoans()
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

    private func quantityLabel(_ quantity: Int) -> String {
        quantity == 1 ? L10n.text("ui_1_unit_f5489a1b") : L10n.text("ui_units_0_516a0351", quantity)
    }

    private func statusTitle(_ assignment: LoanAssignment) -> String {
        if assignment.overdue { return L10n.text("ui_overdue_a1f573d6") }
        if assignment.kind == .reservation, assignment.status == .active {
            return L10n.text("ui_reserved_10814cd6")
        }
        return switch assignment.status {
        case .active: L10n.text("ui_active_8163454f")
        case .returned: L10n.text("ui_returned_48d94b8b")
        case .cancelled: L10n.text("ui_cancelled_0aa6a1fa")
        }
    }

    private func statusColor(_ assignment: LoanAssignment) -> Color {
        if assignment.overdue { return .red }
        if assignment.kind == .reservation, assignment.status == .active {
            return .orange
        }
        return switch assignment.status {
        case .active: InventoryTheme.accent
        case .returned: .green
        case .cancelled: .secondary
        }
    }

    private func assigneeSymbol(_ type: LoanAssigneeType) -> String {
        switch type {
        case .user: "person"
        case .resource: "shippingbox"
        case .label: "tag"
        }
    }
}

private enum LoanFilter: String, CaseIterable, Identifiable {
    case active
    case overdue
    case reservations
    case history

    var id: Self { self }

    var title: String {
        switch self {
        case .active: L10n.text("ui_active_loans_d28980eb")
        case .overdue: L10n.text("ui_overdue_a1f573d6")
        case .reservations: L10n.text("ui_reservations_ff2232b0")
        case .history: L10n.text("ui_history_5fd70311")
        }
    }

    var systemImage: String {
        switch self {
        case .active: "person.crop.circle.badge.clock"
        case .overdue: "clock.badge.exclamationmark"
        case .reservations: "calendar.badge.clock"
        case .history: "clock.arrow.circlepath"
        }
    }

    var emptyDescription: String {
        switch self {
        case .active: L10n.text("ui_nothing_is_currently_on_loan_06645fe5")
        case .overdue: L10n.text("ui_no_return_is_overdue_6971966e")
        case .reservations: L10n.text("ui_there_are_no_upcoming_reservations_224e8c59")
        case .history: L10n.text("ui_there_are_no_completed_loans_yet_f1b89d58")
        }
    }

    func matches(_ assignment: LoanAssignment) -> Bool {
        switch self {
        case .active:
            assignment.kind == .checkout
                && assignment.status == .active
                && !assignment.overdue
        case .overdue:
            assignment.overdue
        case .reservations:
            assignment.kind == .reservation && assignment.status == .active
        case .history:
            assignment.status != .active
        }
    }
}

private struct PendingLoanAction: Sendable {
    let assignment: LoanAssignment
    let status: AssignmentCompletionStatus
    let idempotencyKey: UUID

    var buttonTitle: String {
        status == .returned ? L10n.text("ui_return_96ee1fd4") : L10n.text("ui_cancel_81a5f66b")
    }

    var buttonRole: ButtonRole? {
        status == .cancelled ? .destructive : nil
    }

    var message: String {
        status == .returned
            ? L10n.text("ui_0_will_be_marked_as_returned_6a629e38", assignment.resource.name)
            : L10n.text("ui_the_reservation_for_0_will_be_cancelled_d7062484", assignment.resource.name)
    }
}

private struct LoanResourceDestinationView: View {
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
