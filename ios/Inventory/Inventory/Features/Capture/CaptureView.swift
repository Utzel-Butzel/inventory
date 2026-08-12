import PhotosUI
import SwiftUI
import UIKit

struct CaptureView: View {
    @EnvironmentObject private var state: AppState
    @StateObject private var camera = CameraService()
    @StateObject private var model = CaptureViewModel()
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var shutterFlash = false
    @State private var codeScanning = false
    @State private var showDetails = false
    @State private var detailsDetent: PresentationDetent = .medium
    @State private var showSpatialCapture = false

    let onClose: (() -> Void)?
    let onSubmit: (IntakeSubmission) -> Void

    init(
        onClose: (() -> Void)? = nil,
        onSubmit: @escaping (IntakeSubmission) -> Void
    ) {
        self.onClose = onClose
        self.onSubmit = onSubmit
    }

    var body: some View {
        NavigationStack {
            cameraPanel
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear {
                camera.scanningEnabled = false
                camera.onCode = { code in
                    model.applyScannedCode(code)
                    codeScanning = false
                    camera.scanningEnabled = false
                }
                camera.onPhoto = { data in
                    withAnimation(.easeOut(duration: 0.12)) { shutterFlash = true }
                    model.addCapturedData(data)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) {
                        withAnimation(.easeIn(duration: 0.14)) { shutterFlash = false }
                    }
                }
                if !state.canUseAI {
                    model.autoAnalyze = false
                    model.autoCover = false
                }
                consumePendingCode()
                camera.start()
            }
            .onDisappear { camera.stop() }
            .onChange(of: pickerItems) { _, items in
                model.addPickerItems(items)
                pickerItems = []
            }
            .onChange(of: state.pendingCaptureCode) { _, _ in consumePendingCode() }
            .sheet(isPresented: $showDetails) {
                detailsSheet
                    .presentationDetents([.medium, .large], selection: $detailsDetent)
                    .presentationDragIndicator(.visible)
                    .presentationBackground(.regularMaterial)
            }
            .fullScreenCover(
                isPresented: $showSpatialCapture,
                onDismiss: { camera.start() }
            ) {
                SpatialItemCaptureView { placement, imageData in
                    model.applySpatialPlacement(placement)
                    model.addCapturedData(imageData)
                }
                .environmentObject(state)
            }
            .alert(
                "Foto konnte nicht hinzugefügt werden",
                isPresented: Binding(
                    get: { model.errorMessage != nil },
                    set: { if !$0 { model.errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { model.errorMessage = nil }
            } message: {
                Text(model.errorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private var cameraPanel: some View {
        ZStack {
            CameraPreview(camera: camera)
                .ignoresSafeArea()
            Color.white.opacity(shutterFlash ? 0.72 : 0)

            LinearGradient(
                colors: [.black.opacity(0.4), .clear, .black.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )

            if codeScanning {
                RoundedRectangle(cornerRadius: 25, style: .continuous)
                    .stroke(InventoryTheme.lime, style: StrokeStyle(lineWidth: 3, dash: [16, 8]))
                    .frame(width: 245, height: 245)
            }

            VStack {
                HStack(spacing: 8) {
                    capturedPhotosButton

                    Spacer(minLength: 4)

                    Button {
                        toggleCodeScanning()
                    } label: {
                        Image(systemName: codeScanning ? "qrcode.viewfinder" : "barcode.viewfinder")
                            .frame(width: 42, height: 42)
                            .background(.black.opacity(0.36), in: Circle())
                    }
                    .foregroundStyle(codeScanning ? InventoryTheme.lime : .white)
                    Button {
                        camera.toggleTorch()
                    } label: {
                        Image(systemName: camera.torchEnabled ? "flashlight.on.fill" : "flashlight.off.fill")
                            .frame(width: 42, height: 42)
                            .background(.black.opacity(0.36), in: Circle())
                    }
                    .foregroundStyle(camera.torchEnabled ? InventoryTheme.lime : .white)
                    .disabled(!camera.torchAvailable)
                    .opacity(camera.torchAvailable ? 1 : 0.45)

                    if let onClose {
                        Button {
                            onClose()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.subheadline.weight(.bold))
                                .frame(width: 42, height: 42)
                                .background(.black.opacity(0.36), in: Circle())
                        }
                        .foregroundStyle(.white)
                        .accessibilityLabel("Erfassen schließen")
                    }

                    topUploadButton
                }

                Spacer()

                if !codeScanning {
                    HStack(spacing: 10) {
                        detailsButton
                        spatialCaptureButton
                    }
                    .padding(.bottom, 14)

                    HStack(alignment: .center) {
                        PhotosPicker(
                            selection: $pickerItems,
                            maxSelectionCount: CaptureViewModel.maximumPhotos - model.photos.count,
                            matching: .images
                        ) {
                            Image(systemName: "photo.on.rectangle.angled")
                                .font(.title3)
                                .frame(width: 52, height: 52)
                                .background(.black.opacity(0.36), in: Circle())
                        }
                        .foregroundStyle(.white)
                        .disabled(model.photos.count >= CaptureViewModel.maximumPhotos)

                        Spacer()

                        Button {
                            camera.capturePhoto()
                        } label: {
                            ZStack {
                                Circle().fill(.white).frame(width: 74, height: 74)
                                Circle()
                                    .stroke(.white.opacity(0.55), lineWidth: 3)
                                    .frame(width: 86, height: 86)
                                if model.processingCount > 0 {
                                    ProgressView().tint(InventoryTheme.ink)
                                }
                            }
                        }
                        .disabled(
                            camera.state != .ready
                                || model.photos.count >= CaptureViewModel.maximumPhotos
                        )

                        Spacer()

                        Button {
                            camera.switchCamera()
                        } label: {
                            Group {
                                if camera.isSwitchingCamera {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Image(systemName: "arrow.triangle.2.circlepath.camera.fill")
                                        .font(.title3)
                                        .foregroundStyle(.white)
                                }
                            }
                            .frame(width: 52, height: 52)
                            .background(.black.opacity(0.36), in: Circle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!camera.canSwitchCamera || camera.isSwitchingCamera)
                        .opacity(camera.canSwitchCamera ? 1 : 0.45)
                        .accessibilityLabel(
                            camera.isUsingFrontCamera
                                ? "Zur Rückkamera wechseln"
                                : "Zur Frontkamera wechseln"
                        )
                    }
                    .transition(.opacity)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 20)

            if camera.state == .denied {
                permissionOverlay
            } else if case .unavailable(let message) = camera.state {
                unavailableOverlay(message)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var capturedPhotosButton: some View {
        Button {
            openDetails()
        } label: {
            ZStack(alignment: .topTrailing) {
                Group {
                    if let photo = model.photos.last {
                        LocalThumbnail(url: photo.fileURL, size: 44)
                    } else {
                        Image(systemName: "photo.stack")
                            .font(.title3)
                            .frame(width: 44, height: 44)
                            .foregroundStyle(.white)
                    }
                }
                .background(.black.opacity(0.36))
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(.white.opacity(0.55), lineWidth: 1)
                }

                Text("\(model.photos.count)")
                    .font(.caption2.monospacedDigit().bold())
                    .foregroundStyle(InventoryTheme.ink)
                    .padding(.horizontal, 6)
                    .frame(minWidth: 22, minHeight: 22)
                    .background(InventoryTheme.lime, in: Capsule())
                    .offset(x: 8, y: -7)
            }
            .padding(.top, 7)
            .padding(.trailing, 8)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "Aufgenommene Fotos: \(model.photos.count) von \(CaptureViewModel.maximumPhotos)"
        )
        .accessibilityHint("Öffnet die aufgenommenen Fotos")
    }

    private var detailsButton: some View {
        Button {
            openDetails()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "slider.horizontal.3")
                Text(detailsSummary)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(.black.opacity(0.48), in: Capsule())
            .overlay {
                Capsule()
                    .stroke(.white.opacity(0.28), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Öffnet Namen, Ort und weitere Angaben")
    }

    private var spatialCaptureButton: some View {
        Button {
            presentSpatialCapture()
        } label: {
            HStack(spacing: 7) {
                Image(systemName: model.spatialPlacement == nil ? "cube.transparent" : "mappin.and.ellipse")
                Text(model.spatialPlacement == nil ? "Im Raum" : model.spatialPlacement?.roomName ?? "Im Raum")
                    .lineLimit(1)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(model.spatialPlacement == nil ? .white : InventoryTheme.ink)
            .padding(.horizontal, 15)
            .frame(minHeight: 44)
            .background(
                model.spatialPlacement == nil ? Color.black.opacity(0.48) : InventoryTheme.lime,
                in: Capsule()
            )
            .overlay {
                Capsule().stroke(.white.opacity(0.28), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Erfasst Foto und 3D-Position in einem gescannten Raum")
    }

    private var detailsSummary: String {
        let count = [model.name, model.locationName, model.sku, model.serialNumber]
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .count + (model.locationService.coordinates == nil ? 0 : 1)
        return count == 0 ? "Details" : "Details · \(count) Angaben"
    }

    private var detailsSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    photoTray
                    intakeOptions
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 30)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(InventoryTheme.canvas)
            .navigationTitle("Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") {
                        showDetails = false
                    }
                }
            }
        }
    }

    private var topUploadButton: some View {
        Button(action: submitCapture) {
            HStack(spacing: 6) {
                if model.processingCount > 0 {
                    ProgressView()
                        .controlSize(.small)
                        .tint(InventoryTheme.ink)
                } else {
                    Image(systemName: "arrow.up")
                }
                Text("Hochladen")
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(InventoryTheme.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 42)
            .background(InventoryTheme.lime, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!model.canSubmit || model.processingCount > 0)
        .opacity(model.canSubmit && model.processingCount == 0 ? 1 : 0.55)
        .accessibilityHint("Legt den Gegenstand an und startet den Upload")
    }

    @ViewBuilder
    private var photoTray: some View {
        if !model.photos.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(model.photos) { photo in
                        ZStack(alignment: .topTrailing) {
                            LocalThumbnail(url: photo.fileURL)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            Button {
                                model.removePhoto(photo)
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

    private var intakeOptions: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 7) {
                Text("Name (optional)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                TextField("Wird sonst aus Fotos erkannt", text: $model.name)
                    .textInputAutocapitalization(.sentences)
                    .padding(13)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            }

            HStack(spacing: 12) {
                Picker("Typ", selection: $model.resourceType) {
                    ForEach(InventoryResourceType.allCases, id: \.self) { type in
                        Text(type.localizedName).tag(type)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

                Button {
                    model.locationService.requestCurrentLocation()
                } label: {
                    Label(
                        model.locationService.coordinates == nil ? "GPS" : "GPS gesetzt",
                        systemImage: model.locationService.coordinates == nil ? "location" : "location.fill"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(InventoryTheme.ink)
            }

            TextField("Ort, Regal oder Raum", text: $model.locationName)
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

            if let placement = model.spatialPlacement {
                HStack(spacing: 10) {
                    Image(systemName: "mappin.and.ellipse")
                        .foregroundStyle(InventoryTheme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("3D-Position in \(placement.roomName)")
                            .font(.caption.weight(.semibold))
                        Text(placement.position.map { String(format: "%.2f", $0) }.joined(separator: " · ") + " m")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Entfernen") { model.clearSpatialPlacement() }
                        .font(.caption.weight(.semibold))
                }
                .padding(12)
                .background(InventoryTheme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            }

            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Label(
                        codeScanning ? "Code ins Kamerabild halten" : "QR-/Barcode-Zuordnung",
                        systemImage: codeScanning ? "viewfinder" : "qrcode"
                    )
                    .font(.caption.weight(.semibold))
                    Spacer()
                    Button(codeScanning ? "Abbrechen" : "Scannen") {
                        toggleCodeScanning()
                    }
                    .font(.caption.weight(.semibold))
                }
                TextField("SKU / Barcode", text: $model.sku)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                TextField("Seriennummer", text: $model.serialNumber)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            }

            if state.canUseAI {
                Toggle("Fotos analysieren", isOn: $model.autoAnalyze)
                Toggle("Cover erzeugen", isOn: $model.autoCover)
                    .disabled(!model.autoAnalyze)
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
        .padding(28)
        .foregroundStyle(.white)
        .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 22))
        .padding(24)
    }

    private func unavailableOverlay(_ message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").font(.title)
            Text(message).font(.subheadline).multilineTextAlignment(.center)
        }
        .padding(24)
        .foregroundStyle(.white)
        .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 20))
        .padding(24)
    }

    private func submitCapture() {
        guard model.canSubmit, model.processingCount == 0 else { return }
        let submission = model.makeSubmission(imageModelID: state.selectedImageModelID)
        onSubmit(submission)
        withAnimation {
            model.resetAfterSubmitting()
            showDetails = false
        }
    }

    private func openDetails() {
        if codeScanning {
            codeScanning = false
            camera.scanningEnabled = false
        }
        detailsDetent = .medium
        showDetails = true
    }

    private func presentSpatialCapture() {
        codeScanning = false
        camera.scanningEnabled = false
        camera.stop()
        showDetails = false
        showSpatialCapture = true
    }

    private func toggleCodeScanning() {
        let nextValue = !codeScanning
        codeScanning = nextValue
        camera.scanningEnabled = nextValue
        if nextValue {
            showDetails = false
        }
    }

    private func consumePendingCode() {
        guard let code = state.pendingCaptureCode else { return }
        state.pendingCaptureCode = nil
        model.applyScannedCode(code)
    }
}

extension InventoryResourceType {
    var localizedName: String {
        switch self {
        case .place: "Ort"
        case .person: "Person"
        case .vehicle: "Fahrzeug"
        case .tool: "Werkzeug"
        case .project: "Projekt"
        case .clothing: "Kleidung"
        case .furniture: "Möbel"
        case .object: "Gegenstand"
        case .other: "Sonstiges"
        case .custom(let value): value
        }
    }

    var symbolName: String {
        switch self {
        case .place: "mappin.and.ellipse"
        case .person: "person.crop.circle"
        case .vehicle: "car.fill"
        case .tool: "wrench.and.screwdriver.fill"
        case .project: "square.stack.3d.up.fill"
        case .clothing: "tshirt.fill"
        case .furniture: "chair.lounge.fill"
        case .object: "shippingbox.fill"
        case .other: "archivebox.fill"
        case .custom: "square.grid.2x2.fill"
        }
    }
}
