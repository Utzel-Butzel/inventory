import PhotosUI
import SwiftUI
import UIKit

struct CaptureView: View {
    @EnvironmentObject private var state: AppState
    @StateObject private var camera = CameraService()
    @StateObject private var model: CaptureViewModel
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var shutterFlash = false
    @State private var codeScanning = false
    @State private var showDetails = false
    @State private var detailsDetent: PresentationDetent = .medium
    @State private var showSpatialCapture = false
    @State private var inventoryTypes: [InventoryTypeDefinition] = []

    let onClose: (() -> Void)?
    let onSubmit: (IntakeSubmission) -> Void

    init(
        maximumUploadImagePixelSize: Int,
        onClose: (() -> Void)? = nil,
        onSubmit: @escaping (IntakeSubmission) -> Void
    ) {
        _model = StateObject(
            wrappedValue: CaptureViewModel(
                maximumPixelSize: maximumUploadImagePixelSize
            )
        )
        self.onClose = onClose
        self.onSubmit = onSubmit
    }

    var body: some View {
        NavigationStack {
            cameraPanel
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
            .toolbar(.hidden, for: .navigationBar)
            .task(id: state.organizationContextIdentifier) {
                await model.loadAIDefaults(from: state)
            }
            .onAppear {
                camera.scanningEnabled = false
                camera.onCode = { code in
                    model.applyScannedCode(code)
                    codeScanning = false
                    camera.scanningEnabled = false
                }
                camera.onPhoto = { result in
                    switch result {
                    case .success(let data):
                        withAnimation(.easeOut(duration: 0.12)) { shutterFlash = true }
                        model.addCameraCapturedData(data)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) {
                            withAnimation(.easeIn(duration: 0.14)) { shutterFlash = false }
                        }
                    case .failure(let error):
                        model.errorMessage = error.localizedDescription
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
            .task {
                guard let client = state.client else { return }
                inventoryTypes = (try? await client.inventoryTypes().types) ?? []
            }
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
                L10n.text("ui_could_not_add_photo_e4fcc8de"),
                isPresented: Binding(
                    get: { model.errorMessage != nil },
                    set: { if !$0 { model.errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { model.errorMessage = nil }
            } message: {
                Text(model.errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
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
                        .accessibilityLabel(L10n.text("ui_close_capture_dcb1dca3"))
                    }

                    topUploadButton
                }

                Spacer()

                if !codeScanning {
                    HStack(spacing: 10) {
                        detailsButton
                        if state.canManageSpatial {
                            spatialCaptureButton
                        }
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
                                ? L10n.text("ui_switch_to_rear_camera_33a18d67")
                                : L10n.text("ui_switch_to_front_camera_ac6c89db")
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
            L10n.text("ui_photos_taken_0_of_1_c20e6760", model.photos.count, CaptureViewModel.maximumPhotos)
        )
        .accessibilityHint(L10n.text("ui_opens_captured_photos_6d56cfef"))
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
        .accessibilityHint(L10n.text("ui_opens_name_location_and_other_details_d534fc78"))
    }

    private var spatialCaptureButton: some View {
        Button {
            presentSpatialCapture()
        } label: {
            HStack(spacing: 7) {
                Image(systemName: model.spatialPlacement == nil ? "cube.transparent" : "mappin.and.ellipse")
                Text(model.spatialPlacement == nil ? L10n.text("ui_in_room_da48d729") : model.spatialPlacement?.roomName ?? L10n.text("ui_in_room_da48d729"))
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
        .accessibilityHint(L10n.text("ui_captures_a_photo_and_3d_position_in_91e09d30"))
    }

    private var detailsSummary: String {
        let count = [model.name, model.locationName, model.sku, model.barcode, model.serialNumber]
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .count + (model.locationService.coordinates == nil ? 0 : 1)
        return count == 0 ? L10n.text("ui_details_45989de4") : L10n.text("ui_details_0_fields_72ce2ae9", count)
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
            .navigationTitle(L10n.text("ui_details_45989de4"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.text("ui_done_25d52d7e")) {
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
                Text(L10n.text("ui_upload_6638ef84"))
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(InventoryTheme.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 42)
            .background(InventoryTheme.lime, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!model.canSubmit || model.processingCount > 0 || (state.canUseAI && !model.aiDefaultsLoaded))
        .opacity(model.canSubmit && model.processingCount == 0 ? 1 : 0.55)
        .accessibilityHint(L10n.text("ui_creates_the_item_and_starts_the_upload_0fa46231"))
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
                Text(L10n.text("ui_name_optional_e09b37bc")).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                TextField(L10n.text("ui_otherwise_detected_from_photos_c4cfd713"), text: $model.name)
                    .textInputAutocapitalization(.sentences)
                    .padding(13)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            }

            HStack(spacing: 12) {
                Picker(L10n.text("ui_type_1b024183"), selection: $model.resourceType) {
                    ForEach(captureTypes, id: \.self) { type in
                        Text(captureTypeLabel(type)).tag(type)
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
                        model.locationService.coordinates == nil ? "GPS" : L10n.text("ui_gps_set_8af94f20"),
                        systemImage: model.locationService.coordinates == nil ? "location" : "location.fill"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(InventoryTheme.ink)
            }

            TextField(L10n.text("ui_location_shelf_or_room_5161bf8f"), text: $model.locationName)
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

            if let placement = model.spatialPlacement {
                HStack(spacing: 10) {
                    Image(systemName: "mappin.and.ellipse")
                        .foregroundStyle(InventoryTheme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L10n.text("ui_3d_position_in_0_cf6a0309", placement.roomName))
                            .font(.caption.weight(.semibold))
                        Text(placement.position.map { String(format: "%.2f", $0) }.joined(separator: " · ") + " m")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(L10n.text("ui_remove_3828375a")) { model.clearSpatialPlacement() }
                        .font(.caption.weight(.semibold))
                }
                .padding(12)
                .background(InventoryTheme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            }

            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Label(
                        codeScanning ? L10n.text("ui_hold_the_code_in_the_camera_view_bb6b0370") : "QR-/Barcode-Zuordnung",
                        systemImage: codeScanning ? "viewfinder" : "qrcode"
                    )
                    .font(.caption.weight(.semibold))
                    Spacer()
                    Button(codeScanning ? L10n.text("ui_cancel_f7ff1178") : L10n.text("ui_scan_2a53b078")) {
                        toggleCodeScanning()
                    }
                    .font(.caption.weight(.semibold))
                }
                TextField("SKU", text: $model.sku)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                TextField(L10n.text("ui_barcode_a401f372"), text: $model.barcode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                TextField(L10n.text("ui_serial_number_760abc3d"), text: $model.serialNumber)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            }

            if state.canUseAI {
                VStack(alignment: .leading, spacing: 3) {
                    if !model.aiDefaultsLoaded {
                        Button(L10n.text("ui_reload_ai_defaults_647b46ea")) { Task { await model.loadAIDefaults(from: state) } }
                    }
                    Toggle(L10n.text("ui_analyze_photos_957b01f7"), isOn: $model.autoAnalyze)
                    if model.autoAnalyze {
                        Toggle(L10n.text("ui_overwrite_existing_text_e3d8f4dd"), isOn: $model.analysisOverwrite)
                    }
                    if state.canResearchInventory {
                        Toggle(L10n.text("ui_research_after_creating_3b405147"), isOn: $model.autoResearch)
                        Text(L10n.text("ui_research_adds_missing_details_from_the_web_4e5d6382"))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let estimate = state.aiCostEstimate(for: "inventoryAnalysis") {
                        Label(
                            L10n.text("ui_estimated_api_cost_0_f15c8c17", estimate.formattedUSD),
                            systemImage: "dollarsign.circle"
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Toggle(L10n.text("ui_generate_cover_a4f5e57d"), isOn: $model.autoCover)
                        .disabled(!model.autoAnalyze)
                    if let estimate = state.imageGenerationCostEstimate() {
                        Label(
                            L10n.text("ui_estimated_api_cost_0_f15c8c17", estimate.formattedUSD),
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
            Text(L10n.text("ui_camera_access_missing_f7ed6654")).font(.headline)
            Text(L10n.text("ui_enable_the_camera_in_ios_settings_3f9e91ac"))
                .font(.subheadline)
                .multilineTextAlignment(.center)
            Button(L10n.text("ui_open_settings_b05424fb")) {
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
        guard (!state.canUseAI || model.aiDefaultsLoaded), model.canSubmit, model.processingCount == 0 else { return }
        let submission = model.makeSubmission(
            imageModelID: state.selectedImageModelID,
            maximumAIGeneratedImagePixelSize: state.maximumAIGeneratedImagePixelSize,
            analysisPrompt: state.analysisPrompt,
            coverPrompt: state.coverPrompt
        )
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

extension InventoryResourceType {
    var localizedName: String {
        switch self {
        case .place: L10n.text("ui_place_30fb2591")
        case .person: L10n.text("ui_person_6007db63")
        case .vehicle: L10n.text("ui_vehicle_56f7557e")
        case .tool: L10n.text("ui_tool_bf1349a8")
        case .project: L10n.text("ui_project_40ebf93a")
        case .clothing: L10n.text("ui_clothing_e6bb4b3e")
        case .furniture: L10n.text("ui_furniture_c895b27d")
        case .object: L10n.text("ui_item_72e2f335")
        case .other: L10n.text("ui_other_9f3d5f8d")
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
