import PhotosUI
import SwiftUI
import UIKit

enum CameraMode: String, CaseIterable, Identifiable, Sendable {
    case capture
    case scan
    case count

    var id: String { rawValue }

    var title: String {
        switch self {
        case .capture: "Erfassen"
        case .scan: "Scannen"
        case .count: "Zählen"
        }
    }

    var navigationTitle: String {
        switch self {
        case .capture: "Inventar erfassen"
        case .scan: "QR & Barcode"
        case .count: "Teile per Foto zählen"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .capture: "Inventar mit Fotos erfassen"
        case .scan: "QR- oder Barcode scannen"
        case .count: "Teile per Foto zählen"
        }
    }
}

private enum CameraPhotoRequest: Equatable {
    case capture(UUID, cropAspectRatio: CGFloat)
    case count(UUID, cropAspectRatio: CGFloat)

    var cropAspectRatio: CGFloat {
        switch self {
        case .capture(_, let cropAspectRatio), .count(_, let cropAspectRatio):
            cropAspectRatio
        }
    }
}

struct UnifiedCameraView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var camera = CameraService()
    @StateObject private var captureModel = CaptureViewModel()
    @StateObject private var countModel: StockCountViewModel

    @State private var mode: CameraMode
    @State private var countResource: InventoryResource?
    @State private var pendingPhotoRequest: CameraPhotoRequest?
    @State private var shutterFlash = false
    @State private var isPinchingZoom = false

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCaptureDetails = false
    @State private var detailsDetent: PresentationDetent = .medium
    @State private var showSpatialCapture = false

    @State private var manualCode = ""
    @State private var lastCode: String?
    @State private var isResolvingCode = false
    @State private var foundResource: InventoryResource?
    @State private var unmatchedCode: String?
    @State private var showCreateForm = false
    @State private var scannerErrorMessage: String?
    @State private var lookupTask: Task<Void, Never>?
    @State private var lookupRequestID: UUID?
    @State private var activeCodePurpose: CodePurpose?
    @State private var confirmIssue = false

    private let onClose: (() -> Void)?
    private let onSubmit: (IntakeSubmission) -> Void
    private let onCountApplied: ((InventoryResource) -> Void)?

    init(
        initialMode: CameraMode,
        initialCountResource: InventoryResource? = nil,
        onClose: (() -> Void)? = nil,
        onSubmit: @escaping (IntakeSubmission) -> Void,
        onCountApplied: ((InventoryResource) -> Void)? = nil
    ) {
        _mode = State(initialValue: initialMode)
        _countResource = State(initialValue: initialCountResource)
        _countModel = StateObject(
            wrappedValue: StockCountViewModel(
                itemHint: initialCountResource?.name ?? "",
                itemID: initialCountResource?.id
            )
        )
        self.onClose = onClose
        self.onSubmit = onSubmit
        self.onCountApplied = onCountApplied
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                cameraViewport

                VStack(spacing: 0) {
                    cameraTopBar
                        .padding(.horizontal, 16)
                        .padding(.top, geometry.safeAreaInsets.top + 8)

                    if mode == .capture, !captureModel.photos.isEmpty {
                        captureQuickBar
                            .padding(.horizontal, 16)
                            .padding(.top, 10)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    Spacer(minLength: 12)

                    cameraControlDeck(
                        viewportAspectRatio: max(
                            0.1,
                            geometry.size.width / max(1, geometry.size.height)
                        )
                    )
                    .padding(.bottom, max(8, geometry.safeAreaInsets.bottom))
                }
                .animation(.easeInOut(duration: 0.2), value: captureModel.photos.count)
            }
            .background(.black)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .simultaneousGesture(
                cameraDetailsSwipe(viewHeight: geometry.size.height)
            )
        }
        .statusBarHidden()
        .interactiveDismissDisabled(countModel.phase == .booking)
        .onAppear(perform: configureCamera)
        .task {
            if let client = state.client {
                await countModel.loadCountModels(using: client)
            }
        }
        .onDisappear(perform: tearDown)
        .onChange(of: mode) { _, _ in
            lastCode = nil
            configureMode()
        }
        .onChange(of: pickerItems) { _, items in
            captureModel.addPickerItems(items)
            pickerItems = []
        }
        .onChange(of: state.pendingCaptureCode) { _, code in
            guard let code else { return }
            state.pendingCaptureCode = nil
            captureModel.applyScannedCode(code)
            mode = .capture
        }
        .onChange(of: state.pendingScanCode) { _, code in
            guard let code else { return }
            state.pendingScanCode = nil
            mode = .scan
            resolve(code, purpose: .inventoryLookup)
        }
        .sheet(isPresented: $showCaptureDetails) {
            cameraDetailsSheet
                .presentationDetents([.medium, .large], selection: $detailsDetent)
                .presentationDragIndicator(.visible)
                .presentationBackground(.regularMaterial)
        }
        .sheet(item: $foundResource, onDismiss: resumeScanningIfNeeded) { resource in
            NavigationStack { ResourceDetailView(resource: resource) }
        }
        .sheet(isPresented: $showCreateForm, onDismiss: resumeScanningIfNeeded) {
            ResourceFormView(
                resource: nil,
                prefilledCode: unmatchedCode,
                onSaved: { resource in
                    showCreateForm = false
                    unmatchedCode = nil
                    foundResource = resource
                }
            )
        }
        .fullScreenCover(
            isPresented: $showSpatialCapture,
            onDismiss: {
                configureCamera()
            }
        ) {
            SpatialItemCaptureView { placement, imageData in
                captureModel.applySpatialPlacement(placement)
                captureModel.addCapturedData(imageData)
            }
            .environmentObject(state)
        }
        .confirmationDialog(
            "Gezählte Teile entnehmen?",
            isPresented: $confirmIssue,
            titleVisibility: .visible
        ) {
            Button(
                "\(countModel.adjustedCount) Teile entnehmen",
                role: .destructive
            ) {
                applyCount(.issue)
            }
            Button("Abbrechen", role: .cancel) { }
        } message: {
            if let resource = countResource {
                Text(
                    "Der Bestand wird von \(resource.quantity) auf "
                        + "\(max(0, resource.quantity - countModel.adjustedCount)) reduziert."
                )
            }
        }
        .alert(
            "Foto konnte nicht verarbeitet werden",
            isPresented: Binding(
                get: { captureModel.errorMessage != nil },
                set: { if !$0 { captureModel.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { captureModel.errorMessage = nil }
        } message: {
            Text(captureModel.errorMessage ?? "Unbekannter Fehler")
        }
        .alert(
            "Code konnte nicht verarbeitet werden",
            isPresented: Binding(
                get: { scannerErrorMessage != nil },
                set: {
                    if !$0 {
                        scannerErrorMessage = nil
                        resumeScanningIfNeeded()
                    }
                }
            )
        ) {
            Button("Noch einmal", role: .cancel) {
                scannerErrorMessage = nil
                resumeScanningIfNeeded()
            }
        } message: {
            Text(scannerErrorMessage ?? "Unbekannter Fehler")
        }
        .alert(
            "Aktion fehlgeschlagen",
            isPresented: Binding(
                get: { countModel.errorMessage != nil },
                set: { if !$0 { countModel.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { countModel.errorMessage = nil }
        } message: {
            Text(countModel.errorMessage ?? "Unbekannter Fehler")
        }
    }

    private var cameraViewport: some View {
        ZStack {
            Color.black

            CameraPreview(camera: camera)
                .opacity(showingCountPhoto ? 0 : 1)

            if mode == .count, let photoURL = countModel.photoURL {
                StockCountPhotoPreview(
                    url: photoURL,
                    markers: countModel.result?.markers ?? [],
                    contentMode: .fill
                )
            }

            Color.white.opacity(shutterFlash ? 0.72 : 0)

            LinearGradient(
                colors: [.black.opacity(0.36), .clear, .black.opacity(0.52)],
                startPoint: .top,
                endPoint: .bottom
            )

            if showsScanGuide {
                GeometryReader { geometry in
                    let edge = scanGuideEdge(in: geometry.size)
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .stroke(
                            InventoryTheme.lime,
                            style: StrokeStyle(lineWidth: 3, dash: [18, 9])
                        )
                        .frame(width: edge, height: edge)
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                        .shadow(color: .black.opacity(0.25), radius: 8)
                }
            }

            if countModel.isAnalyzing, mode == .count {
                VStack(spacing: 12) {
                    ProgressView().tint(.white).controlSize(.large)
                    Text(
                        countModel.phase == .preparingPhoto
                            ? "Foto wird vorbereitet …"
                            : "Teile werden gezählt …"
                    )
                    .font(.headline)
                }
                .foregroundStyle(.white)
                .padding(24)
                .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 20))
            } else if isResolvingCode, showsScanGuide {
                ProgressView()
                    .tint(InventoryTheme.lime)
                    .scaleEffect(1.3)
                    .padding(18)
                    .background(.black.opacity(0.52), in: Circle())
            } else if camera.state == .denied {
                permissionOverlay
            } else if case .unavailable(let message) = camera.state {
                unavailableOverlay(message)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .simultaneousGesture(cameraModeSwipe)
        .simultaneousGesture(cameraZoomGesture)
    }

    private var cameraTopBar: some View {
        HStack(spacing: 10) {
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.48), in: Circle())
            }
            .foregroundStyle(.white)
            .disabled(countModel.phase == .booking)
            .accessibilityLabel("Kamera schließen")

            Spacer()

            Button {
                openCaptureDetails()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "chevron.up")
                    Text("Details")
                    if let detailsBadgeText {
                        Text(detailsBadgeText)
                            .font(.caption2.monospacedDigit().bold())
                            .foregroundStyle(.black)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(.white, in: Capsule())
                    }
                }
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .frame(height: 44)
                .background(.black.opacity(0.48), in: Capsule())
            }
            .foregroundStyle(.white)
            .accessibilityLabel("Details öffnen")

            if !showingCountPhoto {
                Button { camera.toggleTorch() } label: {
                    Image(
                        systemName: camera.torchEnabled
                            ? "flashlight.on.fill"
                            : "flashlight.off.fill"
                    )
                    .frame(width: 42, height: 42)
                    .background(.black.opacity(0.4), in: Circle())
                }
                .foregroundStyle(camera.torchEnabled ? InventoryTheme.lime : .white)
                .disabled(!camera.torchAvailable)
                .opacity(camera.torchAvailable ? 1 : 0.45)
            }
        }
    }

    private var captureQuickBar: some View {
        HStack(spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(captureModel.photos) { photo in
                        Button(action: openCaptureDetails) {
                            LocalThumbnail(url: photo.fileURL, size: 48)
                                .clipShape(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                )
                                .overlay {
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .stroke(.white.opacity(0.55), lineWidth: 1)
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Aufgenommenes Foto anzeigen")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: submitCapture) {
                Image(systemName: "arrow.up")
                    .font(.headline.bold())
                    .foregroundStyle(InventoryTheme.ink)
                    .frame(width: 48, height: 48)
                    .background(InventoryTheme.lime, in: Circle())
                    .overlay {
                        Circle().stroke(.white.opacity(0.35), lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            .disabled(!captureModel.canSubmit || captureModel.processingCount > 0)
            .opacity(captureModel.processingCount == 0 ? 1 : 0.55)
            .accessibilityLabel("Inventar hochladen")
            .accessibilityHint(
                "Lädt \(captureModel.photos.count) aufgenommene Fotos hoch"
            )
        }
        .frame(height: 48)
    }

    private func cameraControlDeck(viewportAspectRatio: CGFloat) -> some View {
        VStack(spacing: 14) {
            if !showingCountPhoto {
                zoomSelector
            }

            cameraBottomControls(viewportAspectRatio: viewportAspectRatio)
                .frame(minHeight: 88)

            CameraModeBar(selection: $mode)
                .disabled(countModel.phase == .booking)
                .opacity(countModel.phase == .booking ? 0.65 : 1)
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .background(
            LinearGradient(
                colors: [.clear, .black.opacity(0.48), .black.opacity(0.78)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        )
    }

    private var zoomSelector: some View {
        HStack(spacing: 12) {
            ForEach(camera.zoomPresets) { preset in
                let selected = abs(camera.selectedZoomFactor - preset.displayFactor) < 0.05
                Button {
                    camera.selectZoom(preset)
                } label: {
                    Text(preset.label)
                        .font(.subheadline.monospacedDigit().weight(.semibold))
                        .foregroundStyle(selected ? .yellow : .white)
                        .frame(width: selected ? 46 : 34, height: selected ? 46 : 34)
                        .background(
                            selected ? Color.black.opacity(0.52) : Color.black.opacity(0.22),
                            in: Circle()
                        )
                        .frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Zoom \(preset.label)")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity, minHeight: 48)
        .animation(.easeInOut(duration: 0.16), value: camera.selectedZoomFactor)
    }

    @ViewBuilder
    private func cameraBottomControls(viewportAspectRatio: CGFloat) -> some View {
        switch mode {
        case .capture:
            HStack {
                PhotosPicker(
                    selection: $pickerItems,
                    maxSelectionCount: CaptureViewModel.maximumPhotos - captureModel.photos.count,
                    matching: .images
                ) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.title3)
                        .frame(width: 52, height: 52)
                        .background(.black.opacity(0.4), in: Circle())
                }
                .foregroundStyle(.white)
                .disabled(captureModel.photos.count >= CaptureViewModel.maximumPhotos)

                Spacer()
                shutterButton(accessibilityLabel: "Inventarfoto aufnehmen") {
                    requestPhoto(
                        for: .capture(
                            UUID(),
                            cropAspectRatio: viewportAspectRatio
                        )
                    )
                }
                .disabled(
                    camera.state != .ready
                        || pendingPhotoRequest != nil
                        || captureModel.photos.count >= CaptureViewModel.maximumPhotos
                )
                Spacer()
                cameraSwitchButton
            }

        case .scan:
            HStack {
                Color.clear.frame(width: 52, height: 52)
                Spacer()
                Image(systemName: "viewfinder")
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(InventoryTheme.lime)
                    .frame(width: 82, height: 82)
                    .background(.black.opacity(0.4), in: Circle())
                    .accessibilityLabel("Code wird automatisch gescannt")
                Spacer()
                cameraSwitchButton
            }

        case .count:
            HStack {
                Color.clear.frame(width: 52, height: 52)
                Spacer()
                if !state.canUseAI {
                    Label("KI fehlt", systemImage: "lock.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(.black.opacity(0.56), in: Capsule())
                } else if countResource == nil {
                    Image(systemName: "viewfinder")
                        .font(.system(size: 34, weight: .light))
                        .foregroundStyle(InventoryTheme.lime)
                        .frame(width: 82, height: 82)
                        .background(.black.opacity(0.4), in: Circle())
                        .accessibilityLabel("Artikelcode scannen")
                } else if countModel.photoURL == nil, !countModel.isAnalyzing {
                    shutterButton(accessibilityLabel: "Foto aufnehmen und Teile zählen") {
                        requestPhoto(
                            for: .count(
                                UUID(),
                                cropAspectRatio: viewportAspectRatio
                            )
                        )
                    }
                    .disabled(camera.state != .ready || pendingPhotoRequest != nil)
                } else if countModel.result != nil {
                    Button {
                        countModel.retake()
                        configureMode()
                    } label: {
                        Label("Neues Foto", systemImage: "camera.rotate")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(.black.opacity(0.56), in: Capsule())
                    }
                    .foregroundStyle(.white)
                } else if countModel.photoURL != nil, !countModel.isAnalyzing {
                    Button {
                        guard let client = state.client else {
                            countModel.errorMessage = "Keine Verbindung zum Inventarserver."
                            return
                        }
                        countModel.retryAnalysis(using: client)
                    } label: {
                        Label("Erneut zählen", systemImage: "arrow.clockwise")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(.black.opacity(0.56), in: Capsule())
                    }
                    .foregroundStyle(.white)
                } else {
                    ProgressView().tint(.white).controlSize(.large)
                }
                Spacer()
                cameraSwitchButton
            }
        }
    }

    private var cameraSwitchButton: some View {
        Button { camera.switchCamera() } label: {
            Group {
                if camera.isSwitchingCamera {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "arrow.triangle.2.circlepath.camera.fill")
                        .font(.title3)
                }
            }
            .frame(width: 52, height: 52)
            .background(.black.opacity(0.48), in: Circle())
        }
        .foregroundStyle(.white)
        .disabled(!camera.canSwitchCamera || camera.isSwitchingCamera)
        .opacity(camera.canSwitchCamera ? 1 : 0.45)
        .accessibilityLabel("Kamera wechseln")
    }

    private func shutterButton(
        accessibilityLabel: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ZStack {
                Circle().fill(.white).frame(width: 72, height: 72)
                Circle()
                    .stroke(.white.opacity(0.58), lineWidth: 3)
                    .frame(width: 84, height: 84)
            }
        }
        .accessibilityLabel(accessibilityLabel)
    }

    private var scannerDetails: some View {
        VStack(spacing: 16) {
            if let code = unmatchedCode {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Noch nicht im Inventar", systemImage: "questionmark.app.dashed")
                        .font(.headline)
                    Text(code)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                    Button {
                        captureModel.applyScannedCode(code)
                        unmatchedCode = nil
                        mode = .capture
                    } label: {
                        Label("Mit Fotos erfassen", systemImage: "camera.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(InventoryTheme.ink)

                    Button {
                        camera.scanningEnabled = false
                        camera.stop()
                        showCreateForm = true
                    } label: {
                        Label("Nur Stammdaten anlegen", systemImage: "doc.badge.plus")
                            .frame(maxWidth: .infinity, minHeight: 42)
                    }
                    .buttonStyle(.bordered)

                    Button("Anderen Code scannen") {
                        unmatchedCode = nil
                        resumeScanningIfNeeded()
                    }
                    .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .inventoryCard()
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Code manuell eingeben")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                HStack {
                    TextField("UUID, SKU oder Seriennummer", text: $manualCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .onSubmit { resolve(manualCode, purpose: .inventoryLookup) }
                    Button {
                        resolve(manualCode, purpose: .inventoryLookup)
                    } label: {
                        Image(systemName: "arrow.right.circle.fill").font(.title2)
                    }
                    .disabled(manualCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(12)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            }
            .inventoryCard()
        }
    }

    @ViewBuilder
    private var countDetails: some View {
        if !state.canUseAI {
            VStack(alignment: .leading, spacing: 10) {
                Label("Fotozählung nicht verfügbar", systemImage: "lock.fill")
                    .font(.headline)
                Text("Die Fotozählung benötigt die KI-Berechtigung für dieses Konto. Erfassen und Scannen stehen weiterhin zur Verfügung.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .inventoryCard()
        } else if let resource = countResource {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 7) {
                    Label(resource.name, systemImage: "shippingbox.fill")
                        .font(.headline)
                    Text("Lege alle Teile gut sichtbar und möglichst ohne Überlappungen aus. Die erkannte Anzahl kann vor der Buchung korrigiert werden.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .inventoryCard()

                countHintField
                countModelPicker

                if let result = countModel.result {
                    countResultCard(result)
                    countActionCard(resource: resource)
                } else if countModel.photoURL != nil, !countModel.isAnalyzing {
                    countRetryCard
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Label("Artikel zum Zählen wählen", systemImage: "shippingbox.fill")
                    .font(.headline)
                Text("Scanne den QR- oder Barcode des Inventarartikels oder gib den Code ein.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                HStack {
                    TextField("UUID, SKU oder Seriennummer", text: $manualCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .onSubmit { resolve(manualCode, purpose: .countTarget) }
                    Button {
                        resolve(manualCode, purpose: .countTarget)
                    } label: {
                        Image(systemName: "arrow.right.circle.fill").font(.title2)
                    }
                    .disabled(manualCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(12)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            }
            .inventoryCard()
        }
    }

    private var countHintField: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("Was soll gezählt werden?")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(
                    "\(countModel.itemHint.utf16.count)/"
                        + "\(StockCountViewModel.maximumItemHintUTF16Length)"
                )
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.tertiary)
            }
            TextField("z. B. rote 3D-Druckteile", text: $countModel.itemHint)
                .textInputAutocapitalization(.sentences)
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
                .disabled(countModel.isBusy || countModel.result != nil)
        }
        .inventoryCard()
    }

    private var countModelPicker: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Zählmodell")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Picker("Zählmodell", selection: $countModel.selectedCountModelID) {
                ForEach(countModel.countModels) { option in
                    Text(option.label).tag(option.id)
                }
            }
            .pickerStyle(.menu)
            .disabled(countModel.isBusy || countModel.result != nil)
            if let selected = countModel.countModels.first(where: {
                $0.id == countModel.selectedCountModelID
            }) {
                Text(selected.description)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .inventoryCard()
    }

    private func countResultCard(_ result: ObjectCountResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Erkannte Anzahl").font(.headline)
                    if !result.detectedItem.isEmpty {
                        Text(result.detectedItem)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Label(
                    result.isExact ? "Eindeutig" : "Bitte prüfen",
                    systemImage: result.isExact
                        ? "checkmark.seal.fill"
                        : "exclamationmark.triangle.fill"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(result.isExact ? InventoryTheme.success : InventoryTheme.warning)
            }

            HStack(spacing: 16) {
                TextField("Anzahl", value: $countModel.adjustedCount, format: .number)
                    .keyboardType(.numberPad)
                    .font(.system(size: 42, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, minHeight: 72)
                    .background(
                        InventoryTheme.lime.opacity(0.62),
                        in: RoundedRectangle(cornerRadius: 16)
                    )
                Stepper(
                    "Anzahl korrigieren",
                    value: $countModel.adjustedCount,
                    in: 0 ... StockCountViewModel.maximumCount
                )
                .labelsHidden()
            }

            HStack {
                Text("Konfidenz")
                Spacer()
                Text(result.confidence.formatted(.percent.precision(.fractionLength(0))))
                    .monospacedDigit()
            }
            .font(.caption.weight(.semibold))
            ProgressView(value: min(max(result.confidence, 0), 1))
                .tint(result.isExact ? InventoryTheme.success : InventoryTheme.warning)

            if !result.explanation.isEmpty {
                Text(result.explanation)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, warning in
                Label(warning, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(InventoryTheme.warning)
            }
        }
        .inventoryCard()
    }

    private func countActionCard(resource: InventoryResource) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Bestand ändern", systemImage: "arrow.left.arrow.right")
                    .font(.headline)
                Spacer()
                Text("Aktuell: \(resource.quantity)")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
            }

            if countModel.adjustedCount > resource.quantity {
                Label(
                    "Für eine Entnahme sind nur \(resource.quantity) Einheiten verfügbar.",
                    systemImage: "exclamationmark.circle"
                )
                .font(.caption)
                .foregroundStyle(InventoryTheme.warning)
            }

            HStack(spacing: 10) {
                Button {
                    confirmIssue = true
                } label: {
                    VStack(spacing: 4) {
                        Label("Entnehmen", systemImage: "minus.circle.fill")
                        Text("danach \(max(0, resource.quantity - countModel.adjustedCount))")
                            .font(.caption.monospacedDigit())
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.bordered)
                .disabled(!countModel.canApplyIssue(currentQuantity: resource.quantity))

                Button {
                    applyCount(.receipt)
                } label: {
                    VStack(spacing: 4) {
                        Label("Hinzufügen", systemImage: "plus.circle.fill")
                        Text("danach \(resource.quantity + countModel.adjustedCount)")
                            .font(.caption.monospacedDigit())
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
                .tint(InventoryTheme.ink)
                .disabled(!countModel.canApplyReceipt)
            }

            if countModel.phase == .booking {
                ProgressView("Bestand wird gebucht …")
                    .frame(maxWidth: .infinity)
            }
        }
        .inventoryCard()
    }

    private var countRetryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Das Foto ist bereit, konnte aber noch nicht ausgewertet werden.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack {
                Button("Neues Foto") {
                    countModel.retake()
                    configureMode()
                }
                .buttonStyle(.bordered)
                Spacer()
                Button("Erneut zählen") {
                    guard let client = state.client else {
                        countModel.errorMessage = "Keine Verbindung zum Inventarserver."
                        return
                    }
                    countModel.retryAnalysis(using: client)
                }
                .buttonStyle(.borderedProminent)
                .tint(InventoryTheme.ink)
            }
        }
        .inventoryCard()
    }

    private var cameraDetailsSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    switch mode {
                    case .capture:
                        capturePhotoTray
                        captureOptions
                        captureUploadAction
                    case .scan:
                        scannerDetails
                    case .count:
                        countDetails
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 30)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(InventoryTheme.canvas)
            .navigationTitle(mode.navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { showCaptureDetails = false }
                }
            }
        }
    }

    private var captureUploadAction: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: submitCapture) {
                HStack(spacing: 8) {
                    if captureModel.processingCount > 0 {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                    }
                    Text("Inventar hochladen")
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(InventoryTheme.ink)
            .disabled(!captureModel.canSubmit || captureModel.processingCount > 0)

            Text(
                captureModel.photos.isEmpty
                    ? "Nimm mindestens ein Foto auf."
                    : "\(captureModel.photos.count) von \(CaptureViewModel.maximumPhotos) Fotos bereit"
            )
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .inventoryCard()
    }

    @ViewBuilder
    private var capturePhotoTray: some View {
        if !captureModel.photos.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(captureModel.photos) { photo in
                        ZStack(alignment: .topTrailing) {
                            LocalThumbnail(url: photo.fileURL)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            Button {
                                captureModel.removePhoto(photo)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.caption.bold())
                                    .frame(width: 25, height: 25)
                                    .background(.black.opacity(0.7), in: Circle())
                                    .foregroundStyle(.white)
                            }
                            .offset(x: 5, y: -5)
                        }
                        .padding(.top, 5)
                    }
                }
                .padding(.horizontal, 2)
            }
        }
    }

    private var captureOptions: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 7) {
                Text("Name (optional)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                TextField("Wird sonst aus Fotos erkannt", text: $captureModel.name)
                    .textInputAutocapitalization(.sentences)
                    .padding(13)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            }

            HStack(spacing: 12) {
                Picker("Typ", selection: $captureModel.resourceType) {
                    ForEach(InventoryResourceType.allCases, id: \.self) { type in
                        Text(type.localizedName).tag(type)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

                Button {
                    captureModel.locationService.requestCurrentLocation()
                } label: {
                    Label(
                        captureModel.locationService.coordinates == nil ? "GPS" : "GPS gesetzt",
                        systemImage: captureModel.locationService.coordinates == nil
                            ? "location"
                            : "location.fill"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(InventoryTheme.ink)
            }

            TextField("Ort, Regal oder Raum", text: $captureModel.locationName)
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            TextField("SKU / Barcode", text: $captureModel.sku)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            TextField("Seriennummer", text: $captureModel.serialNumber)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

            Button {
                camera.scanningEnabled = false
                camera.stop()
                showCaptureDetails = false
                showSpatialCapture = true
            } label: {
                Label(
                    captureModel.spatialPlacement?.roomName ?? "Im Raum positionieren",
                    systemImage: captureModel.spatialPlacement == nil
                        ? "cube.transparent"
                        : "mappin.and.ellipse"
                )
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)

            if let placement = captureModel.spatialPlacement {
                HStack(spacing: 10) {
                    Image(systemName: "mappin.and.ellipse")
                        .foregroundStyle(InventoryTheme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("3D-Position in \(placement.roomName)")
                            .font(.caption.weight(.semibold))
                        Text(
                            placement.position
                                .map { String(format: "%.2f", $0) }
                                .joined(separator: " · ") + " m"
                        )
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Entfernen") { captureModel.clearSpatialPlacement() }
                        .font(.caption.weight(.semibold))
                }
                .padding(12)
                .background(
                    InventoryTheme.accent.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 13)
                )
            }

            if state.canUseAI {
                Toggle("Fotos analysieren", isOn: $captureModel.autoAnalyze)
                Toggle("Cover erzeugen", isOn: $captureModel.autoCover)
                    .disabled(!captureModel.autoAnalyze)
            }
        }
    }

    private var permissionOverlay: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.fill").font(.largeTitle)
            Text("Kamerazugriff fehlt").font(.headline)
            Text("Aktiviere die Kamera in den iOS-Einstellungen.")
                .font(.subheadline)
                .multilineTextAlignment(.center)
            Button("Einstellungen öffnen") {
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                UIApplication.shared.open(url)
            }
            .buttonStyle(.borderedProminent)
            .tint(InventoryTheme.accent)
        }
        .padding(24)
        .foregroundStyle(.white)
        .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 20))
        .padding(24)
    }

    private func unavailableOverlay(_ message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").font(.title)
            Text(message).font(.subheadline).multilineTextAlignment(.center)
        }
        .padding(24)
        .foregroundStyle(.white)
        .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 20))
        .padding(24)
    }

    private var showingCountPhoto: Bool {
        mode == .count && countModel.photoURL != nil
    }

    private var showsScanGuide: Bool {
        mode == .scan || (mode == .count && countResource == nil && state.canUseAI)
    }

    private var shouldScanCodes: Bool {
        guard showsScanGuide, !isResolvingCode else { return false }
        if mode == .scan {
            return unmatchedCode == nil && foundResource == nil && !showCreateForm
        }
        return true
    }

    private var detailsBadgeText: String? {
        switch mode {
        case .capture:
            captureModel.photos.isEmpty ? nil : "\(captureModel.photos.count)"
        case .scan:
            unmatchedCode == nil ? nil : "!"
        case .count:
            countModel.result == nil ? nil : "\(countModel.adjustedCount)"
        }
    }

    private var cameraModeSwipe: some Gesture {
        DragGesture(minimumDistance: 32)
            .onEnded { value in
                guard !isPinchingZoom,
                      countModel.phase != .booking,
                      abs(value.translation.width) > abs(value.translation.height),
                      abs(value.translation.width) >= 52,
                      let currentIndex = CameraMode.allCases.firstIndex(of: mode) else {
                    return
                }
                let offset = value.translation.width < 0 ? 1 : -1
                let nextIndex = currentIndex + offset
                guard CameraMode.allCases.indices.contains(nextIndex) else { return }
                withAnimation(.easeInOut(duration: 0.18)) {
                    mode = CameraMode.allCases[nextIndex]
                }
            }
    }

    private var cameraZoomGesture: some Gesture {
        MagnificationGesture()
            .onChanged { magnification in
                isPinchingZoom = true
                camera.updatePinchZoom(magnification: magnification)
            }
            .onEnded { magnification in
                camera.endPinchZoom(magnification: magnification)
                DispatchQueue.main.async {
                    isPinchingZoom = false
                }
            }
    }

    private func cameraDetailsSwipe(viewHeight: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                let horizontalDistance = abs(value.translation.width)
                let verticalDistance = value.translation.height
                guard !isPinchingZoom,
                      value.startLocation.y >= viewHeight * 0.6,
                      verticalDistance <= -56,
                      abs(verticalDistance) > horizontalDistance else {
                    return
                }
                openCaptureDetails()
            }
    }

    private enum CodePurpose: Equatable {
        case inventoryLookup
        case countTarget
    }

    private func configureCamera() {
        camera.onPhoto = { result in handleCapturedPhoto(result) }
        camera.onCode = { code in
            switch mode {
            case .scan:
                resolve(code, purpose: .inventoryLookup)
            case .count where countResource == nil:
                resolve(code, purpose: .countTarget)
            case .capture, .count:
                break
            }
        }
        if !state.canUseAI {
            captureModel.autoAnalyze = false
            captureModel.autoCover = false
        }
        if let pendingCode = state.pendingCaptureCode {
            state.pendingCaptureCode = nil
            captureModel.applyScannedCode(pendingCode)
        }
        if let pendingCode = state.pendingScanCode {
            state.pendingScanCode = nil
            mode = .scan
            resolve(pendingCode, purpose: .inventoryLookup)
        }
        configureMode()
        camera.start()
    }

    private func configureMode() {
        if let activeCodePurpose {
            let lookupStillBelongsToMode = switch activeCodePurpose {
            case .inventoryLookup:
                mode == .scan
            case .countTarget:
                mode == .count && countResource == nil
            }
            if !lookupStillBelongsToMode {
                lookupTask?.cancel()
                lookupTask = nil
                lookupRequestID = nil
                self.activeCodePurpose = nil
                isResolvingCode = false
                lastCode = nil
            }
        }
        camera.scanningEnabled = shouldScanCodes
        camera.start()
    }

    private func tearDown() {
        lookupTask?.cancel()
        lookupTask = nil
        lookupRequestID = nil
        activeCodePurpose = nil
        camera.scanningEnabled = false
        camera.onCode = nil
        camera.onPhoto = nil
        if camera.torchEnabled { camera.toggleTorch() }
        camera.stop()
        countModel.cleanup()
    }

    private func requestPhoto(for request: CameraPhotoRequest) {
        guard pendingPhotoRequest == nil else { return }
        if case .count = request, !state.canUseAI {
            countModel.errorMessage = "Die Fotozählung benötigt die KI-Berechtigung für dieses Konto."
            return
        }
        pendingPhotoRequest = request
        camera.capturePhoto()
    }

    private func handleCapturedPhoto(_ result: Result<Data, CameraService.PhotoCaptureError>) {
        guard let request = pendingPhotoRequest else { return }
        pendingPhotoRequest = nil

        let data: Data
        switch result {
        case .success(let capturedData):
            data = capturedData
        case .failure(let error):
            switch request {
            case .capture:
                captureModel.errorMessage = error.localizedDescription
            case .count:
                countModel.errorMessage = error.localizedDescription
            }
            return
        }

        switch request {
        case .capture:
            withAnimation(.easeOut(duration: 0.12)) { shutterFlash = true }
            captureModel.addCameraCapturedData(
                data,
                cropAspectRatio: request.cropAspectRatio
            )
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) {
                withAnimation(.easeIn(duration: 0.14)) { shutterFlash = false }
            }
        case .count:
            if camera.torchEnabled { camera.toggleTorch() }
            guard let client = state.client else {
                countModel.errorMessage = "Keine Verbindung zum Inventarserver."
                return
            }
            countModel.analyzeCapturedData(
                data,
                cropAspectRatio: request.cropAspectRatio,
                using: client
            )
        }
    }

    private func resolve(_ rawCode: String, purpose: CodePurpose) {
        let code = rawCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, !isResolvingCode, code != lastCode else { return }
        if purpose == .countTarget, !state.canUseAI {
            scannerErrorMessage = "Die Fotozählung benötigt die KI-Berechtigung für dieses Konto."
            return
        }
        guard let client = state.client else {
            scannerErrorMessage = "Keine Serververbindung eingerichtet."
            return
        }

        lastCode = code
        isResolvingCode = true
        activeCodePurpose = purpose
        if purpose == .inventoryLookup { unmatchedCode = nil }
        camera.scanningEnabled = false
        lookupTask?.cancel()
        let requestID = UUID()
        lookupRequestID = requestID
        lookupTask = Task {
            do {
                let result = try await client.lookupResource(code: code)
                try Task.checkCancellation()
                guard lookupRequestID == requestID else { return }
                manualCode = ""
                isResolvingCode = false
                switch purpose {
                case .inventoryLookup:
                    showCaptureDetails = false
                    camera.stop()
                    foundResource = result.resource
                case .countTarget:
                    showCaptureDetails = false
                    countModel.prepare(for: result.resource.name, itemID: result.resource.id)
                    countResource = result.resource
                }
            } catch is CancellationError {
                guard lookupRequestID == requestID else { return }
                isResolvingCode = false
            } catch let error as APIClientError where error.statusCode == 404 {
                guard lookupRequestID == requestID else { return }
                isResolvingCode = false
                if purpose == .inventoryLookup {
                    unmatchedCode = code
                    detailsDetent = .medium
                    showCaptureDetails = true
                } else {
                    scannerErrorMessage = "Zu diesem Code wurde kein Inventarartikel gefunden."
                }
            } catch {
                guard lookupRequestID == requestID else { return }
                isResolvingCode = false
                scannerErrorMessage = error.localizedDescription
            }
            if lookupRequestID == requestID {
                lookupTask = nil
                lookupRequestID = nil
                activeCodePurpose = nil
            }
        }
    }

    private func resumeScanningIfNeeded() {
        guard foundResource == nil, !showCreateForm else {
            camera.scanningEnabled = false
            camera.stop()
            return
        }
        lastCode = nil
        isResolvingCode = false
        camera.scanningEnabled = shouldScanCodes
        camera.start()
    }

    private func openCaptureDetails() {
        detailsDetent = .medium
        showCaptureDetails = true
    }

    private func submitCapture() {
        guard captureModel.canSubmit, captureModel.processingCount == 0 else { return }
        let submission = captureModel.makeSubmission(imageModelID: state.selectedImageModelID)
        onSubmit(submission)
        withAnimation {
            captureModel.resetAfterSubmitting()
            showCaptureDetails = false
        }
    }

    private func applyCount(_ operation: StockCountOperation) {
        guard let client = state.client, let resource = countResource else {
            countModel.errorMessage = "Keine Verbindung zum Inventarserver."
            return
        }
        countModel.apply(operation, to: resource, using: client) { updated in
            countResource = updated
            onCountApplied?(updated)
            close()
        }
    }

    private func close() {
        if let onClose {
            onClose()
        } else {
            dismiss()
        }
    }

    private func scanGuideEdge(in size: CGSize) -> CGFloat {
        min(245, min(size.width * 0.68, size.height * 0.68))
    }
}

