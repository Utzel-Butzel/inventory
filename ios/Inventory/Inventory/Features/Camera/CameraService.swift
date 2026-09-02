import AVFoundation
import AudioToolbox
import Foundation
import ImageIO
import UIKit

struct DetectedCameraCode: Equatable, Sendable {
    let value: String
    let type: String?
}

final class CameraService: NSObject, ObservableObject, @unchecked Sendable {
    static let photoAspectRatio: CGFloat = 3.0 / 4.0

    struct ZoomPreset: Identifiable, Equatable, Sendable {
        let displayFactor: CGFloat
        let deviceFactor: CGFloat

        var id: CGFloat { displayFactor }

        var label: String {
            let fractionDigits = displayFactor.rounded() == displayFactor ? 0 : 1
            return Double(displayFactor).formatted(
                .number.precision(.fractionLength(fractionDigits))
            ) + "×"
        }
    }

    enum State: Equatable {
        case idle
        case requestingPermission
        case ready
        case denied
        case unavailable(String)
    }

    enum PhotoCaptureError: Error, LocalizedError, Sendable {
        case cameraNotReady
        case captureFailed(String)
        case processingFailed(String)
        case missingImageData

        var errorDescription: String? {
            switch self {
            case .cameraNotReady:
                "Die Kamera ist noch nicht bereit. Bitte versuche es erneut."
            case .captureFailed(let message):
                "Die Aufnahme wurde nicht abgeschlossen: \(message)"
            case .processingFailed(let message):
                "Das Foto konnte nicht aufgenommen werden: \(message)"
            case .missingImageData:
                "Die Kamera hat kein lesbares Foto geliefert. Bitte versuche es erneut."
            }
        }
    }

    enum VideoCaptureError: Error, LocalizedError, Sendable {
        case cameraNotReady
        case unsupported
        case recordingFailed(String)

        var errorDescription: String? {
            switch self {
            case .cameraNotReady:
                "Die Kamera ist noch nicht bereit. Bitte versuche es erneut."
            case .unsupported:
                "Videoaufnahmen werden auf diesem Gerät nicht unterstützt."
            case .recordingFailed(let message):
                "Das Video konnte nicht aufgenommen werden: \(message)"
            }
        }
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var torchEnabled = false
    @Published private(set) var torchAvailable = false
    @Published private(set) var canSwitchCamera = false
    @Published private(set) var isUsingFrontCamera = false
    @Published private(set) var isSwitchingCamera = false
    @Published private(set) var isRecordingVideo = false
    @Published private(set) var canRecordVideo = false
    @Published private(set) var zoomPresets: [ZoomPreset] = []
    @Published private(set) var selectedZoomFactor: CGFloat = 1

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
    var onDetectedCode: ((DetectedCameraCode) -> Void)?
    var onPhoto: ((Result<Data, PhotoCaptureError>) -> Void)?
    var onVideo: ((Result<MediaUploadFile, VideoCaptureError>) -> Void)?

    private let sessionQueue = DispatchQueue(
        label: "digital.congru.inventory.camera.session",
        qos: .userInitiated
    )
    private let metadataQueue = DispatchQueue(label: "digital.congru.inventory.camera.metadata")
    private let photoOutput = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private let metadataOutput = AVCaptureMetadataOutput()
    private var cameraDevice: AVCaptureDevice?
    private var cameraInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var configured = false
    private var switchInProgress = false
    private var lastScan: (value: String, time: Date)?
    private let scanningStateLock = NSLock()
    private var scanningEnabledStorage = true
    private var videoRotationAngle: CGFloat = 90
    private var pinchStartZoomFactor: CGFloat?
    private let photoCaptureStateLock = NSLock()
    private var processedPhotoCaptureIDs: Set<Int64> = []

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
            guard let self else { return }
            if self.movieOutput.isRecording {
                self.movieOutput.stopRecording()
            }
            guard self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }

