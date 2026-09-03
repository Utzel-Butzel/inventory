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
                ProgressView("Ausleihen werden geladen …")
            } else if response == nil, let errorMessage {
                ContentUnavailableView {
                    Label("Ausleihen nicht verfügbar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Erneut versuchen") { Task { await load() } }
                }
            } else {
                loansList
            }
        }
        .navigationTitle("Ausleihen")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Ressource oder Empfänger")
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
                    .accessibilityLabel("Aktualisieren")
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
            Button("Abbrechen", role: .cancel) { }
        } message: { action in
            Text(action.message)
        }
        .alert(
            "Ausleihe konnte nicht aktualisiert werden",
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

    private var loansList: some View {
        List {
            Section {
                Picker("Ansicht", selection: $filter) {
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
                        Label("Keine Ausleihen gefunden", systemImage: "shippingbox.and.arrow.backward")
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
                    Label("Zurückgeben", systemImage: "arrow.uturn.backward.circle")
                }
                .tint(.green)
                .disabled(actingID != nil)
            } else {
                Button(role: .destructive) {
                    requestCompletion(of: assignment, status: .cancelled)
                } label: {
                    Label("Stornieren", systemImage: "xmark.circle")
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
            ? "Ausleihe zurückgeben?"
            : "Reservierung stornieren?"
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
        return count == 1 ? "1 Vorgang" : "\(count) Vorgänge"
    }

    private var emptyDescription: String {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Keine Ausleihe entspricht der aktuellen Suche."
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
        quantity == 1 ? "1 Einheit" : "\(quantity) Einheiten"
    }

    private func statusTitle(_ assignment: LoanAssignment) -> String {
        if assignment.overdue { return "Überfällig" }
        if assignment.kind == .reservation, assignment.status == .active {
            return "Reserviert"
        }
        return switch assignment.status {
        case .active: "Aktiv"
        case .returned: "Zurückgegeben"
        case .cancelled: "Storniert"
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
        case .active: "Aktive Ausleihen"
        case .overdue: "Überfällig"
        case .reservations: "Reservierungen"
        case .history: "Verlauf"
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
        case .active: "Derzeit ist nichts ausgeliehen."
        case .overdue: "Keine Rückgabe ist überfällig."
        case .reservations: "Es gibt keine anstehenden Reservierungen."
        case .history: "Es sind noch keine abgeschlossenen Ausleihen vorhanden."
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
        status == .returned ? "Zurückgeben" : "Stornieren"
    }

    var buttonRole: ButtonRole? {
        status == .cancelled ? .destructive : nil
    }

    var message: String {
        status == .returned
            ? "„\(assignment.resource.name)“ wird als zurückgegeben markiert."
            : "Die Reservierung für „\(assignment.resource.name)“ wird storniert."
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
