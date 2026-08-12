import RoomPlan
import SwiftUI

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
            .background(InventoryTheme.canvas)
            .navigationTitle("3D-Räume")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        presentation = RoomScanPresentation(existingScan: nil)
                    } label: {
                        Image(systemName: "plus.viewfinder")
                    }
                    .disabled(!RoomCaptureSession.isSupported)
                    .accessibilityLabel("Raum scannen")
                }
            }
            .refreshable { await loadScans() }
            .task(id: state.client?.serverURL) { await loadScans() }
            .sheet(item: $presentation) { presentation in
                RoomScanFlowView(existingScan: presentation.existingScan) {
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
                    ? "Zeichne einen Raum einmal mit LiDAR auf. Danach können Gegenstände darin räumlich positioniert werden."
                    : "Dieses iPhone unterstützt RoomPlan nicht. Dafür ist ein LiDAR-fähiges iPhone erforderlich."
            )
        } actions: {
            if RoomCaptureSession.isSupported {
                Button("Ersten Raum scannen") {
                    presentation = RoomScanPresentation(existingScan: nil)
                }
                .buttonStyle(.borderedProminent)
                .tint(InventoryTheme.accent)
            }
        }
        .padding(24)
    }

    private var roomList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(scans) { scan in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 12) {
                            Image(systemName: "cube.transparent.fill")
                                .font(.title2)
                                .foregroundStyle(InventoryTheme.accent)
                                .frame(width: 48, height: 48)
                                .background(InventoryTheme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

                            VStack(alignment: .leading, spacing: 3) {
                                Text(scan.roomName)
                                    .font(.headline)
                                    .foregroundStyle(InventoryTheme.ink)
                                Text("Revision \(scan.revision) · \(scan.placementCount) platzierte Gegenstände")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }

                        HStack {
                            Label(
                                scan.capturedAt.formatted(date: .abbreviated, time: .shortened),
                                systemImage: "clock"
                            )
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                            Spacer()

                            Button("Neu scannen") {
                                presentation = RoomScanPresentation(existingScan: scan)
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(!RoomCaptureSession.isSupported)
                        }
                    }
                    .padding(16)
                    .background(.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(.black.opacity(0.06), lineWidth: 1)
                    }
                }
            }
            .padding(16)
            .padding(.bottom, 90)
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
    let existingScan: SpatialRoomScanSummary?
}

private struct RoomScanFlowView: View {
    enum Phase {
        case details
        case scanning
        case processing
        case uploading
        case complete
    }

    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    let existingScan: SpatialRoomScanSummary?
    let onSaved: () -> Void

    @State private var roomName: String
    @State private var phase: Phase = .details
    @State private var finishRequest = 0
    @State private var hint = "Bewege das iPhone langsam entlang aller Wände und Möbel."
    @State private var draft: SpatialRoomScanDraft?
    @State private var createdRoomResourceID: UUID?
    @State private var errorMessage: String?
    @State private var scanSessionID = UUID()
    @State private var uploadTask: Task<Void, Never>?

