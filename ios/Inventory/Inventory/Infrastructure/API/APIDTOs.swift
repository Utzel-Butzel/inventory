import Foundation

public struct CapabilitiesResponse: Codable, Equatable, Sendable {
    public let name: String
    public let principal: String?
    public let scopes: [String]
    public let permissions: [String]?
    public let organizations: [InventoryOrganization]?
    public let activeOrganization: InventoryOrganization?

    private enum CodingKeys: String, CodingKey {
        case name
        case principal
        case scopes
        case permissions
        case organizations
        case activeOrganization = "organization"
    }
}

public struct InventoryOrganization: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let slug: String
    public let role: String?
    public let roleName: String?
    public let isReadOnly: Bool?
    public let allowNegativeStock: Bool?
    public let canManage: Bool?
}

public struct OrganizationListResponse: Codable, Equatable, Sendable {
    public let organizations: [InventoryOrganization]
    public let activeOrganizationId: UUID?
}

public struct OrganizationSelectionResponse: Codable, Equatable, Sendable {
    public let organization: InventoryOrganization
}

public struct RuntimeSettingsResponse: Codable, Equatable, Sendable {
    public let storage: RuntimeStorageStatus
    public let ai: RuntimeAIStatus
    public let auth: RuntimeAuthenticationStatus
    public let user: RuntimeUserStatus
}

public struct RuntimeStorageStatus: Codable, Equatable, Sendable {
    public let provider: String
    public let configured: Bool
}

public struct RuntimeAIStatus: Codable, Equatable, Sendable {
    public let analysis: Bool
    public let imageGeneration: Bool
    public let imageProvider: String
}

public struct RuntimeAuthenticationStatus: Codable, Equatable, Sendable {
    public let password: Bool
    public let auth0: Bool
    public let providers: [RuntimeExternalAuthenticationProvider]?
}

public struct RuntimeExternalAuthenticationProvider: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
}

public struct RuntimeUserStatus: Codable, Equatable, Sendable {
    public let role: String?
}

public struct InventoryTypeDefinition: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public let label: String
    public let description: String
    public let color: String
    public let icon: String
    public let canContain: Bool
    public let spatialContainment: Bool
    public let position: Int
    public let isSystem: Bool
    public let archivedAt: Date?

    public var id: String { key }
}

public struct InventoryTypesResponse: Codable, Equatable, Sendable {
    public let types: [InventoryTypeDefinition]
}

public enum CustomFieldEntityType: String, Codable, CaseIterable, Sendable {
    case inventory
    case stockUnit = "stock_unit"
}

public enum CustomFieldValueType: String, Codable, CaseIterable, Sendable {
    case text
    case textarea
    case number
    case boolean
    case date
    case datetime
    case select
    case multiSelect = "multi_select"
    case reference
    case email
    case url
}

public struct CustomFieldOption: Codable, Equatable, Identifiable, Sendable {
    public let value: String
    public let label: String
    public let color: String?

    public var id: String { value }
}

public struct CustomFieldDefinition: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let entityType: CustomFieldEntityType
    public let key: String
    public let label: String
    public let fieldType: CustomFieldValueType
    public let description: String
    public let placeholder: String
    public let required: Bool
    public let minValue: Double?
    public let maxValue: Double?
    public let step: Double?
    public let resourceTypes: [String]
    public let categories: [String]
    public let options: [CustomFieldOption]
    public let referenceEntityType: CustomFieldEntityType?
    public let referenceMultiple: Bool?
    public let referenceResourceTypes: [String]?
    public let referenceCategories: [String]?
    public let referenceStatuses: [String]?
    public let position: Int
    public let revision: Int
    public let archivedAt: Date?
}

public struct CustomFieldReferenceOption: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let entityType: CustomFieldEntityType
    public let label: String
    public let description: String
    public let status: String
}

public struct CustomFieldReferenceOptionsResponse: Codable, Equatable, Sendable {
    public let options: [CustomFieldReferenceOption]
}

public struct CustomFieldDefinitionsResponse: Codable, Equatable, Sendable {
    public let definitions: [CustomFieldDefinition]
}

public struct ImageGenerationModelOption: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let provider: String
    public let model: String
    public let label: String
    public let estimatedCost: AICostRange?
    public let estimatedCostsBySize: [String: AICostRange]?

    public init(
        id: String,
        provider: String,
        model: String,
        label: String,
        estimatedCost: AICostRange? = nil,
        estimatedCostsBySize: [String: AICostRange]? = nil
    ) {
        self.id = id
        self.provider = provider
        self.model = model
        self.label = label
        self.estimatedCost = estimatedCost
        self.estimatedCostsBySize = estimatedCostsBySize
    }
}

public struct AICostRange: Codable, Equatable, Sendable {
    public let minimumUsd: Double
    public let maximumUsd: Double
    public let unit: String

