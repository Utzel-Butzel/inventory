import AVFoundation
import SwiftUI
import UIKit

struct CameraPreview: UIViewRepresentable {
    let camera: CameraService

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = camera.session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.onScanningRegionChange = { [weak camera] region in
            camera?.updateScanningRegion(region)
        }
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        if uiView.previewLayer.session !== camera.session {
            uiView.previewLayer.session = camera.session
        }
    }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    var onScanningRegionChange: ((CGRect) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
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
}
