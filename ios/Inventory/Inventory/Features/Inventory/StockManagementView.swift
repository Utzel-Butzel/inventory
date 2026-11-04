import SwiftUI

private enum StockBookingDirection: String, CaseIterable, Identifiable {
    case incoming
    case outgoing

    var id: Self { self }
    var localizedName: String { self == .incoming ? L10n.text("ui_stock_in_5184cdf3") : L10n.text("ui_stock_out_858e7736") }
}

private enum StockUnitCreationMode: String, CaseIterable, Identifiable {
    case generated
    case custom

    var id: Self { self }
    var localizedName: String { self == .generated ? L10n.text("ui_automatic_4c2a3993") : L10n.text("ui_custom_codes_0a25e1c9") }
}

private enum StockHistoryFilter: String, CaseIterable, Identifiable {
    case all
    case incoming
    case outgoing

    var id: Self { self }

    var localizedName: String {
        switch self {
        case .all: L10n.text("ui_all_3801a35c")
        case .incoming: L10n.text("ui_stock_in_f4587117")
        case .outgoing: L10n.text("ui_stock_out_085feccf")
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
    @Published var unitName = L10n.text("ui_unit_d5ba1549")

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

    func bookMovement(using client: APIClient, allowNegativeStock: Bool) async {
        guard let detail else { return }
        guard detail.config.trackingMode == .bulk else {
            errorMessage = L10n.text("ui_serialized_stock_tracks_each_unit_individually_dab2550e")
            return
        }
        guard movementQuantity > 0 else {
            errorMessage = L10n.text("ui_the_quantity_must_be_at_least_one_243cb110")
            return
        }
        if direction == .outgoing,
           !allowNegativeStock,
           movementQuantity > detail.resource.quantity {
            errorMessage = L10n.text("ui_only_0_units_are_available_5565b6e2", detail.resource.quantity)
            return
        }
        guard availableMovementTypes.contains(movementType) else {
            errorMessage = L10n.text("ui_the_transaction_type_does_not_match_the_17a76cc5")
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
                ? L10n.text("ui_0_units_were_added_to_stock_441f3d67", bookedQuantity)
                : L10n.text("ui_0_units_were_removed_from_stock_81cc89c3", bookedQuantity)
        }
    }

    func saveConfig(using client: APIClient) async {
        guard minimumStock >= 0, reorderQuantity >= 0 else {
            errorMessage = L10n.text("ui_minimum_stock_and_reorder_quantity_must_not_793d41a8")
            return
        }
        guard (0 ... 36_500).contains(leadTimeDays) else {
            errorMessage = L10n.text("ui_lead_time_must_be_between_0_and_845f28a6")
            return
        }
        let normalizedUnitName = unitName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUnitName.isEmpty, normalizedUnitName.count <= 80 else {
            errorMessage = L10n.text("ui_the_unit_must_contain_between_one_and_3b3a842a")
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
                ? L10n.text("ui_settings_saved_and_0_units_created_d86eb28c", result.unitsCreated)
                : L10n.text("ui_stock_settings_saved_8f92bcb9")
        }
    }

    func createUnits(using client: APIClient) async {
        let request: StockUnitCreateRequest
        let createdCount: Int
        switch unitCreationMode {
        case .generated:
            guard (1 ... 100).contains(unitCount) else {
                errorMessage = L10n.text("ui_create_between_one_and_100_units_at_502955b3")
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
                errorMessage = L10n.text("ui_enter_between_one_and_100_codes_878efa5d")
                return
            }
            guard Set(codes.map { $0.lowercased() }).count == codes.count else {
                errorMessage = L10n.text("ui_each_unit_code_must_be_unique_0908b860")
                return
            }
            guard codes.allSatisfy({ $0.count <= 180 }) else {
                errorMessage = L10n.text("ui_a_unit_code_must_not_exceed_180_1c6de094")
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
            notice = L10n.text("ui_0_serialized_units_were_created_8783ee90", createdCount)
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
            notice = L10n.text("ui_unit_0_was_updated_dd51260b", unit.code)
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
    private let selectedUnitID: UUID?

    init(resource: InventoryResource, selectedUnitID: UUID? = nil) {
        _model = StateObject(wrappedValue: StockManagementViewModel(resource: resource))
        self.selectedUnitID = selectedUnitID
    }

    var body: some View {
        NavigationStack {
            Group {
                if model.loading, model.detail == nil {
                    ProgressView(L10n.text("ui_loading_stock_0e4716e0"))
                } else if let detail = model.detail {
                    stockForm(detail)
                } else {
                    ContentUnavailableView(
                        L10n.text("ui_stock_unavailable_47bfec6d"),
                        systemImage: "exclamationmark.triangle",
                        description: Text(model.errorMessage ?? L10n.text("ui_could_not_load_stock_data_dd379012"))
                    )
                }
            }
            .navigationTitle(L10n.text("ui_manage_stock_0826c917"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("ui_close_b808f6e9")) { dismiss() }
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
            L10n.text("ui_really_remove_stock_0d1df08c"),
            isPresented: $confirmOutgoing,
            titleVisibility: .visible
        ) {
            Button(L10n.text("ui_remove_0_units_from_stock_f45b5849", model.movementQuantity), role: .destructive) {
                submitMovement()
            }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { }
        } message: {
            if let quantity = model.detail?.resource.quantity {
                Text(L10n.text("ui_stock_will_decrease_from_0_to_1_ca3494fd", quantity, quantity - model.movementQuantity))
            }
        }
        .confirmationDialog(
            L10n.text("ui_change_tracking_mode_ca388b20"),
            isPresented: $confirmTrackingChange,
            titleVisibility: .visible
        ) {
            Button(L10n.text("ui_change_mode_64633fcf")) { saveConfig() }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { }
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
            L10n.text("ui_action_failed_3a20cc65"),
            isPresented: Binding(
                get: { model.errorMessage != nil && model.detail != nil },
                set: { if !$0 { model.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
        }
    }

    private func stockForm(_ detail: StockDetailResponse) -> some View {
        Form {
            summarySection(detail)
            if let selectedUnitID {
                Section(L10n.text("ui_scanned_unit_725b4b80")) {
                    if let unit = detail.units.first(where: { $0.id == selectedUnitID }) {
                        LabeledContent(L10n.text("ui_code_340f4630"), value: unit.code)
                        LabeledContent(L10n.text("ui_status_920e413c"), value: unit.status.localizedName)
                        LabeledContent(L10n.text("ui_place_30fb2591"), value: unit.location.nilIfBlank ?? L10n.text("ui_no_location_1bb3351d"))
                        if state.canManageStock {
                            Button(L10n.text("ui_edit_unit_71cdf815")) { editingUnit = unit }
                        }
                    } else {
                        Text(L10n.text("ui_this_unit_is_unavailable_or_does_not_b9e09865"))
                            .foregroundStyle(.secondary)
                    }
                }
            }
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
                LabeledContent(L10n.text("ui_incoming_45fd2616"), value: "+\(detail.procurement.onOrder)")
                LabeledContent(L10n.text("ui_forecast_f7ab1afd"), value: "\(detail.procurement.projectedQuantity)")
            }
            if detail.forecast.isBelowMinimum {
                Label(L10n.text("ui_below_minimum_stock_be4ad13b"), systemImage: "exclamationmark.triangle.fill")
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
        Section(L10n.text("ui_book_stock_e4df72bd")) {
            Picker(L10n.text("ui_direction_73ea47c9"), selection: $model.direction) {
                ForEach(StockBookingDirection.allCases) { direction in
                    Text(direction.localizedName).tag(direction)
                }
            }
            .pickerStyle(.segmented)

            TextField(L10n.text("ui_quantity_1bece813"), value: $model.movementQuantity, format: .number)
                .keyboardType(.numberPad)

            Picker(L10n.text("ui_transaction_type_27dd1187"), selection: $model.movementType) {
                ForEach(model.availableMovementTypes, id: \.self) { type in
                    Text(type.localizedName).tag(type)
                }
            }
            TextField(L10n.text("ui_reason_optional_a96aed7d"), text: $model.movementReason)
            TextField(L10n.text("ui_note_optional_337da4d8"), text: $model.movementNote, axis: .vertical)
                .lineLimit(2 ... 5)
            TextField(L10n.text("ui_location_optional_9b569818"), text: $model.movementLocation)
            DatePicker(L10n.text("ui_transaction_time_f4432207"), selection: $model.movementDate)

            Button {
                if model.direction == .outgoing {
                    confirmOutgoing = true
                } else {
                    submitMovement()
                }
            } label: {
                Label(
                    model.direction == .incoming ? L10n.text("ui_book_receipt_27e830e4") : L10n.text("ui_book_removal_5a2c91e4"),
                    systemImage: model.direction == .incoming ? "plus.circle.fill" : "minus.circle.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(model.direction == .incoming ? InventoryTheme.ink : InventoryTheme.danger)
            .disabled(
                model.movementQuantity < 1 ||
                    (model.direction == .outgoing &&
                        detail.resource.quantity <= 0 &&
                        !state.allowsNegativeStock)
            )
        }
    }

    private var serializedHintSection: some View {
        Section(L10n.text("ui_book_stock_e4df72bd")) {
            Label(
                L10n.text("ui_this_stock_is_changed_through_individual_units_eae3c00e"),
                systemImage: "barcode.viewfinder"
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
    }

    private func planningSection(_ detail: StockDetailResponse) -> some View {
        Section(L10n.text("ui_planning_settings_c1763aa3")) {
            Picker(L10n.text("ui_tracking_36b6ca18"), selection: $model.trackingMode) {
                ForEach(StockTrackingMode.allCases, id: \.self) { mode in
                    Text(mode.localizedName).tag(mode)
                }
            }

            TextField(L10n.text("ui_unit_name_f38f75ae"), text: $model.unitName)
            TextField(L10n.text("ui_minimum_stock_0c96df5c"), value: $model.minimumStock, format: .number)
                .keyboardType(.numberPad)
            TextField(L10n.text("ui_reorder_quantity_aff18853"), value: $model.reorderQuantity, format: .number)
                .keyboardType(.numberPad)
            TextField(L10n.text("ui_lead_time_in_days_6a859361"), value: $model.leadTimeDays, format: .number)
                .keyboardType(.numberPad)

            if detail.forecast.averageDailyUsage > 0 {
                LabeledContent(
                    L10n.text("ui_average_daily_usage_2747607b"),
                    value: detail.forecast.averageDailyUsage.formatted(.number.precision(.fractionLength(1 ... 2)))
                )
            }
            if let days = detail.forecast.daysUntilStockout {
                LabeledContent(
                    L10n.text("ui_days_of_stock_3dfd5f37"),
                    value: L10n.text("ui_0_days_6f628107", days.formatted(.number.precision(.fractionLength(0 ... 1))))
                )
            }
            if detail.forecast.suggestedReorderQuantity > 0 {
                LabeledContent(
                    L10n.text("ui_order_suggestion_2a79473b"),
                    value: "\(detail.forecast.suggestedReorderQuantity)"
                )
            }

            Button(L10n.text("ui_save_settings_337972dc")) {
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
        Section(L10n.text("ui_create_units_53d8f150")) {
            Picker(L10n.text("ui_codes_e0d1d308"), selection: $model.unitCreationMode) {
                ForEach(StockUnitCreationMode.allCases) { mode in
                    Text(mode.localizedName).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if model.unitCreationMode == .generated {
                Stepper(
                    L10n.text("ui_count_0_3bf60cd3", model.unitCount),
                    value: $model.unitCount,
                    in: 1 ... 100
                )
            } else {
                TextField(
                    L10n.text("ui_codes_separated_by_commas_or_line_breaks_aac9e803"),
                    text: $model.unitCodes,
                    axis: .vertical
                )
                .lineLimit(3 ... 8)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            }
            TextField(L10n.text("ui_location_optional_9b569818"), text: $model.unitLocation)
            DatePicker(L10n.text("ui_acquisition_date_ed829fba"), selection: $model.acquiredAt)
            Button(L10n.text("ui_create_units_53d8f150")) {
                guard let client = state.client else { return }
                Task { await model.createUnits(using: client) }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func unitsSection(_ detail: StockDetailResponse) -> some View {
        Section(L10n.text("ui_individual_units_b2614fdf")) {
            if detail.units.isEmpty {
                Text(L10n.text("ui_no_units_yet_3fe93860"))
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
                                Text(unit.location.nilIfBlank ?? L10n.text("ui_no_location_1bb3351d"))
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
                    Text(L10n.text("ui_showing_the_first_200_of_0_units_7a487de9", detail.units.count))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var historySection: some View {
        Section(L10n.text("ui_transaction_history_2b52bd02")) {
            Picker(L10n.text("ui_filter_638e249f"), selection: $model.historyFilter) {
                ForEach(StockHistoryFilter.allCases) { filter in
                    Text(filter.localizedName).tag(filter)
                }
            }
            .pickerStyle(.segmented)

            if model.filteredMovements.isEmpty {
                Text(L10n.text("ui_no_matching_transactions_10e93238"))
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
                            Text(L10n.text("ui_stock_0_7d245045", movement.balanceAfter))
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
            return L10n.text("ui_existing_stock_will_be_converted_to_individual_06c9706c")
        }
        return L10n.text("ui_switching_back_to_quantity_stock_is_only_7749fc5d")
    }

    private func submitMovement() {
        guard let client = state.client else { return }
        Task {
            await model.bookMovement(
                using: client,
                allowNegativeStock: state.allowsNegativeStock
            )
        }
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
                    LabeledContent(L10n.text("ui_code_340f4630"), value: unit.code)
                    Picker(L10n.text("ui_status_920e413c"), selection: $status) {
                        ForEach(StockUnitStatus.allCases, id: \.self) { status in
                            Text(status.localizedName).tag(status)
                        }
                    }
                    TextField(L10n.text("ui_place_30fb2591"), text: $location)
                    DatePicker(L10n.text("ui_time_9d91e4d4"), selection: $occurredAt)
                }

                Section(L10n.text("ui_transaction_details_e8243ed9")) {
                    TextField(L10n.text("ui_reason_optional_a96aed7d"), text: $reason)
                    TextField(L10n.text("ui_note_optional_337da4d8"), text: $note, axis: .vertical)
                        .lineLimit(2 ... 5)
                }
            }
            .navigationTitle(L10n.text("ui_edit_unit_b23063d3"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("ui_cancel_f7ff1178")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.text("ui_save_f6b2ff39")) {
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
        self == .bulk ? L10n.text("ui_bulk_8dff8f29") : L10n.text("ui_serialized_units_aad5fbc1")
    }
}

private extension StockMovementType {
    var localizedName: String {
        switch self {
        case .receipt: L10n.text("ui_goods_receipt_d84ec7ae")
        case .issue: L10n.text("ui_removal_95114093")
        case .adjustment: L10n.text("ui_adjustment_62bc7c7f")
        case .return: L10n.text("ui_return_6223760a")
        case .waste: L10n.text("ui_loss_scrap_2d529613")
        case .transfer: L10n.text("ui_transfer_a9372d22")
        }
    }
}

private extension StockUnitStatus {
    var localizedName: String {
        switch self {
        case .available: L10n.text("ui_available_3aa55273")
        case .reserved: L10n.text("ui_reserved_10814cd6")
        case .inUse: L10n.text("ui_in_use_d4800d74")
        case .maintenance: L10n.text("ui_maintenance_854f69bd")
        case .consumed: L10n.text("ui_consumed_417c49fe")
        case .lost: L10n.text("ui_lost_4b067d9b")
        case .retired: L10n.text("ui_retired_ff85d35e")
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
        case "receipt": L10n.text("ui_goods_receipt_d84ec7ae")
        case "issue": L10n.text("ui_removal_95114093")
        case "adjustment": L10n.text("ui_adjustment_62bc7c7f")
        case "return": L10n.text("ui_return_6223760a")
        case "waste": L10n.text("ui_loss_scrap_2d529613")
        case "transfer": L10n.text("ui_transfer_a9372d22")
        case "unit-created": L10n.text("ui_unit_created_8760b6d5")
        case "unit-status": L10n.text("ui_unit_status_463fb2bb")
        case "unit-update": L10n.text("ui_unit_updated_5bb0b6bf")
        case "serialization-opening": L10n.text("ui_serialization_ea16a109")
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
