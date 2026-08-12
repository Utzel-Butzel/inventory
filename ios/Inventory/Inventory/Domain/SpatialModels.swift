import Foundation

public typealias SpatialVector3 = [Double]
public typealias SpatialQuaternion = [Double]
public typealias SpatialMatrix4 = [Double]

public struct SpatialRoomSurface: Codable, Equatable, Sendable {
    public let id: UUID
    public let category: String
    public let dimensions: SpatialVector3
    public let transform: SpatialMatrix4
    public let confidence: String
}

public struct SpatialRoomObject: Codable, Equatable, Sendable {
    public let id: UUID
    public let category: String
    public let dimensions: SpatialVector3
    public let transform: SpatialMatrix4
    public let confidence: String
}

public struct SpatialRoomBounds: Codable, Equatable, Sendable {
    public let min: SpatialVector3
    public let max: SpatialVector3
}

public struct SpatialRoomScene: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let coordinateSystem: String
    public let units: String
    public let matrixOrder: String
    public let worldFromModel: SpatialMatrix4
    public let webFromWorld: SpatialMatrix4
    public let bounds: SpatialRoomBounds
    public let surfaces: [SpatialRoomSurface]
    public let objects: [SpatialRoomObject]

    public init(
        bounds: SpatialRoomBounds,
        surfaces: [SpatialRoomSurface],
        objects: [SpatialRoomObject]
    ) {
        schemaVersion = 1
        coordinateSystem = "arkit-right-handed-y-up"
        units = "meter"
        matrixOrder = "column-major"
        worldFromModel = Self.identityMatrix
        webFromWorld = Self.identityMatrix
        self.bounds = bounds
        self.surfaces = surfaces
        self.objects = objects
    }

    public static let identityMatrix: SpatialMatrix4 = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]
}

public struct SpatialRoomScanAsset: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let kind: String
    public let name: String
    public let mimeType: String
    public let size: Int
    public let checksumSha256: String
    public let url: String
    public let createdAt: Date
}

public struct SpatialRoomScanSummary: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let roomResourceID: UUID
    public let roomName: String
    public let revision: Int
    public let status: String
    public let capturedAt: Date
    public let deviceModel: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let placementCount: Int
    public let assets: [SpatialRoomScanAsset]

    public var worldMapAsset: SpatialRoomScanAsset? {
        assets.first { $0.kind == "world_map" }
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case roomResourceID = "roomResourceId"
        case roomName
        case revision
        case status
        case capturedAt
        case deviceModel
        case createdAt
        case updatedAt
        case placementCount
        case assets
    }
}

public struct SpatialRoomScanListResponse: Codable, Equatable, Sendable {
    public let scans: [SpatialRoomScanSummary]
}

public struct SpatialRoomScanDraft: Sendable {
    public let id: UUID
    public let scene: SpatialRoomScene
    public let capturedAt: Date
    public let deviceModel: String
    public let worldMapURL: URL
    public let modelURL: URL
    public let guideImageURL: URL?

    public func removeLocalArtifacts() {
        let directory = worldMapURL.deletingLastPathComponent().standardizedFileURL
        let expectedName = "inventory-room-scan-\(id.uuidString)"
        guard directory.lastPathComponent == expectedName,
              modelURL.deletingLastPathComponent().standardizedFileURL == directory,
              (
                  guideImageURL == nil ||
                  guideImageURL?.deletingLastPathComponent().standardizedFileURL == directory
              )
        else {
            return
        }
        try? FileManager.default.removeItem(at: directory)
    }
}

public struct SpatialRoomScanUploadResponse: Codable, Equatable, Sendable {
    public let replayed: Bool
}

public struct SpatialPlacementDraft: Codable, Equatable, Sendable {
    public let roomScanID: UUID
    public let roomName: String
    public let position: SpatialVector3
    public let orientation: SpatialQuaternion
    public let extent: SpatialVector3?
    public let confidence: Double
    public let method: String
    public let anchorIdentifier: UUID
    public let capturedAt: Date

    public init(
        roomScanID: UUID,
        roomName: String,
        position: SpatialVector3,
        orientation: SpatialQuaternion,
        extent: SpatialVector3? = nil,
        confidence: Double,
        method: String,
        anchorIdentifier: UUID = UUID(),
        capturedAt: Date = Date()
    ) {
        self.roomScanID = roomScanID
        self.roomName = roomName
        self.position = position
        self.orientation = orientation
        self.extent = extent
        self.confidence = confidence
        self.method = method
        self.anchorIdentifier = anchorIdentifier
        self.capturedAt = capturedAt
    }

    private enum CodingKeys: String, CodingKey {
        case roomScanID = "roomScanId"
        case roomName
        case position
        case orientation
        case extent
        case confidence
        case method
        case anchorIdentifier
        case capturedAt
    }
}

public struct SpatialPlacementRequest: Codable, Equatable, Sendable {
    public let position: SpatialVector3
    public let orientation: SpatialQuaternion
    public let extent: SpatialVector3?
    public let confidence: Double
    public let method: String
    public let anchorIdentifier: UUID
    public let capturedAt: Date

    public init(draft: SpatialPlacementDraft) {
        position = draft.position
        orientation = draft.orientation
        extent = draft.extent
        confidence = draft.confidence
        method = draft.method
        anchorIdentifier = draft.anchorIdentifier
        capturedAt = draft.capturedAt
    }
}

public struct SpatialPlacementResponse: Codable, Equatable, Sendable {
    public struct Placement: Codable, Equatable, Sendable {
        public let id: UUID
    }

    public let placement: Placement
}
