import RoomPlan
import SwiftUI

struct SpatialRoomAppendSeed: Equatable, Sendable {
    let structureID: UUID
    let structureName: String
    let suggestedFloorIdentifier: String
    let suggestedFloorIndex: Int
    let usesGeoreference: Bool
    let existingCoordinateSpaceIDs: Set<UUID>
}

enum SpatialRoomScanMode: Equatable, Sendable {
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

    var body: some View {
        NavigationStack {
            Group {
                if loading && !hasLoaded {
                    ProgressView("3D-Räume werden geladen …")
                } else if scans.isEmpty {
                    emptyState
                } else {
                    roomList
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Räume")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Raum scannen", systemImage: "plus") {
                        presentation = RoomScanPresentation(mode: .newStructure)
                    }
                    .disabled(!RoomCaptureSession.isSupported)
                }
            }
            .refreshable { await loadScans() }
            .task(id: state.client?.serverURL) { await loadScans() }
            .sheet(item: $presentation) { presentation in
                RoomScanFlowView(mode: presentation.mode) {
                    self.presentation = nil
                    Task { await loadScans() }
                }
                .environmentObject(state)
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
            if RoomCaptureSession.isSupported {
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

            Button("Raum oder Etage hinzufügen", systemImage: "plus") {
                guard let seed = structure.appendSeed else { return }
                presentation = RoomScanPresentation(mode: .appendToStructure(seed))
            }
            .disabled(structure.appendSeed == nil || !RoomCaptureSession.isSupported)
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
            Button("Neu scannen", systemImage: "viewfinder") {
                presentation = RoomScanPresentation(mode: .replaceRoom(scan))
            }
            .disabled(!RoomCaptureSession.isSupported)
        }
    }

    @MainActor
    private func loadScans() async {
        guard !loading, let client = state.client else { return }
        loading = true
        defer {
            loading = false
            hasLoaded = true
        }
        do {
            scans = try await client.listRoomScans().scans
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct RoomScanPresentation: Identifiable {
    let id = UUID()
    let mode: SpatialRoomScanMode
}

private struct RoomScanFlowView: View {
    enum Phase {
        case details
        case scanning
        case processing
        case betweenRooms
        case finalizing
        case uploading
        case complete
    }

    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
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

    init(mode: SpatialRoomScanMode, onSaved: @escaping () -> Void) {
        self.mode = mode
        self.onSaved = onSaved
        let identity = SpatialRoomCaptureIdentity(mode: mode)
        _structureID = State(initialValue: identity.structureID)
        _coordinateSpaceID = State(initialValue: identity.coordinateSpaceID)

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
    }

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .details:
                    details
                case .scanning, .processing, .betweenRooms, .finalizing:
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
                        Button("Abbrechen") { discardAndDismiss() }
                    }
                }
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
                georeferenceStartTask?.cancel()
                locationService.stopGeoreferenceCapture()
            }
            .task {
                if georeferenceEnabled, georeferenceObservation == nil {
                    locationService.requestCurrentGeoreference()
                }
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
            "Scanne alle verbundenen Räume nacheinander. Türen und Übergänge bleiben dabei im selben AR-Koordinatensystem."
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
            "Die Räume sind verbunden. Beim Platzieren erkennt die AR-Kamera den aktuellen Raum automatisch."
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
                    roomName = ""
                    phase = .betweenRooms
                    hint = "Bleibe in der gemeinsamen AR-Sitzung und gehe durch den Übergang in den nächsten Raum."
                },
                onResult: { result in
                    switch result {
                    case .success(let scanDrafts):
                        locationService.stopGeoreferenceCapture()
                        drafts = scanDrafts
                        startUpload()
                    case .failure(let error):
                        restartCaptureBatch()
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
                        Text("Wie heißt der nächste Raum?")
                            .font(.headline)
                        TextField("Zum Beispiel Lager", text: $roomName)
                            .textInputAutocapitalization(.words)
                            .padding(12)
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        Button {
                            resumeRequest += 1
                            phase = .scanning
                            hint = "Gehe durch die Tür und scanne den nächsten Raum vollständig."
                        } label: {
                            Label("Nächsten Raum scannen", systemImage: "arrow.right")
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(roomName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
                    } else if mode.supportsMultipleRooms {
                        VStack(spacing: 10) {
                            Button {
                                finishCurrentRoom(finalizesStructure: false)
                            } label: {
                                Label("Raum fertig · weiter", systemImage: "door.left.hand.open")
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 48)
                            }
                            .buttonStyle(.bordered)
                            .tint(.white)

                            Button {
                                finishCurrentRoom(finalizesStructure: true)
                            } label: {
                                Label("Letzten Raum & Struktur abschließen", systemImage: "checkmark")
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
                ProgressView().padding(.top, 4)
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
        guard !drafts.isEmpty, let client = state.client else { return }
        phase = .uploading
        uploadProgress = 0
        do {
            if !mode.supportsMultipleRooms, drafts.count != 1 {
                throw APIClientError.invalidUpload(
                    "Beim Neu-Scannen darf genau ein Raumstand erzeugt werden."
                )
            }
            for (index, draft) in drafts.enumerated() {
                try Task.checkCancellation()
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
                            description: "Mit RoomPlan erfasster 3D-Raum in \(structureName), \(floorIdentifier).",
                            type: .place,
                            location: draft.roomName
                        ),
                        idempotencyKey: draft.id
                    )
                    createdRoomResourceIDs[draft.id] = room.id
                    roomResourceID = room.id
                }
                _ = try await client.uploadRoomScan(draft, roomResourceID: roomResourceID)
                uploadProgress = index + 1
            }
            drafts.forEach { $0.removeLocalArtifacts() }
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
        uploadTask?.cancel()
        uploadTask = Task { await uploadDrafts() }
    }

    @MainActor
    private func discardAndDismiss() {
        uploadTask?.cancel()
        uploadTask = nil
        georeferenceStartTask?.cancel()
        georeferenceStartTask = nil
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
    private func finishCurrentRoom(finalizesStructure: Bool) {
        finishCommand = RoomCaptureFinishCommand(
            sequence: finishCommand.sequence + 1,
            finalizesStructure: finalizesStructure
        )
    }

    @MainActor
    private func restartCaptureBatch() {
        drafts.forEach { $0.removeLocalArtifacts() }
        drafts.removeAll()
        capturedRoomCount = 0
        finishCommand = .idle
        resumeRequest = 0
        let previousCoordinateSpaceID = coordinateSpaceID
        repeat {
            coordinateSpaceID = UUID()
        } while coordinateSpaceID == previousCoordinateSpaceID ||
            mode.existingCoordinateSpaceIDs.contains(coordinateSpaceID)
        scanSessionID = UUID()
        phase = .details
        if georeferenceEnabled {
            locationService.requestCurrentGeoreference()
        }
    }
}
