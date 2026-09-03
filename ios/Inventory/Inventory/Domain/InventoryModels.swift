import Foundation

public enum InventoryResourceType: RawRepresentable, Codable, CaseIterable, Hashable, Sendable {
    case place
    case person
    case vehicle
    case tool
    case project
    case clothing
    case furniture
    case object
    case other
    case custom(String)

    public typealias RawValue = String

    /// Types bundled with the app. Server-defined types are represented by
    /// ``custom(_:)`` and deliberately do not become static picker options.
    public static let allCases: [InventoryResourceType] = [
        .place,
        .person,
        .vehicle,
        .tool,
        .project,
        .clothing,
        .furniture,
        .object,
        .other,
    ]

    public init?(rawValue: String) {
        self.init(preserving: rawValue)
    }

    public var rawValue: String {
        switch self {
        case .place: "place"
        case .person: "person"
        case .vehicle: "vehicle"
        case .tool: "tool"
        case .project: "project"
        case .clothing: "clothing"
        case .furniture: "furniture"
        case .object: "object"
        case .other: "other"
        case .custom(let value): value
        }
    }

    public var isBuiltIn: Bool {
        if case .custom = self { return false }
        return true
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(preserving: try container.decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    private init(preserving rawValue: String) {
        switch rawValue {
        case "place": self = .place
        case "person": self = .person
        case "vehicle": self = .vehicle
        case "tool": self = .tool
        case "project": self = .project
        case "clothing": self = .clothing
        case "furniture": self = .furniture
        case "object": self = .object
        case "other": self = .other
        default: self = .custom(rawValue)
        }
    }
}

public enum InventoryResourceStatus: String, Codable, CaseIterable, Sendable {
    case available
    case inUse = "in-use"
    case maintenance
    case archived
}

public enum InventoryMediaKind: String, Codable, CaseIterable, Sendable {
    case image
    case video
    case document
    case model
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        self = Self(rawValue: rawValue) ?? .unknown
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum InventoryMediaSource: String, Codable, CaseIterable, Sendable {
    case upload
    case ai
}

public struct InventoryResourceCategory: Codable, Hashable, Sendable {
    public let name: String
    public let color: String?

    public init(name: String, color: String? = nil) {
        self.name = name
        self.color = color
    }
}

public enum CustomFieldValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case boolean(Bool)
    case strings([String])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode([String].self) {
            self = .strings(value)
        } else {
            throw DecodingError.typeMismatch(
                CustomFieldValue.self,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Unsupported custom-field value."
                )
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .boolean(let value): try container.encode(value)
        case .strings(let value): try container.encode(value)
        }
    }
}

public struct InventoryAIMetadata: Codable, Equatable, Sendable {
    public let analyzedAt: Date?
    public let model: String?
    public let confidence: Double?
    public let generatedFields: [String]?

    public init(
        analyzedAt: Date? = nil,
        model: String? = nil,
        confidence: Double? = nil,
        generatedFields: [String]? = nil
    ) {
        self.analyzedAt = analyzedAt
        self.model = model
        self.confidence = confidence
        self.generatedFields = generatedFields
    }
}

public struct InventoryMedia: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let resourceID: UUID
    public let storageKey: String?
    public let url: String
    public let name: String
    public let mimeType: String
    public let kind: InventoryMediaKind
    public let size: Int?
    public let width: Int?
    public let height: Int?
    public let position: Int
    public let altText: String
    public let source: InventoryMediaSource
    public let createdAt: Date?

    public init(
        id: UUID,
        resourceID: UUID,
        storageKey: String? = nil,
        url: String,
        name: String,
        mimeType: String,
        kind: InventoryMediaKind,
        size: Int? = nil,
        width: Int? = nil,
        height: Int? = nil,
        position: Int,
        altText: String = "",
        source: InventoryMediaSource,
        createdAt: Date? = nil
    ) {
        self.id = id
        self.resourceID = resourceID
        self.storageKey = storageKey
        self.url = url
        self.name = name
        self.mimeType = mimeType
        self.kind = kind
        self.size = size
        self.width = width
        self.height = height
        self.position = position
        self.altText = altText
        self.source = source
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case resourceID = "resourceId"
        case storageKey
        case url
        case name
        case mimeType
        case kind
        case size
        case width
        case height
        case position
        case altText
        case source
        case createdAt
    }
}

public struct InventoryResource: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let slugs: [String]?
    public let description: String
    public let type: InventoryResourceType
    public let status: InventoryResourceStatus
    public let sku: String?
    public let barcode: String?
    public let quantity: Int
    public let location: String?
    public let serialNumber: String?
    public let valueCents: Int?
    public let currency: String
    public let priority: Int
    public let tags: [String]
    public let categories: [InventoryResourceCategory]
    public let customFields: [String: CustomFieldValue]?
    public let relatedResourceIDs: [UUID]
    public let gpsLatitude: Double?
    public let gpsLongitude: Double?
    public let gpsAltitude: Double?
    public let notes: String
    public let aiMetadata: InventoryAIMetadata?
    public let createdBy: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let media: [InventoryMedia]
    public let cover: InventoryMedia?
    public var isFavorite: Bool?

    public init(
        id: UUID,
        name: String,
        slugs: [String] = [],
        description: String,
        type: InventoryResourceType,
        status: InventoryResourceStatus,
        sku: String? = nil,
        barcode: String? = nil,
        quantity: Int,
        location: String? = nil,
        serialNumber: String? = nil,
        valueCents: Int? = nil,
        currency: String,
        priority: Int,
        tags: [String] = [],
        categories: [InventoryResourceCategory] = [],
        customFields: [String: CustomFieldValue]? = nil,
        relatedResourceIDs: [UUID] = [],
        gpsLatitude: Double? = nil,
        gpsLongitude: Double? = nil,
        gpsAltitude: Double? = nil,
        notes: String = "",
        aiMetadata: InventoryAIMetadata? = nil,
        createdBy: String? = nil,
        createdAt: Date,
        updatedAt: Date,
        media: [InventoryMedia] = [],
        cover: InventoryMedia? = nil,
        isFavorite: Bool? = nil
    ) {
        self.id = id
        self.name = name
        self.slugs = slugs
        self.description = description
        self.type = type
        self.status = status
        self.sku = sku
        self.barcode = barcode
        self.quantity = quantity
        self.location = location
        self.serialNumber = serialNumber
        self.valueCents = valueCents
        self.currency = currency
        self.priority = priority
        self.tags = tags
        self.categories = categories
        self.customFields = customFields
        self.relatedResourceIDs = relatedResourceIDs
        self.gpsLatitude = gpsLatitude
        self.gpsLongitude = gpsLongitude
        self.gpsAltitude = gpsAltitude
        self.notes = notes
        self.aiMetadata = aiMetadata
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.media = media
        self.cover = cover
        self.isFavorite = isFavorite
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case slugs
        case description
        case type
        case status
        case sku
        case barcode
        case quantity
        case location
        case serialNumber
        case valueCents
        case currency
        case priority
        case tags
        case categories
        case customFields
        case relatedResourceIDs = "relatedResourceIds"
        case gpsLatitude
        case gpsLongitude
        case gpsAltitude
        case notes
        case aiMetadata
        case createdBy
        case createdAt
        case updatedAt
        case media
        case cover
        case isFavorite
    }
}