private struct CameraModeBar: View {
    @Binding var selection: CameraMode

    var body: some View {
        HStack(spacing: 26) {
            ForEach(CameraMode.allCases) { mode in
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        selection = mode
                    }
                } label: {
                    Text(mode.title.uppercased())
                        .font(.caption.weight(.bold))
                        .tracking(0.35)
                        .foregroundStyle(
                            selection == mode ? Color.yellow : Color.white.opacity(0.82)
                        )
                        .frame(minHeight: 44)
                        .scaleEffect(selection == mode ? 1.05 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(mode.accessibilityLabel)
                .accessibilityAddTraits(selection == mode ? .isSelected : [])
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 4)
        .background(.black.opacity(0.34), in: Capsule())
        .simultaneousGesture(
            DragGesture(minimumDistance: 20)
                .onEnded { value in
                    guard abs(value.translation.width) > abs(value.translation.height),
                          abs(value.translation.width) >= 28,
                          let currentIndex = CameraMode.allCases.firstIndex(of: selection) else {
                        return
                    }
                    let offset = value.translation.width < 0 ? 1 : -1
                    let nextIndex = currentIndex + offset
                    guard CameraMode.allCases.indices.contains(nextIndex) else { return }
                    withAnimation(.easeInOut(duration: 0.18)) {
                        selection = CameraMode.allCases[nextIndex]
                    }
                }
        )
    }
}
