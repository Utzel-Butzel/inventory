import Foundation

/// Couples an asynchronous world-map download to the room selection that
/// started it. Starting or cancelling a selection invalidates every older
/// generation, even when an underlying networking stack completes late.
struct SpatialWorldMapSelectionState: Equatable, Sendable {
    private(set) var scanID: UUID?
    private(set) var generation = UUID()

    @discardableResult
    mutating func begin(scanID: UUID) -> UUID {
        generation = UUID()
        self.scanID = scanID
        return generation
    }

    mutating func cancel() {
        generation = UUID()
        scanID = nil
    }

    func accepts(scanID: UUID, generation: UUID) -> Bool {
        self.scanID == scanID && self.generation == generation
    }
}

/// Small, hardware-independent state machine for AR relocalization. It keeps
/// a delayed timeout from failing a session that has already become ready and
/// allows an interruption to arm a fresh timeout afterwards.
struct SpatialRelocalizationGate: Equatable, Sendable {
    enum Phase: Equatable, Sendable {
        case searching
        case ready
        case failed
    }

    private(set) var phase: Phase = .searching

    var isReady: Bool { phase == .ready }
    var isFailed: Bool { phase == .failed }

    mutating func beginSearching() {
        guard !isFailed else { return }
        phase = .searching
    }

    mutating func markReady() {
        guard !isFailed else { return }
        phase = .ready
    }

    @discardableResult
    mutating func failIfSearching() -> Bool {
        guard phase == .searching else { return false }
        phase = .failed
        return true
    }

    @discardableResult
    mutating func fail() -> Bool {
        guard !isFailed else { return false }
        phase = .failed
        return true
    }
}

struct SpatialRoomDetectionCandidate: Equatable, Sendable {
    let scan: SpatialRoomScanSummary
    let footprint: SpatialRoomFootprint

    init(scan: SpatialRoomScanSummary, scene: SpatialRoomScene) {
        self.scan = scan
        footprint = SpatialRoomFootprint(scene: scene)
    }
}

/// A room footprint in the shared ARKit world coordinate system. Floor
/// surfaces retain their orientation; the broad scene AABB is only a fallback
/// for older scans without a normalized floor surface.
struct SpatialRoomFootprint: Equatable, Sendable {
    struct Point: Equatable, Sendable {
        let x: Double
        let z: Double
    }

    struct Polygon: Equatable, Sendable {
        let vertices: [Point]
    }

    let polygons: [Polygon]
    let minimumY: Double
    let maximumY: Double
    let fallbackMinimum: Point
    let fallbackMaximum: Point

    init(scene: SpatialRoomScene) {
        polygons = scene.surfaces
            .filter { $0.category == "floor" }
            .compactMap {
                Self.floorPolygon(
                    $0,
                    worldFromModel: scene.worldFromModel
                )
            }
        let boundsCorners = Self.boundsCorners(scene.bounds).compactMap {
            Self.transformedPoint($0, matrix: scene.worldFromModel)
        }
        minimumY = boundsCorners.map(\.y).min() ?? -1
        maximumY = boundsCorners.map(\.y).max() ?? 4
        fallbackMinimum = Point(
            x: boundsCorners.map(\.x).min() ?? -1,
            z: boundsCorners.map(\.z).min() ?? -1
        )
        fallbackMaximum = Point(
            x: boundsCorners.map(\.x).max() ?? 1,
            z: boundsCorners.map(\.z).max() ?? 1
        )
    }

    func contains(position: SpatialVector3, margin: Double = 0) -> Bool {
        guard let x = position[safe: 0],
              let y = position[safe: 1],
              let z = position[safe: 2],
              x.isFinite, y.isFinite, z.isFinite,
              y >= minimumY - 1.2,
              y <= maximumY + 1.2
        else { return false }

        let point = Point(x: x, z: z)
        if !polygons.isEmpty {
            return polygons.contains { polygon in
                Self.contains(point, in: polygon) ||
                    Self.distanceToEdges(point, polygon: polygon) <= margin
            }
        }
        return x >= fallbackMinimum.x - margin &&
            x <= fallbackMaximum.x + margin &&
            z >= fallbackMinimum.z - margin &&
            z <= fallbackMaximum.z + margin
    }

