import Foundation

public struct ResourceCreateRequest: Codable, Equatable, Sendable {
    public var name: String
    public var description: String
    public var type: InventoryResourceType
    public var status: InventoryResourceStatus
    public var sku: String?
    public var quantity: Int
    public var location: String?
    public var serialNumber: String?
    public var valueCents: Int?
    public var currency: String
    public var priority: Int
    public var tags: [String]
    public var categories: [InventoryResourceCategory]
    public var relatedResourceIDs: [UUID]
    public var gpsLatitude: Double?
    public var gpsLongitude: Double?
    public var gpsAltitude: Double?
    public var notes: String

    public init(
        name: String,
        description: String = "",
        type: InventoryResourceType = .object,
        status: InventoryResourceStatus = .available,
        sku: String? = nil,
        quantity: Int = 1,
        location: String? = nil,
        serialNumber: String? = nil,
        valueCents: Int? = nil,
        currency: String = "EUR",
        priority: Int = 3,
        tags: [String] = [],
        categories: [InventoryResourceCategory] = [],
        relatedResourceIDs: [UUID] = [],
        gpsLatitude: Double? = nil,
        gpsLongitude: Double? = nil,
        gpsAltitude: Double? = nil,
        notes: String = ""
    ) {
        self.name = name
        self.description = description
        self.type = type
        self.status = status
        self.sku = sku
        self.quantity = quantity
        self.location = location
        self.serialNumber = serialNumber
        self.valueCents = valueCents
        self.currency = currency
        self.priority = priority
        self.tags = tags
        self.categories = categories
        self.relatedResourceIDs = relatedResourceIDs
        self.gpsLatitude = gpsLatitude
        self.gpsLongitude = gpsLongitude
        self.gpsAltitude = gpsAltitude
        self.notes = notes
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case description
        case type
        case status
        case sku
        case quantity
        case location
        case serialNumber
        case valueCents
        case currency
        case priority
        case tags
        case categories
        case relatedResourceIDs = "relatedResourceIds"
        case gpsLatitude
        case gpsLongitude
        case gpsAltitude
        case notes
    }
}

/// A nullable PATCH field distinguishes "leave unchanged" from an explicit JSON null.
public enum NullablePatch<Value: Codable & Sendable>: Codable, Sendable {
    case unchanged
    case value(Value)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else {
            self = .value(try container.decode(Value.self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .unchanged, .null:
            try container.encodeNil()
        case .value(let value):
            try container.encode(value)
        }
    }
}

public struct ResourcePatchRequest: Codable, Sendable {
    public var name: String?
    public var description: String?
    public var type: InventoryResourceType?
    public var status: InventoryResourceStatus?
    public var sku: NullablePatch<String>
    public var location: NullablePatch<String>
    public var serialNumber: NullablePatch<String>
    public var valueCents: NullablePatch<Int>
    public var currency: String?
    public var priority: Int?
    public var tags: [String]?
    public var categories: [InventoryResourceCategory]?
    public var relatedResourceIDs: [UUID]?
    public var gpsLatitude: NullablePatch<Double>
    public var gpsLongitude: NullablePatch<Double>
    public var gpsAltitude: NullablePatch<Double>
    public var notes: String?

    public init(
        name: String? = nil,
        description: String? = nil,
        type: InventoryResourceType? = nil,
        status: InventoryResourceStatus? = nil,
        sku: NullablePatch<String> = .unchanged,
        location: NullablePatch<String> = .unchanged,
        serialNumber: NullablePatch<String> = .unchanged,
        valueCents: NullablePatch<Int> = .unchanged,
        currency: String? = nil,
        priority: Int? = nil,
        tags: [String]? = nil,
        categories: [InventoryResourceCategory]? = nil,
        relatedResourceIDs: [UUID]? = nil,
        gpsLatitude: NullablePatch<Double> = .unchanged,
        gpsLongitude: NullablePatch<Double> = .unchanged,
        gpsAltitude: NullablePatch<Double> = .unchanged,
        notes: String? = nil
    ) {
        self.name = name
        self.description = description
        self.type = type
        self.status = status
        self.sku = sku
        self.location = location
        self.serialNumber = serialNumber
        self.valueCents = valueCents
        self.currency = currency
        self.priority = priority
        self.tags = tags
        self.categories = categories
        self.relatedResourceIDs = relatedResourceIDs
        self.gpsLatitude = gpsLatitude
        self.gpsLongitude = gpsLongitude
        self.gpsAltitude = gpsAltitude
        self.notes = notes
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case description
        case type
        case status
        case sku
        case location
        case serialNumber
        case valueCents
        case currency
        case priority
        case tags
        case categories
        case relatedResourceIDs = "relatedResourceIds"
        case gpsLatitude
        case gpsLongitude
        case gpsAltitude
        case notes
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        type = try container.decodeIfPresent(InventoryResourceType.self, forKey: .type)
        status = try container.decodeIfPresent(InventoryResourceStatus.self, forKey: .status)
        sku = try container.decodePatch(String.self, forKey: .sku)
        location = try container.decodePatch(String.self, forKey: .location)
        serialNumber = try container.decodePatch(String.self, forKey: .serialNumber)
        valueCents = try container.decodePatch(Int.self, forKey: .valueCents)
        currency = try container.decodeIfPresent(String.self, forKey: .currency)
        priority = try container.decodeIfPresent(Int.self, forKey: .priority)
        tags = try container.decodeIfPresent([String].self, forKey: .tags)
        categories = try container.decodeIfPresent(
            [InventoryResourceCategory].self,
            forKey: .categories
        )
        relatedResourceIDs = try container.decodeIfPresent([UUID].self, forKey: .relatedResourceIDs)
        gpsLatitude = try container.decodePatch(Double.self, forKey: .gpsLatitude)
        gpsLongitude = try container.decodePatch(Double.self, forKey: .gpsLongitude)
        gpsAltitude = try container.decodePatch(Double.self, forKey: .gpsAltitude)
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(type, forKey: .type)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodePatch(sku, forKey: .sku)
        try container.encodePatch(location, forKey: .location)
        try container.encodePatch(serialNumber, forKey: .serialNumber)
        try container.encodePatch(valueCents, forKey: .valueCents)
        try container.encodeIfPresent(currency, forKey: .currency)
        try container.encodeIfPresent(priority, forKey: .priority)
        try container.encodeIfPresent(tags, forKey: .tags)
        try container.encodeIfPresent(categories, forKey: .categories)
        try container.encodeIfPresent(relatedResourceIDs, forKey: .relatedResourceIDs)
        try container.encodePatch(gpsLatitude, forKey: .gpsLatitude)
        try container.encodePatch(gpsLongitude, forKey: .gpsLongitude)
        try container.encodePatch(gpsAltitude, forKey: .gpsAltitude)
        try container.encodeIfPresent(notes, forKey: .notes)
    }
}

private extension KeyedDecodingContainer {
    func decodePatch<Value: Codable & Sendable>(
        _ type: Value.Type,
        forKey key: Key
    ) throws -> NullablePatch<Value> {
        guard contains(key) else { return .unchanged }
        if try decodeNil(forKey: key) { return .null }
        return .value(try decode(type, forKey: key))
    }
}

private extension KeyedEncodingContainer {
    mutating func encodePatch<Value: Codable & Sendable>(
        _ patch: NullablePatch<Value>,
        forKey key: Key
    ) throws {
        switch patch {
        case .unchanged:
            return
        case .null:
            try encodeNil(forKey: key)
        case .value(let value):
            try encode(value, forKey: key)
        }
    }
}
