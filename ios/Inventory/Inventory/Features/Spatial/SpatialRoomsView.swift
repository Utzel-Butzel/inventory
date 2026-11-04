import RoomPlan
import SwiftUI

struct SpatialRoomAppendSeed: Codable, Equatable, Sendable {
    let structureID: UUID
    let structureName: String
    let suggestedFloorIdentifier: String
    let suggestedFloorIndex: Int
    let usesGeoreference: Bool
    let existingCoordinateSpaceIDs: Set<UUID>
}

enum SpatialRoomScanMode: Codable, Equatable, Sendable {
    case newStructure
    case appendToStructure(SpatialRoomAppendSeed)
    case replaceRoom(SpatialRoomScanSummary)

    var replacedScan: SpatialRoomScanSummary? {
        guard case .replaceRoom(let scan) = self else { return nil }
        return scan
    }

    var supportsMultipleRooms: Bool {
        if case .replaceRoom = self { return false }
        return true
    }

    var existingCoordinateSpaceIDs: Set<UUID> {
        switch self {
        case .newStructure:
            []
        case .appendToStructure(let seed):
            seed.existingCoordinateSpaceIDs
        case .replaceRoom(let scan):
            Set([scan.coordinateSpaceID].compactMap { $0 })
        }
    }

    func existingRoomResourceID(forDraftAt index: Int) -> UUID? {
        guard index == 0, case .replaceRoom(let scan) = self else { return nil }
        return scan.roomResourceID
    }
}

struct SpatialRoomCaptureIdentity: Equatable, Sendable {
    let structureID: UUID
    let coordinateSpaceID: UUID

    init(
        mode: SpatialRoomScanMode,
        generatedStructureID: UUID = UUID(),
        generatedCoordinateSpaceID: UUID = UUID()
    ) {
        switch mode {
        case .newStructure:
            structureID = generatedStructureID
        case .appendToStructure(let seed):
            structureID = seed.structureID
        case .replaceRoom(let scan):
            structureID = scan.structureID ?? generatedStructureID
        }

        var freshCoordinateSpaceID = generatedCoordinateSpaceID
        while mode.existingCoordinateSpaceIDs.contains(freshCoordinateSpaceID) {
            freshCoordinateSpaceID = UUID()
        }
        coordinateSpaceID = freshCoordinateSpaceID
    }
}

struct SpatialRoomStructureGroup: Equatable, Identifiable, Sendable {
    struct Floor: Equatable, Identifiable, Sendable {
        let id: String
        let identifier: String?
        let index: Int?
        let scans: [SpatialRoomScanSummary]

        var title: String {
            if let identifier, !identifier.isEmpty { return identifier }
            if let index { return L10n.text("ui_floor_0_b8fd778f", index) }
            return L10n.text("ui_floor_not_assigned_1285e89a")
        }
    }

    let id: String
    let structureID: UUID?
    let structureName: String
    let floors: [Floor]

    var roomCount: Int {
        floors.reduce(0) { $0 + $1.scans.count }
    }

    var appendSeed: SpatialRoomAppendSeed? {
        guard let structureID,
              let latestScan = floors.flatMap(\.scans).max(by: { $0.updatedAt < $1.updatedAt })
        else { return nil }
        return SpatialRoomAppendSeed(
            structureID: structureID,
            structureName: structureName,
            suggestedFloorIdentifier: latestScan.floorIdentifier ?? L10n.text("ui_ground_floor_29fc5dee"),
            suggestedFloorIndex: latestScan.floorIndex ?? 0,
            usesGeoreference: latestScan.georeference != nil,
            existingCoordinateSpaceIDs: Set(
                floors.flatMap(\.scans).compactMap(\.coordinateSpaceID)
            )
        )
    }
}

struct SpatialRoomScanLibrary: Equatable, Sendable {
    let structures: [SpatialRoomStructureGroup]
    let standaloneScans: [SpatialRoomScanSummary]