    func squaredDistanceToCenter(position: SpatialVector3) -> Double {
        guard let x = position[safe: 0], let z = position[safe: 2] else {
            return .greatestFiniteMagnitude
        }
        let vertices = polygons.flatMap(\.vertices)
        let center: Point
        if vertices.isEmpty {
            center = Point(
                x: (fallbackMinimum.x + fallbackMaximum.x) / 2,
                z: (fallbackMinimum.z + fallbackMaximum.z) / 2
            )
        } else {
            center = Point(
                x: vertices.map(\.x).reduce(0, +) / Double(vertices.count),
                z: vertices.map(\.z).reduce(0, +) / Double(vertices.count)
            )
        }
        let dx = x - center.x
        let dz = z - center.z
        return dx * dx + dz * dz
    }

    private static func floorPolygon(
        _ surface: SpatialRoomSurface,
        worldFromModel: SpatialMatrix4
    ) -> Polygon? {
        guard surface.dimensions.count == 3,
              surface.transform.count == 16,
              worldFromModel.count == 16,
              surface.dimensions.allSatisfy({ $0.isFinite }),
              surface.transform.allSatisfy({ $0.isFinite }),
              worldFromModel.allSatisfy({ $0.isFinite })
        else { return nil }

        if let corners = surface.polygonCorners, corners.count >= 3 {
            let vertices = corners.compactMap { corner -> Point? in
                guard corner.count == 3,
                      let model = transformedPoint(
                          [corner[0], corner[1], corner[2], 1],
                          matrix: surface.transform
                      ),
                      let world = transformedPoint(
                          [model.x, model.y, model.z, 1],
                          matrix: worldFromModel
                      )
                else { return nil }
                return Point(x: world.x, z: world.z)
            }
            if vertices.count == corners.count {
                return Polygon(vertices: vertices)
            }
        }

        let dimensions = surface.dimensions.enumerated()
            .sorted { abs($0.element) > abs($1.element) }
        guard dimensions.count >= 2,
              abs(dimensions[0].element) > 0.05,
              abs(dimensions[1].element) > 0.05
        else { return nil }
        let firstAxis = dimensions[0].offset
        let secondAxis = dimensions[1].offset
        let firstHalf = abs(dimensions[0].element) / 2
        let secondHalf = abs(dimensions[1].element) / 2

        let vertices = [
            (-firstHalf, -secondHalf),
            (firstHalf, -secondHalf),
            (firstHalf, secondHalf),
            (-firstHalf, secondHalf),
        ].compactMap { first, second -> Point? in
            var local = [0.0, 0.0, 0.0, 1.0]
            local[firstAxis] = first
            local[secondAxis] = second
            guard let model = transformedPoint(local, matrix: surface.transform),
                  let world = transformedPoint(
                      [model.x, model.y, model.z, 1],
                      matrix: worldFromModel
                  )
            else { return nil }
            return Point(x: world.x, z: world.z)
        }
        guard vertices.count == 4 else { return nil }
        return Polygon(vertices: vertices)
    }

    private static func boundsCorners(_ bounds: SpatialRoomBounds) -> [[Double]] {
        guard bounds.min.count == 3, bounds.max.count == 3 else { return [] }
        return [bounds.min[0], bounds.max[0]].flatMap { x in
            [bounds.min[1], bounds.max[1]].flatMap { y in
                [bounds.min[2], bounds.max[2]].map { z in [x, y, z, 1] }
            }
        }
    }

    private static func transformedPoint(
        _ point: [Double],
        matrix: SpatialMatrix4
    ) -> (x: Double, y: Double, z: Double)? {
        guard point.count == 4, matrix.count == 16 else { return nil }
        let transformed = (0 ..< 4).map { row in
            (0 ..< 4).reduce(0.0) {
                $0 + matrix[$1 * 4 + row] * point[$1]
            }
        }
        let divisor = abs(transformed[3]) > 0.000_001 ? transformed[3] : 1
        let result = (
            transformed[0] / divisor,
            transformed[1] / divisor,
            transformed[2] / divisor
        )
        guard result.0.isFinite, result.1.isFinite, result.2.isFinite else {
            return nil
        }
        return result
    }

