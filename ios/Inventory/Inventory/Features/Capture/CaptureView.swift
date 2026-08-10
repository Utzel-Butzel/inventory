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
    @State private var controlsExpanded = false
    @GestureState private var drawerDragOffset: CGFloat = 0

    let onSubmit: (IntakeSubmission) -> Void

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let drawerHeight = min(
                    max(geometry.size.height * 0.66, 320),
                    min(geometry.size.height, 610)
                )

                ZStack(alignment: .bottom) {
                    cameraPanel
                    captureDrawer(height: drawerHeight)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
            }
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
                .ignoresSafeArea(.container, edges: .horizontal)
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
                HStack {
                    Label(cameraLabel, systemImage: "circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.black.opacity(0.36), in: Capsule())
                    Spacer()
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
                }

                Spacer()

                if !controlsExpanded {
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

                        Text("\(model.photos.count)/\(CaptureViewModel.maximumPhotos)")
                            .font(.callout.monospacedDigit().weight(.semibold))
                            .frame(width: 52, height: 52)
                            .background(.black.opacity(0.36), in: Circle())
                            .foregroundStyle(.white)
                    }
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, collapsedDrawerHeight + 20)

            if camera.state == .denied {
                permissionOverlay
            } else if case .unavailable(let message) = camera.state {
                unavailableOverlay(message)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func captureDrawer(height: CGFloat) -> some View {
        let restingOffset = controlsExpanded ? 0 : height - collapsedDrawerHeight
        let maximumOffset = height - collapsedDrawerHeight
        let currentOffset = min(max(restingOffset + drawerDragOffset, 0), maximumOffset)

        return VStack(spacing: 0) {
            drawerHeader
            Divider().opacity(controlsExpanded ? 1 : 0)

            ScrollView {
                VStack(spacing: 16) {
                    photoTray
                    intakeOptions
                    submitButton
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .frame(maxWidth: .infinity)
        .frame(height: height, alignment: .top)
        .background(.regularMaterial)
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: 28,
                topTrailingRadius: 28,
                style: .continuous
            )
        )
        .overlay(alignment: .top) {
            UnevenRoundedRectangle(
                topLeadingRadius: 28,
                topTrailingRadius: 28,
                style: .continuous
            )
            .stroke(.white.opacity(0.45), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.24), radius: 18, y: -5)
        .offset(y: currentOffset)
        .animation(.interactiveSpring(response: 0.34, dampingFraction: 0.86), value: controlsExpanded)
    }

    private var drawerHeader: some View {
        Button {
            withAnimation(.interactiveSpring(response: 0.34, dampingFraction: 0.86)) {
                setControlsExpanded(!controlsExpanded)
            }
        } label: {
            VStack(spacing: 8) {
                Capsule()
                    .fill(.secondary.opacity(0.45))
                    .frame(width: 38, height: 5)

                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Details & Upload")
                            .font(.headline)
                        Text(controlsExpanded ? "Nach unten ziehen zum Schließen" : "Nach oben ziehen zum Öffnen")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Label("\(model.photos.count)", systemImage: "photo.stack.fill")
                        .font(.subheadline.monospacedDigit().weight(.semibold))
                        .padding(.horizontal, 11)
                        .padding(.vertical, 7)
                        .background(InventoryTheme.lime.opacity(0.72), in: Capsule())

                    Image(systemName: controlsExpanded ? "chevron.down" : "chevron.up")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .frame(height: collapsedDrawerHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .gesture(drawerDragGesture)
        .accessibilityHint(controlsExpanded ? "Klappt die Details ein" : "Klappt die Details auf")
    }

    private var drawerDragGesture: some Gesture {
        DragGesture(minimumDistance: 5)
            .updating($drawerDragOffset) { value, offset, _ in
                offset = value.translation.height
            }
            .onEnded { value in
                let projectedDistance = value.predictedEndTranslation.height
                let shouldExpand: Bool
                if projectedDistance < -45 {
                    shouldExpand = true
                } else if projectedDistance > 45 {
                    shouldExpand = false
                } else {
                    shouldExpand = controlsExpanded
                }

                withAnimation(.interactiveSpring(response: 0.34, dampingFraction: 0.86)) {
                    setControlsExpanded(shouldExpand)
                }
            }
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
        .inventoryCard()
    }

    private var submitButton: some View {
        Button {
            let submission = model.makeSubmission()
            onSubmit(submission)
            withAnimation {
                model.resetAfterSubmitting()
                controlsExpanded = false
            }
        } label: {
            HStack {
                Image(systemName: "arrow.up.circle.fill")
                Text("Hochladen")
                Spacer()
                Text("\(model.photos.count)").monospacedDigit()
            }
            .font(.headline)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(.plain)
        .foregroundStyle(InventoryTheme.ink)
        .background(InventoryTheme.lime, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .disabled(!model.canSubmit || model.processingCount > 0)
        .opacity(model.canSubmit && model.processingCount == 0 ? 1 : 0.45)
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

    private var cameraLabel: String {
        switch camera.state {
        case .idle: "Kamera aus"
        case .requestingPermission: "Berechtigung …"
        case .ready: "Bereit"
        case .denied: "Gesperrt"
        case .unavailable: "Nicht verfügbar"
        }
    }

    private var collapsedDrawerHeight: CGFloat { 82 }

    private func setControlsExpanded(_ expanded: Bool) {
        controlsExpanded = expanded
        if expanded, codeScanning {
            codeScanning = false
            camera.scanningEnabled = false
        }
    }

    private func toggleCodeScanning() {
        let nextValue = !codeScanning
        codeScanning = nextValue
        camera.scanningEnabled = nextValue
        if nextValue {
            withAnimation(.interactiveSpring(response: 0.34, dampingFraction: 0.86)) {
                controlsExpanded = false
            }
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
        }
    }
}
