import AVFoundation
import AudioToolbox
import Foundation

final class CameraService: NSObject, ObservableObject, @unchecked Sendable {
    enum State: Equatable {
        case idle
        case requestingPermission
        case ready
        case denied
        case unavailable(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var torchEnabled = false

    let session = AVCaptureSession()
    var scanningEnabled: Bool {
        get {
            scanningStateLock.lock()
            defer { scanningStateLock.unlock() }
            return scanningEnabledStorage
        }
        set {
            scanningStateLock.lock()
            scanningEnabledStorage = newValue
            scanningStateLock.unlock()
        }
    }
    var onCode: ((String) -> Void)?
    var onPhoto: ((Data) -> Void)?

    private let sessionQueue = DispatchQueue(
        label: "digital.congru.inventory.camera.session",
        qos: .userInitiated
    )
    private let metadataQueue = DispatchQueue(label: "digital.congru.inventory.camera.metadata")
    private let photoOutput = AVCapturePhotoOutput()
    private let metadataOutput = AVCaptureMetadataOutput()
    private var cameraDevice: AVCaptureDevice?
    private var configured = false
    private var lastScan: (value: String, time: Date)?
    private let scanningStateLock = NSLock()
    private var scanningEnabledStorage = true

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureAndStart()
        case .notDetermined:
            setState(.requestingPermission)
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard let self else { return }
                granted ? self.configureAndStart() : self.setState(.denied)
            }
        case .denied, .restricted:
            setState(.denied)
        @unknown default:
            setState(.denied)
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }

    func capturePhoto() {
        sessionQueue.async { [weak self] in
            guard let self, self.configured, self.session.isRunning else { return }
            let settings: AVCapturePhotoSettings
            if self.photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
                settings = AVCapturePhotoSettings(
                    format: [AVVideoCodecKey: AVVideoCodecType.jpeg]
                )
            } else {
                settings = AVCapturePhotoSettings()
            }
            settings.photoQualityPrioritization = .balanced
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    func toggleTorch() {
        sessionQueue.async { [weak self] in
            guard let self, let device = self.cameraDevice, device.hasTorch else { return }
            do {
                try device.lockForConfiguration()
                let enabled = !device.isTorchActive
                if enabled {
                    try device.setTorchModeOn(level: 0.7)
                } else {
                    device.torchMode = .off
                }
                device.unlockForConfiguration()
                DispatchQueue.main.async { self.torchEnabled = enabled }
            } catch {
                // Torch support varies by hardware and current thermal state.
            }
        }
    }

    func updateScanningRegion(_ region: CGRect) {
        sessionQueue.async { [weak self] in
            self?.metadataOutput.rectOfInterest = region
        }
    }

    private func configureAndStart() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            if !self.configured, !self.configureSession() { return }
            guard !self.session.isRunning else {
                self.setState(.ready)
                return
            }
            self.session.startRunning()
            self.setState(.ready)
        }
    }

    private func configureSession() -> Bool {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo

        guard
            let device = AVCaptureDevice.default(
                .builtInWideAngleCamera,
                for: .video,
                position: .back
            ) ?? AVCaptureDevice.default(for: .video)
        else {
            setState(.unavailable("Auf diesem Gerät wurde keine Kamera gefunden."))
            return false
        }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input), session.canAddOutput(photoOutput) else {
                setState(.unavailable("Die Kamera konnte nicht konfiguriert werden."))
                return false
            }
            session.addInput(input)
            session.addOutput(photoOutput)

            if session.canAddOutput(metadataOutput) {
                session.addOutput(metadataOutput)
                metadataOutput.setMetadataObjectsDelegate(self, queue: metadataQueue)
                let requested: [AVMetadataObject.ObjectType] = [
                    .qr, .ean8, .ean13, .upce, .code128, .dataMatrix, .pdf417, .aztec,
                ]
                metadataOutput.metadataObjectTypes = requested.filter {
                    metadataOutput.availableMetadataObjectTypes.contains($0)
                }
            }

            try device.lockForConfiguration()
            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            if device.isSmoothAutoFocusSupported { device.isSmoothAutoFocusEnabled = true }
            device.unlockForConfiguration()

            cameraDevice = device
            configured = true
            return true
        } catch {
            setState(.unavailable(error.localizedDescription))
            return false
        }
    }

    private func setState(_ next: State) {
        DispatchQueue.main.async { [weak self] in self?.state = next }
    }
}

extension CameraService: AVCaptureMetadataOutputObjectsDelegate {
    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard
            scanningEnabled,
            let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            let value = object.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
            !value.isEmpty
        else { return }

        let now = Date()
        if let lastScan, lastScan.value == value, now.timeIntervalSince(lastScan.time) < 1.4 {
            return
        }
        lastScan = (value, now)
        DispatchQueue.main.async { [weak self] in
            AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
            self?.onCode?(value)
        }
    }
}

extension CameraService: AVCapturePhotoCaptureDelegate {
    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        guard error == nil, let data = photo.fileDataRepresentation() else { return }
        DispatchQueue.main.async { [weak self] in self?.onPhoto?(data) }
    }
}