    public func multiplied(by multiplier: Double, unit: String = "action") -> AICostRange {
        AICostRange(
            minimumUsd: minimumUsd * multiplier,
            maximumUsd: maximumUsd * multiplier,
            unit: unit
        )
    }

    public func adding(_ other: AICostRange, unit: String = "action") -> AICostRange {
        AICostRange(
            minimumUsd: minimumUsd + other.minimumUsd,
            maximumUsd: maximumUsd + other.maximumUsd,
            unit: unit
        )
    }

    public var formattedUSD: String {
        let fractionDigits = maximumUsd < 0.01 ? 4 : maximumUsd < 0.1 ? 3 : 2
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        let minimum = formatter.string(from: NSNumber(value: minimumUsd)) ?? "$\(minimumUsd)"
        let maximum = formatter.string(from: NSNumber(value: maximumUsd)) ?? "$\(maximumUsd)"
        return minimum == maximum ? minimum : "\(minimum)–\(maximum)"
    }
}

public struct AICostEstimate: Codable, Equatable, Sendable {
    public let provider: String
    public let model: String
    public let minimumUsd: Double
    public let maximumUsd: Double
    public let unit: String

    public var range: AICostRange {
        AICostRange(
            minimumUsd: minimumUsd,
            maximumUsd: maximumUsd,
            unit: unit
        )
    }
}

public struct AICostEstimateCatalog: Codable, Equatable, Sendable {
    public let currency: String
    public let pricingUpdatedAt: String
    public let operations: [String: AICostEstimate]
}

public struct ImageGenerationModelsResponse: Codable, Equatable, Sendable {
    public let models: [ImageGenerationModelOption]
    public let defaultModelId: String?
    public let costEstimates: AICostEstimateCatalog?

    public init(
        models: [ImageGenerationModelOption],
        defaultModelId: String?,
        costEstimates: AICostEstimateCatalog? = nil
    ) {
        self.models = models
        self.defaultModelId = defaultModelId
        self.costEstimates = costEstimates
    }
}

public struct ObjectCountModelOption: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let provider: String
    public let model: String
    public let label: String
    public let description: String

    public init(id: String, provider: String, model: String, label: String, description: String) {
        self.id = id
        self.provider = provider
        self.model = model
        self.label = label
        self.description = description
    }
}

public struct ObjectCountModelsResponse: Codable, Equatable, Sendable {
    public let models: [ObjectCountModelOption]
    public let defaultModelId: String
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
    public let organizations: [InventoryOrganization]?
    public let activeOrganization: InventoryOrganization?

    private enum CodingKeys: String, CodingKey {
        case token
        case user
        case scopes
        case expiresAt
        case organizations
        case activeOrganization = "organization"
    }
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
    public let access: InventoryResourceAccess?

    public init(resource: InventoryResource, access: InventoryResourceAccess? = nil) {
        self.resource = resource
        self.access = access
    }
}

public struct ResourceFavoriteResponse: Codable, Equatable, Sendable {
    public let favorite: Bool
}

public struct InventoryNotification: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let eventType: String
    public let resourceID: UUID?
    public let assignmentID: UUID?
    public let title: String
    public let body: String
    public let href: String?
    public let readAt: Date?
    public let createdAt: Date

    private enum CodingKeys: String, CodingKey {
        case id
        case eventType
        case resourceID = "resourceId"
        case assignmentID = "assignmentId"
        case title
        case body
        case href
        case readAt
        case createdAt
    }
}

public struct NotificationInboxResponse: Codable, Equatable, Sendable {
    public let notifications: [InventoryNotification]
    public let unread: Int
}

public struct NotificationUpdateResponse: Codable, Equatable, Sendable {
    public let notification: InventoryNotification
}

public struct NotificationReadAllResponse: Codable, Equatable, Sendable {
    public let updated: Int
}

public enum NotificationEventType: String, Codable, CaseIterable, Identifiable, Sendable {
    case lowStock = "low_stock"
    case expiry
    case maintenance
    case returnDue = "return_due"

    public var id: Self { self }
}

public enum NotificationFrequency: String, Codable, CaseIterable, Identifiable, Sendable {
    case daily
    case immediate

    public var id: Self { self }
}

public enum NotificationLocale: String, Codable, CaseIterable, Identifiable, Sendable {
    case german = "de"
    case english = "en"

    public var id: Self { self }
}

public enum NotificationChannel: String, Codable, CaseIterable, Identifiable, Sendable {
    case email
    case push
    case slack
    case teams
    case webhook

    public var id: Self { self }
}