    init(existingScan: SpatialRoomScanSummary?, onSaved: @escaping () -> Void) {
        self.existingScan = existingScan
        self.onSaved = onSaved
        _roomName = State(initialValue: existingScan?.roomName ?? "")
    }

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .details:
                    details
                case .scanning, .processing:
                    scanner
                case .uploading:
                    statusView(
                        icon: "icloud.and.arrow.up.fill",
                        title: "Raum wird übertragen",
                        message: "3D-Modell und Weltkarte werden sicher in Inventory gespeichert.",
                        progress: true
                    )
                case .complete:
                    statusView(
                        icon: "checkmark.seal.fill",
                        title: "3D-Raum ist verfügbar",
                        message: "Du kannst jetzt Inventargegenstände mit der AR-Kamera in diesem Raum platzieren.",
                        progress: false
                    )
                }
            }
            .navigationTitle(existingScan == nil ? "Raum scannen" : "Raum neu scannen")
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
                if draft != nil {
                    Button("Upload erneut versuchen") {
                        startUpload()
                    }
                }
                Button("Schließen", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private var details: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "cube.transparent")
                .font(.system(size: 52, weight: .medium))
                .foregroundStyle(InventoryTheme.accent)
                .frame(width: 96, height: 96)
                .background(InventoryTheme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 28))

            VStack(spacing: 8) {
                Text(existingScan == nil ? "Wie heißt der Raum?" : "Neuen Stand aufnehmen")
                    .font(.title2.bold())
                    .foregroundStyle(InventoryTheme.ink)
                Text(
                    existingScan == nil
                        ? "Der Name erscheint später auch im 3D-Modell der Web-App."
                        : "Vorhandene Platzierungen bleiben am alten Scan und müssen danach neu bestätigt werden."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            }

            TextField("Zum Beispiel Werkstatt", text: $roomName)
                .textInputAutocapitalization(.words)
                .padding(14)
                .background(.white, in: RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14).stroke(.black.opacity(0.08))
                }

            Button {
                phase = .scanning
            } label: {
                Label("3D-Scan starten", systemImage: "viewfinder")
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(InventoryTheme.accent)
            .disabled(roomName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Spacer()
        }
        .padding(24)
        .background(InventoryTheme.canvas)
    }

    private var scanner: some View {
        ZStack {
            RoomCaptureControllerView(
                finishRequest: finishRequest,
                onHint: { hint = $0 },
                onProcessing: {
                    phase = .processing
                    hint = "Raummodell und Weltkarte werden erzeugt …"
                },
                onResult: { result in
                    switch result {
                    case .success(let scanDraft):
                        draft = scanDraft
                        startUpload()
                    case .failure(let error):
                        finishRequest = 0
                        scanSessionID = UUID()
                        phase = .scanning
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
                Text(hint)
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(.black.opacity(0.46), in: Capsule())
                    .padding(.top, 12)

                Spacer()

                Button {
                    finishRequest += 1
                } label: {
                    HStack(spacing: 8) {
                        if phase == .processing {
                            ProgressView().tint(InventoryTheme.ink)
                        } else {
                            Image(systemName: "checkmark")
                        }
                        Text(phase == .processing ? "Wird verarbeitet" : "Scan abschließen")
                    }
                    .font(.headline)
                    .foregroundStyle(InventoryTheme.ink)
                    .padding(.horizontal, 22)
                    .frame(minHeight: 52)
                    .background(InventoryTheme.lime, in: Capsule())
                }
                .disabled(phase == .processing)
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
                .foregroundStyle(progress ? InventoryTheme.accent : InventoryTheme.success)
            Text(title)
                .font(.title2.bold())
                .foregroundStyle(InventoryTheme.ink)
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
                    .tint(InventoryTheme.accent)
                    .padding(.top, 8)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(InventoryTheme.canvas)
    }

    @MainActor
    private func uploadDraft() async {
        guard let draft, let client = state.client else { return }
        phase = .uploading
        do {
            let roomResourceID: UUID
            if let existingScan {
                roomResourceID = existingScan.roomResourceID
            } else if let createdRoomResourceID {
                roomResourceID = createdRoomResourceID
            } else {
                let normalizedName = roomName.trimmingCharacters(in: .whitespacesAndNewlines)
                let room = try await client.createResource(
                    ResourceCreateRequest(
                        name: normalizedName,
                        description: "Mit RoomPlan erfasster 3D-Raum.",
                        type: .place,
                        location: normalizedName
                    ),
                    idempotencyKey: draft.id
                )
                createdRoomResourceID = room.id
                roomResourceID = room.id
            }
            _ = try await client.uploadRoomScan(draft, roomResourceID: roomResourceID)
            draft.removeLocalArtifacts()
            self.draft = nil
            phase = .complete
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            phase = .details
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func startUpload() {
        uploadTask?.cancel()
        uploadTask = Task { await uploadDraft() }
    }

    @MainActor
    private func discardAndDismiss() {
        uploadTask?.cancel()
        uploadTask = nil
        draft?.removeLocalArtifacts()
        draft = nil
        dismiss()
    }
}
