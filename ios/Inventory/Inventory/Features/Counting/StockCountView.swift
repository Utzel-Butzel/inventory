import SwiftUI
import UIKit

struct StockCountView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var camera = CameraService()
    @StateObject private var model: StockCountViewModel
    @State private var captureRequested = false
    @State private var confirmIssue = false

    let resource: InventoryResource
    let onApplied: (InventoryResource) -> Void

    init(
        resource: InventoryResource,
        onApplied: @escaping (InventoryResource) -> Void
    ) {
        self.resource = resource
        self.onApplied = onApplied
        _model = StateObject(
            wrappedValue: StockCountViewModel(itemHint: resource.name, itemID: resource.id)
        )
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    introduction
                    itemHintField
                    countModelPicker
                    cameraPanel
                    if let result = model.result {
                        resultCard(result)
                        stockActionCard
                    } else if model.photoURL != nil, !model.isAnalyzing {
                        retryCard
                    }
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .background(InventoryTheme.canvas)
            .navigationTitle("Teile per Foto zählen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Schließen") { dismiss() }
                        .disabled(model.phase == .booking)
                }
            }
        }
        .interactiveDismissDisabled(model.phase == .booking)
        .task {
            if let client = state.client {
                await model.loadCountModels(using: client)
            }
        }
        .confirmationDialog(
            "Gezählte Teile entnehmen?",
            isPresented: $confirmIssue,
            titleVisibility: .visible
        ) {
            Button(
                "\(model.adjustedCount) Teile entnehmen",
                role: .destructive
            ) {
                apply(.issue)
            }
            Button("Abbrechen", role: .cancel) { }
        } message: {
            Text(
                "Der Bestand wird von \(resource.quantity) auf "
                    + "\(resource.quantity - model.adjustedCount) reduziert."
            )
        }
        .onAppear {
            camera.scanningEnabled = false
            camera.onPhoto = { result in
                captureRequested = false
                guard case .success(let data) = result else {
                    if case .failure(let error) = result {
                        model.errorMessage = error.localizedDescription
                    }
                    return
                }
                if camera.torchEnabled { camera.toggleTorch() }
                camera.stop()
                guard let client = state.client else {
                    model.errorMessage = "Keine Verbindung zum Inventarserver."
                    camera.start()
                    return
                }
                model.analyzeCapturedData(data, using: client)
            }
            camera.start()
        }
        .onDisappear {
            if camera.torchEnabled { camera.toggleTorch() }
            camera.stop()
            camera.onPhoto = nil
            model.cleanup()
        }
        .onChange(of: model.phase) { _, phase in
            if phase == .camera, model.photoURL == nil {
                captureRequested = false
                camera.start()
            }
        }
        .alert(
            "Aktion fehlgeschlagen",
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

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(resource.name, systemImage: "shippingbox.fill")
                .font(.headline)
            Text("Lege alle Teile gut sichtbar und möglichst ohne Überlappungen aus. Die erkannte Anzahl kann vor der Buchung korrigiert werden.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .inventoryCard()
    }

    private var itemHintField: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("Was soll gezählt werden?")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(
                    "\(model.itemHint.utf16.count)/"
                        + "\(StockCountViewModel.maximumItemHintUTF16Length)"
                )
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
            TextField("z. B. rote 3D-Druckteile", text: $model.itemHint)
                .textInputAutocapitalization(.sentences)
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
                .disabled(model.isBusy || model.result != nil)
        }
        .inventoryCard()
    }

    private var countModelPicker: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Zählmodell")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Picker("Zählmodell", selection: $model.selectedCountModelID) {
                ForEach(model.countModels) { option in
                    Text(option.label).tag(option.id)
                }
            }
            .pickerStyle(.menu)
            .disabled(model.isBusy || model.result != nil)
            if let selected = model.countModels.first(where: {
                $0.id == model.selectedCountModelID
            }) {
                Text(selected.description)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .inventoryCard()
    }

    private var cameraPanel: some View {
        ZStack {
            if let photoURL = model.photoURL {
                StockCountPhotoPreview(
                    url: photoURL,
                    markers: model.result?.markers ?? []
                )
            } else {
                CameraPreview(camera: camera)
            }

            LinearGradient(
                colors: [.black.opacity(0.36), .clear, .black.opacity(0.52)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack {
                HStack {
                    Label(cameraLabel, systemImage: "circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.black.opacity(0.38), in: Capsule())
                    Spacer()
                    if model.photoURL == nil {
                        Button { camera.toggleTorch() } label: {
                            Image(
                                systemName: camera.torchEnabled
                                    ? "flashlight.on.fill"
                                    : "flashlight.off.fill"
                            )
                            .frame(width: 42, height: 42)
                            .background(.black.opacity(0.38), in: Circle())
                        }
                        .foregroundStyle(camera.torchEnabled ? InventoryTheme.lime : .white)
                    }
                }

                Spacer()

                if model.photoURL == nil, !model.isAnalyzing {
                    Button {
                        captureRequested = true
                        camera.capturePhoto()
                    } label: {
                        ZStack {
                            Circle().fill(.white).frame(width: 72, height: 72)
                            Circle()
                                .stroke(.white.opacity(0.58), lineWidth: 3)
                                .frame(width: 84, height: 84)
                        }
                    }
                    .disabled(camera.state != .ready || captureRequested)
                    .accessibilityLabel("Foto aufnehmen und Teile zählen")
                } else if model.result != nil {
                    Button {
                        model.retake()
                        captureRequested = false
                        camera.start()
                    } label: {
                        Label("Neues Foto", systemImage: "camera.rotate")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 11)
                            .background(.black.opacity(0.56), in: Capsule())
                    }
                    .foregroundStyle(.white)
                }
            }
            .padding(16)

            if model.isAnalyzing {
                VStack(spacing: 12) {
                    ProgressView().tint(.white).controlSize(.large)
                    Text(
                        model.phase == .preparingPhoto
                            ? "Foto wird vorbereitet …"
                            : "Teile werden gezählt …"
                    )
                    .font(.headline)
                }
                .foregroundStyle(.white)
                .padding(24)
                .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 20))
            } else if camera.state == .denied, model.photoURL == nil {
                permissionOverlay
            } else if case .unavailable(let message) = camera.state,
                      model.photoURL == nil {
                unavailableOverlay(message)
            }
        }
        .frame(height: 390)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(.white.opacity(0.16), lineWidth: 1)
        }
    }

    private func resultCard(_ result: ObjectCountResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Erkannte Anzahl")
                        .font(.headline)
                    if !result.detectedItem.isEmpty {
                        Text(result.detectedItem)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Label(
                    result.isExact ? "Eindeutig" : "Bitte prüfen",
                    systemImage: result.isExact ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(result.isExact ? InventoryTheme.success : InventoryTheme.warning)
            }

            HStack(spacing: 16) {
                TextField("Anzahl", value: $model.adjustedCount, format: .number)
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
                    value: $model.adjustedCount,
                    in: 0 ... StockCountViewModel.maximumCount
                )
                .labelsHidden()
            }

            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text("Konfidenz")
                    Spacer()
                    Text(result.confidence.formatted(.percent.precision(.fractionLength(0))))
                        .monospacedDigit()
                }
                .font(.caption.weight(.semibold))
                ProgressView(value: min(max(result.confidence, 0), 1))
                    .tint(result.isExact ? InventoryTheme.success : InventoryTheme.warning)
            }

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
            Text("Prüfe und korrigiere die Zahl, bevor du den Bestand änderst.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .inventoryCard()
    }

    private var stockActionCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Bestand ändern", systemImage: "arrow.left.arrow.right")
                    .font(.headline)
                Spacer()
                Text("Aktuell: \(resource.quantity)")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
            }

            if model.adjustedCount > resource.quantity && !state.allowsNegativeStock {
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
                        Text("danach \(resource.quantity - model.adjustedCount)")
                            .font(.caption.monospacedDigit())
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.bordered)
                .disabled(
                    !model.canApplyIssue(
                        currentQuantity: resource.quantity,
                        allowNegativeStock: state.allowsNegativeStock
                    )
                )

                Button {
                    apply(.receipt)
                } label: {
                    VStack(spacing: 4) {
                        Label("Hinzufügen", systemImage: "plus.circle.fill")
                        Text("danach \(resource.quantity + model.adjustedCount)")
                            .font(.caption.monospacedDigit())
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
                .tint(InventoryTheme.ink)
                .disabled(!model.canApplyReceipt)
            }

            if model.phase == .booking {
                ProgressView("Bestand wird gebucht …")
                    .frame(maxWidth: .infinity)
            }
        }
        .inventoryCard()
    }

    private var retryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Das Foto ist bereit, konnte aber noch nicht ausgewertet werden.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack {
                Button("Neues Foto") {
                    model.retake()
                    captureRequested = false
                    camera.start()
                }
                .buttonStyle(.bordered)
                Spacer()
                Button("Erneut zählen") {
                    guard let client = state.client else {
                        model.errorMessage = "Keine Verbindung zum Inventarserver."
                        return
                    }
                    model.retryAnalysis(using: client)
                }
                .buttonStyle(.borderedProminent)
                .tint(InventoryTheme.ink)
            }
        }
        .inventoryCard()
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
        .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 20))
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
        if model.phase == .preparingPhoto { return "Foto wird vorbereitet" }
        if model.phase == .analyzing { return "KI zählt" }
        if model.photoURL != nil { return "Zählfoto" }
        return switch camera.state {
        case .idle: "Kamera aus"
        case .requestingPermission: "Berechtigung …"
        case .ready: "Bereit zum Zählen"
        case .denied: "Gesperrt"
        case .unavailable: "Nicht verfügbar"
        }
    }

    private func apply(_ operation: StockCountOperation) {
        guard let client = state.client else {
            model.errorMessage = "Keine Verbindung zum Inventarserver."
            return
        }
        model.apply(
            operation,
            to: resource,
            allowNegativeStock: state.allowsNegativeStock,
            using: client
        ) { updated in
            onApplied(updated)
            dismiss()
        }
    }
}