public struct NotificationPreference: Codable, Equatable, Sendable {
    public let recipientKey: String
    public let recipientEmail: String?
    public let recipientName: String?
    public var enabledEventTypes: [NotificationEventType]
    public var frequency: NotificationFrequency
    public var digestHour: Int
    public var timezone: String
    public var locale: NotificationLocale
    public var cooldownHours: Int
    public var lowStockThresholdPercent: Int
    public var expiryWindowDays: Int
    public var expiryFieldKey: String
    public var maintenanceWindowDays: Int
    public var maintenanceFieldKey: String
    public var returnDueWindowDays: Int
    public var emailEnabled: Bool
    public var pushEnabled: Bool
    public var slackEnabled: Bool
    public var teamsEnabled: Bool
    public var webhookEnabled: Bool
    public let lastDigestAt: Date?
    public let createdAt: Date
    public let updatedAt: Date
}

public struct NotificationRuntimeChannel: Codable, Equatable, Sendable {
    public let configured: Bool
    public let target: String?
    public let publicKey: String?
}

public struct NotificationRuntimeConfiguration: Codable, Equatable, Sendable {
    public let email: NotificationRuntimeChannel
    public let push: NotificationRuntimeChannel
    public let slack: NotificationRuntimeChannel
    public let teams: NotificationRuntimeChannel
    public let webhook: NotificationRuntimeChannel
}

public struct NotificationSettingsResponse: Codable, Equatable, Sendable {
    public let preference: NotificationPreference
    public let runtime: NotificationRuntimeConfiguration
    public let pushSubscriptionCount: Int
}

public struct NotificationPreferenceUpdateRequest: Codable, Equatable, Sendable {
    public let enabledEventTypes: [NotificationEventType]
    public let frequency: NotificationFrequency
    public let digestHour: Int
    public let timezone: String
    public let locale: NotificationLocale
    public let cooldownHours: Int
    public let lowStockThresholdPercent: Int
    public let expiryWindowDays: Int
    public let expiryFieldKey: String
    public let maintenanceWindowDays: Int
    public let maintenanceFieldKey: String
    public let returnDueWindowDays: Int
    public let emailEnabled: Bool
    public let pushEnabled: Bool
    public let slackEnabled: Bool
    public let teamsEnabled: Bool
    public let webhookEnabled: Bool

    public init(preference: NotificationPreference) {
        enabledEventTypes = preference.enabledEventTypes
        frequency = preference.frequency
        digestHour = preference.digestHour
        timezone = preference.timezone.trimmingCharacters(in: .whitespacesAndNewlines)
        locale = preference.locale
        cooldownHours = preference.cooldownHours
        lowStockThresholdPercent = preference.lowStockThresholdPercent
        expiryWindowDays = preference.expiryWindowDays
        expiryFieldKey = preference.expiryFieldKey.trimmingCharacters(in: .whitespacesAndNewlines)
        maintenanceWindowDays = preference.maintenanceWindowDays
        maintenanceFieldKey = preference.maintenanceFieldKey
            .trimmingCharacters(in: .whitespacesAndNewlines)
        returnDueWindowDays = preference.returnDueWindowDays
        emailEnabled = preference.emailEnabled
        pushEnabled = preference.pushEnabled
        slackEnabled = preference.slackEnabled
        teamsEnabled = preference.teamsEnabled
        webhookEnabled = preference.webhookEnabled
    }
}

public struct NotificationPreferenceUpdateResponse: Codable, Equatable, Sendable {
    public let preference: NotificationPreference
}

public struct NotificationChannelPreviewRequest: Codable, Equatable, Sendable {
    public let channel: NotificationChannel
}

public struct NotificationPreviewEvent: Codable, Equatable, Sendable {
    public let eventType: NotificationEventType
    public let title: String
    public let body: String
}

public struct NotificationChannelPreview: Codable, Equatable, Sendable {
    public let dryRun: Bool
    public let channel: NotificationChannel
    public let target: String?
    public let subject: String
    public let events: [NotificationPreviewEvent]
}

public struct NotificationChannelPreviewResponse: Codable, Equatable, Sendable {
    public let configured: Bool
    public let preview: NotificationChannelPreview
}

public enum LoanAssignmentKind: String, Codable, CaseIterable, Sendable {
    case checkout
    case reservation
}

public enum LoanAssignmentStatus: String, Codable, CaseIterable, Sendable {
    case active
    case returned
    case cancelled
}

public enum LoanAssigneeType: String, Codable, CaseIterable, Sendable {
    case user
    case resource
    case label
}

public struct LoanAssignee: Codable, Equatable, Sendable {
    public let type: LoanAssigneeType
    public let id: UUID?
    public let label: String
    public let detail: String?
}

public struct LoanStockUnit: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let code: String
    public let status: String?
}

public struct LoanResourceSummary: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let sku: String?
    public let status: String
}

public struct LoanAssignment: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let resourceId: UUID
    public let stockUnitId: UUID?
    public let kind: LoanAssignmentKind
    public let status: LoanAssignmentStatus
    public let stockApplied: Bool
    public let overdue: Bool
    public let quantity: Int
    public let assignee: LoanAssignee
    public let stockUnit: LoanStockUnit?
    public let startsAt: Date
    public let dueAt: Date?
    public let completedAt: Date?
    public let note: String
    public let resource: LoanResourceSummary
    public let trackingMode: StockTrackingMode
}

