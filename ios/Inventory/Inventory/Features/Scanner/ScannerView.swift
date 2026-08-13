import AVFoundation
import SwiftUI
import UIKit

struct ScannerView: View {
    @EnvironmentObject private var state: AppState
    @StateObject private var camera = CameraService()
    @State private var manualCode = ""
    @State private var lastCode: String?
    @State private var isResolving = false
    @State private var foundResource: InventoryResource?
    @State private var unmatchedCode: String?
    @State private var showCreateForm = false
    @State private var errorMessage: String?

    let onClose: (() -> Void)?

    init(onClose: (() -> Void)? = nil) {
        self.onClose = onClose
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    scannerPanel
                    resultCard
                    manualEntry
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(InventoryTheme.canvas)
            .navigationTitle("QR & Barcode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let onClose {
                    ToolbarItem(placement: .cancellationAction) {
                        Button {
                            onClose()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel("Scanner schließen")
                    }
                }
            }
            .onAppear {
                camera.scanningEnabled = true
                camera.onCode = { code in resolve(code) }
                camera.start()
                if let pending = state.pendingScanCode {
                    state.pendingScanCode = nil
                    resolve(pending)
                }
            }
            .onDisappear { camera.stop() }
            .onChange(of: state.pendingScanCode) { _, code in
                guard let code else { return }
                state.pendingScanCode = nil
                resolve(code)
            }
            .sheet(item: $foundResource, onDismiss: resumeScanning) { resource in
                NavigationStack { ResourceDetailView(resource: resource) }
            }
            .sheet(isPresented: $showCreateForm, onDismiss: resumeScanning) {
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
            .alert(
                "Code konnte nicht verarbeitet werden",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil; resumeScanning() } }
                )
            ) {
                Button("Noch einmal", role: .cancel) {
                    errorMessage = nil
                    resumeScanning()
                }
            } message: {
                Text(errorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private var scannerPanel: some View {
        ZStack {
            CameraPreview(camera: camera)
            LinearGradient(
                colors: [.black.opacity(0.38), .clear, .black.opacity(0.45)],
                startPoint: .top,
                endPoint: .bottom
            )

            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(InventoryTheme.lime, style: StrokeStyle(lineWidth: 3, dash: [18, 9]))
                .frame(width: 245, height: 245)
                .shadow(color: .black.opacity(0.25), radius: 8)

            VStack {
                HStack {
                    Label(
                        isResolving ? "Wird gesucht …" : "Code ins Quadrat halten",
                        systemImage: isResolving ? "magnifyingglass" : "viewfinder"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.4), in: Capsule())
                    Spacer()
                    Button { camera.toggleTorch() } label: {
                        Image(systemName: camera.torchEnabled ? "flashlight.on.fill" : "flashlight.off.fill")
                            .frame(width: 42, height: 42)
                            .background(.black.opacity(0.4), in: Circle())
                    }
                    .foregroundStyle(camera.torchEnabled ? InventoryTheme.lime : .white)
                }
                Spacer()
                if isResolving {
                    ProgressView()
                        .tint(InventoryTheme.lime)
                        .scaleEffect(1.3)
                        .padding(18)
                        .background(.black.opacity(0.5), in: Circle())
                }
            }
            .padding(16)

            if camera.state == .denied {
                VStack(spacing: 12) {
                    Image(systemName: "camera.fill").font(.largeTitle)
                    Text("Kamera in den Einstellungen erlauben")
                        .font(.headline)
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
            }
        }
        .frame(height: 430)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    @ViewBuilder
    private var resultCard: some View {
        if let code = unmatchedCode {
            VStack(alignment: .leading, spacing: 12) {
                Label("Noch nicht im Inventar", systemImage: "questionmark.app.dashed")
                    .font(.headline)
                Text(code)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .textSelection(.enabled)
                if state.canWrite {
                    Button {
                        state.pendingCaptureCode = code
                        unmatchedCode = nil
                        state.presentedTool = .capture
                    } label: {
                        Label("Mit Fotos erfassen", systemImage: "camera.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(InventoryTheme.ink)
                    Button {
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
                    resumeScanning()
                }
                .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .inventoryCard()
        }
    }

    private var manualEntry: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Code manuell eingeben").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            HStack {
                TextField("UUID, SKU oder Seriennummer", text: $manualCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { resolve(manualCode) }
                Button {
                    resolve(manualCode)
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

    private func resolve(_ rawCode: String) {
        let code = rawCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, !isResolving, code != lastCode else { return }
        guard let client = state.client else {
            errorMessage = "Keine Serververbindung eingerichtet."
            return
        }
        lastCode = code
        isResolving = true
        unmatchedCode = nil
        camera.scanningEnabled = false

        Task {
            do {
                let result = try await client.lookupResource(code: code)
                foundResource = result.resource
                manualCode = ""
            } catch let error as APIClientError where error.statusCode == 404 {
                unmatchedCode = code
            } catch {
                errorMessage = error.localizedDescription
            }
            isResolving = false
        }
    }

    private func resumeScanning() {
        lastCode = nil
        camera.scanningEnabled = true
    }
}
