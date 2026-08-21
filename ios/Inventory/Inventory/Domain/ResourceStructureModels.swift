import Foundation

public enum ResourceFamilyRole: String, Codable, Sendable {
    case primary
    case variant
}

public struct ResourceFamilyMember: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let type: InventoryResourceType
    public let status: InventoryResourceStatus
    public let sku: String?
    public let barcode: String?
    public let quantity: Int
    public let trackingMode: StockTrackingMode
    public let updatedAt: Date
    public let overriddenFields: [String]
}

public struct ResourceFamilySummary: Codable, Equatable, Sendable {
    public let totalQuantity: Int
    public let primaryQuantity: Int
    public let variantQuantity: Int
    public let variantCount: Int
    public let serializedVariantCount: Int
}

public struct ResourceFamilyResponse: Codable, Equatable, Sendable {
    public let role: ResourceFamilyRole
    public let currentResourceId: UUID
    public let primary: ResourceFamilyMember
    public let variants: [ResourceFamilyMember]
    public let legacyVariantCount: Int
    public let optionGroupCount: Int
    public let summary: ResourceFamilySummary
}

public struct ResourceFamilyVariantRequest: Codable, Equatable, Sendable {
    public let name: String
    public let sku: String?
    public let barcode: String?
}

public struct ResourceFamilyAttachRequest: Codable, Equatable, Sendable {
    public let existingResourceId: UUID
}

public struct ResourceFamilyVariantResponse: Codable, Equatable, Sendable {
    public let variant: ResourceFamilyMember
}

public struct DetachedResourceFamilyResponse: Codable, Equatable, Sendable {
    public let detached: DetachedResourceFamily
}

public struct DetachedResourceFamily: Codable, Equatable, Sendable {
    public let resourceId: UUID
    public let materializedBomLineCount: Int
}

public struct RelationTypeDefinition: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public let label: String
    public let inverseLabel: String
    public let description: String
    public let allowManual: Bool
    public let spatial: Bool
    public let position: Int
    public let isSystem: Bool
    public let archivedAt: Date?

    public var id: String { key }
}

public struct RelationTypesResponse: Codable, Equatable, Sendable {
    public let relationTypes: [RelationTypeDefinition]
}

public struct RelationResourceSummary: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let type: InventoryResourceType
    public let status: InventoryResourceStatus
}

public struct ResourceRelation: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let sourceResourceId: UUID
    public let targetResourceId: UUID
    public let relationTypeKey: String
    public let origin: String
    public let createdAt: Date
    public let source: RelationResourceSummary?
    public let target: RelationResourceSummary?
    public let relationType: RelationTypeDefinition?
}

public struct ResourceRelationsResponse: Codable, Equatable, Sendable {
    public let relations: [ResourceRelation]
}

public struct ResourceRelationCreateRequest: Codable, Equatable, Sendable {
    public let sourceResourceId: UUID
    public let targetResourceId: UUID
    public let relationTypeKey: String
}

public struct ResourceRelationResponse: Codable, Equatable, Sendable {
    public let relation: ResourceRelation
}

public struct BillOfMaterialsResource: Codable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let quantity: Int
    public let trackingMode: StockTrackingMode
}

public struct BillOfMaterialsComponent: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let slotKey: String
    public let origin: String?
    public let resourceId: UUID
    public let name: String
    public let sku: String?
    public let quantityPerAssembly: Int
    public let position: Int
    public let note: String
    public let availableQuantity: Int
    public let trackingMode: StockTrackingMode
}

public struct BillOfMaterialsInheritance: Codable, Equatable, Sendable {
    public let primaryResourceId: UUID
    public let primaryName: String
    public let overrideCount: Int
}

public struct BillOfMaterialsResponse: Codable, Equatable, Sendable {
    public let resource: BillOfMaterialsResource
    public let components: [BillOfMaterialsComponent]
    public let buildableQuantity: Int
    public let inheritance: BillOfMaterialsInheritance?
}

public struct BillOfMaterialsComponentRequest: Codable, Equatable, Sendable {
    public let resourceId: UUID
    public let slotKey: String
    public let quantityPerAssembly: Int
    public let position: Int
    public let note: String?
}

public struct BillOfMaterialsReplaceRequest: Codable, Equatable, Sendable {
    public let components: [BillOfMaterialsComponentRequest]
}
