import PhotosUI
import SwiftUI
import UIKit

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
    @State private var keyframeIndexTask: Task<Void, Never>?
    @State private var photoOnlyMatchTask: Task<Void, Never>?
    @State private var photoOnlyPickerItem: PhotosPickerItem?
    @State private var photoOnlyState = SpatialPhotoOnlyLocalizationState.unavailable
    @State private var photoOnlyResult: SpatialPhotoOnlyMatchPresentation?
    @State private var showingPhotoOnlyCamera = false
    @State private var arRelocalizationUnavailable = false
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
                // UIImagePickerController temporarily covers this view. Keep
                // the selected matcher alive until its captured photo returns.
                guard !showingPhotoOnlyCamera else { return }
                worldMapLoadTask?.cancel()
                worldMapLoadTask = nil
                keyframeIndexTask?.cancel()
                keyframeIndexTask = nil
                photoOnlyMatchTask?.cancel()
                photoOnlyMatchTask = nil
                selectionState.cancel()
            }
            .onChange(of: photoOnlyPickerItem) { _, item in
                guard let item else { return }
                photoOnlyPickerItem = nil
                startPhotoOnlyLibraryMatch(item)
            }
            .fullScreenCover(isPresented: $showingPhotoOnlyCamera) {
                SpatialPhotoOnlyCameraPicker { imageData in
                    showingPhotoOnlyCamera = false
                    if let imageData {
                        startPhotoOnlyMatch(encodedData: imageData)
                    }
                }
                .ignoresSafeArea()
            }
            .sheet(item: $photoOnlyResult) { result in
                SpatialPhotoOnlyResultView(result: result)
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
            if let worldMapData = worldMap.data {
                ItemPlacementControllerView(
                    worldMapData: worldMapData,
                    roomScan: scan,
                    roomCandidates: worldMap.candidates,
                    keyframeMatcher: worldMap.keyframeMatcher,
                    captureRequest: captureRequest,
                    manualRoomScanID: manualRoomScanID,
                    manualRoomRequest: manualRoomRequest,
                    onTracking: { message, ready in
                        guard selectionState.accepts(
                            scanID: scan.id,
                            generation: worldMap.generation
                        ), !arRelocalizationUnavailable else { return }
                        trackingMessage = message
                        trackingReady = ready
                        if ready {
                            arRelocalizationUnavailable = false
                        }
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
                            if let spatialError = error as? SpatialCaptureError {
                                switch spatialError {
                                case .worldMapUnavailable, .relocalizationFailed, .sessionFailed(_):
                                    arRelocalizationUnavailable = true
                                    trackingReady = false
                                    trackingMessage = "AR-Ortung nicht verfügbar. Ordne stattdessen ein Foto grob einem Raum zu."
                                case .imageUnavailable, .placementUnavailable, .structureUnavailable:
                                    errorMessage = error.localizedDescription
                                }
                            } else {
                                errorMessage = error.localizedDescription
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
            } else {
                Color.black
                    .ignoresSafeArea(edges: .bottom)
            }

            LinearGradient(
                colors: [.black.opacity(0.42), .clear, .black.opacity(0.62)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            if worldMap.data != nil, !arRelocalizationUnavailable {
                reticle
            }

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

                if !trackingReady {
                    photoOnlyControls
                        .padding(.bottom, 12)
                }

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
                        Text(
                            capturing
                                ? "Position wird gemessen"
                                : trackingReady
                                    ? "Foto + Position erfassen"
                                    : "AR-Position nicht verfügbar"
                        )
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

    private var photoOnlyControls: some View {
        VStack(spacing: 10) {
            Label("Grobe Foto-Zuordnung", systemImage: "photo.badge.magnifyingglass")
                .font(.subheadline.weight(.bold))

            Text("Vergleicht ein neues Foto mit gespeicherten Raumansichten. Das Ergebnis ist keine Objektposition.")
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.82))

            switch photoOnlyState {
            case .unavailable:
                Text("Für diesen Bereich sind nicht genug Referenzbilder verfügbar.")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.72))
            case .indexing:
                HStack(spacing: 8) {
                    ProgressView().tint(.white)
                    Text("Referenzbilder werden vorbereitet …")
                }
                .font(.caption)
            case .matching:
                HStack(spacing: 8) {
                    ProgressView().tint(.white)
                    Text("Foto wird grob zugeordnet …")
                }
                .font(.caption)
            case .ready(let referenceCount):
                Text("Vergleich mit \(referenceCount) Referenzbildern")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.72))

                HStack(spacing: 10) {
                    Button {
                        arRelocalizationUnavailable = true
                        trackingReady = false
                        trackingMessage = "Foto wird ohne AR-Position grob zugeordnet."
                        showingPhotoOnlyCamera = true
                    } label: {
                        Label("Aufnehmen", systemImage: "camera.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(
                        !photoOnlyState.canMatch ||
                            !UIImagePickerController.isSourceTypeAvailable(.camera)
                    )

                    PhotosPicker(
                        selection: $photoOnlyPickerItem,
                        matching: .images
                    ) {
                        Label("Auswählen", systemImage: "photo.on.rectangle")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!photoOnlyState.canMatch)
                }
                .font(.caption.weight(.semibold))
                .buttonStyle(.bordered)
                .tint(.white)

                if !photoOnlyState.canMatch {
                    Text("Für einen belastbaren Vergleich sind mindestens zwei Referenzbilder nötig.")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.72))
                }
            }
        }
        .foregroundStyle(.white)
        .padding(14)
        .frame(maxWidth: 430)
        .background(.black.opacity(0.62), in: RoundedRectangle(cornerRadius: 18))
    }

    @MainActor
    private func startPhotoOnlyLibraryMatch(_ item: PhotosPickerItem) {
        guard let context = loadedWorldMap,
              let matcher = context.keyframeMatcher,
              photoOnlyState.beginMatching()
        else { return }

        arRelocalizationUnavailable = true
        trackingReady = false
        trackingMessage = "Foto wird ohne AR-Position grob zugeordnet."
        photoOnlyMatchTask?.cancel()
        let generation = context.generation
        photoOnlyMatchTask = Task { @MainActor in
            defer {
                if selectionState.accepts(
                    scanID: context.scanID,
                    generation: generation
                ) {
                    photoOnlyState.finishMatching()
                    photoOnlyMatchTask = nil
                }
            }
            do {
                guard let encodedData = try await item.loadTransferable(type: Data.self) else {
                    throw SpatialPhotoQueryError.unreadableImage
                }
                let result = try await matchPhotoOnly(
                    encodedData: encodedData,
                    context: context,
                    matcher: matcher
                )
                try Task.checkCancellation()
                guard selectionState.accepts(
                    scanID: context.scanID,
                    generation: generation
                ) else { return }
                photoOnlyResult = result
            } catch is CancellationError {
                return
            } catch {
                guard selectionState.accepts(
                    scanID: context.scanID,
                    generation: generation
                ) else { return }
                errorMessage = "Grobe Foto-Zuordnung: \(error.localizedDescription)"
            }
        }
    }

    @MainActor
    private func startPhotoOnlyMatch(encodedData: Data) {
        guard let context = loadedWorldMap,
              let matcher = context.keyframeMatcher,
              photoOnlyState.beginMatching()
        else { return }

        photoOnlyMatchTask?.cancel()
        let generation = context.generation
        photoOnlyMatchTask = Task { @MainActor in
            defer {
                if selectionState.accepts(
                    scanID: context.scanID,
                    generation: generation
                ) {
                    photoOnlyState.finishMatching()
                    photoOnlyMatchTask = nil
                }
            }
            do {
                let result = try await matchPhotoOnly(
                    encodedData: encodedData,
                    context: context,
                    matcher: matcher
                )
                try Task.checkCancellation()
                guard selectionState.accepts(
                    scanID: context.scanID,
                    generation: generation
                ) else { return }
                photoOnlyResult = result
            } catch is CancellationError {
                return
            } catch {
                guard selectionState.accepts(
                    scanID: context.scanID,
                    generation: generation
                ) else { return }
                errorMessage = "Grobe Foto-Zuordnung: \(error.localizedDescription)"
            }
        }
    }

    private func matchPhotoOnly(
        encodedData: Data,
        context: LoadedSpatialWorldMap,
        matcher: SpatialPhotoKeyframeMatcher
    ) async throws -> SpatialPhotoOnlyMatchPresentation {
        let normalizedData = try await Task.detached(priority: .userInitiated) {
            try SpatialPhotoQueryProcessor.normalizedJPEG(from: encodedData)
        }.value
        try Task.checkCancellation()
        guard let localization = await matcher.match(
            imageData: normalizedData,
            currentCameraTransform: nil,
            roomScanID: nil
        ),
            let estimate = SpatialPhotoOnlyLocalizationPolicy.estimate(
                from: localization
            )
        else {
            throw SpatialPhotoOnlyMatchError.noReliableMatch
        }
        let roomName = context.candidates.first {
            $0.scan.id == estimate.roomScanID
        }?.scan.roomName ?? "Unbekannter Raum"
        return SpatialPhotoOnlyMatchPresentation(
            roomName: roomName,
            estimate: estimate
        )
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
        keyframeIndexTask?.cancel()
        keyframeIndexTask = nil
        photoOnlyMatchTask?.cancel()
        photoOnlyMatchTask = nil
        let scan = entry.sourceScan
        let generation = selectionState.begin(scanID: scan.id)
        selectedScan = scan
        activeRoomScan = entry.scans.count == 1 ? scan : nil
        loadedWorldMap = nil
        loadingWorldMap = true
        trackingReady = false
        capturing = false
        photoOnlyPickerItem = nil
        photoOnlyResult = nil
        photoOnlyState.beginIndexing()
        showingPhotoOnlyCamera = false
        arRelocalizationUnavailable = false
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
        keyframeIndexTask?.cancel()
        keyframeIndexTask = nil
        photoOnlyMatchTask?.cancel()
        photoOnlyMatchTask = nil
        selectionState.cancel()
        selectedScan = nil
        activeRoomScan = nil
        loadedWorldMap = nil
        loadingWorldMap = false
        trackingReady = false
        capturing = false
        photoOnlyPickerItem = nil
        photoOnlyResult = nil
        photoOnlyState = .unavailable
        showingPhotoOnlyCamera = false
        arRelocalizationUnavailable = false
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
            let sourceResponse = try await client.roomScene(scanID: scan.id)
            let keyframeMatcher = SpatialPhotoKeyframeMatcher()
            var keyframeSources: [(UUID, [SpatialRoomKeyframe])] = [
                (scan.id, sourceResponse.scene.scan.keyframes ?? []),
            ]
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
                    keyframeSources.append(
                        (candidateScan.id, response.scene.scan.keyframes ?? [])
                    )
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    // A single stale room must not make the shared world map unusable.
                    // It remains available through the legacy manual room flow.
                    continue
                }
            }
            let downloadedWorldMap: Data?
            do {
                downloadedWorldMap = try await client.downloadRoomWorldMap(scanID: scan.id)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // Stored keyframes remain useful as a bounded, coarse fallback
                // even when the metric AR world map is missing or unreadable.
                downloadedWorldMap = nil
            }
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
                candidates: candidates,
                keyframeMatcher: keyframeMatcher
            )
            arRelocalizationUnavailable = downloadedWorldMap == nil
            trackingMessage = downloadedWorldMap == nil
                ? "AR-Weltkarte nicht verfügbar. Ordne stattdessen ein Foto grob einem Raum zu."
                : "Zeige auf bekannte Wände oder Möbel, bis der Raum erkannt ist."
            trackingReady = false
            keyframeIndexTask?.cancel()
            keyframeIndexTask = Task { @MainActor in
                var indexedCount = 0
                for (sourceScanID, keyframes) in keyframeSources where indexedCount < 24 {
                    guard !Task.isCancelled,
                          selectionState.accepts(scanID: scan.id, generation: generation)
                    else { return }
                    indexedCount += await indexKeyframes(
                        keyframes,
                        scanID: sourceScanID,
                        client: client,
                        matcher: keyframeMatcher,
                        maximumCount: min(8, 24 - indexedCount)
                    )
                }
                if selectionState.accepts(scanID: scan.id, generation: generation) {
                    photoOnlyState.finishIndexing(referenceCount: indexedCount)
                    keyframeIndexTask = nil
                }
            }
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
            photoOnlyState = .unavailable
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func indexKeyframes(
        _ keyframes: [SpatialRoomKeyframe],
        scanID: UUID,
        client: APIClient,
        matcher: SpatialPhotoKeyframeMatcher,
        maximumCount: Int
    ) async -> Int {
        guard maximumCount > 0 else { return 0 }
        var count = 0
        let selected = Array(keyframes
            .filter({
                ($0.mimeType == nil || $0.mimeType == "image/jpeg") &&
                    ($0.size.map { $0 <= 6 * 1_024 * 1_024 } ?? true)
            })
            .sorted(by: { $0.quality > $1.quality })
            .prefix(maximumCount))
        for batchStart in stride(from: 0, to: selected.count, by: 2) {
            let batchEnd = min(batchStart + 2, selected.count)
            let batch = Array(selected[batchStart ..< batchEnd])
            let downloaded = await withTaskGroup(
                of: SpatialRoomKeyframeReference?.self,
                returning: [SpatialRoomKeyframeReference].self
            ) { group in
                for keyframe in batch {
                    group.addTask {
                        guard let data = try? await client.downloadRoomKeyframe(
                            scanID: scanID,
                            keyframeID: keyframe.id
                        ), data.count <= 6 * 1_024 * 1_024 else { return nil }
                        return SpatialRoomKeyframeReference(
                            roomScanID: scanID,
                            metadata: keyframe,
                            imageData: data
                        )
                    }
                }
                var references: [SpatialRoomKeyframeReference] = []
                for await reference in group {
                    if let reference { references.append(reference) }
                }
                return references
            }
            if Task.isCancelled { return count }
            for reference in downloaded {
                // The actor keeps only Vision observations; JPEG Data is
                // released as soon as each feature print has been generated.
                if await matcher.add(reference) {
                    count += 1
                }
            }
        }
        return count
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
    let data: Data?
    let candidates: [SpatialRoomDetectionCandidate]
    let keyframeMatcher: SpatialPhotoKeyframeMatcher?
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

private struct SpatialPhotoOnlyMatchPresentation: Identifiable {
    var id: UUID { estimate.keyframeID }

    let roomName: String
    let estimate: SpatialPhotoOnlyEstimate
}

private enum SpatialPhotoOnlyMatchError: Error, LocalizedError {
    case noReliableMatch

    var errorDescription: String? {
        switch self {
        case .noReliableMatch:
            "Das Foto ähnelt keinem gespeicherten Referenzbild eindeutig genug. Versuche eine markante Ecke oder ein bekanntes Möbelstück."
        }
    }
}

private struct SpatialPhotoOnlyResultView: View {
    @Environment(\.dismiss) private var dismiss
    let result: SpatialPhotoOnlyMatchPresentation

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Label("Grobe Zuordnung", systemImage: "location.magnifyingglass")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(InventoryTheme.accent)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Wahrscheinlicher Raum")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(result.roomName)
                            .font(.title3.weight(.semibold))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Pose der gespeicherten Referenzkamera")
                            .font(.headline)
                        Text(referencePositionText)
                            .font(.body.monospacedDigit())
                        Text("Ähnlichkeits-Konfidenz \(result.estimate.confidence, format: .percent.precision(.fractionLength(0)))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        DisclosureGroup("Gespeicherte 4×4-Pose") {
                            Text(referenceTransformText)
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .padding(.top, 8)
                        }
                        .font(.subheadline)
                    }
                    .padding(16)
                    .background(
                        InventoryTheme.canvas,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )

                    Label {
                        Text("Diese Pose gehört zum ähnlichsten gespeicherten Schlüsselbild. Sie ist nur eine grobe Ortsreferenz: Die Aufnahme berechnet keine neue präzise 6DoF-Pose und keine Position des Gegenstands. Das Ergebnis wird deshalb nicht als Inventar-Placement gespeichert.")
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                    .font(.footnote)
                }
                .padding(20)
            }
            .navigationTitle("Foto zuordnen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var referencePositionText: String {
        let position = result.estimate.referenceCameraPosition
        return String(
            format: "x %.2f m · y %.2f m · z %.2f m",
            position[0],
            position[1],
            position[2]
        )
    }

    private var referenceTransformText: String {
        let transform = result.estimate.referenceCameraTransform
        return (0 ..< 4).map { row in
            (0 ..< 4).map { column in
                String(format: "% .3f", transform[column * 4 + row])
            }.joined(separator: "  ")
        }.joined(separator: "\n")
    }
}

private struct SpatialPhotoOnlyCameraPicker: UIViewControllerRepresentable {
    let onComplete: @MainActor (Data?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onComplete: onComplete)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.cameraCaptureMode = .photo
        controller.allowsEditing = false
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(
        _ uiViewController: UIImagePickerController,
        context: Context
    ) {}

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate,
        UINavigationControllerDelegate {
        private let onComplete: @MainActor (Data?) -> Void

        init(onComplete: @escaping @MainActor (Data?) -> Void) {
            self.onComplete = onComplete
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onComplete(nil)
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            let imageData = (info[.originalImage] as? UIImage)?
                .jpegData(compressionQuality: 0.9)
            onComplete(imageData)
        }
    }
}
