import SwiftUI

struct SpatialItemCaptureView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    let onCapture: (SpatialPlacementDraft, Data) -> Void

    @State private var scans: [SpatialRoomScanSummary] = []
    @State private var selectedScan: SpatialRoomScanSummary?
    @State private var activeRoomScan: SpatialRoomScanSummary?
    @State private var loadedWorldMap: LoadedSpatialWorldMap?
    @State private var loading = true
    @State private var loadingWorldMap = false
    @State private var trackingMessage = "Gespeicherter Raum wird gesucht …"
    @State private var trackingReady = false
    @State private var captureRequest = 0
    @State private var capturing = false
    @State private var errorMessage: String?
    @State private var selectionState = SpatialWorldMapSelectionState()
    @State private var worldMapLoadTask: Task<Void, Never>?
    @State private var manualRoomScanID: UUID?
    @State private var manualRoomRequest = 0

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView("Räume werden geladen …")
                } else if let selectedScan,
                          let loadedWorldMap,
                          selectionState.accepts(
                              scanID: selectedScan.id,
                              generation: loadedWorldMap.generation
                          ),
                          loadedWorldMap.scanID == selectedScan.id {
                    captureView(scan: selectedScan, worldMap: loadedWorldMap)
                } else if scans.isEmpty {
                    emptyState
                } else {
                    roomSelection
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(InventoryTheme.canvas)
            .navigationTitle(selectedScan == nil ? "Raum auswählen" : "Im Raum erfassen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Schließen") { dismiss() }
                }
                if selectedScan != nil {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Bereich wechseln") {
                            resetSelection()
                        }
                    }
                }
                if let loadedWorldMap, loadedWorldMap.candidates.count > 1 {
                    ToolbarItem(placement: .secondaryAction) {
                        Menu {
                            Button("Automatisch erkennen") {
                                selectManualRoom(nil)
                            }
                            Divider()
                            ForEach(loadedWorldMap.candidates, id: \.scan.id) { candidate in
                                Button(candidate.scan.roomName) {
                                    selectManualRoom(candidate.scan.id)
                                }
                            }
                        } label: {
                            Label("Raum wählen", systemImage: "door.left.hand.open")
                        }
                    }
                }
            }
            .task { await loadScans() }
            .onDisappear {
                worldMapLoadTask?.cancel()
                worldMapLoadTask = nil
                selectionState.cancel()
            }
            .alert(
                "Räumliche Erfassung fehlgeschlagen",
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
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Kein 3D-Raum verfügbar", systemImage: "cube.transparent")
        } description: {
            Text("Scanne zuerst einen Raum im Bereich ‚Räume‘.")
        }
        .padding(24)
    }

    private var roomSelection: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Wähle eine verbundene Struktur. Nach der AR-Wiedererkennung bestimmt die App beim Durchqueren von Türen automatisch den aktuellen Raum. Einzelne ältere Raumscans bleiben auswählbar.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                ForEach(selectionEntries) { entry in
                    Button {
                        startSelecting(entry)
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: entry.scans.count > 1 ? "square.3.layers.3d" : "cube.transparent.fill")
                                .font(.title2)
                                .foregroundStyle(InventoryTheme.accent)
                                .frame(width: 48, height: 48)
                                .background(InventoryTheme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

                            VStack(alignment: .leading, spacing: 3) {
                                Text(entry.title)
                                    .font(.headline)
                                    .foregroundStyle(InventoryTheme.ink)
                                Text(entry.subtitle)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if loadingWorldMap && selectedScan?.id == entry.sourceScan.id {
                                ProgressView()
                            } else {
                                Image(systemName: "chevron.right")
                                    .font(.caption.bold())
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(15)
                        .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(.black.opacity(0.06), lineWidth: 1)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(loadingWorldMap)
                }
            }
            .padding(16)
        }
    }

    private func captureView(
        scan: SpatialRoomScanSummary,
        worldMap: LoadedSpatialWorldMap
    ) -> some View {
        ZStack {
            ItemPlacementControllerView(
                worldMapData: worldMap.data,
                roomScan: scan,
                roomCandidates: worldMap.candidates,
                captureRequest: captureRequest,
                manualRoomScanID: manualRoomScanID,
                manualRoomRequest: manualRoomRequest,
                onTracking: { message, ready in
                    guard selectionState.accepts(
                        scanID: scan.id,
                        generation: worldMap.generation
                    ) else { return }
                    trackingMessage = message
                    trackingReady = ready
                },
                onRoomChanged: { detectedScan in
                    guard selectionState.accepts(
                        scanID: scan.id,
                        generation: worldMap.generation
                    ) else { return }
                    activeRoomScan = detectedScan
                },
                onCaptured: { result in
                    guard selectionState.accepts(
                        scanID: scan.id,
                        generation: worldMap.generation
                    ) else { return }
                    capturing = false
                    switch result {
                    case .success(let payload):
                        onCapture(payload.0, payload.1)
                        dismiss()
                    case .failure(let error):
                        errorMessage = error.localizedDescription
                        if (error as? SpatialCaptureError)?.requiresRoomReselection == true {
                            resetSelection()
                        }
                    }
                }
            )
            .id(
                SpatialCaptureSessionIdentity(
                    scanID: scan.id,
                    generation: worldMap.generation
                )
            )
            .ignoresSafeArea(edges: .bottom)

            LinearGradient(
                colors: [.black.opacity(0.42), .clear, .black.opacity(0.62)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            reticle

            VStack {
                VStack(spacing: 7) {
                    Label(
                        activeRoomScan?.roomName ?? (
                            worldMap.candidates.count > 1 ? "Raum wird bestimmt" : scan.roomName
                        ),
                        systemImage: activeRoomScan == nil && worldMap.candidates.count > 1
                            ? "location.magnifyingglass"
                            : "location.fill"
                    )
                        .font(.caption.weight(.bold))
                    Text(trackingMessage)
                        .font(.caption)
                        .multilineTextAlignment(.center)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 15)
                .padding(.vertical, 10)
                .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 16))
                .padding(.top, 12)

                Spacer()

                Button {
                    capturing = true
                    captureRequest += 1
                } label: {
                    HStack(spacing: 9) {
                        if capturing {
                            ProgressView().tint(InventoryTheme.ink)
                        } else {
                            Image(systemName: "camera.fill")
                        }
                        Text(capturing ? "Position wird gemessen" : "Foto + Position erfassen")
                    }
                    .font(.headline)
                    .foregroundStyle(InventoryTheme.ink)
                    .padding(.horizontal, 22)
                    .frame(minHeight: 54)
                    .background(
                        trackingReady ? InventoryTheme.lime : Color.white.opacity(0.75),
                        in: Capsule()
                    )
                }
                .disabled(!trackingReady || capturing)
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 16)
        }
    }

    private var reticle: some View {
        ZStack {
            Circle()
                .stroke(trackingReady ? InventoryTheme.lime : .white.opacity(0.8), lineWidth: 2)
                .frame(width: 44, height: 44)
            Rectangle()
                .fill(trackingReady ? InventoryTheme.lime : .white)
                .frame(width: 18, height: 2)
            Rectangle()
                .fill(trackingReady ? InventoryTheme.lime : .white)
                .frame(width: 2, height: 18)
        }
        .shadow(color: .black.opacity(0.45), radius: 4)
        .allowsHitTesting(false)
    }

    @MainActor
    private func loadScans() async {
        guard let client = state.client else {
            loading = false
            return
        }
        do {
            scans = try await client.listRoomScans().scans
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    @MainActor
    private func startSelecting(_ entry: SpatialRoomSelectionEntry) {
        worldMapLoadTask?.cancel()
        let scan = entry.sourceScan
        let generation = selectionState.begin(scanID: scan.id)
        selectedScan = scan
        activeRoomScan = entry.scans.count == 1 ? scan : nil
        loadedWorldMap = nil
        loadingWorldMap = true
        trackingReady = false
        capturing = false
        manualRoomScanID = nil
        manualRoomRequest = 0

        worldMapLoadTask = Task { @MainActor in
            await select(entry, generation: generation)
        }
    }

    @MainActor
    private func resetSelection() {
        worldMapLoadTask?.cancel()
        worldMapLoadTask = nil
        selectionState.cancel()
        selectedScan = nil
        activeRoomScan = nil
        loadedWorldMap = nil
        loadingWorldMap = false
        trackingReady = false
        capturing = false
        manualRoomScanID = nil
        manualRoomRequest = 0
    }

    @MainActor
    private func select(
        _ entry: SpatialRoomSelectionEntry,
        generation: UUID
    ) async {
        let scan = entry.sourceScan
        guard let client = state.client else { return }
        defer {
            if selectionState.accepts(scanID: scan.id, generation: generation) {
                loadingWorldMap = false
                worldMapLoadTask = nil
            }
        }
        do {
            async let worldMapRequest = client.downloadRoomWorldMap(scanID: scan.id)
            let sourceResponse = try await client.roomScene(scanID: scan.id)
            var candidates = [
                SpatialRoomDetectionCandidate(
                    scan: scan,
                    scene: sourceResponse.scene.scan.scene
                ),
            ]
            for candidateScan in entry.scans where candidateScan.id != scan.id {
                do {
                    let response = try await client.roomScene(scanID: candidateScan.id)
                    guard candidateScan.coordinateSpaceID == scan.coordinateSpaceID ||
                            entry.scans.count == 1
                    else { continue }
                    candidates.append(
                        SpatialRoomDetectionCandidate(
                            scan: candidateScan,
                            scene: response.scene.scan.scene
                        )
                    )
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    // A single stale room must not make the shared world map unusable.
                    // It remains available through the legacy manual room flow.
                    continue
                }
            }
            let downloadedWorldMap = try await worldMapRequest
            try Task.checkCancellation()
            guard selectionState.accepts(scanID: scan.id, generation: generation),
                  selectedScan?.id == scan.id
            else {
                return
            }
            loadedWorldMap = LoadedSpatialWorldMap(
                scanID: scan.id,
                generation: generation,
                data: downloadedWorldMap,
                candidates: candidates
            )
            trackingMessage = "Zeige auf bekannte Wände oder Möbel, bis der Raum erkannt ist."
            trackingReady = false
        } catch is CancellationError {
            return
        } catch {
            guard selectionState.accepts(scanID: scan.id, generation: generation) else {
                return
            }
            loadingWorldMap = false
            worldMapLoadTask = nil
            selectionState.cancel()
            selectedScan = nil
            loadedWorldMap = nil
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func selectManualRoom(_ scanID: UUID?) {
        manualRoomScanID = scanID
        manualRoomRequest += 1
    }

    private var selectionEntries: [SpatialRoomSelectionEntry] {
        var consumedCoordinateSpaces = Set<UUID>()
        var entries: [SpatialRoomSelectionEntry] = []
        for scan in scans {
            if let coordinateSpaceID = scan.coordinateSpaceID {
                guard consumedCoordinateSpaces.insert(coordinateSpaceID).inserted else { continue }
                let grouped = scans.filter { $0.coordinateSpaceID == coordinateSpaceID }
                entries.append(SpatialRoomSelectionEntry(scans: grouped))
            } else {
                entries.append(SpatialRoomSelectionEntry(scans: [scan]))
            }
        }
        return entries
    }
}

private struct LoadedSpatialWorldMap {
    let scanID: UUID
    let generation: UUID
    let data: Data
    let candidates: [SpatialRoomDetectionCandidate]
}

private struct SpatialCaptureSessionIdentity: Hashable {
    let scanID: UUID
    let generation: UUID
}

private struct SpatialRoomSelectionEntry: Identifiable {
    let scans: [SpatialRoomScanSummary]

    var id: UUID { sourceScan.id }
    var sourceScan: SpatialRoomScanSummary { scans[0] }
    var title: String {
        if scans.count > 1 {
            return sourceScan.structureName ?? "Verbundene Räume"
        }
        return sourceScan.roomName
    }
    var subtitle: String {
        if scans.count > 1 {
            let floor = sourceScan.floorIdentifier.map { " · \($0)" } ?? ""
            return "\(scans.count) Räume\(floor) · automatische Erkennung"
        }
        return "\(sourceScan.placementCount) Gegenstände · Scan \(sourceScan.revision)"
    }
}