    private static func contains(_ point: Point, in polygon: Polygon) -> Bool {
        guard polygon.vertices.count >= 3 else { return false }
        var isInside = false
        var previous = polygon.vertices.count - 1
        for current in polygon.vertices.indices {
            let a = polygon.vertices[current]
            let b = polygon.vertices[previous]
            let crosses = (a.z > point.z) != (b.z > point.z)
            if crosses {
                let denominator = b.z - a.z
                if abs(denominator) > 0.000_001 {
                    let edgeX = (b.x - a.x) * (point.z - a.z) / denominator + a.x
                    if point.x < edgeX { isInside.toggle() }
                }
            }
            previous = current
        }
        return isInside
    }

    private static func distanceToEdges(_ point: Point, polygon: Polygon) -> Double {
        guard polygon.vertices.count >= 2 else { return .greatestFiniteMagnitude }
        var minimum = Double.greatestFiniteMagnitude
        for index in polygon.vertices.indices {
            let a = polygon.vertices[index]
            let b = polygon.vertices[(index + 1) % polygon.vertices.count]
            let dx = b.x - a.x
            let dz = b.z - a.z
            let lengthSquared = dx * dx + dz * dz
            let projection: Double
            if lengthSquared <= 0.000_001 {
                projection = 0
            } else {
                projection = max(
                    0,
                    min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared)
                )
            }
            let nearestX = a.x + projection * dx
            let nearestZ = a.z + projection * dz
            minimum = min(minimum, hypot(point.x - nearestX, point.z - nearestZ))
        }
        return minimum
    }
}

/// Stabilizes room changes near doors. The current room gets an expanded
/// boundary and a new room must win several consecutive AR frames.
struct SpatialRoomContainmentTracker: Equatable, Sendable {
    let candidates: [SpatialRoomDetectionCandidate]
    let confirmationFrames: Int
    let exitFrames: Int
    let currentRoomMargin: Double
    let entryMargin: Double

    private(set) var currentScanID: UUID?
    private var proposedScanID: UUID?
    private var proposalFrames = 0
    private var outsideFrames = 0

    init(
        candidates: [SpatialRoomDetectionCandidate],
        confirmationFrames: Int = 8,
        exitFrames: Int = 12,
        currentRoomMargin: Double = 0.45,
        entryMargin: Double = 0.12
    ) {
        self.candidates = candidates
        self.confirmationFrames = max(1, confirmationFrames)
        self.exitFrames = max(1, exitFrames)
        self.currentRoomMargin = max(0, currentRoomMargin)
        self.entryMargin = max(0, entryMargin)
    }

    @discardableResult
    mutating func update(position: SpatialVector3) -> UUID? {
        if let currentScanID,
           let current = candidates.first(where: { $0.scan.id == currentScanID }),
           current.footprint.contains(position: position, margin: currentRoomMargin) {
            outsideFrames = 0
            proposedScanID = nil
            proposalFrames = 0
            return currentScanID
        }

        let candidate = candidates
            .filter { $0.footprint.contains(position: position, margin: entryMargin) }
            .min {
                $0.footprint.squaredDistanceToCenter(position: position) <
                    $1.footprint.squaredDistanceToCenter(position: position)
            }

        guard let candidate else {
            proposedScanID = nil
            proposalFrames = 0
            outsideFrames += 1
            if outsideFrames >= exitFrames { currentScanID = nil }
            return currentScanID
        }

        outsideFrames = 0
        if proposedScanID == candidate.scan.id {
            proposalFrames += 1
        } else {
            proposedScanID = candidate.scan.id
            proposalFrames = 1
        }
        if proposalFrames >= confirmationFrames {
            currentScanID = candidate.scan.id
            proposedScanID = nil
            proposalFrames = 0
        }
        return currentScanID
    }

    mutating func selectManually(scanID: UUID?) {
        currentScanID = candidates.contains { $0.scan.id == scanID } ? scanID : nil
        proposedScanID = nil
        proposalFrames = 0
        outsideFrames = 0
    }
}

private extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