struct StockCountPhotoPreview: View {
    let url: URL
    let markers: [ObjectCountMarker]
    let contentMode: ContentMode
    @State private var image: UIImage?

    init(
        url: URL,
        markers: [ObjectCountMarker],
        contentMode: ContentMode = .fit
    ) {
        self.url = url
        self.markers = markers
        self.contentMode = contentMode
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Rectangle().fill(.secondary.opacity(0.12))
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .frame(
                            width: geometry.size.width,
                            height: geometry.size.height
                        )
                    markerOverlay(imageSize: image.size)
                } else {
                    ProgressView()
                }
            }
        }
        .clipped()
        .task(id: url) {
            image = UIImage(contentsOfFile: url.path)
        }
    }

    private func markerOverlay(imageSize: CGSize) -> some View {
        Canvas { context, size in
            let imageRect = displayedImageRect(imageSize: imageSize, in: size)
            guard !imageRect.isEmpty else { return }

            for marker in markers
                where (0 ... 1_000).contains(marker.x) && (0 ... 1_000).contains(marker.y) {
                let point = CGPoint(
                    x: imageRect.minX + imageRect.width * CGFloat(marker.x) / 1_000,
                    y: imageRect.minY + imageRect.height * CGFloat(marker.y) / 1_000
                )
                let outerRect = CGRect(
                    x: point.x - 7,
                    y: point.y - 7,
                    width: 14,
                    height: 14
                )
                context.fill(Path(ellipseIn: outerRect), with: .color(.white))
                context.fill(
                    Path(ellipseIn: outerRect.insetBy(dx: 2.5, dy: 2.5)),
                    with: .color(InventoryTheme.lime)
                )
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func displayedImageRect(imageSize: CGSize, in containerSize: CGSize) -> CGRect {
        guard imageSize.width > 0,
              imageSize.height > 0,
              containerSize.width > 0,
              containerSize.height > 0 else {
            return .zero
        }
        let horizontalScale = containerSize.width / imageSize.width
        let verticalScale = containerSize.height / imageSize.height
        let scale = switch contentMode {
        case .fit:
            min(horizontalScale, verticalScale)
        case .fill:
            max(horizontalScale, verticalScale)
        }
        let fittedSize = CGSize(
            width: imageSize.width * scale,
            height: imageSize.height * scale
        )
        return CGRect(
            x: (containerSize.width - fittedSize.width) / 2,
            y: (containerSize.height - fittedSize.height) / 2,
            width: fittedSize.width,
            height: fittedSize.height
        )
    }
}