    func startVideoRecording() {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            beginVideoRecording(includeAudio: true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                self?.beginVideoRecording(includeAudio: granted)
            }
        case .denied, .restricted:
            beginVideoRecording(includeAudio: false)
        @unknown default:
            beginVideoRecording(includeAudio: false)
        }
    }

    func stopVideoRecording() {
        sessionQueue.async { [weak self] in
            guard let self, self.movieOutput.isRecording else { return }
            self.movieOutput.stopRecording()
        }
    }

    func capturePhoto() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            guard self.configured, self.session.isRunning else {
                self.deliverPhotoResult(
                    Result<Data, PhotoCaptureError>.failure(.cameraNotReady)
                )
                return
            }
            self.applyOutputGeometry()
            let settings = self.makePhotoSettings()
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    func updateVideoRotationAngle(_ angle: CGFloat) {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.videoRotationAngle = angle
            self.applyOutputGeometry()
        }
    }

    func selectZoom(_ preset: ZoomPreset) {
        sessionQueue.async { [weak self] in
            guard let self, let device = self.cameraDevice else { return }
            self.pinchStartZoomFactor = nil
            let factor = min(
                max(preset.deviceFactor, device.minAvailableVideoZoomFactor),
                device.maxAvailableVideoZoomFactor
            )
            do {
                try device.lockForConfiguration()
                device.ramp(toVideoZoomFactor: factor, withRate: 8)
                device.unlockForConfiguration()
                DispatchQueue.main.async { [weak self] in
                    self?.selectedZoomFactor = preset.displayFactor
                }
            } catch {
                // Keep the current lens/zoom if the device is temporarily unavailable.
            }
        }
    }

    func updatePinchZoom(magnification: CGFloat) {
        sessionQueue.async { [weak self] in
            self?.applyPinchZoom(magnification: magnification, ending: false)
        }
    }

    func endPinchZoom(magnification: CGFloat) {
        sessionQueue.async { [weak self] in
            self?.applyPinchZoom(magnification: magnification, ending: true)
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
                self.configurePhotoDimensions(for: nextDevice)
                self.session.commitConfiguration()

                self.cameraInput = nextInput
                self.cameraDevice = nextDevice
                self.applyOutputGeometry()
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
            let device = Self.videoDevice(position: .back)
                ?? AVCaptureDevice.default(for: .video)
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
            configurePhotoDimensions(for: device)

            if session.canAddOutput(movieOutput) {
                session.addOutput(movieOutput)
                movieOutput.maxRecordedDuration = CMTime(seconds: 60, preferredTimescale: 600)
                movieOutput.maxRecordedFileSize = 23 * 1_024 * 1_024
            }

            if session.canAddOutput(metadataOutput) {
                session.addOutput(metadataOutput)
                metadataOutput.setMetadataObjectsDelegate(self, queue: metadataQueue)
                let requested: [AVMetadataObject.ObjectType] = [
                    .qr, .ean8, .ean13, .upce, .code128, .code93, .code39,
                    .code39Mod43, .codabar, .interleaved2of5, .itf14,
                    .dataMatrix, .pdf417, .aztec,
                ]
                metadataOutput.metadataObjectTypes = requested.filter {
                    metadataOutput.availableMetadataObjectTypes.contains($0)
                }
            }

            try configureDevice(device)

            cameraInput = input
            cameraDevice = device
            applyOutputGeometry()
            configured = true
            publishCapabilities(for: device)
            DispatchQueue.main.async { [weak self] in
                self?.canRecordVideo = self?.movieOutput.connection(with: .video) != nil
            }
            return true
        } catch {
            setState(.unavailable(error.localizedDescription))
            return false
        }
    }

    private func beginVideoRecording(includeAudio: Bool) {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            guard self.configured,
                  self.session.isRunning,
                  !self.movieOutput.isRecording,
                  self.movieOutput.connection(with: .video) != nil else {
                self.deliverVideoResult(.failure(.cameraNotReady))
                return
            }

            if includeAudio, self.audioInput == nil,
               let microphone = AVCaptureDevice.default(for: .audio),
               let input = try? AVCaptureDeviceInput(device: microphone) {
                self.session.beginConfiguration()
                if self.session.canAddInput(input) {
                    self.session.addInput(input)
                    self.audioInput = input
                }
                self.session.commitConfiguration()
            }
            if self.session.canSetSessionPreset(.hd1280x720) {
                self.session.beginConfiguration()
                self.session.sessionPreset = .hd1280x720
                self.session.commitConfiguration()
            }
            self.applyOutputGeometry()
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("inventory-video-\(UUID().uuidString)")
                .appendingPathExtension("mov")
            try? FileManager.default.removeItem(at: url)
            DispatchQueue.main.async { [weak self] in self?.isRecordingVideo = true }
            self.movieOutput.startRecording(to: url, recordingDelegate: self)
        }
    }

    private func deliverVideoResult(
        _ result: Result<MediaUploadFile, VideoCaptureError>
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.isRecordingVideo = false
            self?.onVideo?(result)
        }
    }

    private func restorePhotoSessionPreset() {
        sessionQueue.async { [weak self] in
            guard let self, self.configured else { return }
            if self.session.canSetSessionPreset(.photo) {
                self.session.beginConfiguration()
                self.session.sessionPreset = .photo
                self.session.commitConfiguration()
                if let cameraDevice = self.cameraDevice {
                    self.configurePhotoDimensions(for: cameraDevice)
                }
            }
            self.applyOutputGeometry()
        }
    }

    private func setState(_ next: State) {
        DispatchQueue.main.async { [weak self] in self?.state = next }
    }

    private static func videoDevice(position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        if position == .back {
            let preferredTypes: [AVCaptureDevice.DeviceType] = [
                .builtInTripleCamera,
                .builtInDualWideCamera,
                .builtInDualCamera,
                .builtInWideAngleCamera,
            ]
            for type in preferredTypes {
                if let device = AVCaptureDevice.default(
                    type,
                    for: .video,
                    position: position
                ) {
                    return device
                }
            }
        }
        return AVCaptureDevice.default(
            .builtInWideAngleCamera,
            for: .video,
            position: position
        )
    }

    private func configureDevice(_ device: AVCaptureDevice) throws {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        if device.isVirtualDevice,
           device.primaryConstituentDeviceSwitchingBehavior != .unsupported {
            device.setPrimaryConstituentDeviceSwitchingBehavior(
                .auto,
                restrictedSwitchingBehaviorConditions: []
            )
        }
        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        }
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
        }
        if device.isSmoothAutoFocusSupported {
            device.isSmoothAutoFocusEnabled = true
        }
        let oneTimesFactor = 1 / Self.zoomDisplayMultiplier(for: device)
        device.videoZoomFactor = min(
            max(oneTimesFactor, device.minAvailableVideoZoomFactor),
            device.maxAvailableVideoZoomFactor
        )
    }

    private func applyPinchZoom(magnification: CGFloat, ending: Bool) {
        guard
            magnification.isFinite,
            magnification > 0,
            let device = cameraDevice
        else {
            if ending { pinchStartZoomFactor = nil }
            return
        }
        let startFactor = pinchStartZoomFactor ?? device.videoZoomFactor
        if pinchStartZoomFactor == nil {
            pinchStartZoomFactor = startFactor
        }

        let factor = min(
            max(startFactor * magnification, device.minAvailableVideoZoomFactor),
            device.maxAvailableVideoZoomFactor
        )
        do {
            try device.lockForConfiguration()
            device.videoZoomFactor = factor
            device.unlockForConfiguration()

            let displayFactor = factor * Self.zoomDisplayMultiplier(for: device)
            DispatchQueue.main.async { [weak self] in
                self?.selectedZoomFactor = displayFactor
            }
        } catch {
            // Keep the last valid zoom if the device is temporarily unavailable.
        }
        if ending { pinchStartZoomFactor = nil }
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
        let presets = Self.zoomPresets(for: device)
        let currentDisplayFactor = device.videoZoomFactor * Self.zoomDisplayMultiplier(for: device)
        let selectedPreset = presets.min {
            abs($0.displayFactor - currentDisplayFactor)
                < abs($1.displayFactor - currentDisplayFactor)
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.canSwitchCamera = frontAvailable && backAvailable
            self.torchAvailable = hasTorch
            self.isUsingFrontCamera = usesFrontCamera
            self.zoomPresets = presets
            self.selectedZoomFactor = selectedPreset?.displayFactor ?? currentDisplayFactor
            if !hasTorch { self.torchEnabled = false }
        }
    }

    private static func zoomDisplayMultiplier(for device: AVCaptureDevice) -> CGFloat {
        if #available(iOS 18.0, *) {
            return device.displayVideoZoomFactorMultiplier
        }
        switch device.deviceType {
        case .builtInTripleCamera, .builtInDualWideCamera:
            return 0.5
        default:
            return 1
        }
    }

    private static func zoomPresets(for device: AVCaptureDevice) -> [ZoomPreset] {
        let multiplier = zoomDisplayMultiplier(for: device)
        let minimum = device.minAvailableVideoZoomFactor * multiplier
        let maximum = device.maxAvailableVideoZoomFactor * multiplier
        var requested: [CGFloat] = []

        if minimum < 0.95 {
            requested.append((minimum * 10).rounded() / 10)
        }
        requested.append(contentsOf: [1, 2, 5])

        var unique: [CGFloat] = []
        for factor in requested where factor >= minimum - 0.01 && factor <= maximum + 0.01 {
            if !unique.contains(where: { abs($0 - factor) < 0.01 }) {
                unique.append(factor)
            }
        }
        if unique.isEmpty {
            unique = [min(max(1, minimum), maximum)]
        }
        return unique.map {
            ZoomPreset(
                displayFactor: $0,
                deviceFactor: min(
                    max($0 / multiplier, device.minAvailableVideoZoomFactor),
                    device.maxAvailableVideoZoomFactor
                )
            )
        }
    }

    private func setSwitchingCamera(_ switching: Bool) {
        DispatchQueue.main.async { [weak self] in self?.isSwitchingCamera = switching }
    }

    private func applyOutputGeometry() {
        for output in session.outputs {
            guard let connection = output.connection(with: .video) else { continue }
            if connection.isVideoRotationAngleSupported(videoRotationAngle) {
                connection.videoRotationAngle = videoRotationAngle
            }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = cameraDevice?.position == .front
            }
        }
    }

    private func configurePhotoDimensions(for device: AVCaptureDevice) {
        let sensorAspectRatio = 1 / Self.photoAspectRatio
        let dimensions = device.activeFormat.supportedMaxPhotoDimensions.min { lhs, rhs in
            let lhsRatio = CGFloat(max(lhs.width, lhs.height))
                / CGFloat(min(lhs.width, lhs.height))
            let rhsRatio = CGFloat(max(rhs.width, rhs.height))
                / CGFloat(min(rhs.width, rhs.height))
            let lhsDistance = abs(lhsRatio - sensorAspectRatio)
            let rhsDistance = abs(rhsRatio - sensorAspectRatio)
            if abs(lhsDistance - rhsDistance) > 0.000_1 {
                return lhsDistance < rhsDistance
            }
            return Int64(lhs.width) * Int64(lhs.height) > Int64(rhs.width) * Int64(rhs.height)
        }
        if let dimensions {
            photoOutput.maxPhotoDimensions = dimensions
        }
    }

    private func makePhotoSettings() -> AVCapturePhotoSettings {
        let settings: AVCapturePhotoSettings
        if photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
            settings = AVCapturePhotoSettings(
                format: [AVVideoCodecKey: AVVideoCodecType.jpeg]
            )
        } else {
            settings = AVCapturePhotoSettings()
        }
        settings.photoQualityPrioritization = .balanced
        let maximumDimensions = photoOutput.maxPhotoDimensions
        if maximumDimensions.width > 0, maximumDimensions.height > 0 {
            settings.maxPhotoDimensions = maximumDimensions
        }
        if let previewPixelFormat = settings.availablePreviewPhotoPixelFormatTypes.first {
            // Ask AVFoundation for a preview generated from the same processed photo.
            // Its 3:4 dimensions mirror the in-app viewfinder and also provide a
            // usable fallback if the primary encoded representation is unavailable.
            settings.previewPhotoFormat = [
                kCVPixelBufferPixelFormatTypeKey as String: previewPixelFormat,
                kCVPixelBufferWidthKey as String: 1_200,
                kCVPixelBufferHeightKey as String: 1_600,
            ]
        }
        return settings
    }

    private func deliverPhotoResult(_ result: Result<Data, PhotoCaptureError>) {
        DispatchQueue.main.async { [weak self] in self?.onPhoto?(result) }
    }

    private func deliverProcessedPhotoResult(
        id: Int64,
        _ result: Result<Data, PhotoCaptureError>
    ) {
        photoCaptureStateLock.lock()
        let inserted = processedPhotoCaptureIDs.insert(id).inserted
        photoCaptureStateLock.unlock()
        guard inserted else { return }
        deliverPhotoResult(result)
    }

    private func finishPhotoCapture(id: Int64, error: Error?) {
        photoCaptureStateLock.lock()
        let processingDelivered = processedPhotoCaptureIDs.remove(id) != nil
        photoCaptureStateLock.unlock()
        guard !processingDelivered else { return }
        if let error {
            deliverPhotoResult(.failure(.captureFailed(error.localizedDescription)))
        } else {
            deliverPhotoResult(.failure(.missingImageData))
        }
    }

    private static func previewJPEGData(from photo: AVCapturePhoto) -> Data? {
        guard let preview = photo.previewCGImageRepresentation() else { return nil }
        let rawOrientation = photo.metadata[kCGImagePropertyOrientation as String] as? UInt32
        let orientation = rawOrientation.flatMap(UIImage.Orientation.init(exifOrientation:)) ?? .up
        return UIImage(cgImage: preview, scale: 1, orientation: orientation)
            .jpegData(compressionQuality: 0.95)
    }
}

