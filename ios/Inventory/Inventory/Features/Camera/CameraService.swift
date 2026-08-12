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
    @Published private(set) var torchAvailable = false
    @Published private(set) var canSwitchCamera = false
    @Published private(set) var isUsingFrontCamera = false
    @Published private(set) var isSwitchingCamera = false

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
    private var cameraInput: AVCaptureDeviceInput?
    private var configured = false
    private var switchInProgress = false
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

    func switchCamera() {
        sessionQueue.async { [weak self] in
            guard
                let self,
                self.configured,
                !self.switchInProgress,
                let currentInput = self.cameraInput
            else { return }

            let targetPosition: AVCaptureDevice.Position =
                currentInput.device.position == .front ? .back : .front
            guard let nextDevice = Self.videoDevice(position: targetPosition) else { return }

            self.switchInProgress = true
            self.setSwitchingCamera(true)
            defer {
                self.switchInProgress = false
                self.setSwitchingCamera(false)
            }

            do {
                let nextInput = try AVCaptureDeviceInput(device: nextDevice)
                try self.configureDevice(nextDevice)
                self.turnOffTorch(on: currentInput.device)

                self.session.beginConfiguration()
                self.session.removeInput(currentInput)

                guard self.session.canAddInput(nextInput) else {
                    if self.session.canAddInput(currentInput) {
                        self.session.addInput(currentInput)
                    }
                    self.session.commitConfiguration()
                    self.publishCapabilities(for: currentInput.device)
                    return
                }

                self.session.addInput(nextInput)
                self.session.commitConfiguration()

                self.cameraInput = nextInput
                self.cameraDevice = nextDevice
                self.publishCapabilities(for: nextDevice)
            } catch {
                // Keep the current camera active if the alternate input cannot be created.
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

            try configureDevice(device)

            cameraInput = input
            cameraDevice = device
            configured = true
            publishCapabilities(for: device)
            return true
        } catch {
            setState(.unavailable(error.localizedDescription))
            return false
        }
    }

    private func setState(_ next: State) {
        DispatchQueue.main.async { [weak self] in self?.state = next }
    }

    private static func videoDevice(position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        AVCaptureDevice.default(
            .builtInWideAngleCamera,
            for: .video,
            position: position
        )
    }

    private func configureDevice(_ device: AVCaptureDevice) throws {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        }
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
        }
        if device.isSmoothAutoFocusSupported {
            device.isSmoothAutoFocusEnabled = true
        }
    }

    private func turnOffTorch(on device: AVCaptureDevice) {
        guard device.hasTorch else {
            DispatchQueue.main.async { [weak self] in self?.torchEnabled = false }
            return
        }
        do {
            try device.lockForConfiguration()
            if device.isTorchModeSupported(.off) {
                device.torchMode = .off
            }
            device.unlockForConfiguration()
        } catch {
            // The input can still be switched if the torch cannot be changed.
        }
        DispatchQueue.main.async { [weak self] in self?.torchEnabled = false }
    }

    private func publishCapabilities(for device: AVCaptureDevice) {
        let frontAvailable = Self.videoDevice(position: .front) != nil
        let backAvailable = Self.videoDevice(position: .back) != nil
        let hasTorch = device.hasTorch
        let usesFrontCamera = device.position == .front
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.canSwitchCamera = frontAvailable && backAvailable
            self.torchAvailable = hasTorch
            self.isUsingFrontCamera = usesFrontCamera
            if !hasTorch { self.torchEnabled = false }
        }
    }

    private func setSwitchingCamera(_ switching: Bool) {
        DispatchQueue.main.async { [weak self] in self?.isSwitchingCamera = switching }
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