public struct LoanCapabilities: Codable, Equatable, Sendable {
    public let canManage: Bool
}

public struct LoansResponse: Codable, Equatable, Sendable {
    public let assignments: [LoanAssignment]
    public let capabilities: LoanCapabilities
}

public enum AssignmentCompletionStatus: String, Codable, Sendable {
    case returned
    case cancelled
}

public struct AssignmentCompletionRequest: Codable, Equatable, Sendable {
    public let status: AssignmentCompletionStatus

    public init(status: AssignmentCompletionStatus) {
        self.status = status
    }
}

public enum ResourceAssignmentKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case checkout
    case assignment
    case reservation

    public var id: Self { self }
}

public struct ResourceAssignment: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let resourceId: UUID
    public let stockUnitId: UUID?
    public let kind: ResourceAssignmentKind
    public let status: LoanAssignmentStatus
    public let stockApplied: Bool
    public let overdue: Bool
    public let quantity: Int
    public let assignee: LoanAssignee
    public let stockUnit: LoanStockUnit?
    public let startsAt: Date
    public let dueAt: Date?
    public let completedAt: Date?
    public let note: String
}

public struct AssignmentResourceSnapshot: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let quantity: Int
}

public struct ResourceLendingSettings: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var approvalRequired: Bool
    public var defaultDurationDays: Int
    public var maxDurationDays: Int

    public init(
        enabled: Bool,
        approvalRequired: Bool,
        defaultDurationDays: Int,
        maxDurationDays: Int
    ) {
        self.enabled = enabled
        self.approvalRequired = approvalRequired
        self.defaultDurationDays = defaultDurationDays
        self.maxDurationDays = maxDurationDays
    }
}

public struct AssignmentAvailability: Codable, Equatable, Sendable {
    public let availableQuantity: Int
    public let activeQuantity: Int
    public let reservedQuantity: Int
}

public struct AssignmentRecipientUser: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let email: String
}

public struct AssignmentRecipients: Codable, Equatable, Sendable {
    public let users: [AssignmentRecipientUser]
}

public struct AssignmentAvailableUnit: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let code: String
    public let status: StockUnitStatus
    public let location: String?
}

public struct ResourceAssignmentsResponse: Codable, Equatable, Sendable {
    public let resource: AssignmentResourceSnapshot
    public let trackingMode: StockTrackingMode
    public let lending: ResourceLendingSettings
    public let availability: AssignmentAvailability
    public let recipients: AssignmentRecipients
    public let availableUnits: [AssignmentAvailableUnit]
    public let assignments: [ResourceAssignment]
}

public struct ResourceLendingSettingsResponse: Codable, Equatable, Sendable {
    public let lending: ResourceLendingSettings
}

public enum AssignmentRecipientRequest: Encodable, Equatable, Sendable {
    case user(UUID)
    case resource(UUID)
    case label(String)

    private enum CodingKeys: String, CodingKey {
        case type
        case userId
        case resourceId
        case label
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .user(let id):
            try container.encode("user", forKey: .type)
            try container.encode(id, forKey: .userId)
        case .resource(let id):
            try container.encode("resource", forKey: .type)
            try container.encode(id, forKey: .resourceId)
        case .label(let label):
            try container.encode("label", forKey: .type)
            try container.encode(
                label.trimmingCharacters(in: .whitespacesAndNewlines),
                forKey: .label
            )
        }
    }
}

public struct ResourceAssignmentCreateRequest: Encodable, Equatable, Sendable {
    public let kind: ResourceAssignmentKind
    public let quantity: Int
    public let stockUnitId: UUID?
    public let recipient: AssignmentRecipientRequest
    public let startsAt: Date?
    public let dueAt: Date?
    public let note: String?

    public init(
        kind: ResourceAssignmentKind,
        quantity: Int,
        stockUnitId: UUID? = nil,
        recipient: AssignmentRecipientRequest,
        startsAt: Date? = nil,
        dueAt: Date? = nil,
        note: String? = nil
    ) {
        self.kind = kind
        self.quantity = quantity
        self.stockUnitId = stockUnitId
        self.recipient = recipient
        self.startsAt = startsAt
        self.dueAt = dueAt
        let normalizedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.note = normalizedNote?.isEmpty == false ? normalizedNote : nil
    }
}

public struct AssignmentActivationRequest: Encodable, Equatable, Sendable {
    public let action = "checkout"
    public let stockUnitId: UUID?
    public let checkedOutAt: Date?
    public let note: String?

    public init(
        stockUnitId: UUID? = nil,
        checkedOutAt: Date? = nil,
        note: String? = nil
    ) {
        self.stockUnitId = stockUnitId
        self.checkedOutAt = checkedOutAt
        let normalizedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.note = normalizedNote?.isEmpty == false ? normalizedNote : nil
    }
}