    init(scans: [SpatialRoomScanSummary]) {
        var structureBuckets: [String: [SpatialRoomScanSummary]] = [:]
        var standaloneScans: [SpatialRoomScanSummary] = []

        for scan in scans {
            let normalizedName = scan.structureName?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let key: String?
            if let structureID = scan.structureID {
                key = "id:\(structureID.uuidString.lowercased())"
            } else if let normalizedName, !normalizedName.isEmpty {
                key = "name:\(normalizedName.lowercased())"
            } else {
                key = nil
            }

            if let key {
                structureBuckets[key, default: []].append(scan)
            } else {
                standaloneScans.append(scan)
            }
        }

        structures = structureBuckets.map { key, scans in
            let latestScan = scans.max { $0.updatedAt < $1.updatedAt }
            let fallbackID = latestScan?.structureID?.uuidString.prefix(8) ?? ""
            let structureName = latestScan?.structureName?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            var floorBuckets: [String: [SpatialRoomScanSummary]] = [:]
            for scan in scans {
                let identifier = scan.floorIdentifier?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let floorKey = "\(scan.floorIndex.map(String.init) ?? "-")|\(identifier?.lowercased() ?? "-")"
                floorBuckets[floorKey, default: []].append(scan)
            }
            let floors = floorBuckets.map { floorKey, scans in
                let exemplar = scans.max { $0.updatedAt < $1.updatedAt }
                return SpatialRoomStructureGroup.Floor(
                    id: floorKey,
                    identifier: exemplar?.floorIdentifier,
                    index: exemplar?.floorIndex,
                    scans: scans.sorted {
                        $0.roomName.localizedCaseInsensitiveCompare($1.roomName) == .orderedAscending
                    }
                )
            }
            .sorted {
                let left = $0.index ?? Int.max
                let right = $1.index ?? Int.max
                if left != right { return left < right }
                return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
            return SpatialRoomStructureGroup(
                id: key,
                structureID: latestScan?.structureID,
                structureName: structureName.flatMap { $0.isEmpty ? nil : $0 }
                    ?? L10n.text("ui_structure_0_e4d9b1e4", fallbackID),
                floors: floors
            )
        }
        .sorted {
            $0.structureName.localizedCaseInsensitiveCompare($1.structureName) == .orderedAscending
        }
        self.standaloneScans = standaloneScans.sorted {
            $0.roomName.localizedCaseInsensitiveCompare($1.roomName) == .orderedAscending
        }
    }
}

struct SpatialRoomsView: View {
    @EnvironmentObject private var state: AppState
    @State private var scans: [SpatialRoomScanSummary] = []
    @State private var loading = false
    @State private var hasLoaded = false
    @State private var errorMessage: String?
    @State private var presentation: RoomScanPresentation?
    @State private var pendingScans: [SpatialPendingScan] = []
    @State private var loadGeneration = UUID()

