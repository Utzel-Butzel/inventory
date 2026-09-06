import PhotosUI
import SwiftUI
import UIKit

enum CameraMode: String, CaseIterable, Identifiable, Sendable {
    case capture
    case video
    case document
    case scan
    case recognize
    case count

    var id: String { rawValue }

    var title: String {
        switch self {
        case .capture: "Foto"
        case .video: "Video"
        case .document: "Dokument"
        case .scan: "Scannen"
        case .recognize: "Erkennen"
        case .count: "Zählen"
        }
    }

    var navigationTitle: String {
        switch self {
        case .capture: "Inventar erfassen"
        case .video: "Inventarvideo"
        case .document: "Dokument scannen"
        case .scan: "QR & Barcode"
        case .recognize: "Objekt erkennen"
        case .count: "Teile per Foto zählen"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .capture: "Inventar mit Fotos erfassen"
        case .video: "Inventarvideo aufnehmen"
        case .document: "Mehrseitiges Dokument mit OCR scannen"
        case .scan: "QR- oder Barcode scannen"
        case .recognize: "Inventarartikel per Foto erkennen"
        case .count: "Teile per Foto zählen"
        }
    }
}

private enum CameraPhotoRequest: Equatable {
    case capture(UUID, cropAspectRatio: CGFloat)
    case recognize(UUID, cropAspectRatio: CGFloat)
    case count(UUID, cropAspectRatio: CGFloat)

    var cropAspectRatio: CGFloat {
        switch self {
        case .capture(_, let cropAspectRatio),
             .recognize(_, let cropAspectRatio),
             .count(_, let cropAspectRatio):
            cropAspectRatio
        }
    }
}

private struct PendingActionScan: Identifiable {
    let id = UUID()
    let workflow: ScanActionWorkflow
    let code: String
    let codeType: String?
}