extension CameraService: AVCaptureMetadataOutputObjectsDelegate {
    private static func normalizedCodeType(
        _ type: AVMetadataObject.ObjectType,
        value: String
    ) -> String? {
        switch type {
        case .qr: "qr_code"
        case .dataMatrix: "data_matrix"
        case .aztec: "aztec"
        case .pdf417: "pdf417"
        case .code128: "code_128"
        case .code93: "code_93"
        case .code39, .code39Mod43: "code_39"
        case .codabar: "codabar"
        // AVFoundation exposes UPC-A as EAN-13 with a leading zero.
        case .ean13: value.count == 13 && value.hasPrefix("0") ? "upc_a" : "ean_13"
        case .ean8: "ean_8"
        case .upce: "upc_e"
        case .interleaved2of5, .itf14: "itf"
        default: nil
        }
    }

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
        let codeType = Self.normalizedCodeType(object.type, value: value)
        DispatchQueue.main.async { [weak self] in
            AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
            self?.onCode?(value)
            self?.onDetectedCode?(
                DetectedCameraCode(
                    value: value,
                    type: codeType
                )
            )
        }
    }
}

extension CameraService: AVCapturePhotoCaptureDelegate {
    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        let captureID = photo.resolvedSettings.uniqueID
        if let error {
            deliverProcessedPhotoResult(
                id: captureID,
                .failure(.processingFailed(error.localizedDescription))
            )
            return
        }
        if let data = photo.fileDataRepresentation() ?? Self.previewJPEGData(from: photo) {
            deliverProcessedPhotoResult(id: captureID, .success(data))
        } else {
            deliverProcessedPhotoResult(id: captureID, .failure(.missingImageData))
        }
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
        error: Error?
    ) {
        finishPhotoCapture(id: resolvedSettings.uniqueID, error: error)
    }
}

