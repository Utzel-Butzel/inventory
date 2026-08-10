import Foundation

public struct CapabilitiesResponse: Codable, Equatable, Sendable {
    public let name: String
    public let scopes: [String]
}

public struct LoginUser: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let email: String
    public let role: String
}

public struct LoginResponse: Codable, Equatable, Sendable {
    public let token: String
    public let user: LoginUser
    public let scopes: [String]
    public let expiresAt: Date
}

public struct ResourcePagination: Codable, Equatable, Sendable {
    public let page: Int
    public let pageSize: Int
    public let total: Int
    public let pages: Int

    public init(page: Int, pageSize: Int, total: Int, pages: Int) {
        self.page = page
        self.pageSize = pageSize
        self.total = total
        self.pages = pages
    }
}

public struct ResourceListResponse: Codable, Equatable, Sendable {
    public let resources: [InventoryResource]
    public let pagination: ResourcePagination

    public init(resources: [InventoryResource], pagination: ResourcePagination) {
        self.resources = resources
        self.pagination = pagination
    }
}

public struct ResourceResponse: Codable, Equatable, Sendable {
    public let resource: InventoryResource

    public init(resource: InventoryResource) {
        self.resource = resource
    }
}

public enum ResourceCodeMatch: String, Codable, CaseIterable, Sendable {
    case id
    case sku
    case serialNumber
}

public struct ResourceLookupResponse: Codable, Equatable, Sendable {
    public let resource: InventoryResource
    public let matchedBy: ResourceCodeMatch

    public init(resource: InventoryResource, matchedBy: ResourceCodeMatch) {
        self.resource = resource
        self.matchedBy = matchedBy
    }
}

public struct MediaUploadFile: Equatable, Sendable {
    public let fileURL: URL
    public let filename: String
    public let mimeType: String

    public init(fileURL: URL, filename: String? = nil, mimeType: String = "image/jpeg") {
        self.fileURL = fileURL
        self.filename = filename ?? fileURL.lastPathComponent
        self.mimeType = mimeType
    }
}

public struct MediaUploadResponse: Codable, Equatable, Sendable {
    public let media: [InventoryMedia]
    public let uploaded: [InventoryMedia]

    public init(media: [InventoryMedia], uploaded: [InventoryMedia]) {
        self.media = media
        self.uploaded = uploaded
    }
}

public struct InventoryAnalysis: Codable, Equatable, Sendable {
    public let title: String
    public let description: String
    public let tags: [String]
    public let type: InventoryResourceType
    public let altText: String
    public let confidence: Double

    public init(
        title: String,
        description: String,
        tags: [String],
        type: InventoryResourceType,
        altText: String,
        confidence: Double
    ) {
        self.title = title
        self.description = description
        self.tags = tags
        self.type = type
        self.altText = altText
        self.confidence = confidence
    }
}

public struct AnalyzeResourceResponse: Codable, Equatable, Sendable {
    public let resource: InventoryResource
    public let analysis: InventoryAnalysis
    public let model: String

    public init(resource: InventoryResource, analysis: InventoryAnalysis, model: String) {
        self.resource = resource
        self.analysis = analysis
        self.model = model
    }
}

public struct ObjectCountResponse: Codable, Equatable, Sendable {
    public let count: Int
    public let confidence: Double
    public let detectedItem: String
    public let isExact: Bool
    public let explanation: String
    public let warnings: [String]
    public let model: String

    public init(
        count: Int,
        confidence: Double,
        detectedItem: String,
        isExact: Bool,
        explanation: String,
        warnings: [String],
        model: String
    ) {
        self.count = count
        self.confidence = confidence
        self.detectedItem = detectedItem
        self.isExact = isExact
        self.explanation = explanation
        self.warnings = warnings
        self.model = model
    }
}

public struct CoverGeneration: Codable, Equatable, Sendable {
    public let provider: String
    public let model: String

    public init(provider: String, model: String) {
        self.provider = provider
        self.model = model
    }
}

public struct CoverResourceResponse: Codable, Equatable, Sendable {
    public let resource: InventoryResource
    public let generation: CoverGeneration

    public init(resource: InventoryResource, generation: CoverGeneration) {
        self.resource = resource
        self.generation = generation
    }
}

public struct StockResourceSnapshot: Codable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let quantity: Int
}

public struct StockMovement: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let delta: Int
    public let balanceAfter: Int
    public let type: String
    public let reason: String?
    public let note: String
    public let location: String?
    public let occurredAt: Date
    public let createdAt: Date
    public let createdBy: String?
    public let unitID: UUID?

    private enum CodingKeys: String, CodingKey {
        case id, delta, balanceAfter, type, reason, note, location, occurredAt, createdAt, createdBy
        case unitID = "unitId"
    }
}

public struct StockMovementResponse: Codable, Equatable, Sendable {
    public let resource: StockResourceSnapshot
    public let movement: StockMovement
}