public enum InternalRequestStatus: String, Codable, CaseIterable, Identifiable, Sendable {
    case submitted
    case approved
    case rejected
    case fulfilled
    case cancelled

    public var id: Self { self }
}

public enum InternalRequestAction: String, Codable, CaseIterable, Identifiable, Sendable {
    case approve
    case reject
    case cancel
    case fulfill

    public var id: Self { self }
}

public struct InternalRequestRequester: Codable, Equatable, Sendable {
    public let userId: UUID?
    public let name: String
    public let email: String?
}

public struct InternalRequestDelivery: Codable, Equatable, Sendable {
    public let resourceId: UUID
    public let name: String
}

public struct InternalRequestLineResource: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let sku: String?
    public let status: String
    public let currentQuantity: Int
    public let trackingMode: StockTrackingMode
}

public struct InternalRequestLine: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let resource: InternalRequestLineResource
    public let quantity: Int
    public let note: String
}

public struct InternalRequestEvent: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let type: InternalRequestStatus
    public let actor: String
    public let note: String
    public let occurredAt: Date
}

public struct InventoryInternalRequest: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let reference: String
    public let status: InternalRequestStatus
    public let requester: InternalRequestRequester
    public let delivery: InternalRequestDelivery?
    public let startsAt: Date
    public let dueAt: Date
    public let note: String
    public let decisionNote: String
    public let decidedBy: String?
    public let decidedAt: Date?
    public let fulfilledBy: String?
    public let fulfilledAt: Date?
    public let createdBy: String
    public let createdAt: Date
    public let updatedAt: Date
    public let canCancel: Bool
    public let lines: [InternalRequestLine]
    public let events: [InternalRequestEvent]
}

public struct InternalRequestCapabilities: Codable, Equatable, Sendable {
    public let canCreate: Bool
    public let canManage: Bool
}

public struct InternalRequestsResponse: Codable, Equatable, Sendable {
    public let requests: [InventoryInternalRequest]
    public let capabilities: InternalRequestCapabilities
}

public struct InternalRequestResponse: Codable, Equatable, Sendable {
    public let request: InventoryInternalRequest
}

public struct InternalRequestCreateLineRequest: Encodable, Equatable, Sendable {
    public let resourceId: UUID
    public let quantity: Int
    public let note: String?

    public init(resourceId: UUID, quantity: Int, note: String? = nil) {
        self.resourceId = resourceId
        self.quantity = quantity
        let normalizedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.note = normalizedNote?.isEmpty == false ? normalizedNote : nil
    }

    private enum CodingKeys: String, CodingKey {
        case resourceId
        case quantity
        case note
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(resourceId.uuidString.lowercased(), forKey: .resourceId)
        try container.encode(quantity, forKey: .quantity)
        try container.encodeIfPresent(note, forKey: .note)
    }
}

public struct InternalRequestCreateRequest: Encodable, Equatable, Sendable {
    public let deliveryResourceId: UUID?
    public let startsAt: Date
    public let dueAt: Date
    public let note: String?
    public let lines: [InternalRequestCreateLineRequest]

    public init(
        deliveryResourceId: UUID? = nil,
        startsAt: Date,
        dueAt: Date,
        note: String? = nil,
        lines: [InternalRequestCreateLineRequest]
    ) {
        self.deliveryResourceId = deliveryResourceId
        self.startsAt = startsAt
        self.dueAt = dueAt
        let normalizedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.note = normalizedNote?.isEmpty == false ? normalizedNote : nil
        self.lines = lines
    }

    private enum CodingKeys: String, CodingKey {
        case deliveryResourceId
        case startsAt
        case dueAt
        case note
        case lines
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(
            deliveryResourceId?.uuidString.lowercased(),
            forKey: .deliveryResourceId
        )
        try container.encode(startsAt, forKey: .startsAt)
        try container.encode(dueAt, forKey: .dueAt)
        try container.encodeIfPresent(note, forKey: .note)
        try container.encode(lines, forKey: .lines)
    }
}

public struct InternalRequestActionRequest: Encodable, Equatable, Sendable {
    public let action: InternalRequestAction
    public let note: String?

    public init(action: InternalRequestAction, note: String? = nil) {
        self.action = action
        let normalizedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.note = normalizedNote?.isEmpty == false ? normalizedNote : nil
    }
}

public struct InventoryResourceAccess: Codable, Equatable, Sendable {
    public let update: Bool
    public let delete: Bool
    public let stock: Bool
    public let assignments: Bool
    public let counts: Bool
    public let spatial: Bool
    public let ai: Bool
}

public struct ResourceTranslationField: Codable, Equatable, Identifiable, Sendable {
    public var id: String { fieldKey }
    public let fieldKey: String
    public let label: String
    public let sourceText: String
    public let translatedText: String?
    public let suggestion: String?
    public let state: String
    public let origin: String?
    public let model: String?
    public let updatedAt: Date?
}

