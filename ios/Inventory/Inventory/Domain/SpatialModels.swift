import Foundation

public typealias SpatialVector3 = [Double]
public typealias SpatialQuaternion = [Double]
public typealias SpatialMatrix4 = [Double]

/// Connects one ARKit coordinate space to a geographic map location. The
/// heading is the clockwise true-north bearing of the local ARKit `-Z` axis.
public struct SpatialStructureGeoreference: Codable, Equatable, Sendable {
    public enum Source: String, Codable, Equatable, Sendable {
        case gps
        case manual
        case qrMarker = "qr-marker"
        case appClip = "app-clip"
        case other
    }

    public struct ReferencePoint: Codable, Equatable, Sendable {
        public let id: String
        public let label: String?
        public let localPosition: SpatialVector3
        public let latitude: Double
        public let longitude: Double
        public let altitude: Double?
    }

    public let latitude: Double
    public let longitude: Double
    public let altitude: Double?
    public let headingDegrees: Double
    public let horizontalAccuracy: Double?
    public let verticalAccuracy: Double?
    public let capturedAt: Date
    public let source: Source
    public let localReferencePosition: SpatialVector3?
    public let referencePoints: [ReferencePoint]?
    public let entryMarkerCode: String?
}

/// A GPS/compass observation that can be tied to an AR frame once the shared
/// RoomPlan session has started.
public struct SpatialGeoreferenceObservation: Equatable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let altitude: Double?
    public let horizontalAccuracy: Double?
    public let verticalAccuracy: Double?
    public let trueHeading: Double
    public let headingAccuracy: Double?
    public let capturedAt: Date
    public let entryMarkerCode: String?
}

public struct SpatialRoomSurface: Codable, Equatable, Sendable {
    public let id: UUID
    public let category: String
    public let dimensions: SpatialVector3
    public let transform: SpatialMatrix4
    public let polygonCorners: [SpatialVector3]?
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
        worldFromModel: SpatialMatrix4 = Self.identityMatrix,
        webFromWorld: SpatialMatrix4 = Self.identityMatrix,
        bounds: SpatialRoomBounds,
        surfaces: [SpatialRoomSurface],
        objects: [SpatialRoomObject]
    ) {
        schemaVersion = 1
        coordinateSystem = "arkit-right-handed-y-up"
        units = "meter"
        matrixOrder = "column-major"
        self.worldFromModel = worldFromModel
        self.webFromWorld = webFromWorld
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
    public let structureID: UUID?
    public let structureName: String?
    public let floorIdentifier: String?
    public let floorIndex: Int?
    public let roomIdentifier: String?
    public let coordinateSpaceID: UUID?
    public let georeference: SpatialStructureGeoreference?

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
        case structureID = "structureId"
        case structureName
        case floorIdentifier
        case floorIndex
        case roomIdentifier
        case coordinateSpaceID = "coordinateSpaceId"
        case georeference
    }
}

public struct SpatialRoomScanListResponse: Codable, Equatable, Sendable {
    public let scans: [SpatialRoomScanSummary]
}

public struct SpatialRoomSceneResponse: Codable, Equatable, Sendable {
    public let scene: SpatialRoomSceneManifest
}

public struct SpatialRoomSceneManifest: Codable, Equatable, Sendable {
    public struct Room: Codable, Equatable, Sendable {
        public let id: UUID
        public let name: String
        public let description: String
    }

    public struct Scan: Codable, Equatable, Sendable {
        public let id: UUID
        public let revision: Int
        public let status: String
        public let scene: SpatialRoomScene
        public let capturedAt: Date
        public let deviceModel: String?
        public let assets: [SpatialRoomScanAsset]
        public let structureID: UUID?
        public let structureName: String?
        public let floorIdentifier: String?
        public let floorIndex: Int?
        public let roomIdentifier: String?
        public let coordinateSpaceID: UUID?
        public let georeference: SpatialStructureGeoreference?

        private enum CodingKeys: String, CodingKey {
            case id, revision, status, scene, capturedAt, deviceModel, assets
            case structureID = "structureId"
            case structureName, floorIdentifier, floorIndex, roomIdentifier
            case coordinateSpaceID = "coordinateSpaceId"
            case georeference
        }
    }

    public let room: Room
    public let scan: Scan
    public let placements: [SpatialRoomPlacement]
}

public struct SpatialRoomPlacement: Codable, Equatable, Identifiable, Sendable {
    public struct Resource: Codable, Equatable, Sendable {
        public struct Cover: Codable, Equatable, Sendable {
            public let id: UUID
            public let url: String
            public let altText: String
        }

        public let id: UUID
        public let name: String
        public let description: String
        public let type: String
        public let status: String
        public let location: String?
        public let cover: Cover?
    }

    public let id: UUID
    public let resource: Resource
    public let position: SpatialVector3
    public let orientation: SpatialQuaternion
    public let extent: SpatialVector3?
    public let confidence: Double
    public let method: String
    public let anchorIdentifier: UUID?
    public let capturedAt: Date
    public let updatedAt: Date
}

public struct SpatialRoomScanDraft: Sendable {
    public let id: UUID
    public let roomName: String
    public let scene: SpatialRoomScene
    public let capturedAt: Date
    public let deviceModel: String
    public let worldMapURL: URL
    public let modelURL: URL
    public let guideImageURL: URL?
    public let structureID: UUID?
    public let structureName: String?
    public let floorIdentifier: String?
    public let floorIndex: Int?
    public let roomIdentifier: String?
    public let coordinateSpaceID: UUID?
    public let georeference: SpatialStructureGeoreference?
    public let structureModelURL: URL?

    public init(
        id: UUID,
        roomName: String,
        scene: SpatialRoomScene,
        capturedAt: Date,
        deviceModel: String,
        worldMapURL: URL,
        modelURL: URL,
        guideImageURL: URL?,
        structureID: UUID? = nil,
        structureName: String? = nil,
        floorIdentifier: String? = nil,
        floorIndex: Int? = nil,
        roomIdentifier: String? = nil,
        coordinateSpaceID: UUID? = nil,
        georeference: SpatialStructureGeoreference? = nil,
        structureModelURL: URL? = nil
    ) {
        self.id = id
        self.roomName = roomName
        self.scene = scene
        self.capturedAt = capturedAt
        self.deviceModel = deviceModel
        self.worldMapURL = worldMapURL
        self.modelURL = modelURL
        self.guideImageURL = guideImageURL
        self.structureID = structureID
        self.structureName = structureName
        self.floorIdentifier = floorIdentifier
        self.floorIndex = floorIndex
        self.roomIdentifier = roomIdentifier
        self.coordinateSpaceID = coordinateSpaceID
        self.georeference = georeference
        self.structureModelURL = structureModelURL
    }

    public func removeLocalArtifacts() {
        let directory = worldMapURL.deletingLastPathComponent().standardizedFileURL
        let expectedName = "inventory-room-scan-\(id.uuidString)"
        guard directory.lastPathComponent == expectedName,
              modelURL.deletingLastPathComponent().standardizedFileURL == directory,
              (
                  guideImageURL == nil ||
                  guideImageURL?.deletingLastPathComponent().standardizedFileURL == directory
              ),
              (
                  structureModelURL == nil ||
                  structureModelURL?.deletingLastPathComponent().standardizedFileURL == directory
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