    var body: some View {
        NavigationStack {
            Group {
                if loading && !hasLoaded {
                    ProgressView(L10n.text("ui_loading_3d_rooms_2fda4e39"))
                } else if scans.isEmpty && pendingScans.isEmpty {
                    emptyState
                } else {
                    roomList
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(L10n.text("ui_rooms_c8bb1368"))
            .toolbar {
                if state.canManageSpatial {
                    ToolbarItem(placement: .primaryAction) {
                        Button(L10n.text("ui_scan_room_eabaecb5"), systemImage: "plus") {
                            presentation = RoomScanPresentation(mode: .newStructure)
                        }
                        .disabled(!RoomCaptureSession.isSupported)
                    }
                }
            }
            .refreshable { await loadScans() }
            .task(id: state.client?.contextIdentifier) {
                pendingScans = []
                scans = []
                hasLoaded = false
                await loadScans()
            }
            .sheet(item: $presentation) { presentation in
                RoomScanFlowView(mode: presentation.mode, pendingScan: presentation.pendingScan) {
                    self.presentation = nil
                    Task { await loadScans() }
                }
                .environmentObject(state)
            }
            .onChange(of: presentation == nil) { _, closed in
                if closed { Task { await loadScans() } }
            }
            .alert(
                L10n.text("ui_could_not_load_3d_rooms_74cef6cf"),
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button(L10n.text("ui_retry_1b8b908f")) { Task { await loadScans() } }
                Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label(L10n.text("ui_no_room_scan_yet_e319be80"), systemImage: "viewfinder")
        } description: {
            Text(
                RoomCaptureSession.isSupported
                    ? L10n.text("ui_scan_connected_rooms_with_lidar_the_ar_b27d9b02")
                    : L10n.text("ui_this_iphone_does_not_support_roomplan_a_91e823e2")
            )
        } actions: {
            if state.canManageSpatial && RoomCaptureSession.isSupported {
                Button(L10n.text("ui_scan_first_room_f9211506")) {
                    presentation = RoomScanPresentation(mode: .newStructure)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
    }

    private var roomList: some View {
        List {
            if !pendingScans.isEmpty && state.canManageSpatial {
                Section(L10n.text("ui_saved_uploads_125a4455")) {
                    ForEach(pendingScans) { pending in
                        Button {
                            presentation = RoomScanPresentation(mode: pending.mode, pendingScan: pending)
                        } label: {
                            Label {
                                VStack(alignment: .leading) {
                                    Text(pending.title)
                                    Text(L10n.text("ui_0_of_1_transferred_resume_upload_b24d8bb7", pending.uploadedScanIDs.count, pending.drafts.count))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            } icon: { Image(systemName: "icloud.and.arrow.up") }
                        }
                    }
                }
            }
            ForEach(scanLibrary.structures) { structure in
                structureSection(structure)
            }

            if !scanLibrary.standaloneScans.isEmpty {
                Section(L10n.text("ui_individual_rooms_23e496de")) {
                    ForEach(scanLibrary.standaloneScans) { scan in
                        roomRow(scan)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var scanLibrary: SpatialRoomScanLibrary {
        SpatialRoomScanLibrary(scans: scans)
    }

    private func structureSection(_ structure: SpatialRoomStructureGroup) -> some View {
        Section {
            ForEach(structure.floors) { floor in
                DisclosureGroup {
                    ForEach(floor.scans) { scan in
                        roomRow(scan)
                    }
                } label: {
                    Label {
                        HStack {
                            Text(floor.title)
                            Spacer()
                            Text("\(floor.scans.count)")
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "square.stack.3d.up")
                    }
                }
            }

            if state.canManageSpatial {
                Button(L10n.text("ui_add_room_or_floor_38a3bdd9"), systemImage: "plus") {
                    guard let seed = structure.appendSeed else { return }
                    presentation = RoomScanPresentation(mode: .appendToStructure(seed))
                }
                .disabled(structure.appendSeed == nil || !RoomCaptureSession.isSupported)
            }
        } header: {
            Label(structure.structureName, systemImage: "building.2")
        } footer: {
            Text(
                L10n.text("ui_0_rooms_on_1_cf5c38cb", structure.roomCount, structure.floors.count) +
                    (structure.floors.count == 1 ? L10n.text("ui_floor_ef352421") : L10n.text("ui_floors_35689241"))
            )
        }
    }

    private func roomRow(_ scan: SpatialRoomScanSummary) -> some View {
        NavigationLink {
            SpatialRoomSceneView(scan: scan)
        } label: {
            Label {
                VStack(alignment: .leading, spacing: 3) {
                    Text(scan.roomName)
                    Text(
                        L10n.text("ui_revision_0_1_items_d6786669", scan.revision, scan.placementCount) +
                            scan.capturedAt.formatted(date: .abbreviated, time: .omitted)
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "cube.transparent")
                    .foregroundStyle(.secondary)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if state.canManageSpatial {
                Button(L10n.text("ui_rescan_d98f477b"), systemImage: "viewfinder") {
                    presentation = RoomScanPresentation(mode: .replaceRoom(scan))
                }
                .disabled(!RoomCaptureSession.isSupported)
            }
        }
    }

    @MainActor
    private func loadScans() async {
        guard let client = state.client else { return }
        let generation = UUID()
        loadGeneration = generation
        loading = true
        defer {
            if loadGeneration == generation {
                loading = false
                hasLoaded = true
            }
        }
        do {
            pendingScans = try SpatialScanDraftStore(contextIdentifier: client.contextIdentifier).load()
            let response = try await client.listRoomScans()
            guard loadGeneration == generation, state.client?.contextIdentifier == client.contextIdentifier else { return }
            scans = response.scans
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            guard loadGeneration == generation, state.client?.contextIdentifier == client.contextIdentifier else { return }
            errorMessage = error.localizedDescription
        }
    }
}

private struct RoomScanPresentation: Identifiable {
    let id = UUID()
    let mode: SpatialRoomScanMode
    var pendingScan: SpatialPendingScan? = nil
}

private struct RoomScanFlowView: View {
    enum Phase {
        case details
        case scanning
        case paused
        case processing
        case betweenRooms
        case finalizing
        case uploading
        case complete
    }

    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let mode: SpatialRoomScanMode
    let onSaved: () -> Void

    @StateObject private var locationService = LocationService()
    @State private var structureName: String
    @State private var floorIdentifier: String
    @State private var floorIndex: Int
    @State private var roomName: String
    @State private var phase: Phase = .details
    @State private var finishCommand = RoomCaptureFinishCommand.idle
    @State private var resumeRequest = 0
    @State private var discardRequest = 0
    @State private var showsExitOptions = false
    @State private var saveForLater = false
    @State private var pendingScanID = UUID()
    @State private var uploadedScanIDs: Set<UUID> = []
    @State private var draftContextIdentifier: String?
    @State private var hint = L10n.text("ui_move_the_iphone_slowly_along_all_walls_fcd06b9a")
    @State private var drafts: [SpatialRoomScanDraft] = []
    @State private var createdRoomResourceIDs: [UUID: UUID] = [:]
    @State private var errorMessage: String?
    @State private var scanSessionID = UUID()
    @State private var uploadTask: Task<Void, Never>?
    @State private var capturedRoomCount = 0
    @State private var uploadProgress = 0
    @State private var structureID: UUID
    @State private var coordinateSpaceID: UUID
    @State private var georeferenceEnabled: Bool
    @State private var entryMarkerCode = ""
    @State private var waitsForGeoreferencedStart = false
    @State private var georeferenceStartTask: Task<Void, Never>?

    init(mode: SpatialRoomScanMode, pendingScan: SpatialPendingScan? = nil, onSaved: @escaping () -> Void) {
        self.mode = mode
        self.onSaved = onSaved
        let identity = SpatialRoomCaptureIdentity(mode: mode)
        _structureID = State(initialValue: identity.structureID)
        _coordinateSpaceID = State(initialValue: identity.coordinateSpaceID)
        if let pendingScan {
            _draftContextIdentifier = State(initialValue: pendingScan.contextIdentifier)
            _pendingScanID = State(initialValue: pendingScan.id)
            _drafts = State(initialValue: pendingScan.drafts)
            _createdRoomResourceIDs = State(initialValue: pendingScan.roomResourceIDs)
            _uploadedScanIDs = State(initialValue: pendingScan.uploadedScanIDs)
            _uploadProgress = State(initialValue: pendingScan.uploadedScanIDs.count)
            _phase = State(initialValue: .uploading)
        }

        switch mode {
        case .newStructure:
            _structureName = State(initialValue: "")
            _floorIdentifier = State(initialValue: L10n.text("ui_ground_floor_29fc5dee"))
            _floorIndex = State(initialValue: 0)
            _roomName = State(initialValue: "")
            _georeferenceEnabled = State(initialValue: false)
        case .appendToStructure(let seed):
            _structureName = State(initialValue: seed.structureName)
            _floorIdentifier = State(initialValue: seed.suggestedFloorIdentifier)
            _floorIndex = State(initialValue: seed.suggestedFloorIndex)
            _roomName = State(initialValue: "")
            _georeferenceEnabled = State(initialValue: seed.usesGeoreference)
        case .replaceRoom(let scan):
            _structureName = State(initialValue: scan.structureName ?? scan.roomName)
            _floorIdentifier = State(initialValue: scan.floorIdentifier ?? L10n.text("ui_ground_floor_29fc5dee"))
            _floorIndex = State(initialValue: scan.floorIndex ?? 0)
            _roomName = State(initialValue: scan.roomName)
            _georeferenceEnabled = State(initialValue: scan.georeference != nil)
        }
        if let draft = pendingScan?.drafts.first {
            _structureName = State(initialValue: draft.structureName ?? draft.roomName)
            _floorIdentifier = State(initialValue: draft.floorIdentifier ?? L10n.text("ui_ground_floor_29fc5dee"))
            _floorIndex = State(initialValue: draft.floorIndex ?? 0)
            _roomName = State(initialValue: draft.roomName)
            _georeferenceEnabled = State(initialValue: false)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .details:
                    details
                case .scanning, .paused, .processing, .betweenRooms, .finalizing:
                    scanner
                case .uploading:
                    statusView(
                        icon: "icloud.and.arrow.up.fill",
                        title: mode.supportsMultipleRooms
                            ? L10n.text("ui_uploading_rooms_2046e8b2")
                            : L10n.text("ui_replacing_room_95acb238"),
                        message: mode.supportsMultipleRooms
                            ? L10n.text("ui_0_of_1_rooms_saved_e6c65f11", uploadProgress, drafts.count)
                            : L10n.text("ui_the_new_3d_state_is_being_saved_0e519957"),
                        progress: true
                    )
                case .complete:
                    statusView(
                        icon: "checkmark.seal.fill",
                        title: completionTitle,
                        message: completionMessage,
                        progress: false
                    )
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if phase != .complete {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(L10n.text("ui_close_b808f6e9")) {
                            if phase == .details { discardAndDismiss() }
                            else { showsExitOptions = true }
                        }
                    }
                }
            }
            .interactiveDismissDisabled(phase != .details && phase != .complete)
            .confirmationDialog(L10n.text("ui_end_scan_c7c8cfb2"), isPresented: $showsExitOptions, titleVisibility: .visible) {
                if phase == .scanning || phase == .paused || (phase == .betweenRooms && capturedRoomCount > 0) {
                    Button(L10n.text("ui_save_progress_upload_later_f396a459")) {
                        finishCurrentRoom(finalizesStructure: true, saveLocally: true)
                    }
                }
                if phase == .scanning || phase == .paused {
                    Button(L10n.text("ui_discard_current_room_3782feb8"), role: .destructive) {
                        discardRequest += 1
                        phase = .scanning
                    }
                }
                if !drafts.isEmpty {
                    Button(L10n.text("ui_resume_upload_later_7752280c")) { keepDraftsAndDismiss() }
                }
                Button(L10n.text("ui_discard_local_scan_46d27cad"), role: .destructive) { discardAndDismiss() }
                Button(L10n.text("ui_continue_scanning_3402ece8"), role: .cancel) {}
            } message: {
                Text(L10n.text("ui_saved_uploads_remain_available_on_this_iphone_71442811"))
            }
            .alert(
                L10n.text("ui_room_scan_failed_d8220756"),
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                if !drafts.isEmpty {
                    Button(L10n.text("ui_retry_upload_48c7b5f6")) {
                        startUpload()
                    }
                }
                Button(L10n.text("ui_close_b808f6e9"), role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
            }
            .onDisappear {
                uploadTask?.cancel()
                georeferenceStartTask?.cancel()
                locationService.stopGeoreferenceCapture()
            }
            .task {
                if draftContextIdentifier == nil { draftContextIdentifier = state.client?.contextIdentifier }
                if georeferenceEnabled, georeferenceObservation == nil {
                    locationService.requestCurrentGeoreference()
                }
            }
            .onChange(of: scenePhase) { _, newPhase in
                if newPhase != .active && phase == .scanning { phase = .paused }
            }
            .onChange(of: georeferenceObservation) { _, observation in
                guard waitsForGeoreferencedStart, observation != nil else { return }
                beginScanning()
            }
            .onChange(of: locationService.errorMessage) { _, message in
                if waitsForGeoreferencedStart, message != nil {
                    beginScanningWithoutGeoreference()
                }
            }
        }
    }

    private var navigationTitle: String {
        switch mode {
        case .newStructure:
            L10n.text("ui_scan_new_structure_6ac1530d")
        case .appendToStructure:
            L10n.text("ui_extend_structure_889e98e2")
        case .replaceRoom:
            L10n.text("ui_rescan_room_cd23b316")
        }
    }

    private var detailsHeading: String {
        switch mode {
        case .newStructure:
            L10n.text("ui_connected_rooms_b6dd6bf9")
        case .appendToStructure:
            L10n.text("ui_add_room_or_floor_38a3bdd9")
        case .replaceRoom:
            L10n.text("ui_replace_room_state_4a9e2f9c")
        }
    }

    private var detailsSystemImage: String {
        switch mode {
        case .newStructure:
            "square.3.layers.3d"
        case .appendToStructure:
            "plus.square.on.square"
        case .replaceRoom:
            "arrow.triangle.2.circlepath"
        }
    }

    private var detailsExplanation: String {
        switch mode {
        case .newStructure:
            L10n.text("ui_scan_one_or_more_rooms_you_can_a11c2304")
        case .appendToStructure:
            L10n.text("ui_the_structure_is_preserved_choose_an_existing_e1541e3b")
        case .replaceRoom:
            L10n.text("ui_this_process_only_replaces_the_selected_room_362fe942")
        }
    }

    private var scanStartTitle: String {
        mode.supportsMultipleRooms ? L10n.text("ui_start_3d_scan_7d90e9f0") : L10n.text("ui_rescan_room_cd23b316")
    }

    private var scannerTitle: String {
        if mode.supportsMultipleRooms {
            return "\(structureName) · \(floorIdentifier) · " +
                L10n.text("ui_room_0_eb5cfd3d", capturedRoomCount + (phase == .betweenRooms ? 0 : 1))
        }
        return "\(structureName) · \(floorIdentifier) · \(roomName)"
    }

    private var completionTitle: String {
        switch mode {
        case .newStructure:
            L10n.text("ui_3d_structure_is_available_5b5a2211")
        case .appendToStructure:
            L10n.text("ui_structure_extended_32fc3ea6")
        case .replaceRoom:
            L10n.text("ui_room_scan_updated_09fc37d6")
        }
    }

    private var completionMessage: String {
        switch mode {
        case .newStructure:
            L10n.text("ui_the_captured_state_is_saved_you_can_62f0fbb5")
        case .appendToStructure:
            L10n.text("ui_the_new_rooms_now_belong_to_the_26d39eed")
        case .replaceRoom:
            L10n.text("ui_the_previous_state_of_this_room_has_0667dd8b")
        }
    }

    private var details: some View {
        Form {
            Section {
                Label(detailsHeading, systemImage: detailsSystemImage)
                    .font(.headline)
                Text(detailsExplanation)
                    .foregroundStyle(.secondary)
            }

            Section(L10n.text("ui_building_and_floor_ae271bb4")) {
                if case .newStructure = mode {
                    TextField(L10n.text("ui_building_name_e11b310e"), text: $structureName)
                        .textInputAutocapitalization(.words)
                } else {
                    LabeledContent(L10n.text("ui_structure_22650066"), value: structureName)
                }
                if case .replaceRoom = mode {
                    LabeledContent(L10n.text("ui_floor_ef352421"), value: floorIdentifier)
                    LabeledContent(L10n.text("ui_floor_index_8bc6d558"), value: String(floorIndex))
                } else {
                    TextField(L10n.text("ui_floor_e_g_ground_floor_2d66fb55"), text: $floorIdentifier)
                    Stepper(
                        L10n.text("ui_floor_index_0_6f6443ad", floorIndex),
                        value: $floorIndex,
                        in: -20 ... 200
                    )
                }
            }

            Section(mode.supportsMultipleRooms ? L10n.text("ui_first_room_8daaf317") : L10n.text("ui_room_to_replace_b02a1eac")) {
                if case .replaceRoom = mode {
                    LabeledContent(L10n.text("ui_room_d2fc5e58"), value: roomName)
                } else {
                    TextField(L10n.text("ui_room_name_e_g_workshop_38d932fa"), text: $roomName)
                        .textInputAutocapitalization(.words)
                }
            }

            Section {
                Toggle(L10n.text("ui_anchor_on_map_0e9b7079"), isOn: $georeferenceEnabled)
                    .onChange(of: georeferenceEnabled) { _, enabled in
                        if enabled {
                            locationService.requestCurrentGeoreference()
                        } else {
                            georeferenceStartTask?.cancel()
                            georeferenceStartTask = nil
                            waitsForGeoreferencedStart = false
                            locationService.stopGeoreferenceCapture()
                        }
                    }
                if georeferenceEnabled {
                    TextField(L10n.text("ui_entrance_or_qr_marker_optional_d7e4c219"), text: $entryMarkerCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if let coordinates = locationService.coordinates,
                       let heading = locationService.heading {
                        Label(
                            L10n.text("ui_gps_0_m_north_1_4e2cfcf4", Int(coordinates.accuracy.rounded()), Int(heading.accuracy.rounded())),
                            systemImage: "location.north.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(.green)
                    } else if locationService.isRequesting || locationService.isRequestingHeading {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text(L10n.text("ui_preparing_location_and_heading_8eb36b48"))
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    if let locationError = locationService.errorMessage {
                        Label(locationError, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                        Button(L10n.text("ui_retry_948643cb")) {
                            locationService.requestCurrentGeoreference()
                        }
                    }
                }
            } header: {
                Text(L10n.text("ui_position_6d031af1"))
            } footer: {
                if georeferenceEnabled {
                    Text(L10n.text("ui_gps_position_and_north_alignment_are_captured_c4e1d078"))
                }
            }

            Section {
                Button {
                    if georeferenceEnabled {
                        startScanningWithOptionalGeoreference()
                    } else {
                        beginScanning()
                    }
                } label: {
                    if waitsForGeoreferencedStart {
                        HStack(spacing: 9) {
                            ProgressView()
                            Text(L10n.text("ui_capturing_location_4be1315f"))
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        Label(scanStartTitle, systemImage: "viewfinder")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!detailsAreValid || waitsForGeoreferencedStart)
            }
        }
    }

    private var scanner: some View {
        ZStack {
            RoomCaptureControllerView(
                finishCommand: finishCommand,
                resumeRequest: resumeRequest,
                discardRequest: discardRequest,
                isPaused: phase == .paused,
                currentRoomName: roomName,
                batch: captureBatch,
                onHint: { hint = $0 },
                onProcessing: {
                    if mode.supportsMultipleRooms && finishCommand.finalizesStructure {
                        phase = .finalizing
                        hint = L10n.text("ui_connecting_rooms_into_a_structure_014834cc")
                    } else {
                        phase = .processing
                        hint = L10n.text("ui_processing_room_440f8642")
                    }
                },
                onRoomCaptured: { count in
                    capturedRoomCount = count
                    roomName = mode.replacedScan?.roomName ?? ""
                    phase = .betweenRooms
                    hint = count > 0
                        ? L10n.text("ui_previous_rooms_have_been_included_you_can_8030effa")
                        : L10n.text("ui_you_can_restart_the_room_or_close_a8401c64")
                },
                onResult: { result in
                    switch result {
                    case .success(let scanDrafts):
                        locationService.stopGeoreferenceCapture()
                        drafts = scanDrafts
                        phase = .uploading
                        if saveForLater { keepDraftsAndDismiss() }
                        else { startUpload() }
                    case .failure(let error):
                        saveForLater = false
                        errorMessage = error.localizedDescription
                    }
                }
            )
            .id(scanSessionID)
            .ignoresSafeArea(edges: .bottom)

            LinearGradient(
                colors: [.black.opacity(0.5), .clear, .black.opacity(0.58)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            VStack {
                VStack(spacing: 7) {
                    Label(
                        scannerTitle,
                        systemImage: "square.3.layers.3d"
                    )
                    .font(.caption.bold())
                    Text(hint)
                        .font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.center)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 17))
                .padding(.top, 12)

                Spacer()

                Group {
                    if phase == .betweenRooms {
                    VStack(spacing: 12) {
                        if mode.supportsMultipleRooms || capturedRoomCount == 0 {
                        Text(capturedRoomCount == 0 ? L10n.text("ui_start_room_f3c348a8") : L10n.text("ui_what_is_the_next_room_called_8337646e"))
                            .font(.headline)
                        TextField(L10n.text("ui_for_example_storage_room_dffe059f"), text: $roomName)
                            .textInputAutocapitalization(.words)
                            .padding(12)
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        Button {
                            resumeRequest += 1
                            phase = .scanning
                            hint = L10n.text("ui_move_the_iphone_slowly_along_the_walls_0a6aa91f")
                        } label: {
                            Label(capturedRoomCount == 0 ? L10n.text("ui_scan_room_eabaecb5") : L10n.text("ui_scan_next_room_f8ee0255"), systemImage: "arrow.right")
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(roomName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        if capturedRoomCount > 0 {
                            Button(capturedRoomCount == 1 ? L10n.text("ui_save_room_e4290148") : L10n.text("ui_save_0_rooms_6e077ae0", capturedRoomCount)) {
                                finishCurrentRoom(finalizesStructure: true)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(16)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                    } else if phase == .processing || phase == .finalizing {
                        HStack(spacing: 9) {
                            ProgressView()
                            Text(phase == .finalizing ? L10n.text("ui_building_structure_ef16a84d") : L10n.text("ui_processing_room_dd6a99f3"))
                        }
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 22)
                        .frame(minHeight: 52)
                        .background(.white.opacity(0.9), in: Capsule())
                    } else if phase == .paused {
                        VStack(spacing: 12) {
                            Text(L10n.text("ui_scan_paused_53917423")).font(.headline)
                            Text(L10n.text("ui_resume_in_the_same_room_save_your_05147643"))
                                .font(.caption).multilineTextAlignment(.center)
                            Button(L10n.text("ui_resume_scan_752c7424"), systemImage: "play.fill") { phase = .scanning }
                                .buttonStyle(.borderedProminent)
                            Button(L10n.text("ui_upload_progress_so_far_a9280122")) {
                                finishCurrentRoom(finalizesStructure: true)
                            }
                            .buttonStyle(.bordered)
                        }
                        .padding(16)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                    } else if mode.supportsMultipleRooms {
                        VStack(spacing: 10) {
                            Button {
                                finishCurrentRoom(finalizesStructure: false)
                            } label: {
                                Label(L10n.text("ui_accept_room_continue_3e9d5c9f"), systemImage: "door.left.hand.open")
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 48)
                            }
                            .buttonStyle(.bordered)
                            .tint(.white)

                            Button {
                                finishCurrentRoom(finalizesStructure: true)
                            } label: {
                                Label(L10n.text("ui_upload_progress_so_far_a9280122"), systemImage: "icloud.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 50)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    } else {
                        Button {
                            finishCurrentRoom(finalizesStructure: true)
                        } label: {
                            Label(L10n.text("ui_replace_room_scan_01a178af"), systemImage: "arrow.triangle.2.circlepath")
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 50)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                .padding(.bottom, 24)
                if phase == .scanning {
                    Button(L10n.text("ui_pause_75a303be"), systemImage: "pause.fill") { phase = .paused }
                        .buttonStyle(.bordered).tint(.white)
                        .padding(.bottom, 12)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func statusView(
        icon: String,
        title: String,
        message: String,
        progress: Bool
    ) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: icon)
                .font(.system(size: 48, weight: .semibold))
                .foregroundStyle(progress ? Color.accentColor : .green)
            Text(title)
                .font(.title2.bold())
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 22)
            if progress {
                if uploadTask != nil {
                    ProgressView().padding(.top, 4)
                } else {
                    Button(L10n.text("ui_resume_upload_b147c126")) { startUpload() }
                        .buttonStyle(.borderedProminent)
                }
                Button(L10n.text("ui_upload_later_75702eab")) { keepDraftsAndDismiss() }
                    .buttonStyle(.bordered)
            } else {
                Button(L10n.text("ui_done_25d52d7e")) { onSaved() }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 8)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @MainActor
    private func uploadDrafts() async {
        defer { uploadTask = nil }
        guard state.canManageSpatial, !drafts.isEmpty, let client = state.client,
              client.contextIdentifier == draftContextIdentifier else {
            errorMessage = L10n.text("ui_to_upload_sign_in_again_with_the_201afcb4")
            return
        }
        phase = .uploading
        errorMessage = nil
        uploadProgress = uploadedScanIDs.count
        do {
            try persistDrafts()
            if !mode.supportsMultipleRooms, drafts.count != 1 {
                throw APIClientError.invalidUpload(
                    L10n.text("ui_rescanning_must_produce_exactly_one_room_state_82d25f65")
                )
            }
            for (index, draft) in drafts.enumerated() {
                try Task.checkCancellation()
                if uploadedScanIDs.contains(draft.id) { continue }
                let roomResourceID: UUID
                if let existingRoomResourceID = mode.existingRoomResourceID(
                    forDraftAt: index
                ) {
                    roomResourceID = existingRoomResourceID
                } else if let createdID = createdRoomResourceIDs[draft.id] {
                    roomResourceID = createdID
                } else {
                    let room = try await client.createResource(
                        ResourceCreateRequest(
                            name: draft.roomName,
                            description: L10n.text("ui_3d_room_captured_with_roomplan_in_0_48dcea4b", draft.structureName ?? draft.roomName, draft.floorIdentifier ?? L10n.text("ui_ground_floor_29fc5dee")),
                            type: .place,
                            location: draft.roomName
                        ),
                        idempotencyKey: draft.id
                    )
                    try Task.checkCancellation()
                    createdRoomResourceIDs[draft.id] = room.id
                    try persistDrafts()
                    roomResourceID = room.id
                }
                _ = try await client.uploadRoomScan(draft, roomResourceID: roomResourceID)
                try Task.checkCancellation()
                uploadedScanIDs.insert(draft.id)
                uploadProgress = uploadedScanIDs.count
                try persistDrafts()
            }
            try draftStore().remove(id: pendingScanID)
            drafts = []
            phase = .complete
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            phase = .uploading
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func startUpload() {
        guard uploadTask == nil else { return }
        uploadTask = Task { await uploadDrafts() }
    }

    private func draftStore() throws -> SpatialScanDraftStore {
        guard let draftContextIdentifier else {
            throw APIClientError.invalidUpload(L10n.text("ui_sign_in_details_for_this_scan_are_2b530ddc"))
        }
        return try SpatialScanDraftStore(contextIdentifier: draftContextIdentifier)
    }

    @MainActor
    private func persistDrafts() throws {
        let originals = drafts
        let saved = try draftStore().save(SpatialPendingScan(
            id: pendingScanID, contextIdentifier: draftContextIdentifier ?? "", mode: mode, drafts: drafts,
            roomResourceIDs: createdRoomResourceIDs, uploadedScanIDs: uploadedScanIDs
        ))
        drafts = saved.drafts
        for (original, stored) in zip(originals, saved.drafts) where original.modelURL != stored.modelURL {
            original.removeLocalArtifacts()
        }
    }

    @MainActor
    private func keepDraftsAndDismiss() {
        uploadTask?.cancel()
        do {
            try persistDrafts()
            dismiss()
        } catch {
            saveForLater = false
            errorMessage = L10n.text("ui_could_not_save_the_scan_on_this_dcd017ad", error.localizedDescription)
        }
    }

    @MainActor
    private func discardAndDismiss() {
        uploadTask?.cancel()
        uploadTask = nil
        georeferenceStartTask?.cancel()
        georeferenceStartTask = nil
        do {
            if draftContextIdentifier != nil { try draftStore().remove(id: pendingScanID) }
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        drafts.forEach { $0.removeLocalArtifacts() }
        drafts.removeAll()
        locationService.stopGeoreferenceCapture()
        dismiss()
    }

    private var captureBatch: SpatialRoomCaptureBatch {
        SpatialRoomCaptureBatch(
            structureID: structureID,
            structureName: String(
                structureName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(240)
            ),
            floorIdentifier: String(
                floorIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)
            ),
            floorIndex: floorIndex,
            coordinateSpaceID: coordinateSpaceID,
            georeferenceObservation: georeferenceObservation
        )
    }

    private var georeferenceObservation: SpatialGeoreferenceObservation? {
        guard georeferenceEnabled,
              let coordinates = locationService.coordinates,
              let heading = locationService.heading,
              abs(coordinates.capturedAt.timeIntervalSince(heading.capturedAt)) <= 3
        else { return nil }
        return SpatialGeoreferenceObservation(
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            altitude: coordinates.altitude,
            horizontalAccuracy: coordinates.accuracy >= 0 ? coordinates.accuracy : nil,
            verticalAccuracy: coordinates.verticalAccuracy,
            trueHeading: heading.trueHeading,
            headingAccuracy: heading.accuracy,
            capturedAt: max(coordinates.capturedAt, heading.capturedAt),
            entryMarkerCode: normalizedEntryMarkerCode
        )
    }

    private var normalizedEntryMarkerCode: String? {
        let value = entryMarkerCode.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : String(value.prefix(240))
    }

    @MainActor
    private func startScanningWithOptionalGeoreference() {
        if let observation = georeferenceObservation,
           abs(observation.capturedAt.timeIntervalSinceNow) <= 2.5 {
            beginScanning()
            return
        }

        waitsForGeoreferencedStart = true
        locationService.requestCurrentGeoreference()
        guard locationService.errorMessage == nil else {
            beginScanningWithoutGeoreference()
            return
        }

        georeferenceStartTask?.cancel()
        georeferenceStartTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled, waitsForGeoreferencedStart else { return }
            beginScanningWithoutGeoreference()
        }
    }

    @MainActor
    private func beginScanning() {
        georeferenceStartTask?.cancel()
        georeferenceStartTask = nil
        waitsForGeoreferencedStart = false
        locationService.stopGeoreferenceCapture()
        phase = .scanning
    }

    @MainActor
    private func beginScanningWithoutGeoreference() {
        georeferenceEnabled = false
        beginScanning()
    }

    private var detailsAreValid: Bool {
        !structureName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !floorIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !roomName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @MainActor
    private func finishCurrentRoom(finalizesStructure: Bool, saveLocally: Bool = false) {
        saveForLater = saveLocally
        finishCommand = RoomCaptureFinishCommand(
            sequence: finishCommand.sequence + 1,
            finalizesStructure: finalizesStructure
        )
    }

}
