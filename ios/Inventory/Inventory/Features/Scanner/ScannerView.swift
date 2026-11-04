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
            .navigationTitle(L10n.text("ui_qr_barcode_29cf3034"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let onClose {
                    ToolbarItem(placement: .cancellationAction) {
                        Button {
                            onClose()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel(L10n.text("ui_close_scanner_e657d12e"))
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
                L10n.text("ui_could_not_process_code_9a640900"),
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil; resumeScanning() } }
                )
            ) {
                Button(L10n.text("ui_try_again_130ba1e2"), role: .cancel) {
                    errorMessage = nil
                    resumeScanning()
                }
            } message: {
                Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
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
                        isResolving ? L10n.text("ui_searching_295864f3") : L10n.text("ui_hold_the_code_inside_the_square_279dbd02"),
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
                    Text(L10n.text("ui_allow_camera_access_in_settings_99e79884"))
                        .font(.headline)
                    Button(L10n.text("ui_open_settings_b05424fb")) {
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
                Label(L10n.text("ui_not_in_inventory_yet_003eb9c5"), systemImage: "questionmark.app.dashed")
                    .font(.headline)
                Text(code)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .textSelection(.enabled)
                if state.canCreateInventory {
                    Button {
                        state.pendingCaptureCode = code
                        unmatchedCode = nil
                        state.presentedTool = .capture
                    } label: {
                        Label(L10n.text("ui_capture_with_photos_2c95bc6a"), systemImage: "camera.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(InventoryTheme.ink)
                    Button {
                        showCreateForm = true
                    } label: {
                        Label(L10n.text("ui_create_basic_details_only_dc33a725"), systemImage: "doc.badge.plus")
                            .frame(maxWidth: .infinity, minHeight: 42)
                    }
                    .buttonStyle(.bordered)
                } else {
                    Label(L10n.text("ui_read_only_access_014dace5"), systemImage: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button(L10n.text("ui_scan_a_different_code_408f68c5")) {
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
            Text(L10n.text("ui_enter_code_manually_0162322b")).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            HStack {
                TextField(L10n.text("ui_uuid_sku_or_serial_number_0145c2ae"), text: $manualCode)
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
            errorMessage = L10n.text("ui_no_server_connection_configured_4a1c3f55")
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
