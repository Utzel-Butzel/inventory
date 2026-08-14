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
        private enum TexturePattern {
            case plaster
            case grain
            case speckle
        }

        private struct SurfaceRect {
            let left: Float
            let right: Float
            let bottom: Float
            let top: Float
        }

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
        private lazy var wallTexture = proceduralTexture(
            base: (242, 239, 233),
            variation: 7,
            pattern: .plaster,
            seed: 11
        )
        private lazy var floorTexture = proceduralTexture(
            base: (112, 91, 69),
            variation: 15,
            pattern: .grain,
            seed: 43
        )
        private lazy var doorTexture = proceduralTexture(
            base: (177, 137, 96),
            variation: 18,
            pattern: .grain,
            seed: 59
        )
        private lazy var objectTexture = proceduralTexture(
            base: (246, 242, 235),
            variation: 9,
            pattern: .speckle,
            seed: 71
        )

        init(parent: RoomSceneViewport) {
            self.parent = parent
        }

        func configure(_ view: SCNView) {
            scanID = parent.manifest.scan.id
            markerStyles.removeAll(keepingCapacity: true)
            sceneView = view

            let scene = makeScene(from: parent.manifest)
            view.scene = scene
            view.backgroundColor = UIColor(red: 0.953, green: 0.961, blue: 0.969, alpha: 1)
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
            let background = UIColor(red: 0.953, green: 0.961, blue: 0.969, alpha: 1)
            scene.background.contents = background
            scene.fogColor = background
            scene.fogStartDistance = 18
            scene.fogEndDistance = 55

            let framedBounds = transformedBounds(for: manifest.scan.scene)
            sceneCenter = framedBounds.center
            let size = framedBounds.size
            sceneRadius = max(sqrt(size.x * size.x + size.y * size.y + size.z * size.z) * 0.5, 1.5)
            addLights(to: scene.rootNode, center: sceneCenter, radius: sceneRadius)

            let webRoot = SCNNode()
            webRoot.simdTransform = matrix(from: manifest.scan.scene.webFromWorld)
            scene.rootNode.addChildNode(webRoot)

            let modelRoot = SCNNode()
            modelRoot.simdTransform = matrix(from: manifest.scan.scene.worldFromModel)
            webRoot.addChildNode(modelRoot)

            let aperturesByWall = wallApertures(manifest.scan.scene.surfaces)
            for surface in manifest.scan.scene.surfaces {
                switch surface.category {
                case "wall":
                    modelRoot.addChildNode(
                        makeWallNode(surface, apertures: aperturesByWall[surface.id] ?? [])
                    )
                case "door":
                    modelRoot.addChildNode(makeDoorNode(surface))
                case "window":
                    modelRoot.addChildNode(makeWindowNode(surface))
                case "opening":
                    modelRoot.addChildNode(makeOpeningNode(surface))
                default:
                    modelRoot.addChildNode(makeSurfaceNode(surface))
                }
            }
            for object in manifest.scan.scene.objects {
                modelRoot.addChildNode(makeObjectNode(object))
            }
            for placement in manifest.placements {
                addMarker(for: placement, to: webRoot)
            }

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
            let minimum = surface.category == "floor" ? 0.025 : 0.035
            let dimensions = normalizedDimensions(surface.dimensions, minimum: minimum)
            let geometry = SCNBox(
                width: CGFloat(dimensions.x),
                height: CGFloat(dimensions.y),
                length: CGFloat(dimensions.z),
                chamferRadius: 0
            )
            let material = surface.category == "floor"
                ? texturedMaterial(
                    texture: floorTexture,
                    repeatX: 6,
                    repeatY: 4,
                    roughness: 0.76,
                    metalness: 0.01
                )
                : texturedMaterial(
                    texture: wallTexture,
                    repeatX: 5,
                    repeatY: 5,
                    roughness: 0.96
                )
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.simdTransform = matrix(from: surface.transform)
            node.castsShadow = false
            node.categoryBitMask = 1
            return node
        }

        private func makeWallNode(
            _ surface: SpatialRoomSurface,
            apertures: [SurfaceRect]
        ) -> SCNNode {
            let dimensions = normalizedDimensions(surface.dimensions, minimum: 0.035)
            var pieces = [
                SurfaceRect(
                    left: -dimensions.x / 2,
                    right: dimensions.x / 2,
                    bottom: -dimensions.y / 2,
                    top: dimensions.y / 2
                ),
            ]
            for aperture in apertures {
                pieces = pieces.flatMap { subtract($0, cutout: aperture) }
            }

            let wall = SCNNode()
            wall.simdTransform = matrix(from: surface.transform)
            let material = texturedMaterial(
                texture: wallTexture,
                repeatX: 5,
                repeatY: 5,
                roughness: 0.96
            )
            for piece in pieces {
                let width = piece.right - piece.left
                let height = piece.top - piece.bottom
                guard width > 0.002, height > 0.002 else { continue }
                let node = boxNode(
                    size: SCNVector3(width, height, dimensions.z),
                    position: SCNVector3(
                        (piece.left + piece.right) / 2,
                        (piece.bottom + piece.top) / 2,
                        0
                    ),
                    material: material
                )
                node.castsShadow = false
                wall.addChildNode(node)
            }
            return wall
        }

        private func makeDoorNode(_ surface: SpatialRoomSurface) -> SCNNode {
            let dimensions = normalizedDimensions(surface.dimensions, minimum: 0.065)
            let width = dimensions.x
            let height = dimensions.y
            let measuredDepth = dimensions.z
            let frameWidth = min(max(min(width, height) * 0.075, 0.035), 0.085)
            let frameDepth = max(measuredDepth, 0.10)
            let gap = min(0.012, width * 0.025)
            let panelWidth = max(width - frameWidth * 2 - gap * 2, 0.025)
            let panelHeight = max(height - frameWidth - gap * 2, 0.025)
            // Extend past even an unassociated wall on both sides. This avoids
            // coplanar faces when RoomPlan reports identical wall/door depths.
            let panelDepth = min(max(measuredDepth + 0.012, 0.055), 0.085)

            let door = SCNNode()
            door.simdTransform = matrix(from: surface.transform)
            let frameMaterial = texturedMaterial(
                texture: wallTexture,
                repeatX: 4,
                repeatY: 4,
                roughness: 0.78
            )
            let panelMaterial = texturedMaterial(
                texture: doorTexture,
                repeatX: 4,
                repeatY: 2,
                roughness: 0.68,
                metalness: 0.01
            )
            let detailMaterial = coloredMaterial(
                UIColor(red: 0.753, green: 0.553, blue: 0.365, alpha: 1),
                roughness: 0.76
            )
            let hardwareMaterial = coloredMaterial(
                UIColor(red: 0.725, green: 0.647, blue: 0.435, alpha: 1),
                roughness: 0.27,
                metalness: 0.82
            )

            addBox(
                to: door,
                size: SCNVector3(frameWidth, height, frameDepth),
                position: SCNVector3(-width / 2 + frameWidth / 2, 0, 0),
                material: frameMaterial,
                castsShadow: true
            )
            addBox(
                to: door,
                size: SCNVector3(frameWidth, height, frameDepth),
                position: SCNVector3(width / 2 - frameWidth / 2, 0, 0),
                material: frameMaterial,
                castsShadow: true
            )
            addBox(
                to: door,
                size: SCNVector3(width - frameWidth * 2, frameWidth, frameDepth),
                position: SCNVector3(0, height / 2 - frameWidth / 2, 0),
                material: frameMaterial,
                castsShadow: true
            )
            addBox(
                to: door,
                size: SCNVector3(panelWidth, panelHeight, panelDepth),
                position: SCNVector3(0, -frameWidth / 2, 0),
                material: panelMaterial,
                castsShadow: true
            )

            if panelWidth > 0.32, panelHeight > 0.75 {
                let detailDepth: Float = 0.009
                for direction: Float in [-1, 1] {
                    for y in [-panelHeight * 0.22, panelHeight * 0.2] {
                        addBox(
                            to: door,
                            size: SCNVector3(panelWidth * 0.68, panelHeight * 0.28, detailDepth),
                            position: SCNVector3(
                                0,
                                y - frameWidth / 2,
                                direction * (panelDepth / 2 + detailDepth / 2)
                            ),
                            material: detailMaterial,
                            castsShadow: true
                        )
                    }
                }
            }

            if panelWidth > 0.24, panelHeight > 0.5 {
                let handleX = panelWidth * 0.34
                let handleY = -height / 2 + min(1, height * 0.48)
                let radius = min(max(width * 0.032, 0.018), 0.032)
                for direction: Float in [-1, 1] {
                    let rosette = SCNNode(
                        geometry: SCNCylinder(
                            radius: CGFloat(radius),
                            height: 0.014
                        )
                    )
                    rosette.geometry?.materials = [hardwareMaterial]
                    rosette.position = SCNVector3(
                        handleX,
                        handleY,
                        direction * (panelDepth / 2 + 0.009)
                    )
                    rosette.eulerAngles.x = .pi / 2
                    rosette.castsShadow = true
                    door.addChildNode(rosette)
                    addBox(
                        to: door,
                        size: SCNVector3(radius * 2.6, radius * 0.48, 0.018),
                        position: SCNVector3(
                            handleX - radius * 0.8,
                            handleY,
                            direction * (panelDepth / 2 + 0.022)
                        ),
                        material: hardwareMaterial,
                        castsShadow: true
                    )
                }
            }
            return door
        }

        private func makeWindowNode(_ surface: SpatialRoomSurface) -> SCNNode {
            let dimensions = normalizedDimensions(surface.dimensions, minimum: 0.045)
            let width = dimensions.x
            let height = dimensions.y
            let frameWidth = min(max(min(width, height) * 0.085, 0.032), 0.075)
            let frameDepth = max(dimensions.z, 0.085)
            let glassWidth = max(width - frameWidth * 2, 0.02)
            let glassHeight = max(height - frameWidth * 2, 0.02)

            let window = SCNNode()
            window.simdTransform = matrix(from: surface.transform)
            let frameMaterial = coloredMaterial(
                UIColor(red: 0.906, green: 0.918, blue: 0.922, alpha: 1),
                roughness: 0.50,
                metalness: 0.06
            )
            let glassMaterial = coloredMaterial(
                UIColor(red: 0.510, green: 0.706, blue: 0.784, alpha: 1),
                roughness: 0.12,
                transparency: 0.46
            )
            glassMaterial.writesToDepthBuffer = false
            glassMaterial.blendMode = .alpha

            addBox(to: window, size: SCNVector3(frameWidth, height, frameDepth), position: SCNVector3(-width / 2 + frameWidth / 2, 0, 0), material: frameMaterial)
            addBox(to: window, size: SCNVector3(frameWidth, height, frameDepth), position: SCNVector3(width / 2 - frameWidth / 2, 0, 0), material: frameMaterial)
            addBox(to: window, size: SCNVector3(glassWidth, frameWidth, frameDepth), position: SCNVector3(0, height / 2 - frameWidth / 2, 0), material: frameMaterial)
            addBox(to: window, size: SCNVector3(glassWidth, frameWidth, frameDepth), position: SCNVector3(0, -height / 2 + frameWidth / 2, 0), material: frameMaterial)
            addBox(
                to: window,
                size: SCNVector3(glassWidth, glassHeight, 0.012),
                position: SCNVector3Zero,
                material: glassMaterial
            )
            return window
        }

        private func makeOpeningNode(_ surface: SpatialRoomSurface) -> SCNNode {
            let dimensions = normalizedDimensions(surface.dimensions, minimum: 0.035)
            let width = dimensions.x
            let height = dimensions.y
            let trimWidth = min(max(min(width, height) * 0.055, 0.025), 0.055)
            let depth = max(dimensions.z, 0.075)
            let opening = SCNNode()
            opening.simdTransform = matrix(from: surface.transform)
            let material = coloredMaterial(
                UIColor(red: 0.851, green: 0.831, blue: 0.792, alpha: 1),
                roughness: 0.86
            )
            addBox(to: opening, size: SCNVector3(trimWidth, height, depth), position: SCNVector3(-width / 2 + trimWidth / 2, 0, 0), material: material)
            addBox(to: opening, size: SCNVector3(trimWidth, height, depth), position: SCNVector3(width / 2 - trimWidth / 2, 0, 0), material: material)
            addBox(to: opening, size: SCNVector3(width - trimWidth * 2, trimWidth, depth), position: SCNVector3(0, height / 2 - trimWidth / 2, 0), material: material)
            return opening
        }

        private func makeObjectNode(_ object: SpatialRoomObject) -> SCNNode {
            let dimensions = normalizedDimensions(object.dimensions, minimum: 0.035)
            let shortestSide = min(dimensions.x, min(dimensions.y, dimensions.z))
            let chamfer = min(max(shortestSide * 0.035, 0.008), 0.03)
            let geometry = SCNBox(
                width: CGFloat(dimensions.x),
                height: CGFloat(dimensions.y),
                length: CGFloat(dimensions.z),
                chamferRadius: CGFloat(chamfer)
            )
            let material = texturedMaterial(
                texture: objectTexture,
                color: objectColor(object.category),
                repeatX: 3,
                repeatY: 3,
                roughness: 0.70,
                metalness: 0.025
            )
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.simdTransform = matrix(from: object.transform)
            node.castsShadow = true
            node.categoryBitMask = 1
            return node
        }

        private func boxNode(
            size: SCNVector3,
            position: SCNVector3,
            material: SCNMaterial
        ) -> SCNNode {
            let geometry = SCNBox(
                width: CGFloat(max(size.x, 0.002)),
                height: CGFloat(max(size.y, 0.002)),
                length: CGFloat(max(size.z, 0.002)),
                chamferRadius: 0
            )
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.position = position
            node.categoryBitMask = 1
            return node
        }

        private func addBox(
            to parent: SCNNode,
            size: SCNVector3,
            position: SCNVector3,
            material: SCNMaterial,
            castsShadow: Bool = false
        ) {
            let node = boxNode(size: size, position: position, material: material)
            node.castsShadow = castsShadow
            parent.addChildNode(node)
        }

        private func coloredMaterial(
            _ color: UIColor,
            roughness: CGFloat,
            metalness: CGFloat = 0,
            transparency: CGFloat = 1
        ) -> SCNMaterial {
            let material = SCNMaterial()
            material.lightingModel = .physicallyBased
            material.diffuse.contents = color
            material.roughness.contents = roughness
            material.metalness.contents = metalness
            material.transparency = transparency
            material.isDoubleSided = true
            return material
        }

        private func texturedMaterial(
            texture: UIImage,
            color: UIColor = .white,
            repeatX: Float,
            repeatY: Float,
            roughness: CGFloat,
            metalness: CGFloat = 0
        ) -> SCNMaterial {
            let material = coloredMaterial(
                color,
                roughness: roughness,
                metalness: metalness
            )
            material.diffuse.contents = texture
            material.diffuse.wrapS = .repeat
            material.diffuse.wrapT = .repeat
            material.diffuse.minificationFilter = .linear
            material.diffuse.magnificationFilter = .linear
            material.diffuse.mipFilter = .linear
            material.diffuse.maxAnisotropy = 8
            material.diffuse.contentsTransform = SCNMatrix4MakeScale(repeatX, repeatY, 1)
            material.multiply.contents = color
            return material
        }

        private func proceduralTexture(
            base: (Int, Int, Int),
            variation: Int,
            pattern: TexturePattern,
            seed: Int
        ) -> UIImage {
            let size = 128
            var pixels = [UInt8](repeating: 255, count: size * size * 4)
            for y in 0 ..< size {
                for x in 0 ..< size {
                    let value = patternValue(pattern, x: x, y: y, seed: seed)
                    let offset = Int((value * Double(variation)).rounded())
                    let index = (y * size + x) * 4
                    pixels[index] = UInt8(clamping: base.0 + offset)
                    pixels[index + 1] = UInt8(clamping: base.1 + offset)
                    pixels[index + 2] = UInt8(clamping: base.2 + offset)
                }
            }

            let data = Data(pixels) as CFData
            guard let provider = CGDataProvider(data: data),
                  let image = CGImage(
                    width: size,
                    height: size,
                    bitsPerComponent: 8,
                    bitsPerPixel: 32,
                    bytesPerRow: size * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGBitmapInfo(
                        rawValue: CGImageAlphaInfo.last.rawValue
                    ),
                    provider: provider,
                    decode: nil,
                    shouldInterpolate: true,
                    intent: .defaultIntent
                  ) else {
                return UIImage()
            }
            return UIImage(cgImage: image)
        }

        private func patternValue(
            _ pattern: TexturePattern,
            x: Int,
            y: Int,
            seed: Int
        ) -> Double {
            let fine = textureNoise(x: x, y: y, seed: seed) * 2 - 1
            let broad = textureNoise(x: x / 9, y: y / 9, seed: seed + 17) * 2 - 1
            switch pattern {
            case .grain:
                let grain = sin(Double(x) * 0.38 + sin(Double(y) * 0.09 + Double(seed)) * 2.4)
                return grain * 0.68 + fine * 0.2 + broad * 0.12
            case .plaster:
                return fine * 0.36 + broad * 0.64
            case .speckle:
                return fine * 0.7 + broad * 0.3
            }
        }

        private func textureNoise(x: Int, y: Int, seed: Int) -> Double {
            let value = sin(
                Double(x) * 12.9898 +
                    Double(y) * 78.233 +
                    Double(seed) * 37.719
            ) * 43_758.5453
            return value - floor(value)
        }

        private func wallApertures(
            _ surfaces: [SpatialRoomSurface]
        ) -> [UUID: [SurfaceRect]] {
            let walls = surfaces.filter { $0.category == "wall" }
            let apertures = surfaces.filter {
                ["door", "window", "opening"].contains($0.category)
            }
            var matches: [UUID: [SurfaceRect]] = [:]

            for aperture in apertures {
                let apertureDimensions = normalizedDimensions(aperture.dimensions, minimum: 0.04)
                var best: (wall: SpatialRoomSurface, rect: SurfaceRect, score: Float)?

                for wall in walls {
                    let wallDimensions = normalizedDimensions(wall.dimensions, minimum: 0.04)
                    let wallFromAperture = simd_inverse(matrix(from: wall.transform)) *
                        matrix(from: aperture.transform)
                    let rawNormal = wallFromAperture * SIMD4<Float>(0, 0, 1, 0)
                    let normalLength = max(simd_length(SIMD3(rawNormal.x, rawNormal.y, rawNormal.z)), 0.001)
                    let normalAlignment = abs(rawNormal.z / normalLength)
                    guard normalAlignment >= 0.82 else { continue }

                    let localCorners = [
                        SIMD4<Float>(-apertureDimensions.x / 2, -apertureDimensions.y / 2, 0, 1),
                        SIMD4<Float>(apertureDimensions.x / 2, -apertureDimensions.y / 2, 0, 1),
                        SIMD4<Float>(apertureDimensions.x / 2, apertureDimensions.y / 2, 0, 1),
                        SIMD4<Float>(-apertureDimensions.x / 2, apertureDimensions.y / 2, 0, 1),
                    ]
                    let corners = localCorners.map { wallFromAperture * $0 }
                    let planeDistance = corners.map { abs($0.z) }.max() ?? .greatestFiniteMagnitude
                    guard planeDistance <= 0.24 else { continue }

                    let projected = SurfaceRect(
                        left: corners.map(\.x).min() ?? 0,
                        right: corners.map(\.x).max() ?? 0,
                        bottom: corners.map(\.y).min() ?? 0,
                        top: corners.map(\.y).max() ?? 0
                    )
                    let wallBounds = SurfaceRect(
                        left: -wallDimensions.x / 2,
                        right: wallDimensions.x / 2,
                        bottom: -wallDimensions.y / 2,
                        top: wallDimensions.y / 2
                    )
                    let overlapWidth = min(projected.right, wallBounds.right) -
                        max(projected.left, wallBounds.left)
                    let overlapHeight = min(projected.top, wallBounds.top) -
                        max(projected.bottom, wallBounds.bottom)
                    guard overlapWidth >= 0.04, overlapHeight >= 0.04 else { continue }

                    let outside =
                        max(0, wallBounds.left - projected.left) +
                        max(0, projected.right - wallBounds.right) +
                        max(0, wallBounds.bottom - projected.bottom) +
                        max(0, projected.top - wallBounds.top)
                    let padding: Float = 0.012
                    let rect = SurfaceRect(
                        left: max(wallBounds.left, projected.left - padding),
                        right: min(wallBounds.right, projected.right + padding),
                        bottom: max(wallBounds.bottom, projected.bottom - padding),
                        top: min(wallBounds.top, projected.top + padding)
                    )
                    let score = planeDistance * 5 + (1 - normalAlignment) * 2 + outside * 3
                    if best == nil || score < best!.score {
                        best = (wall, rect, score)
                    }
                }

                if let best {
                    matches[best.wall.id, default: []].append(best.rect)
                }
            }
            return matches
        }

        private func subtract(_ source: SurfaceRect, cutout: SurfaceRect) -> [SurfaceRect] {
            let overlap = SurfaceRect(
                left: max(source.left, cutout.left),
                right: min(source.right, cutout.right),
                bottom: max(source.bottom, cutout.bottom),
                top: min(source.top, cutout.top)
            )
            guard overlap.right - overlap.left > 0.001,
                  overlap.top - overlap.bottom > 0.001 else {
                return [source]
            }

            var pieces: [SurfaceRect] = []
            if overlap.left - source.left > 0.001 {
                pieces.append(
                    SurfaceRect(
                        left: source.left,
                        right: overlap.left,
                        bottom: source.bottom,
                        top: source.top
                    )
                )
            }
            if source.right - overlap.right > 0.001 {
                pieces.append(
                    SurfaceRect(
                        left: overlap.right,
                        right: source.right,
                        bottom: source.bottom,
                        top: source.top
                    )
                )
            }
            if overlap.bottom - source.bottom > 0.001 {
                pieces.append(
                    SurfaceRect(
                        left: overlap.left,
                        right: overlap.right,
                        bottom: source.bottom,
                        top: overlap.bottom
                    )
                )
            }
            if source.top - overlap.top > 0.001 {
                pieces.append(
                    SurfaceRect(
                        left: overlap.left,
                        right: overlap.right,
                        bottom: overlap.top,
                        top: source.top
                    )
                )
            }
            return pieces
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

        private func addLights(
            to root: SCNNode,
            center: SCNVector3,
            radius: Float
        ) {
            let ambient = SCNLight()
            ambient.type = .ambient
            ambient.color = UIColor(red: 1, green: 0.98, blue: 0.945, alpha: 1)
            ambient.intensity = 480
            let ambientNode = SCNNode()
            ambientNode.light = ambient
            root.addChildNode(ambientNode)

            let sun = SCNLight()
            sun.type = .directional
            sun.color = UIColor(red: 1, green: 0.945, blue: 0.863, alpha: 1)
            sun.intensity = 1_350
            sun.castsShadow = true
            sun.shadowMapSize = CGSize(width: 2_048, height: 2_048)
            sun.shadowSampleCount = 16
            sun.shadowBias = 0.004
            sun.shadowRadius = 8
            sun.shadowColor = UIColor.black.withAlphaComponent(0.20)
            sun.orthographicScale = Double(radius * 2.9)
            sun.zNear = Double(max(0.1, radius * 0.05))
            sun.zFar = Double(max(20, radius * 6))
            let sunNode = SCNNode()
            sunNode.light = sun
            sunNode.position = center + SCNVector3(radius * 1.25, radius * 2.4, radius * 1.15)
            sunNode.look(
                at: center,
                up: SCNVector3(0, 1, 0),
                localFront: SCNVector3(0, 0, -1)
            )
            root.addChildNode(sunNode)

            let fill = SCNLight()
            fill.type = .directional
            fill.color = UIColor(red: 0.863, green: 0.925, blue: 1, alpha: 1)
            fill.intensity = 520
            let fillNode = SCNNode()
            fillNode.light = fill
            fillNode.position = center + SCNVector3(-radius * 1.6, radius * 1.1, -radius * 0.9)
            fillNode.look(
                at: center,
                up: SCNVector3(0, 1, 0),
                localFront: SCNVector3(0, 0, -1)
            )
            root.addChildNode(fillNode)

            let rim = SCNLight()
            rim.type = .directional
            rim.color = UIColor(red: 1, green: 0.886, blue: 0.761, alpha: 1)
            rim.intensity = 300
            let rimNode = SCNNode()
            rimNode.light = rim
            rimNode.position = center + SCNVector3(radius * 0.25, radius * 1.4, -radius * 1.8)
            rimNode.look(
                at: center,
                up: SCNVector3(0, 1, 0),
                localFront: SCNVector3(0, 0, -1)
            )
            root.addChildNode(rimNode)
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

        private func objectColor(_ category: String) -> UIColor {
            switch category {
            case "storage": UIColor(red: 0.718, green: 0.604, blue: 0.447, alpha: 1)
            case "table": UIColor(red: 0.757, green: 0.584, blue: 0.400, alpha: 1)
            case "chair": UIColor(red: 0.663, green: 0.529, blue: 0.408, alpha: 1)
            case "sofa": UIColor(red: 0.529, green: 0.573, blue: 0.659, alpha: 1)
            case "bed": UIColor(red: 0.678, green: 0.624, blue: 0.733, alpha: 1)
            case "refrigerator": UIColor(red: 0.761, green: 0.796, blue: 0.820, alpha: 1)
            case "stove": UIColor(red: 0.455, green: 0.494, blue: 0.525, alpha: 1)
            case "oven": UIColor(red: 0.451, green: 0.482, blue: 0.510, alpha: 1)
            case "dishwasher": UIColor(red: 0.667, green: 0.710, blue: 0.741, alpha: 1)
            case "washer-dryer": UIColor(red: 0.710, green: 0.745, blue: 0.769, alpha: 1)
            case "sink": UIColor(red: 0.824, green: 0.816, blue: 0.788, alpha: 1)
            case "toilet": UIColor(red: 0.851, green: 0.843, blue: 0.816, alpha: 1)
            case "bathtub": UIColor(red: 0.843, green: 0.831, blue: 0.800, alpha: 1)
            case "fireplace": UIColor(red: 0.612, green: 0.490, blue: 0.408, alpha: 1)
            case "television": UIColor(red: 0.333, green: 0.361, blue: 0.396, alpha: 1)
            case "stairs": UIColor(red: 0.624, green: 0.592, blue: 0.533, alpha: 1)
            default: UIColor(red: 0.690, green: 0.608, blue: 0.518, alpha: 1)
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