public struct ResourceTranslationLanguage: Codable, Equatable, Identifiable, Sendable {
    public var id: String { code }
    public let code: String
    public let label: String
    public let autoTranslate: Bool
    public let revision: Int
    public let status: String
    public let currentCount: Int
    public let totalCount: Int
    public let lastError: String?
    public let fields: [ResourceTranslationField]
}

public struct ResourceTranslationLanguageLabel: Codable, Equatable, Sendable {
    public let code: String
    public let label: String
}

public struct ResourceTranslationOverview: Codable, Equatable, Sendable {
    public let resourceId: UUID
    public let contentRevision: Int
    public let defaultLanguage: ResourceTranslationLanguageLabel
    public let languages: [ResourceTranslationLanguage]
}

public enum ResourceTranslationOperation: Encodable, Equatable, Sendable {
    case set(fieldKey: String, translatedText: String)
    case acceptSuggestion(fieldKey: String)
    case useAI(fieldKey: String)

    private enum CodingKeys: String, CodingKey {
        case action
        case fieldKey
        case translatedText
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .set(let fieldKey, let translatedText):
            try container.encode("set", forKey: .action)
            try container.encode(fieldKey, forKey: .fieldKey)
            try container.encode(translatedText, forKey: .translatedText)
        case .acceptSuggestion(let fieldKey):
            try container.encode("accept_suggestion", forKey: .action)
            try container.encode(fieldKey, forKey: .fieldKey)
        case .useAI(let fieldKey):
            try container.encode("use_ai", forKey: .action)
            try container.encode(fieldKey, forKey: .fieldKey)
        }
    }
}

public enum ResourceCodeMatch: String, Codable, CaseIterable, Sendable {
    case id
    case sku
    case barcode
    case serialNumber
    case variantSku
    case variantBarcode
}

public struct ResourceVariantDTO: Codable, Equatable, Sendable {
    public let id: UUID
    public let resourceId: UUID
    public let name: String
    public let sku: String?
    public let barcode: String?
    public let priceCents: Int?
    public let currency: String
    public let quantity: Int
    public let position: Int
    public let createdBy: String?
    public let updatedBy: String?
    public let createdAt: Date
    public let updatedAt: Date
}

public struct ResourceLookupResponse: Codable, Equatable, Sendable {
    public let resource: InventoryResource
    public let variant: ResourceVariantDTO?
    public let matchedBy: ResourceCodeMatch

    public init(
        resource: InventoryResource,
        variant: ResourceVariantDTO? = nil,
        matchedBy: ResourceCodeMatch
    ) {
        self.resource = resource
        self.variant = variant
        self.matchedBy = matchedBy
    }
}

public struct ScanActionWorkflowListResponse: Codable, Equatable, Sendable {
    public let workflows: [ScanActionWorkflow]
}

public struct ScanActionWorkflow: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let description: String
    public let enabled: Bool
    public let resourceId: UUID
    public let codeTypes: [String]
    public let revision: Int
    public let operation: ScanActionOperation
    public let inputFields: [ScanActionInputField]
}

public struct ScanActionOperation: Codable, Equatable, Sendable {
    public let type: String
    public let delta: Int?
    public let quantity: Int?

    public var summary: String {
        switch type {
        case "assembly-build":
            return "\(quantity ?? 1) × Baugruppe fertigstellen"
        case "stock-adjustment":
            let amount = delta ?? 0
            return "\(amount > 0 ? "+" : "")\(amount) Bestand"
        default:
            return "Inventareinheit aktualisieren"
        }
    }
}

public struct ScanActionOption: Codable, Equatable, Identifiable, Sendable {
    public let value: String
    public let label: String

    public var id: String { value }
}

public struct ScanActionInputField: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public let label: String
    public let type: String?
    public let storage: String?
    public let required: Bool
    public let placeholder: String?
    public let options: [ScanActionOption]?

    public var id: String { key }
    public var resolvedType: String { type ?? "select" }
}

public struct ScanActionResourcePreview: Codable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let quantity: Int
    public let trackingMode: String?
}

public struct ScanActionResolution: Codable, Equatable, Sendable {
    public let workflow: ScanActionWorkflow
    public let resource: ScanActionResourcePreview
    public let identifier: String
    public let operation: ScanActionOperation
    public let expectedResourceUpdatedAt: String
    public let expectedUnitId: UUID?
    public let expectedUnitUpdatedAt: String?
    public let statusBefore: String?
    public let statusAfter: String?
    public let quantityBefore: Int
    public let quantityAfter: Int
    public let delta: Int
    public let willCreate: Bool
    public let fields: [ScanActionInputField]
}

public struct ScanActionResolveRequest: Codable, Equatable, Sendable {
    public let workflowId: UUID
    public let code: String
    public let codeType: String?
}