struct UnifiedCameraView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var camera = CameraService()
    @StateObject private var captureModel: CaptureViewModel
    @StateObject private var recognitionModel = ResourceRecognitionViewModel()
    @StateObject private var countModel: StockCountViewModel

    @State private var mode: CameraMode
    @State private var countResource: InventoryResource?
    @State private var pendingPhotoRequest: CameraPhotoRequest?
    @State private var pendingPhotoRequestInvalidated = false
    @State private var shutterFlash = false
    @State private var isPinchingZoom = false

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCaptureDetails = false
    @State private var detailsDetent: PresentationDetent = .medium
    @State private var showSpatialCapture = false
    @State private var showDocumentScanner = false
    @State private var documentRecognitionRunning = false
    @State private var recordingSeconds = 0

    @State private var manualCode = ""
    @State private var lastCode: String?
    @State private var isResolvingCode = false
    @State private var foundResource: InventoryResource?
    @State private var unmatchedCode: String?
    @State private var showCreateForm = false
    @State private var scannerErrorMessage: String?
    @State private var scanActionWorkflows: [ScanActionWorkflow] = []
    @State private var actionFlowsLoading = false
    @State private var actionFlowsLoadFailed = false
    @State private var selectedScanActionWorkflowID: UUID?
    @State private var pendingActionScan: PendingActionScan?
    @State private var lookupTask: Task<Void, Never>?
    @State private var lookupRequestID: UUID?
    @State private var activeCodePurpose: CodePurpose?
    @State private var confirmIssue = false
    @State private var inventoryTypes: [InventoryTypeDefinition] = []

    private let onClose: (() -> Void)?
    private let onSubmit: (IntakeSubmission) -> Void
    private let onCountApplied: ((InventoryResource) -> Void)?

    init(
        initialMode: CameraMode,
        maximumUploadImagePixelSize: Int,
        initialCountResource: InventoryResource? = nil,
        onClose: (() -> Void)? = nil,
        onSubmit: @escaping (IntakeSubmission) -> Void,
        onCountApplied: ((InventoryResource) -> Void)? = nil
    ) {
        _mode = State(initialValue: initialMode)
        _countResource = State(initialValue: initialCountResource)
        _captureModel = StateObject(
            wrappedValue: CaptureViewModel(
                maximumPixelSize: maximumUploadImagePixelSize
            )
        )
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

                    if mode == .scan, state.canReadWorkflows {
                        Menu {
                            Picker("Ablauf wählen", selection: $selectedScanActionWorkflowID) {
                                Text("Inventarartikel suchen").tag(nil as UUID?)
                                ForEach(scanActionWorkflows) { workflow in
                                    Text(workflow.name).tag(Optional(workflow.id))
                                }
                            }
                            if actionFlowsLoadFailed || scanActionWorkflows.isEmpty {
                                Button("Abläufe erneut laden", systemImage: "arrow.clockwise") {
                                    Task { await loadActionFlows() }
                                }
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: selectedScanActionWorkflow == nil ? "magnifyingglass" : "bolt.fill")
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(selectedScanActionWorkflow?.name ?? "Inventarartikel suchen").font(.subheadline.weight(.semibold))
                                    Text(actionFlowsLoading ? "Abläufe werden geladen …" : actionFlowsLoadFailed ? "Abläufe konnten nicht geladen werden" : scanActionWorkflows.isEmpty ? "Keine aktiven Abläufe vorhanden" : "Ablauf wählen").font(.caption)
                                }
                                Spacer()
                                Image(systemName: "chevron.down")
                            }
                            .foregroundStyle(.white).padding(14)
                            .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
                        }
                        .disabled(actionFlowsLoading)
                        .padding(.horizontal, 16).padding(.top, 10)
                    }

                    if isIntakeMode, captureModel.mediaCount > 0 {
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
                .animation(.easeInOut(duration: 0.2), value: captureModel.mediaCount)
            }
            .background(.black)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .simultaneousGesture(
                cameraDetailsSwipe(viewHeight: geometry.size.height)
            )
        }
        .statusBarHidden()
        .interactiveDismissDisabled(
            countModel.phase == .booking
                || camera.isRecordingVideo
                || documentRecognitionRunning
        )
        .onAppear {
            if !availableCameraModes.contains(mode) {
                mode = .scan
            }
            configureCamera()
        }
        .task(id: state.organizationContextIdentifier) {
            if let client = state.client {
                await countModel.loadCountModels(using: client)
                inventoryTypes = (try? await client.inventoryTypes().types) ?? []
            }
        }
        .task(id: state.organizationContextIdentifier) { await loadActionFlows() }
        .task(id: camera.isRecordingVideo) {
            recordingSeconds = 0
            while camera.isRecordingVideo, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if camera.isRecordingVideo { recordingSeconds += 1 }
            }
        }
        .onDisappear(perform: tearDown)
        .onChange(of: mode) { oldMode, _ in
            if pendingPhotoRequest != nil {
                pendingPhotoRequestInvalidated = true
            }
            if oldMode == .recognize {
                recognitionModel.cancel()
            }
            lastCode = nil
            configureMode()
        }
        .onChange(of: selectedScanActionWorkflowID) { _, _ in
            lastCode = nil
        }
        .onChange(of: recognitionModel.phase) { _, phase in
            guard mode == .recognize,
                  phase == .result,
                  recognitionModel.result != nil else { return }
            detailsDetent = .large
            showCaptureDetails = true
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
        .sheet(item: $pendingActionScan, onDismiss: resumeScanningIfNeeded) { action in
            ActionFlowRunView(
                workflow: action.workflow,
                code: action.code,
                codeType: action.codeType
            )
                .environmentObject(state)
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
        .fullScreenCover(
            isPresented: $showDocumentScanner,
            onDismiss: { configureCamera() }
        ) {
            InventoryDocumentScannerView(
                onRecognizing: {
                    showDocumentScanner = false
                    documentRecognitionRunning = true
                },
                onComplete: { result in
                    documentRecognitionRunning = false
                    showDocumentScanner = false
                    switch result {
                    case .success(let file):
                        captureModel.addAttachment(file, kind: .document)
                    case .failure(let error):
                        captureModel.errorMessage = error.localizedDescription
                    }
                },
                onCancel: { showDocumentScanner = false }
            )
            .ignoresSafeArea()
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
                        + "\(resource.quantity - countModel.adjustedCount) reduziert."
                )
            }
        }
        .alert(
            "Medium konnte nicht verarbeitet werden",
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
            "Objekt konnte nicht erkannt werden",
            isPresented: Binding(
                get: { recognitionModel.errorMessage != nil },
                set: { if !$0 { recognitionModel.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { recognitionModel.errorMessage = nil }
        } message: {
            Text(recognitionModel.errorMessage ?? "Unbekannter Fehler")
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
                .opacity(showingCapturedPhoto ? 0 : 1)

            if mode == .count, let photoURL = countModel.photoURL {
                StockCountPhotoPreview(
                    url: photoURL,
                    markers: countModel.result?.markers ?? [],
                    contentMode: .fill
                )
            }

            if mode == .recognize, let photoURL = recognitionModel.photoURL {
                StockCountPhotoPreview(
                    url: photoURL,
                    markers: [],
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

            if mode == .document {
                VStack(spacing: 10) {
                    Image(systemName: "doc.viewfinder")
                        .font(.system(size: 54, weight: .light))
                    Text("Kanten, Perspektive und Zuschnitt werden automatisch erkannt.")
                        .font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.center)
                }
                .foregroundStyle(.white)
                .padding(22)
                .background(.black.opacity(0.52), in: RoundedRectangle(cornerRadius: 20))
                .padding(24)
            }

            if camera.isRecordingVideo {
                Label {
                    Text(
                        String(
                            format: "%02d:%02d",
                            recordingSeconds / 60,
                            recordingSeconds % 60
                        )
                    )
                    .monospacedDigit()
                } icon: {
                    Circle().fill(.red).frame(width: 9, height: 9)
                }
                .font(.caption.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .frame(minHeight: 38)
                .background(.black.opacity(0.66), in: Capsule())
                .frame(maxHeight: .infinity, alignment: .top)
                .padding(.top, 90)
            }

            if documentRecognitionRunning {
                VStack(spacing: 12) {
                    ProgressView().tint(.white).controlSize(.large)
                    Text("OCR-Texterkennung und PDF-Erstellung laufen …")
                        .font(.headline)
                        .multilineTextAlignment(.center)
                    Text("Die Verarbeitung findet direkt auf diesem Gerät statt.")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                }
                .foregroundStyle(.white)
                .padding(24)
                .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 20))
                .padding(24)
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
            } else if recognitionModel.isBusy, mode == .recognize {
                VStack(spacing: 12) {
                    ProgressView().tint(.white).controlSize(.large)
                    Text(
                        recognitionModel.phase == .preparingPhoto
                            ? "Foto wird vorbereitet …"
                            : "Inventar wird durchsucht …"
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
            .disabled(
                countModel.phase == .booking
                    || camera.isRecordingVideo
                    || documentRecognitionRunning
            )
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
            .disabled(camera.isRecordingVideo || documentRecognitionRunning)
            .accessibilityLabel("Details öffnen")

            if !showingCapturedPhoto {
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
                    ForEach(captureModel.attachments) { attachment in
                        Button(action: openCaptureDetails) {
                            Image(
                                systemName: attachment.kind == .video
                                    ? "video.fill"
                                    : "doc.text.fill"
                            )
                            .font(.title3)
                            .foregroundStyle(.white)
                            .frame(width: 48, height: 48)
                            .background(.black.opacity(0.48))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(.white.opacity(0.55), lineWidth: 1)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            attachment.kind == .video
                                ? "Aufgenommenes Video anzeigen"
                                : "Gescanntes Dokument anzeigen"
                        )
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
                "Lädt \(captureModel.mediaCount) aufgenommene Mediendateien hoch"
            )
        }
        .frame(height: 48)
    }

    private func cameraControlDeck(viewportAspectRatio: CGFloat) -> some View {
        VStack(spacing: 14) {
            if !showingCapturedPhoto {
                zoomSelector
            }

            cameraBottomControls(viewportAspectRatio: viewportAspectRatio)
                .frame(minHeight: 88)

            CameraModeBar(selection: $mode, modes: availableCameraModes)
                .disabled(
                    countModel.phase == .booking
                        || pendingPhotoRequest != nil
                        || camera.isRecordingVideo
                        || documentRecognitionRunning
                )
                .opacity(
                    countModel.phase == .booking
                        || pendingPhotoRequest != nil
                        || camera.isRecordingVideo
                        || documentRecognitionRunning
                        ? 0.65
                        : 1
                )
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
                    maxSelectionCount: CaptureViewModel.maximumPhotos - captureModel.mediaCount,
                    matching: .images
                ) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.title3)
                        .frame(width: 52, height: 52)
                        .background(.black.opacity(0.4), in: Circle())
                }
                .foregroundStyle(.white)
                .disabled(captureModel.mediaCount >= CaptureViewModel.maximumPhotos)

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
                        || captureModel.mediaCount >= CaptureViewModel.maximumPhotos
                )
                Spacer()
                cameraSwitchButton
            }

        case .video:
            HStack {
                Color.clear.frame(width: 52, height: 52)
                Spacer()
                Button {
                    if camera.isRecordingVideo {
                        camera.stopVideoRecording()
                    } else {
                        camera.startVideoRecording()
                    }
                } label: {
                    ZStack {
                        Circle()
                            .stroke(.white.opacity(0.72), lineWidth: 4)
                            .frame(width: 84, height: 84)
                        if camera.isRecordingVideo {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(.red)
                                .frame(width: 34, height: 34)
                        } else {
                            Circle().fill(.red).frame(width: 64, height: 64)
                        }
                    }
                }
                .disabled(
                    camera.state != .ready
                        || !camera.canRecordVideo
                        || captureModel.mediaCount >= CaptureViewModel.maximumPhotos
                )
                .accessibilityLabel(
                    camera.isRecordingVideo
                        ? "Videoaufnahme stoppen"
                        : "Videoaufnahme starten"
                )
                Spacer()
                cameraSwitchButton
                    .disabled(camera.isRecordingVideo)
            }

        case .document:
            HStack {
                Color.clear.frame(width: 52, height: 52)
                Spacer()
                Button {
                    guard InventoryDocumentScannerView.isSupported else {
                        captureModel.errorMessage = InventoryDocumentScannerError
                            .unavailable.localizedDescription
                        return
                    }
                    camera.stop()
                    showDocumentScanner = true
                } label: {
                    Image(systemName: "doc.viewfinder")
                        .font(.system(size: 34, weight: .medium))
                        .foregroundStyle(InventoryTheme.ink)
                        .frame(width: 78, height: 78)
                        .background(InventoryTheme.lime, in: Circle())
                        .overlay {
                            Circle().stroke(.white.opacity(0.58), lineWidth: 3)
                                .frame(width: 88, height: 88)
                        }
                }
                .disabled(
                    documentRecognitionRunning
                        || captureModel.mediaCount >= CaptureViewModel.maximumPhotos
                )
                .accessibilityLabel("Mehrseitiges Dokument scannen")
                Spacer()
                Color.clear.frame(width: 52, height: 52)
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

        case .recognize:
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
                } else if recognitionModel.photoURL == nil, !recognitionModel.isBusy {
                    shutterButton(
                        accessibilityLabel: "Foto aufnehmen und Inventarartikel suchen"
                    ) {
                        requestPhoto(
                            for: .recognize(
                                UUID(),
                                cropAspectRatio: viewportAspectRatio
                            )
                        )
                    }
                    .disabled(camera.state != .ready || pendingPhotoRequest != nil)
                } else if recognitionModel.result != nil {
                    Button {
                        recognitionModel.retake()
                        showCaptureDetails = false
                        configureMode()
                    } label: {
                        Label("Neues Foto", systemImage: "camera.rotate")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(.black.opacity(0.56), in: Capsule())
                    }
                    .foregroundStyle(.white)
                } else if recognitionModel.photoURL != nil, !recognitionModel.isBusy {
                    Button {
                        guard let client = state.client else {
                            recognitionModel.errorMessage =
                                "Keine Verbindung zum Inventarserver."
                            return
                        }
                        recognitionModel.retry(using: client)
                    } label: {
                        Label("Erneut suchen", systemImage: "arrow.clockwise")
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
            if !scanActionWorkflows.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Scan-Aktion", systemImage: "bolt.fill")
                        .font(.headline)
                    Picker("Verhalten beim nächsten Scan", selection: $selectedScanActionWorkflowID) {
                        Text("Inventarartikel suchen").tag(nil as UUID?)
                        ForEach(scanActionWorkflows) { workflow in
                            Text(workflow.name).tag(Optional(workflow.id))
                        }
                    }
                    .pickerStyle(.menu)
                    if let selectedScanActionWorkflow {
                        Text(selectedScanActionWorkflow.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .inventoryCard()
            }

            if let code = unmatchedCode {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Noch nicht im Inventar", systemImage: "questionmark.app.dashed")
                        .font(.headline)
                    Text(code)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                    if state.canCreateInventory {
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
                    } else {
                        Label("Nur Lesezugriff", systemImage: "lock.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

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
    private var recognitionDetails: some View {
        if !state.canUseAI {
            VStack(alignment: .leading, spacing: 10) {
                Label("Objekterkennung nicht verfügbar", systemImage: "lock.fill")
                    .font(.headline)
                Text(
                    "Die Fotoerkennung benötigt die KI-Berechtigung für dieses Konto. "
                        + "Erfassen und Codes scannen stehen weiterhin zur Verfügung."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .inventoryCard()
        } else if recognitionModel.isBusy {
            VStack(spacing: 12) {
                ProgressView()
                Text(
                    recognitionModel.phase == .preparingPhoto
                        ? "Foto wird vorbereitet …"
                        : "Passender Inventarartikel wird gesucht …"
                )
                .font(.subheadline.weight(.semibold))
                Text(
                    "Das Foto sowie eine begrenzte Auswahl passender Inventardaten "
                        + "und Referenzbilder werden temporär an den KI-Dienst "
                        + "übertragen, aber nicht als Inventarmedium gespeichert."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .inventoryCard()
        } else if let result = recognitionModel.result {
            if let detected = result.detected {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Erkanntes Objekt")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(detected.label).font(.headline)
                            Text(
                                [detected.brand, detected.model]
                                    .compactMap { $0 }
                                    .joined(separator: " · ")
                            )
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(
                            detected.confidence.formatted(
                                .percent.precision(.fractionLength(0))
                            )
                        )
                        .font(.caption.monospacedDigit().weight(.semibold))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .inventoryCard()
            }

            if result.matches.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Label(
                        "Kein sicherer Inventartreffer",
                        systemImage: "questionmark.app.dashed"
                    )
                    .font(.headline)
                    Text(
                        result.catalog.considered == 0
                            ? "Es sind keine sichtbaren Inventareinträge vorhanden."
                            : "Zu diesem Foto wurde kein passender Eintrag gefunden. "
                                + "Fotografiere das Objekt näher, schärfer oder von einer anderen Seite."
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    Button {
                        recognitionModel.retake()
                        showCaptureDetails = false
                        configureMode()
                    } label: {
                        Label("Neues Foto aufnehmen", systemImage: "camera.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(InventoryTheme.ink)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .inventoryCard()
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Label(
                        result.isConfident ? "Sehr wahrscheinlicher Treffer" : "Treffer prüfen",
                        systemImage: result.isConfident
                            ? "checkmark.seal.fill"
                            : "list.bullet.clipboard"
                    )
                    .font(.headline)
                    .foregroundStyle(
                        result.isConfident ? InventoryTheme.success : InventoryTheme.warning
                    )
                    Text(
                        result.isConfident
                            ? "Öffne den Artikel, um den Treffer zu bestätigen."
                            : "Mehrere Einträge können ähnlich aussehen. Wähle den passenden Artikel."
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .inventoryCard()

                ForEach(result.matches) { match in
                    Button {
                        openRecognizedResource(match.resource)
                    } label: {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 12) {
                                Group {
                                    if let cover = match.resource.cover,
                                       let client = state.client {
                                        AuthenticatedInventoryImage(
                                            media: cover,
                                            client: client
                                        )
                                    } else {
                                        Image(systemName: match.resource.type.symbolName)
                                            .font(.title2)
                                            .foregroundStyle(.secondary)
                                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                                            .background(.quaternary)
                                    }
                                }
                                .frame(width: 68, height: 68)
                                .clipShape(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                )

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(match.resource.name)
                                        .font(.headline)
                                        .foregroundStyle(.primary)
                                        .multilineTextAlignment(.leading)
                                    Text(
                                        [
                                            match.resource.type.localizedName,
                                            match.resource.location,
                                        ]
                                        .compactMap { $0 }
                                        .joined(separator: " · ")
                                    )
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 4)
                                Text(
                                    match.confidence.formatted(
                                        .percent.precision(.fractionLength(0))
                                    )
                                )
                                .font(.subheadline.monospacedDigit().bold())
                                .foregroundStyle(
                                    result.isConfident && match.id == result.matches.first?.id
                                        ? InventoryTheme.success
                                        : InventoryTheme.warning
                                )
                            }
                            Text(match.reason)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.leading)
                            Label("Inventarartikel öffnen", systemImage: "arrow.up.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(InventoryTheme.accent)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .inventoryCard()
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Öffnet den erkannten Inventarartikel")
                }
            }

            if result.catalog.truncated {
                Label(
                    "Die visuelle Vergleichsauswahl war begrenzt; ältere oder ähnlich "
                        + "benannte Einträge können fehlen.",
                    systemImage: "info.circle"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .inventoryCard()
            }
        } else if recognitionModel.photoURL != nil {
            VStack(alignment: .leading, spacing: 12) {
                Label(
                    "Suche nicht abgeschlossen",
                    systemImage: "exclamationmark.arrow.triangle.2.circlepath"
                )
                    .font(.headline)
                Text(
                    "Das Foto ist noch vorhanden. Du kannst dieselbe geschützte Anfrage "
                        + "fortsetzen oder ein neues Foto aufnehmen."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
                HStack {
                    Button("Neues Foto") {
                        recognitionModel.retake()
                        showCaptureDetails = false
                        configureMode()
                    }
                    .buttonStyle(.bordered)
                    Spacer()
                    Button("Erneut suchen") {
                        guard let client = state.client else {
                            recognitionModel.errorMessage =
                                "Keine Verbindung zum Inventarserver."
                            return
                        }
                        recognitionModel.retry(using: client)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(InventoryTheme.ink)
                }
                if let estimate = state.aiCostEstimate(for: "inventoryRecognition") {
                    Label(
                        "Geschätzte API-Kosten: \(estimate.formattedUSD)",
                        systemImage: "dollarsign.circle"
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .inventoryCard()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Label("Inventarartikel per Foto finden", systemImage: "camera.metering.center.weighted")
                    .font(.headline)
                Text(
                    "Fotografiere einen einzelnen Gegenstand gut sichtbar. Die Suche vergleicht "
                        + "Form, Farbe, Marke, Modell und lesbare Beschriftungen mit deinem Inventar."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
                Label(
                    "Das Suchfoto wird temporär verarbeitet und nicht an einen "
                        + "Inventarartikel angehängt.",
                    systemImage: "hand.raised.fill"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                if let estimate = state.aiCostEstimate(for: "inventoryRecognition") {
                    Label(
                        "Geschätzte API-Kosten: \(estimate.formattedUSD)",
                        systemImage: "dollarsign.circle"
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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

            if countModel.adjustedCount > resource.quantity && !state.allowsNegativeStock {
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
                        Text("danach \(resource.quantity - countModel.adjustedCount)")
                            .font(.caption.monospacedDigit())
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.bordered)
                .disabled(
                    !countModel.canApplyIssue(
                        currentQuantity: resource.quantity,
                        allowNegativeStock: state.allowsNegativeStock
                    )
                )

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
                    case .capture, .video, .document:
                        capturePhotoTray
                        captureOptions
                        captureUploadAction
                    case .scan:
                        scannerDetails
                    case .recognize:
                        recognitionDetails
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
                captureModel.mediaCount == 0
                    ? "Nimm ein Foto oder Video auf oder scanne ein Dokument."
                    : "\(captureModel.mediaCount) von \(CaptureViewModel.maximumPhotos) Medien bereit"
            )
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .inventoryCard()
    }

    @ViewBuilder
    private var capturePhotoTray: some View {
        if captureModel.mediaCount > 0 {
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
                    ForEach(captureModel.attachments) { attachment in
                        ZStack(alignment: .topTrailing) {
                            VStack(spacing: 7) {
                                Image(
                                    systemName: attachment.kind == .video
                                        ? "video.fill"
                                        : "doc.text.fill"
                                )
                                .font(.title2)
                                Text(attachment.kind == .video ? "Video" : "PDF + OCR")
                                    .font(.caption2.weight(.semibold))
                            }
                            .foregroundStyle(InventoryTheme.ink)
                            .frame(width: 92, height: 92)
                            .background(
                                InventoryTheme.lime.opacity(0.72),
                                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                            )
                            Button {
                                captureModel.removeAttachment(attachment)
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
                    ForEach(captureTypes, id: \.self) { type in
                        Text(captureTypeLabel(type)).tag(type)
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
            TextField("SKU", text: $captureModel.sku)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            TextField("Barcode", text: $captureModel.barcode)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            TextField("Seriennummer", text: $captureModel.serialNumber)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

            if state.canManageSpatial {
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
            }

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
                VStack(alignment: .leading, spacing: 3) {
                    Toggle("Fotos analysieren", isOn: $captureModel.autoAnalyze)
                    if let estimate = state.aiCostEstimate(for: "inventoryAnalysis") {
                        Label(
                            "Geschätzte API-Kosten: \(estimate.formattedUSD)",
                            systemImage: "dollarsign.circle"
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Toggle("Cover erzeugen", isOn: $captureModel.autoCover)
                        .disabled(!captureModel.autoAnalyze)
                    if let estimate = state.imageGenerationCostEstimate() {
                        Label(
                            "Geschätzte API-Kosten: \(estimate.formattedUSD)",
                            systemImage: "dollarsign.circle"
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                }
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

    private var showingCapturedPhoto: Bool {
        (mode == .count && countModel.photoURL != nil)
            || (mode == .recognize && recognitionModel.photoURL != nil)
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
        case .capture, .video, .document:
            captureModel.mediaCount == 0 ? nil : "\(captureModel.mediaCount)"
        case .scan:
            unmatchedCode == nil ? nil : "!"
        case .recognize:
            recognitionModel.result.map { "\($0.matches.count)" }
        case .count:
            countModel.result == nil ? nil : "\(countModel.adjustedCount)"
        }
    }

    private var cameraModeSwipe: some Gesture {
        DragGesture(minimumDistance: 32)
            .onEnded { value in
                guard !isPinchingZoom,
                      pendingPhotoRequest == nil,
                      !camera.isRecordingVideo,
                      !documentRecognitionRunning,
                      countModel.phase != .booking,
                      abs(value.translation.width) > abs(value.translation.height),
                      abs(value.translation.width) >= 52,
                      let currentIndex = availableCameraModes.firstIndex(of: mode) else {
                    return
                }
                let offset = value.translation.width < 0 ? 1 : -1
                let nextIndex = currentIndex + offset
                guard availableCameraModes.indices.contains(nextIndex) else { return }
                withAnimation(.easeInOut(duration: 0.18)) {
                    mode = availableCameraModes[nextIndex]
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
        camera.onVideo = { result in
            switch result {
            case .success(let file):
                captureModel.addAttachment(file, kind: .video)
            case .failure(let error):
                captureModel.errorMessage = error.localizedDescription
            }
        }
        camera.onDetectedCode = { detected in
            switch mode {
            case .scan:
                resolve(
                    detected.value,
                    purpose: .inventoryLookup,
                    codeType: detected.type
                )
            case .count where countResource == nil:
                resolve(
                    detected.value,
                    purpose: .countTarget,
                    codeType: detected.type
                )
            case .capture, .video, .document, .recognize, .count:
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
        camera.onDetectedCode = nil
        camera.onPhoto = nil
        camera.onVideo = nil
        if camera.isRecordingVideo { camera.stopVideoRecording() }
        if camera.torchEnabled { camera.toggleTorch() }
        camera.stop()
        pendingPhotoRequest = nil
        pendingPhotoRequestInvalidated = true
        recognitionModel.cleanup()
        countModel.cleanup()
    }

    private func requestPhoto(for request: CameraPhotoRequest) {
        guard pendingPhotoRequest == nil else { return }
        if case .count = request, !state.canUseAI {
            countModel.errorMessage = "Die Fotozählung benötigt die KI-Berechtigung für dieses Konto."
            return
        }
        if case .recognize = request, !state.canUseAI {
            recognitionModel.errorMessage =
                "Die Objekterkennung benötigt die KI-Berechtigung für dieses Konto."
            return
        }
        pendingPhotoRequestInvalidated = false
        pendingPhotoRequest = request
        camera.capturePhoto()
    }

    private func handleCapturedPhoto(_ result: Result<Data, CameraService.PhotoCaptureError>) {
        guard let request = pendingPhotoRequest else { return }
        let shouldDiscard = pendingPhotoRequestInvalidated
        pendingPhotoRequest = nil
        pendingPhotoRequestInvalidated = false
        guard !shouldDiscard else { return }

        let data: Data
        switch result {
        case .success(let capturedData):
            data = capturedData
        case .failure(let error):
            switch request {
            case .capture:
                captureModel.errorMessage = error.localizedDescription
            case .recognize:
                recognitionModel.errorMessage = error.localizedDescription
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
        case .recognize:
            if camera.torchEnabled { camera.toggleTorch() }
            guard let client = state.client else {
                recognitionModel.errorMessage = "Keine Verbindung zum Inventarserver."
                return
            }
            recognitionModel.recognizeCapturedData(
                data,
                cropAspectRatio: request.cropAspectRatio,
                using: client
            )
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

    private func resolve(
        _ rawCode: String,
        purpose: CodePurpose,
        codeType: String? = nil
    ) {
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

        if purpose == .inventoryLookup, let workflow = selectedScanActionWorkflow {
            lastCode = code
            manualCode = ""
            unmatchedCode = nil
            showCaptureDetails = false
            camera.scanningEnabled = false
            camera.stop()
            pendingActionScan = PendingActionScan(
                workflow: workflow,
                code: code,
                codeType: codeType
            )
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
        guard foundResource == nil, pendingActionScan == nil, !showCreateForm else {
            camera.scanningEnabled = false
            camera.stop()
            return
        }
        lastCode = nil
        isResolvingCode = false
        camera.scanningEnabled = shouldScanCodes
        camera.start()
    }

    @MainActor private func loadActionFlows() async {
        let context = state.organizationContextIdentifier
        let previousSelection = selectedScanActionWorkflowID
        scanActionWorkflows = []
        selectedScanActionWorkflowID = nil
        actionFlowsLoadFailed = false
        actionFlowsLoading = false
        guard state.canReadWorkflows, let client = state.client else { return }
        actionFlowsLoading = true
        defer { if context == state.organizationContextIdentifier { actionFlowsLoading = false } }
        do {
            let workflows = try await client.scanActionWorkflows().workflows.filter(\.enabled)
            guard !Task.isCancelled, context == state.organizationContextIdentifier else { return }
            scanActionWorkflows = workflows
            if let previousSelection, workflows.contains(where: { $0.id == previousSelection }) {
                selectedScanActionWorkflowID = previousSelection
            }
        } catch {
            guard !Task.isCancelled, context == state.organizationContextIdentifier else { return }
            actionFlowsLoadFailed = true
        }
    }

    private var selectedScanActionWorkflow: ScanActionWorkflow? {
        guard let selectedScanActionWorkflowID else { return nil }
        return scanActionWorkflows.first { $0.id == selectedScanActionWorkflowID }
    }

    private func openCaptureDetails() {
        guard !camera.isRecordingVideo, !documentRecognitionRunning else { return }
        detailsDetent = .medium
        showCaptureDetails = true
    }

    private func openRecognizedResource(_ resource: InventoryResource) {
        showCaptureDetails = false
        camera.scanningEnabled = false
        camera.stop()
        foundResource = resource
    }

    private func submitCapture() {
        guard state.canCaptureInventory,
              captureModel.canSubmit,
              captureModel.processingCount == 0 else { return }
        let submission = captureModel.makeSubmission(
            imageModelID: state.selectedImageModelID,
            maximumAIGeneratedImagePixelSize: state.maximumAIGeneratedImagePixelSize,
            analysisPrompt: state.analysisPrompt,
            coverPrompt: state.coverPrompt
        )
        onSubmit(submission)
        withAnimation {
            captureModel.resetAfterSubmitting()
            showCaptureDetails = false
        }
    }

    private func applyCount(_ operation: StockCountOperation) {
        guard state.canManageStock,
              let client = state.client,
              let resource = countResource else {
            countModel.errorMessage = "Keine Verbindung zum Inventarserver."
            return
        }
        countModel.apply(
            operation,
            to: resource,
            allowNegativeStock: state.allowsNegativeStock,
            using: client
        ) { updated in
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

    private var availableCameraModes: [CameraMode] {
        CameraMode.allCases.filter { candidate in
            switch candidate {
            case .capture, .video, .document: state.canCaptureInventory
            case .scan: true
            case .recognize: state.canUseAI
            case .count: state.canManageStock && state.canUseAI
            }
        }
    }

    private var isIntakeMode: Bool {
        mode == .capture || mode == .video || mode == .document
    }

    private var captureTypes: [InventoryResourceType] {
        let definitions = inventoryTypes
            .filter { $0.archivedAt == nil }
            .sorted { ($0.position, $0.label) < ($1.position, $1.label) }
        let values = definitions.compactMap { InventoryResourceType(rawValue: $0.key) }
        return values.isEmpty ? InventoryResourceType.allCases : values
    }

    private func captureTypeLabel(_ type: InventoryResourceType) -> String {
        inventoryTypes.first(where: { $0.key == type.rawValue })?.label ?? type.localizedName
    }
}

private struct CameraModeBar: View {
    @Binding var selection: CameraMode
    let modes: [CameraMode]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(modes) { mode in
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
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .scaleEffect(selection == mode ? 1.05 : 1)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(mode.accessibilityLabel)
                .accessibilityAddTraits(selection == mode ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.black.opacity(0.34), in: Capsule())
        .simultaneousGesture(
            DragGesture(minimumDistance: 20)
                .onEnded { value in
                    guard abs(value.translation.width) > abs(value.translation.height),
                          abs(value.translation.width) >= 28,
                          let currentIndex = modes.firstIndex(of: selection) else {
                        return
                    }
                    let offset = value.translation.width < 0 ? 1 : -1
                    let nextIndex = currentIndex + offset
                    guard modes.indices.contains(nextIndex) else { return }
                    withAnimation(.easeInOut(duration: 0.18)) {
                        selection = modes[nextIndex]
                    }
                }
        )
    }
}
