import AVFoundation
import SwiftUI
import UIKit

struct CameraPreview: UIViewRepresentable {
    let camera: CameraService

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = camera.session
        // Captured camera images are deterministically center-cropped to the same
        // 3:4 canvas, so aspect-fill now has identical framing after capture.
        view.previewLayer.videoGravity = .resizeAspectFill
        view.onScanningRegionChange = { [weak camera] region in
            camera?.updateScanningRegion(region)
        }
        view.onVideoRotationAngleChange = { [weak camera] angle in
            camera?.updateVideoRotationAngle(angle)
        }
        view.setMirrored(camera.isUsingFrontCamera)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        if uiView.previewLayer.session !== camera.session {
            uiView.previewLayer.session = camera.session
        }
        uiView.setMirrored(camera.isUsingFrontCamera)
    }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    var onScanningRegionChange: ((CGRect) -> Void)?
    var onVideoRotationAngleChange: ((CGFloat) -> Void)?
    private var lastVideoRotationAngle: CGFloat?
    private var mirrored = false

    func setMirrored(_ mirrored: Bool) {
        self.mirrored = mirrored
        updateConnectionGeometry()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        updateConnectionGeometry()
        let edge = min(245, min(bounds.width * 0.68, bounds.height * 0.68))
        let guide = CGRect(
            x: bounds.midX - edge / 2,
            y: bounds.midY - edge / 2,
            width: edge,
            height: edge
        )
        onScanningRegionChange?(
            previewLayer.metadataOutputRectConverted(fromLayerRect: guide)
        )
    }

    private func updateConnectionGeometry() {
        guard let connection = previewLayer.connection else { return }
        let angle = videoRotationAngle
        if connection.isVideoRotationAngleSupported(angle) {
            connection.videoRotationAngle = angle
        }
        if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = mirrored
        }
        guard lastVideoRotationAngle != angle else { return }
        lastVideoRotationAngle = angle
        onVideoRotationAngleChange?(angle)
    }

    private var videoRotationAngle: CGFloat {
        switch window?.windowScene?.interfaceOrientation {
        case .portraitUpsideDown: 270
        case .landscapeLeft: 0
        case .landscapeRight: 180
        case .portrait, .unknown, .none: 90
        @unknown default: 90
        }
    }
}