public enum ScanActionInputValue: Encodable, Equatable, Sendable {
    case text(String)
    case number(Double)
    case boolean(Bool)
    case identifiers([String])

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .boolean(let value):
            try container.encode(value)
        case .identifiers(let value):
            try container.encode(value)
        }
    }
}

public struct ScanActionExecuteRequest: Encodable, Equatable, Sendable {
    public let workflowId: UUID
    public let revision: Int
    public let code: String
    public let codeType: String?
    public let expectedResourceUpdatedAt: String
    public let expectedUnitId: UUID?
    public let expectedUnitUpdatedAt: String?
    public let inputs: [String: ScanActionInputValue]

    private enum CodingKeys: String, CodingKey {
        case workflowId
        case revision
        case code
        case codeType
        case expectedResourceUpdatedAt
        case expectedUnitId
        case expectedUnitUpdatedAt
        case inputs
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(workflowId, forKey: .workflowId)
        try container.encode(revision, forKey: .revision)
        try container.encode(code, forKey: .code)
        try container.encodeIfPresent(codeType, forKey: .codeType)
        try container.encode(expectedResourceUpdatedAt, forKey: .expectedResourceUpdatedAt)
        if let expectedUnitId {
            try container.encode(expectedUnitId, forKey: .expectedUnitId)
        } else {
            try container.encodeNil(forKey: .expectedUnitId)
        }
        if let expectedUnitUpdatedAt {
            try container.encode(expectedUnitUpdatedAt, forKey: .expectedUnitUpdatedAt)
        } else {
            try container.encodeNil(forKey: .expectedUnitUpdatedAt)
        }
        try container.encode(inputs, forKey: .inputs)
    }
}

public struct ScanActionExecutionResponse: Codable, Equatable, Sendable {
    public let workflowId: UUID
    public let revision: Int
    public let resource: ScanActionResourcePreview
    public let created: Bool
    public let operation: ScanActionOperation
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

public struct InventoryRecognitionObservation: Codable, Equatable, Sendable {
    public let label: String
    public let category: String
    public let brand: String?
    public let model: String?
    public let color: String?
    public let material: String?
    public let visibleText: [String]
    public let searchTerms: [String]
    public let confidence: Double
}

public struct InventoryRecognitionMatch: Codable, Equatable, Identifiable, Sendable {
    public let resource: InventoryResource
    public let confidence: Double
    public let reason: String
    public let evidence: [String]

    public var id: UUID { resource.id }
}

public struct InventoryRecognitionCatalog: Codable, Equatable, Sendable {
    public let considered: Int
    public let truncated: Bool
}

public struct InventoryRecognitionResponse: Codable, Equatable, Sendable {
    public let detected: InventoryRecognitionObservation?
    public let matches: [InventoryRecognitionMatch]
    public let isConfident: Bool
    public let model: String?
    public let catalog: InventoryRecognitionCatalog
}

public struct ObjectCountMarker: Codable, Equatable, Sendable {
    public let x: Int
    public let y: Int

    public init(x: Int, y: Int) {
        self.x = x
        self.y = y
    }
}

public struct ObjectCountResponse: Codable, Equatable, Sendable {
    public let count: Int
    public let confidence: Double
    public let detectedItem: String
    public let isExact: Bool
    public let explanation: String
    public let warnings: [String]
    public let markers: [ObjectCountMarker]
    public let model: String

    public init(
        count: Int,
        confidence: Double,
        detectedItem: String,
        isExact: Bool,
        explanation: String,
        warnings: [String],
        markers: [ObjectCountMarker] = [],
        model: String
    ) {
        self.count = count
        self.confidence = confidence
        self.detectedItem = detectedItem
        self.isExact = isExact
        self.explanation = explanation
        self.warnings = warnings
        self.markers = markers
        self.model = model
    }

    private enum CodingKeys: String, CodingKey {
        case count, confidence, detectedItem, isExact, explanation, warnings, markers, model
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        count = try container.decode(Int.self, forKey: .count)
        confidence = try container.decode(Double.self, forKey: .confidence)
        detectedItem = try container.decode(String.self, forKey: .detectedItem)
        isExact = try container.decode(Bool.self, forKey: .isExact)
        explanation = try container.decode(String.self, forKey: .explanation)
        warnings = try container.decode([String].self, forKey: .warnings)
        markers = try container.decodeIfPresent([ObjectCountMarker].self, forKey: .markers) ?? []
        model = try container.decode(String.self, forKey: .model)
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

public enum StockTrackingMode: String, Codable, CaseIterable, Sendable {
    case bulk
    case serialized
}

public enum StockMovementType: String, Codable, CaseIterable, Sendable {
    case receipt
    case issue
    case adjustment
    case `return`
    case waste
    case transfer
}

public enum StockUnitStatus: String, Codable, CaseIterable, Sendable {
    case available
    case reserved
    case inUse = "in-use"
    case maintenance
    case consumed
    case lost
    case retired
}

public struct StockConfig: Codable, Equatable, Sendable {
    public let trackingMode: StockTrackingMode
    public let minimumStock: Int
    public let reorderQuantity: Int
    public let leadTimeDays: Int
    public let unitName: String
}

public struct StockForecast: Codable, Equatable, Sendable {
    public let averageDailyUsage: Double
    public let daysUntilStockout: Double?
    public let predictedStockoutAt: Date?
    public let isBelowMinimum: Bool
    public let suggestedReorderQuantity: Int
}

public struct StockProcurementLine: Codable, Identifiable, Equatable, Sendable {
    public let lineID: UUID
    public let orderID: UUID
    public let reference: String?
    public let supplier: String
    public let orderedQuantity: Int
    public let receivedQuantity: Int
    public let openQuantity: Int
    public let expectedAt: Date?

