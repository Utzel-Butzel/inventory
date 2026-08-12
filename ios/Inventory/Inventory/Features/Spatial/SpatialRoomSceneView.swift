import SceneKit
import simd
import SwiftUI
import UIKit

struct SpatialRoomSceneView: View {
    @EnvironmentObject private var state: AppState
    @AppStorage("spatialRoomScene.didShowNavigationHint") private var didShowNavigationHint = false
    let scan: SpatialRoomScanSummary

    @State private var manifest: SpatialRoomSceneManifest?
    @State private var selectedResourceID: UUID?
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var cameraCommand = RoomSceneCameraCommand.reset
    @State private var cameraCommandRevision = 0

    var body: some View {
        Group {
            if let manifest {
                sceneContent(manifest)
            } else if loading {
                ProgressView("3D-Raum wird aufgebaut …")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(InventoryTheme.canvas)
            } else {
                ContentUnavailableView {
                    Label("3D-Raum nicht verfügbar", systemImage: "cube.transparent")
                } description: {
                    Text(errorMessage ?? "Die Raumdaten konnten nicht geladen werden.")
                } actions: {
                    Button("Erneut laden") { Task { await loadScene() } }
                        .buttonStyle(.borderedProminent)
                        .tint(InventoryTheme.accent)
                }
                .padding(24)
                .background(InventoryTheme.canvas)
            }
        }
        .navigationTitle(scan.roomName)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: scan.id) { await loadScene() }
    }

    private func sceneContent(_ manifest: SpatialRoomSceneManifest) -> some View {
        ZStack(alignment: .top) {
            RoomSceneViewport(
                manifest: manifest,
                selectedResourceID: $selectedResourceID,
                cameraCommand: cameraCommand,
                cameraCommandRevision: cameraCommandRevision,
                onInteraction: dismissNavigationHint
            )
            .ignoresSafeArea(edges: .bottom)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    sceneBadge(
                        "Revision \(manifest.scan.revision)",
                        systemImage: "clock.arrow.circlepath"
                    )
                    sceneBadge(
                        "\(manifest.placements.count) Gegenstände",
                        systemImage: "shippingbox.fill"
                    )
                    Spacer(minLength: 0)
                    cameraControls
                }

                if !didShowNavigationHint {
                    navigationHint
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .padding(12)
        }
        .overlay(alignment: .bottom) {
            if selectedPlacement != nil || !manifest.placements.isEmpty {
                itemControls(manifest)
                    .padding(12)
            }
        }
        .background(Color(red: 0.92, green: 0.94, blue: 0.95))
        .task(id: manifest.scan.id) {
            guard !didShowNavigationHint else { return }
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            dismissNavigationHint()
        }
    }

    private var navigationHint: some View {
        HStack(spacing: 9) {
            Image(systemName: "hand.draw.fill")
                .foregroundStyle(InventoryTheme.accent)
            Text("Ziehen zum Drehen · zwei Finger zum Zoomen")
                .font(.caption.weight(.medium))
                .lineLimit(2)
            Button(action: dismissNavigationHint) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hinweis schließen")
        }
        .foregroundStyle(InventoryTheme.ink)
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .frame(minHeight: 42)
        .fixedSize(horizontal: false, vertical: true)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay { Capsule().stroke(.white.opacity(0.55), lineWidth: 1) }
        .frame(maxWidth: 310, alignment: .leading)
    }

    private func itemControls(_ manifest: SpatialRoomSceneManifest) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let selectedPlacement {
                selectedItemCard(selectedPlacement)
                    .padding(10)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            if !manifest.placements.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 8) {
                        ForEach(manifest.placements) { placement in
                            Button {
                                dismissNavigationHint()
                                selectedResourceID = placement.resource.id
                            } label: {
                                Label(placement.resource.name, systemImage: "mappin.circle.fill")
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(1)
                                    .padding(.horizontal, 11)
                                    .frame(minHeight: 34)
                                    .foregroundStyle(
                                        selectedResourceID == placement.resource.id
                                            ? Color.white
                                            : InventoryTheme.ink
                                    )
                                    .background(
                                        selectedResourceID == placement.resource.id
                                            ? InventoryTheme.accent
                                            : Color.white.opacity(0.9),
                                        in: Capsule()
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var selectedPlacement: SpatialRoomPlacement? {
        guard let selectedResourceID else { return nil }
        return manifest?.placements.first { $0.resource.id == selectedResourceID }
    }

    private var cameraControls: some View {
        HStack(spacing: 4) {
            cameraButton("Perspektive zurücksetzen", systemImage: "view.3d", command: .reset)
            cameraButton("Von oben ansehen", systemImage: "square.3.layers.3d.top.filled", command: .top)
        }
        .padding(4)
        .background(.ultraThinMaterial, in: Capsule())
    }

    private func cameraButton(
        _ title: String,
        systemImage: String,
        command: RoomSceneCameraCommand
    ) -> some View {
        Button {
            dismissNavigationHint()
            cameraCommand = command
            cameraCommandRevision += 1
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 34, height: 34)
                .background(Color.white.opacity(0.78), in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(InventoryTheme.ink)
        .accessibilityLabel(title)
    }

    private func sceneBadge(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(InventoryTheme.ink)
            .padding(.horizontal, 10)
            .frame(minHeight: 34)
            .background(.ultraThinMaterial, in: Capsule())
    }

    private func selectedItemCard(_ placement: SpatialRoomPlacement) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "mappin.and.ellipse")
                .font(.title3)
                .foregroundStyle(InventoryTheme.accent)
                .frame(width: 36, height: 36)
                .background(InventoryTheme.accent.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(placement.resource.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(InventoryTheme.ink)
                    .lineLimit(1)
                Text(placement.resource.location ?? placement.resource.type)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Button {
                selectedResourceID = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Auswahl aufheben")
        }
    }

    private func dismissNavigationHint() {
        guard !didShowNavigationHint else { return }
        withAnimation(.easeOut(duration: 0.2)) {
            didShowNavigationHint = true
        }
    }

    @MainActor
    private func loadScene() async {
        guard let client = state.client else { return }
        loading = true
        defer { loading = false }
        do {
            manifest = try await client.roomScene(scanID: scan.id).scene
            selectedResourceID = nil
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            manifest = nil
            errorMessage = error.localizedDescription
        }
    }
}

private enum RoomSceneCameraCommand {
    case reset
    case top
}

private struct RoomSceneViewport: UIViewRepresentable {
    let manifest: SpatialRoomSceneManifest
    @Binding var selectedResourceID: UUID?
    let cameraCommand: RoomSceneCameraCommand
    let cameraCommandRevision: Int
    let onInteraction: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero)
        context.coordinator.configure(view)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.scanID != manifest.scan.id {
            context.coordinator.configure(view)
        }
        context.coordinator.applySelection(selectedResourceID)
        if context.coordinator.lastCameraCommandRevision != cameraCommandRevision {
            context.coordinator.lastCameraCommandRevision = cameraCommandRevision
            context.coordinator.applyCamera(cameraCommand, animated: true)
        }
    }

    @MainActor
    final class Coordinator: NSObject {
        struct MarkerStyle {
            let node: SCNNode
            let dotMaterial: SCNMaterial
            let stemMaterial: SCNMaterial
        }

        var parent: RoomSceneViewport
        var scanID: UUID?
        var lastCameraCommandRevision = 0
        private var markerStyles: [UUID: MarkerStyle] = [:]
        private weak var sceneView: SCNView?
        private var cameraNode: SCNNode?
        private var sceneCenter = SCNVector3Zero
        private var sceneRadius: Float = 1.5

        init(parent: RoomSceneViewport) {
            self.parent = parent
        }

        func configure(_ view: SCNView) {
            scanID = parent.manifest.scan.id
            markerStyles.removeAll(keepingCapacity: true)
            sceneView = view

            let scene = makeScene(from: parent.manifest)
            view.scene = scene
            view.backgroundColor = UIColor(red: 0.94, green: 0.95, blue: 0.96, alpha: 1)
            view.allowsCameraControl = true
            configureInteractionTracking(for: view)
            view.defaultCameraController.interactionMode = .orbitTurntable
            view.defaultCameraController.inertiaEnabled = true
            view.defaultCameraController.maximumVerticalAngle = 89
            view.antialiasingMode = .multisampling4X
            view.preferredFramesPerSecond = 60
            view.isPlaying = false
            view.isAccessibilityElement = true
            view.accessibilityLabel = "Interaktives 3D-Modell von \(parent.manifest.room.name)"
            applySelection(parent.selectedResourceID)
            applyCamera(.reset, animated: false)
        }

        private func configureInteractionTracking(for view: SCNView) {
            view.gestureRecognizers?
                .filter { $0.name == "inventory-room-marker-tap" }
                .forEach(view.removeGestureRecognizer)

            let markerTap = UITapGestureRecognizer(
                target: self,
                action: #selector(didTapScene(_:))
            )
            markerTap.name = "inventory-room-marker-tap"
            view.addGestureRecognizer(markerTap)

            for recognizer in view.gestureRecognizers ?? [] {
                recognizer.removeTarget(self, action: #selector(didInteract(_:)))
                recognizer.addTarget(self, action: #selector(didInteract(_:)))
            }
        }

        private func makeScene(from manifest: SpatialRoomSceneManifest) -> SCNScene {
            let scene = SCNScene()
            scene.background.contents = UIColor(red: 0.94, green: 0.95, blue: 0.96, alpha: 1)

            addLights(to: scene.rootNode)

            let webRoot = SCNNode()
            webRoot.simdTransform = matrix(from: manifest.scan.scene.webFromWorld)
            scene.rootNode.addChildNode(webRoot)

            let modelRoot = SCNNode()
            modelRoot.simdTransform = matrix(from: manifest.scan.scene.worldFromModel)
            webRoot.addChildNode(modelRoot)

            for surface in manifest.scan.scene.surfaces {
                modelRoot.addChildNode(makeSurfaceNode(surface))
            }
            for object in manifest.scan.scene.objects {
                modelRoot.addChildNode(makeObjectNode(object))
            }
            for placement in manifest.placements {
                addMarker(for: placement, to: webRoot)
            }

            let framedBounds = transformedBounds(for: manifest.scan.scene)
            sceneCenter = framedBounds.center
            let size = framedBounds.size
            sceneRadius = max(sqrt(size.x * size.x + size.y * size.y + size.z * size.z) * 0.5, 1.5)
            scene.rootNode.addChildNode(makeGrid(for: framedBounds))

            let camera = SCNCamera()
            camera.fieldOfView = 48
            camera.zNear = Double(max(0.02, sceneRadius / 500))
            camera.zFar = Double(max(100, sceneRadius * 30))
            let cameraNode = SCNNode()
            cameraNode.camera = camera
            scene.rootNode.addChildNode(cameraNode)
            self.cameraNode = cameraNode
            return scene
        }

        private func makeSurfaceNode(_ surface: SpatialRoomSurface) -> SCNNode {
            let dimensions = normalizedDimensions(surface.dimensions, minimum: surface.category == "floor" ? 0.025 : 0.035)
            let geometry = SCNBox(
                width: CGFloat(dimensions.x),
                height: CGFloat(dimensions.y),
                length: CGFloat(dimensions.z),
                chamferRadius: 0
            )
            let material = SCNMaterial()
            material.lightingModel = .physicallyBased
            material.diffuse.contents = surfaceColor(surface.category)
            material.roughness.contents = 0.9
            material.metalness.contents = 0.02
            material.isDoubleSided = true
            switch surface.category {
            case "window":
                material.transparency = 0.28
            case "opening":
                material.transparency = 0.12
            case "wall":
                material.transparency = 0.72
            default:
                material.transparency = 1
            }
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.simdTransform = matrix(from: surface.transform)
            node.castsShadow = false
            node.categoryBitMask = 1
            return node
        }

        private func makeObjectNode(_ object: SpatialRoomObject) -> SCNNode {
            let dimensions = normalizedDimensions(object.dimensions, minimum: 0.035)
            let geometry = SCNBox(
                width: CGFloat(dimensions.x),
                height: CGFloat(dimensions.y),
                length: CGFloat(dimensions.z),
                chamferRadius: 0.015
            )
            let material = SCNMaterial()
            material.lightingModel = .physicallyBased
            material.diffuse.contents = objectColor(object.category)
            material.roughness.contents = 0.78
            material.metalness.contents = 0.02
            material.transparency = 0.78
            material.isDoubleSided = true
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.simdTransform = matrix(from: object.transform)
            node.castsShadow = true
            node.categoryBitMask = 1
            return node
        }

        private func addMarker(for placement: SpatialRoomPlacement, to root: SCNNode) {
            guard placement.position.count == 3 else { return }
            let marker = SCNNode()
            marker.name = markerName(placement.resource.id)
            marker.position = SCNVector3(
                Float(placement.position[0]),
                Float(placement.position[1]),
                Float(placement.position[2])
            )
            marker.categoryBitMask = 2

            let stemMaterial = markerMaterial(color: UIColor(red: 0.30, green: 0.27, blue: 0.90, alpha: 1))
            let stem = SCNNode(geometry: SCNCylinder(radius: 0.012, height: 0.22))
            stem.name = marker.name
            stem.position.y = 0.11
            stem.geometry?.materials = [stemMaterial]
            stem.categoryBitMask = 2
            stem.renderingOrder = 50
            marker.addChildNode(stem)

            let dotMaterial = markerMaterial(color: UIColor(red: 0.40, green: 0.36, blue: 1, alpha: 1))
            let dot = SCNNode(geometry: SCNSphere(radius: 0.07))
            dot.name = marker.name
            dot.position.y = 0.26
            dot.geometry?.materials = [dotMaterial]
            dot.categoryBitMask = 2
            dot.renderingOrder = 50
            marker.addChildNode(dot)

            markerStyles[placement.resource.id] = MarkerStyle(
                node: marker,
                dotMaterial: dotMaterial,
                stemMaterial: stemMaterial
            )
            root.addChildNode(marker)
        }

        private func markerMaterial(color: UIColor) -> SCNMaterial {
            let material = SCNMaterial()
            material.lightingModel = .constant
            material.diffuse.contents = color
            material.readsFromDepthBuffer = false
            material.writesToDepthBuffer = false
            return material
        }

        func applySelection(_ resourceID: UUID?) {
            for (id, style) in markerStyles {
                let selected = id == resourceID
                style.node.scale = selected
                    ? SCNVector3(1.35, 1.35, 1.35)
                    : SCNVector3(1, 1, 1)
                style.dotMaterial.diffuse.contents = selected
                    ? UIColor(red: 1, green: 0.40, blue: 0.10, alpha: 1)
                    : UIColor(red: 0.40, green: 0.36, blue: 1, alpha: 1)
                style.stemMaterial.diffuse.contents = selected
                    ? UIColor(red: 0.93, green: 0.25, blue: 0.07, alpha: 1)
                    : UIColor(red: 0.30, green: 0.27, blue: 0.90, alpha: 1)
            }
        }

        func applyCamera(_ command: RoomSceneCameraCommand, animated: Bool) {
            guard let view = sceneView, let cameraNode else { return }
            let duration = animated ? 0.35 : 0
            SCNTransaction.begin()
            SCNTransaction.animationDuration = duration
            view.defaultCameraController.target = sceneCenter
            switch command {
            case .reset:
                cameraNode.position = sceneCenter + SCNVector3(
                    sceneRadius * 1.25,
                    sceneRadius * 0.9,
                    sceneRadius * 1.35
                )
                cameraNode.look(
                    at: sceneCenter,
                    up: SCNVector3(0, 1, 0),
                    localFront: SCNVector3(0, 0, -1)
                )
            case .top:
                cameraNode.position = sceneCenter + SCNVector3(0, sceneRadius * 2.2, 0.001)
                cameraNode.look(
                    at: sceneCenter,
                    up: SCNVector3(0, 0, -1),
                    localFront: SCNVector3(0, 0, -1)
                )
            }
            SCNTransaction.commit()
        }

        @objc private func didTapScene(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view as? SCNView else { return }
            let point = gesture.location(in: view)
            let hits = view.hitTest(
                point,
                options: [
                    .categoryBitMask: 2,
                    .firstFoundOnly: true,
                ]
            )
            guard let node = hits.first?.node,
                  let id = resourceID(for: node) else { return }
            parent.selectedResourceID = id
            applySelection(id)
        }

        @objc private func didInteract(_ gesture: UIGestureRecognizer) {
            guard gesture.state == .began || gesture.state == .ended else { return }
            parent.onInteraction()
        }

        private func resourceID(for node: SCNNode) -> UUID? {
            var candidate: SCNNode? = node
            while let current = candidate {
                if let name = current.name,
                   name.hasPrefix("inventory-marker:"),
                   let id = UUID(uuidString: String(name.dropFirst("inventory-marker:".count))) {
                    return id
                }
                candidate = current.parent
            }
            return nil
        }

        private func markerName(_ id: UUID) -> String {
            "inventory-marker:\(id.uuidString.lowercased())"
        }

        private func addLights(to root: SCNNode) {
            let ambient = SCNLight()
            ambient.type = .ambient
            ambient.color = UIColor(white: 0.92, alpha: 1)
            ambient.intensity = 650
            let ambientNode = SCNNode()
            ambientNode.light = ambient
            root.addChildNode(ambientNode)

            let sun = SCNLight()
            sun.type = .directional
            sun.color = UIColor.white
            sun.intensity = 1_250
            sun.castsShadow = true
            sun.shadowRadius = 4
            sun.shadowColor = UIColor.black.withAlphaComponent(0.18)
            let sunNode = SCNNode()
            sunNode.light = sun
            sunNode.eulerAngles = SCNVector3(-0.95, 0.65, 0)
            root.addChildNode(sunNode)
        }

        private func makeGrid(for bounds: SceneBounds) -> SCNNode {
            let extent = max(max(bounds.size.x, bounds.size.z) * 1.5, 4)
            let spacing: Float = extent > 20 ? 2 : extent > 10 ? 1 : 0.5
            let half = ceil(extent / spacing) * spacing * 0.5
            var vertices: [SCNVector3] = []
            var position = -half
            while position <= half + 0.001 {
                vertices.append(SCNVector3(-half, 0, position))
                vertices.append(SCNVector3(half, 0, position))
                vertices.append(SCNVector3(position, 0, -half))
                vertices.append(SCNVector3(position, 0, half))
                position += spacing
            }
            let source = SCNGeometrySource(vertices: vertices)
            let indices = Array(Int32(0) ..< Int32(vertices.count))
            let element = SCNGeometryElement(indices: indices, primitiveType: .line)
            let geometry = SCNGeometry(sources: [source], elements: [element])
            let material = SCNMaterial()
            material.lightingModel = .constant
            material.diffuse.contents = UIColor(white: 0.56, alpha: 0.38)
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.position = SCNVector3(bounds.center.x, bounds.minimumY - 0.03, bounds.center.z)
            node.categoryBitMask = 1
            return node
        }

        private func normalizedDimensions(_ values: SpatialVector3, minimum: Double) -> SCNVector3 {
            guard values.count == 3 else {
                return SCNVector3(Float(minimum), Float(minimum), Float(minimum))
            }
            return SCNVector3(
                Float(max(values[0], minimum)),
                Float(max(values[1], minimum)),
                Float(max(values[2], minimum))
            )
        }

        private func matrix(from values: SpatialMatrix4) -> simd_float4x4 {
            guard values.count == 16 else { return matrix_identity_float4x4 }
            return simd_float4x4(columns: (
                SIMD4(Float(values[0]), Float(values[1]), Float(values[2]), Float(values[3])),
                SIMD4(Float(values[4]), Float(values[5]), Float(values[6]), Float(values[7])),
                SIMD4(Float(values[8]), Float(values[9]), Float(values[10]), Float(values[11])),
                SIMD4(Float(values[12]), Float(values[13]), Float(values[14]), Float(values[15]))
            ))
        }

        private func transformedBounds(for scene: SpatialRoomScene) -> SceneBounds {
            guard scene.bounds.min.count == 3, scene.bounds.max.count == 3 else {
                return SceneBounds(
                    center: SCNVector3Zero,
                    size: SCNVector3(3, 3, 3),
                    minimumY: -1.5
                )
            }
            let minimum = scene.bounds.min.map(Float.init)
            let maximum = scene.bounds.max.map(Float.init)
            let transform = matrix(from: scene.webFromWorld) * matrix(from: scene.worldFromModel)
            var transformedMinimum = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
            var transformedMaximum = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
            for x in [minimum[0], maximum[0]] {
                for y in [minimum[1], maximum[1]] {
                    for z in [minimum[2], maximum[2]] {
                        let point = transform * SIMD4<Float>(x, y, z, 1)
                        let divisor = point.w == 0 ? 1 : point.w
                        let value = SIMD3<Float>(point.x / divisor, point.y / divisor, point.z / divisor)
                        transformedMinimum = simd_min(transformedMinimum, value)
                        transformedMaximum = simd_max(transformedMaximum, value)
                    }
                }
            }
            let center = (transformedMinimum + transformedMaximum) * 0.5
            let size = transformedMaximum - transformedMinimum
            return SceneBounds(
                center: SCNVector3(center.x, center.y, center.z),
                size: SCNVector3(max(size.x, 0.1), max(size.y, 0.1), max(size.z, 0.1)),
                minimumY: transformedMinimum.y
            )
        }

        private func surfaceColor(_ category: String) -> UIColor {
            switch category {
            case "wall": UIColor(red: 0.76, green: 0.80, blue: 0.84, alpha: 1)
            case "floor": UIColor(red: 0.63, green: 0.68, blue: 0.73, alpha: 1)
            case "door": UIColor(red: 0.60, green: 0.40, blue: 0.25, alpha: 1)
            case "window": UIColor(red: 0.34, green: 0.67, blue: 0.84, alpha: 1)
            case "opening": UIColor(red: 0.48, green: 0.54, blue: 0.62, alpha: 1)
            default: UIColor(red: 0.69, green: 0.72, blue: 0.76, alpha: 1)
            }
        }

        private func objectColor(_ category: String) -> UIColor {
            switch category {
            case "storage": UIColor(red: 0.48, green: 0.40, blue: 0.31, alpha: 1)
            case "table": UIColor(red: 0.61, green: 0.43, blue: 0.28, alpha: 1)
            case "chair": UIColor(red: 0.39, green: 0.48, blue: 0.39, alpha: 1)
            case "sofa": UIColor(red: 0.38, green: 0.43, blue: 0.58, alpha: 1)
            case "bed": UIColor(red: 0.55, green: 0.49, blue: 0.65, alpha: 1)
            case "refrigerator": UIColor(red: 0.56, green: 0.63, blue: 0.70, alpha: 1)
            default: UIColor(red: 0.55, green: 0.49, blue: 0.43, alpha: 1)
            }
        }
    }
}

private struct SceneBounds {
    let center: SCNVector3
    let size: SCNVector3
    let minimumY: Float
}

private func + (lhs: SCNVector3, rhs: SCNVector3) -> SCNVector3 {
    SCNVector3(lhs.x + rhs.x, lhs.y + rhs.y, lhs.z + rhs.z)
}
