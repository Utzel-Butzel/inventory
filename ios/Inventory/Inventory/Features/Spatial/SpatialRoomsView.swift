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
            if let index { return "Etage \(index)" }
            return "Etage nicht zugeordnet"
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
            suggestedFloorIdentifier: latestScan.floorIdentifier ?? "EG",
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
                    ?? "Struktur \(fallbackID)",
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
                    ProgressView("3D-Räume werden geladen …")
                } else if scans.isEmpty && pendingScans.isEmpty {
                    emptyState
                } else {
                    roomList
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Räume")
            .toolbar {
                if state.canManageSpatial {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Raum scannen", systemImage: "plus") {
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
                "3D-Räume konnten nicht geladen werden",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("Erneut laden") { Task { await loadScans() } }
                Button("Abbrechen", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Noch kein Raumscan", systemImage: "viewfinder")
        } description: {
            Text(
                RoomCaptureSession.isSupported
                    ? "Scanne zusammenhängende Räume mit LiDAR. Danach erkennt die AR-Kamera automatisch, in welchem Raum du dich befindest."
                    : "Dieses iPhone unterstützt RoomPlan nicht. Dafür ist ein LiDAR-fähiges iPhone erforderlich."
            )
        } actions: {
            if state.canManageSpatial && RoomCaptureSession.isSupported {
                Button("Ersten Raum scannen") {
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
                Section("Gespeicherte Uploads") {
                    ForEach(pendingScans) { pending in
                        Button {
                            presentation = RoomScanPresentation(mode: pending.mode, pendingScan: pending)
                        } label: {
                            Label {
                                VStack(alignment: .leading) {
                                    Text(pending.title)
                                    Text("\(pending.uploadedScanIDs.count) von \(pending.drafts.count) übertragen · Upload fortsetzen")
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
                Section("Einzelräume") {
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
                Button("Raum oder Etage hinzufügen", systemImage: "plus") {
                    guard let seed = structure.appendSeed else { return }
                    presentation = RoomScanPresentation(mode: .appendToStructure(seed))
                }
                .disabled(structure.appendSeed == nil || !RoomCaptureSession.isSupported)
            }
        } header: {
            Label(structure.structureName, systemImage: "building.2")
        } footer: {
            Text(
                "\(structure.roomCount) Räume auf \(structure.floors.count) " +
                    (structure.floors.count == 1 ? "Etage" : "Etagen")
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
                        "Revision \(scan.revision) · \(scan.placementCount) Gegenstände · " +
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
                Button("Neu scannen", systemImage: "viewfinder") {
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
    @State private var hint = "Bewege das iPhone langsam entlang aller Wände und Möbel."
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
            _floorIdentifier = State(initialValue: "EG")
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
            _floorIdentifier = State(initialValue: scan.floorIdentifier ?? "EG")
            _floorIndex = State(initialValue: scan.floorIndex ?? 0)
            _roomName = State(initialValue: scan.roomName)
            _georeferenceEnabled = State(initialValue: scan.georeference != nil)
        }
        if let draft = pendingScan?.drafts.first {
            _structureName = State(initialValue: draft.structureName ?? draft.roomName)
            _floorIdentifier = State(initialValue: draft.floorIdentifier ?? "EG")
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
                            ? "Räume werden übertragen"
                            : "Raum wird ersetzt",
                        message: mode.supportsMultipleRooms
                            ? "\(uploadProgress) von \(drafts.count) Räumen sind gespeichert."
                            : "Der neue 3D-Stand wird sicher in Inventory gespeichert.",
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
                        Button("Schließen") {
                            if phase == .details { discardAndDismiss() }
                            else { showsExitOptions = true }
                        }
                    }
                }
            }
            .interactiveDismissDisabled(phase != .details && phase != .complete)
            .confirmationDialog("Scan beenden?", isPresented: $showsExitOptions, titleVisibility: .visible) {
                if phase == .scanning || phase == .paused || (phase == .betweenRooms && capturedRoomCount > 0) {
                    Button("Stand speichern · später hochladen") {
                        finishCurrentRoom(finalizesStructure: true, saveLocally: true)
                    }
                }
                if phase == .scanning || phase == .paused {
                    Button("Aktuellen Raum verwerfen", role: .destructive) {
                        discardRequest += 1
                        phase = .scanning
                    }
                }
                if !drafts.isEmpty {
                    Button("Upload später fortsetzen") { keepDraftsAndDismiss() }
                }
                Button("Lokalen Scan verwerfen", role: .destructive) { discardAndDismiss() }
                Button("Weiter scannen", role: .cancel) {}
            } message: {
                Text("Gespeicherte Uploads bleiben auf diesem iPhone verfügbar. Bereits hochgeladene Räume bleiben erhalten.")
            }
            .alert(
                "Raumscan fehlgeschlagen",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                if !drafts.isEmpty {
                    Button("Upload erneut versuchen") {
                        startUpload()
                    }
                }
                Button("Schließen", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Unbekannter Fehler")
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
            "Neue Struktur scannen"
        case .appendToStructure:
            "Struktur erweitern"
        case .replaceRoom:
            "Raum neu scannen"
        }
    }

    private var detailsHeading: String {
        switch mode {
        case .newStructure:
            "Zusammenhängende Räume"
        case .appendToStructure:
            "Raum oder Etage hinzufügen"
        case .replaceRoom:
            "Raumstand ersetzen"
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
            "Scanne einen oder mehrere Räume. Du kannst jederzeit pausieren oder den bisherigen Stand speichern. Für weitere Räume bleibt die gemeinsame Kamerasitzung geöffnet."
        case .appendToStructure:
            "Die Struktur bleibt erhalten. Wähle die vorhandene oder eine neue Etage und scanne die neuen Räume in einem frischen AR-Koordinatensystem."
        case .replaceRoom:
            "Dieser Vorgang ersetzt ausschließlich den ausgewählten Raumstand. Es werden keine weiteren Räume oder Ressourcen angelegt."
        }
    }

    private var scanStartTitle: String {
        mode.supportsMultipleRooms ? "3D-Scan starten" : "Raum neu scannen"
    }

    private var scannerTitle: String {
        if mode.supportsMultipleRooms {
            return "\(structureName) · \(floorIdentifier) · " +
                "\(capturedRoomCount + (phase == .betweenRooms ? 0 : 1)). Raum"
        }
        return "\(structureName) · \(floorIdentifier) · \(roomName)"
    }

    private var completionTitle: String {
        switch mode {
        case .newStructure:
            "3D-Struktur ist verfügbar"
        case .appendToStructure:
            "Struktur wurde erweitert"
        case .replaceRoom:
            "Raumscan wurde aktualisiert"
        }
    }

    private var completionMessage: String {
        switch mode {
        case .newStructure:
            "Der erfasste Stand ist gespeichert. Du kannst weitere Räume hinzufügen oder einzelne Räume neu scannen."
        case .appendToStructure:
            "Die neuen Räume gehören jetzt zur bestehenden Struktur und können räumlich verwendet werden."
        case .replaceRoom:
            "Der bisherige Stand dieses Raums wurde durch den neuen 3D-Scan ersetzt."
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

            Section("Gebäude und Etage") {
                if case .newStructure = mode {
                    TextField("Gebäudename", text: $structureName)
                        .textInputAutocapitalization(.words)
                } else {
                    LabeledContent("Struktur", value: structureName)
                }
                if case .replaceRoom = mode {
                    LabeledContent("Etage", value: floorIdentifier)
                    LabeledContent("Etagenindex", value: String(floorIndex))
                } else {
                    TextField("Etage, z. B. EG", text: $floorIdentifier)
                    Stepper(
                        "Etagenindex: \(floorIndex)",
                        value: $floorIndex,
                        in: -20 ... 200
                    )
                }
            }

            Section(mode.supportsMultipleRooms ? "Erster Raum" : "Zu ersetzender Raum") {
                if case .replaceRoom = mode {
                    LabeledContent("Raum", value: roomName)
                } else {
                    TextField("Raumname, z. B. Werkstatt", text: $roomName)
                        .textInputAutocapitalization(.words)
                }
            }

            Section {
                Toggle("Auf der Karte verankern", isOn: $georeferenceEnabled)
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
                    TextField("Eingangs- oder QR-Marker (optional)", text: $entryMarkerCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if let coordinates = locationService.coordinates,
                       let heading = locationService.heading {
                        Label(
                            "GPS ±\(Int(coordinates.accuracy.rounded())) m · Nord ±\(Int(heading.accuracy.rounded()))°",
                            systemImage: "location.north.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(.green)
                    } else if locationService.isRequesting || locationService.isRequestingHeading {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Standort und Richtung werden vorbereitet …")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    if let locationError = locationService.errorMessage {
                        Label(locationError, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                        Button("Erneut versuchen") {
                            locationService.requestCurrentGeoreference()
                        }
                    }
                }
            } header: {
                Text("Position")
            } footer: {
                if georeferenceEnabled {
                    Text("GPS-Position und Nordausrichtung werden beim Scanstart erfasst.")
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
                            Text("Standort wird erfasst …")
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
                        hint = "Räume werden zu einer Struktur verbunden …"
                    } else {
                        phase = .processing
                        hint = "Raum wird verarbeitet …"
                    }
                },
                onRoomCaptured: { count in
                    capturedRoomCount = count
                    roomName = mode.replacedScan?.roomName ?? ""
                    phase = .betweenRooms
                    hint = count > 0
                        ? "Bisherige Räume sind übernommen. Du kannst jetzt speichern oder weiter scannen."
                        : "Du kannst den Raum erneut beginnen oder den Scan schließen."
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
                        Text(capturedRoomCount == 0 ? "Raum beginnen" : "Wie heißt der nächste Raum?")
                            .font(.headline)
                        TextField("Zum Beispiel Lager", text: $roomName)
                            .textInputAutocapitalization(.words)
                            .padding(12)
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        Button {
                            resumeRequest += 1
                            phase = .scanning
                            hint = "Bewege das iPhone langsam entlang der Wände und Möbel."
                        } label: {
                            Label(capturedRoomCount == 0 ? "Raum scannen" : "Nächsten Raum scannen", systemImage: "arrow.right")
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(roomName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        if capturedRoomCount > 0 {
                            Button(capturedRoomCount == 1 ? "Raum speichern" : "\(capturedRoomCount) Räume speichern") {
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
                            Text(phase == .finalizing ? "Struktur wird aufgebaut" : "Raum wird verarbeitet")
                        }
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 22)
                        .frame(minHeight: 52)
                        .background(.white.opacity(0.9), in: Capsule())
                    } else if phase == .paused {
                        VStack(spacing: 12) {
                            Text("Scan pausiert").font(.headline)
                            Text("Im selben Raum fortsetzen. Zum Schließen den bisherigen Stand speichern.")
                                .font(.caption).multilineTextAlignment(.center)
                            Button("Scan fortsetzen", systemImage: "play.fill") { phase = .scanning }
                                .buttonStyle(.borderedProminent)
                            Button("Bisherigen Stand hochladen") {
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
                                Label("Raum übernehmen · weiter", systemImage: "door.left.hand.open")
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 48)
                            }
                            .buttonStyle(.bordered)
                            .tint(.white)

                            Button {
                                finishCurrentRoom(finalizesStructure: true)
                            } label: {
                                Label("Bisherigen Stand hochladen", systemImage: "icloud.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 50)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    } else {
                        Button {
                            finishCurrentRoom(finalizesStructure: true)
                        } label: {
                            Label("Raumscan ersetzen", systemImage: "arrow.triangle.2.circlepath")
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 50)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                .padding(.bottom, 24)
                if phase == .scanning {
                    Button("Pausieren", systemImage: "pause.fill") { phase = .paused }
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
                    Button("Upload fortsetzen") { startUpload() }
                        .buttonStyle(.borderedProminent)
                }
                Button("Später hochladen") { keepDraftsAndDismiss() }
                    .buttonStyle(.bordered)
            } else {
                Button("Fertig") { onSaved() }
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
            errorMessage = "Zum Hochladen melde dich wieder mit dem ursprünglichen Konto und der ursprünglichen Organisation an."
            return
        }
        phase = .uploading
        errorMessage = nil
        uploadProgress = uploadedScanIDs.count
        do {
            try persistDrafts()
            if !mode.supportsMultipleRooms, drafts.count != 1 {
                throw APIClientError.invalidUpload(
                    "Beim Neu-Scannen darf genau ein Raumstand erzeugt werden."
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
                            description: "Mit RoomPlan erfasster 3D-Raum in \(draft.structureName ?? draft.roomName), \(draft.floorIdentifier ?? "EG").",
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
            throw APIClientError.invalidUpload("Die Anmeldung für diesen Scan fehlt.")
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
            errorMessage = "Der Scan konnte nicht auf diesem iPhone gespeichert werden: \(error.localizedDescription)"
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