    public var id: UUID { lineID }

    private enum CodingKeys: String, CodingKey {
        case lineID = "lineId"
        case orderID = "orderId"
        case reference, supplier, orderedQuantity, receivedQuantity, openQuantity, expectedAt
    }
}

public struct StockProcurement: Codable, Equatable, Sendable {
    public let onOrder: Int
    public let projectedQuantity: Int
    public let nextExpectedAt: Date?
    public let openLines: [StockProcurementLine]
}

public struct StockUnit: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let code: String
    public let status: StockUnitStatus
    public let location: String?
    public let acquiredAt: Date
    public let lastMovedAt: Date
    public let createdAt: Date
    public let updatedAt: Date
}

public struct StockDetailResponse: Codable, Equatable, Sendable {
    public let resource: StockResourceSnapshot
    public let config: StockConfig
    public let forecast: StockForecast
    public let procurement: StockProcurement
    public let movements: [StockMovement]
    public let units: [StockUnit]
}

public struct StockConfigPatchRequest: Codable, Equatable, Sendable {
    public let trackingMode: StockTrackingMode
    public let minimumStock: Int
    public let reorderQuantity: Int
    public let leadTimeDays: Int
    public let unitName: String

    public init(
        trackingMode: StockTrackingMode,
        minimumStock: Int,
        reorderQuantity: Int,
        leadTimeDays: Int,
        unitName: String
    ) {
        self.trackingMode = trackingMode
        self.minimumStock = minimumStock
        self.reorderQuantity = reorderQuantity
        self.leadTimeDays = leadTimeDays
        self.unitName = unitName
    }
}

public struct StockConfigUpdateResponse: Codable, Equatable, Sendable {
    public let config: StockConfig
    public let unitsCreated: Int
}

public struct StockMovementRequest: Codable, Equatable, Sendable {
    public let delta: Int
    public let type: String
    public let reason: String?
    public let note: String?
    public let location: String?
    public let occurredAt: Date?

    public init(
        delta: Int,
        type: String,
        reason: String? = nil,
        note: String? = nil,
        location: String? = nil,
        occurredAt: Date? = nil
    ) {
        self.delta = delta
        self.type = type
        self.reason = reason
        self.note = note
        self.location = location
        self.occurredAt = occurredAt
    }
}

public struct StockUnitCreateRequest: Codable, Equatable, Sendable {
    public let count: Int?
    public let codes: [String]?
    public let location: String?
    public let acquiredAt: Date?

    public init(
        count: Int? = nil,
        codes: [String]? = nil,
        location: String? = nil,
        acquiredAt: Date? = nil
    ) {
        self.count = count
        self.codes = codes
        self.location = location
        self.acquiredAt = acquiredAt
    }
}

public struct StockUnitCreationResponse: Codable, Equatable, Sendable {
    public let resource: StockResourceSnapshot
    public let units: [StockUnit]
    public let movements: [StockMovement]
}

public struct StockUnitPatchRequest: Encodable, Equatable, Sendable {
    public let status: StockUnitStatus
    public let location: String?
    public let occurredAt: Date
    public let reason: String?
    public let note: String?

    public init(
        status: StockUnitStatus,
        location: String?,
        occurredAt: Date,
        reason: String? = nil,
        note: String? = nil
    ) {
        self.status = status
        self.location = location
        self.occurredAt = occurredAt
        self.reason = reason
        self.note = note
    }

    private enum CodingKeys: String, CodingKey {
        case status, location, occurredAt, reason, note
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(status, forKey: .status)
        try container.encode(location, forKey: .location)
        try container.encode(occurredAt, forKey: .occurredAt)
        try container.encodeIfPresent(reason, forKey: .reason)
        try container.encodeIfPresent(note, forKey: .note)
    }
}

public struct StockUnitUpdateResponse: Codable, Equatable, Sendable {
    public let resource: StockResourceSnapshot
    public let unit: StockUnit
    public let movement: StockMovement
}