extension CameraService: AVCaptureFileOutputRecordingDelegate {
    func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        restorePhotoSessionPreset()
        let recordingSucceeded: Bool
        if let nsError = error as NSError? {
            recordingSucceeded =
                nsError.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool == true
        } else {
            recordingSucceeded = true
        }

        guard recordingSucceeded else {
            try? FileManager.default.removeItem(at: outputFileURL)
            deliverVideoResult(
                .failure(.recordingFailed(error?.localizedDescription ?? "Unbekannter Fehler"))
            )
            return
        }
        do {
            let values = try outputFileURL.resourceValues(forKeys: [
                .isRegularFileKey,
                .fileSizeKey,
            ])
            guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else {
                throw CocoaError(.fileReadCorruptFile)
            }
            deliverVideoResult(
                .success(
                    MediaUploadFile(
                        fileURL: outputFileURL,
                        filename: "Inventar-Video.mov",
                        mimeType: "video/quicktime"
                    )
                )
            )
        } catch {
            try? FileManager.default.removeItem(at: outputFileURL)
            deliverVideoResult(.failure(.recordingFailed(error.localizedDescription)))
        }
    }
}

private extension UIImage.Orientation {
    init?(exifOrientation: UInt32) {
        switch exifOrientation {
        case 1: self = .up
        case 2: self = .upMirrored
        case 3: self = .down
        case 4: self = .downMirrored
        case 5: self = .leftMirrored
        case 6: self = .right
        case 7: self = .rightMirrored
        case 8: self = .left
        default: return nil
        }
    }
}
