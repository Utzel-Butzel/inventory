import SwiftUI

struct SpatialItemCaptureView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    let onCapture: (SpatialPlacementDraft, Data) -> Void

    @State private var scans: [SpatialRoomScanSummary] = []
    @State private var selectedScan: SpatialRoomScanSummary?
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
                        Button("Raum wechseln") {
                            resetSelection()
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
                Text("Wähle den Raum, in dem der Gegenstand gerade liegt. Die App erkennt anschließend die gespeicherte 3D-Umgebung wieder.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                ForEach(scans) { scan in
                    Button {
                        startSelecting(scan)
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "cube.transparent.fill")
                                .font(.title2)
                                .foregroundStyle(InventoryTheme.accent)
                                .frame(width: 48, height: 48)
                                .background(InventoryTheme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

                            VStack(alignment: .leading, spacing: 3) {
                                Text(scan.roomName)
                                    .font(.headline)
                                    .foregroundStyle(InventoryTheme.ink)
                                Text("\(scan.placementCount) Gegenstände · Scan \(scan.revision)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if loadingWorldMap && selectedScan?.id == scan.id {
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
                captureRequest: captureRequest,
                onTracking: { message, ready in
                    guard selectionState.accepts(
                        scanID: scan.id,
                        generation: worldMap.generation
                    ) else { return }
                    trackingMessage = message
                    trackingReady = ready
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
                    Label(scan.roomName, systemImage: "location.fill")
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
    private func startSelecting(_ scan: SpatialRoomScanSummary) {
        worldMapLoadTask?.cancel()
        let generation = selectionState.begin(scanID: scan.id)
        selectedScan = scan
        loadedWorldMap = nil
        loadingWorldMap = true
        trackingReady = false
        capturing = false

        worldMapLoadTask = Task { @MainActor in
            await select(scan, generation: generation)
        }
    }

    @MainActor
    private func resetSelection() {
        worldMapLoadTask?.cancel()
        worldMapLoadTask = nil
        selectionState.cancel()
        selectedScan = nil
        loadedWorldMap = nil
        loadingWorldMap = false
        trackingReady = false
        capturing = false
    }

    @MainActor
    private func select(
        _ scan: SpatialRoomScanSummary,
        generation: UUID
    ) async {
        guard let client = state.client else { return }
        defer {
            if selectionState.accepts(scanID: scan.id, generation: generation) {
                loadingWorldMap = false
                worldMapLoadTask = nil
            }
        }
        do {
            let downloadedWorldMap = try await client.downloadRoomWorldMap(scanID: scan.id)
            try Task.checkCancellation()
            guard selectionState.accepts(scanID: scan.id, generation: generation),
                  selectedScan?.id == scan.id
            else {
                return
            }
            loadedWorldMap = LoadedSpatialWorldMap(
                scanID: scan.id,
                generation: generation,
                data: downloadedWorldMap
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
}

private struct LoadedSpatialWorldMap {
    let scanID: UUID
    let generation: UUID
    let data: Data
}

private struct SpatialCaptureSessionIdentity: Hashable {
    let scanID: UUID
    let generation: UUID
}
