import Foundation

public indirect enum ActionChainJSON: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), null
    case array([ActionChainJSON]), object([String: ActionChainJSON])

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let v = try? value.decode(Bool.self) { self = .bool(v) }
        else if let v = try? value.decode(Double.self) { self = .number(v) }
        else if let v = try? value.decode(String.self) { self = .string(v) }
        else if let v = try? value.decode([ActionChainJSON].self) { self = .array(v) }
        else { self = .object(try value.decode([String: ActionChainJSON].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let v): try value.encode(v)
        case .number(let v): try value.encode(v)
        case .bool(let v): try value.encode(v)
        case .null: try value.encodeNil()
        case .array(let v): try value.encode(v)
        case .object(let v): try value.encode(v)
        }
    }

    public var display: String {
        switch self {
        case .string(let v): return v
        case .number(let v): return v.formatted()
        case .bool(let v): return v ? "Ja" : "Nein"
        case .null: return "—"
        case .array(let v): return v.map(\.display).joined(separator: ", ")
        case .object(let v): return v.keys.sorted().map { "\($0): \(v[$0]!.display)" }.joined(separator: ", ")
        }
    }
}

public struct ActionChainValue: Codable, Equatable, Sendable {
    public let source: String
    public var value: ActionChainJSON? = nil
    public var field: String? = nil
    public var key: String? = nil
    public var actionId: String? = nil
    public var path: String? = nil

    func resolve(identifier: String, raw: String, inputs: [String: ActionChainJSON]) -> ActionChainJSON? {
        switch source {
        case "literal": return value ?? .null
        case "scan": return .string(field == "raw" ? raw : identifier)
        case "input": return key.flatMap { inputs[$0] }
        default: return nil // Action results are never available while collecting inputs.
        }
    }
}

public struct ActionChainCondition: Codable, Equatable, Sendable {
    public let left: ActionChainValue
    public let `operator`: String
    public var right: ActionChainValue? = nil
}

public struct ActionChainConditions: Codable, Equatable, Sendable {
    public let mode: String
    public let rules: [ActionChainCondition]

    public func matches(identifier: String, raw: String, inputs: [String: ActionChainJSON]) -> Bool {
        let matches = rules.map { rule -> Bool in
            let left = rule.left.resolve(identifier: identifier, raw: raw, inputs: inputs)
            let right = rule.right?.resolve(identifier: identifier, raw: raw, inputs: inputs)
            let present = left != nil && left != .null && left != .string("")
            let equal: Bool
            switch (left, right) {
            case (.array, .array), (.object, .object):
                // The server compares collections by identity, not by their contents.
                equal = rule.left.source == "input" && rule.right?.source == "input" && rule.left.key == rule.right?.key
            default: equal = left == right
            }
            switch rule.operator {
            case "exists": return present
            case "missing": return !present
            case "equals": return left != nil && right != nil && equal
            case "not-equals": return left != nil && right != nil && !equal
            case "gt", "gte", "lt", "lte":
                guard case .number(let lhs) = left, case .number(let rhs) = right else { return false }
                switch rule.operator {
                case "gt": return lhs > rhs
                case "gte": return lhs >= rhs
                case "lt": return lhs < rhs
                default: return lhs <= rhs
                }
            default: return false
            }
        }
        return mode == "all" ? matches.allSatisfy { $0 } : mode == "any" && matches.contains(true)
    }
}

public struct ActionChainSummary: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let type: String
    public var enabled: Bool? = nil
}

public struct ActionChainTargetOption: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
}
public struct ActionChainTargetGroup: Codable, Equatable, Identifiable, Sendable {
    public let resourceId: UUID
    public let name: String
    public let options: [ActionChainTargetOption]
    public var id: UUID { resourceId }
}
public struct ActionChainConfiguration: Codable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let description: String
    public let identifier: String
    public let targetSelectionMode: String
    public let targetGroups: [ActionChainTargetGroup]
    public let inputFields: [ScanActionInputField]
    public let actions: [ActionChainSummary]

    public var defaultSelection: [UUID: UUID] {
        Dictionary(uniqueKeysWithValues: targetGroups.enumerated().compactMap { index, group in
            guard targetSelectionMode == "all" || (targetSelectionMode == "radio" && index == 0), let option = group.options.first else { return nil }
            return (group.id, option.id)
        })
    }

    public func visibleFields(raw: String, inputs: [String: ActionChainJSON]) -> [ScanActionInputField] {
        var visibleValues: [String: ActionChainJSON] = [:]
        return inputFields.filter { field in
            let visible = field.visibleWhen?.matches(identifier: identifier, raw: raw, inputs: visibleValues) ?? true
            if visible { visibleValues[field.key] = inputs[field.key] }
            return visible
        }
    }
}
public struct ActionChainConfigurationResponse: Codable, Sendable {
    public let workflow: ActionChainConfiguration
}
public struct ActionChainPrepareRequest: Encodable, Sendable {
    public let code: String
    public let codeType: String?
}
public struct ActionChainRunRequest: Encodable, Equatable, Sendable {
    public let workflowId: UUID
    public let code: String
    public let codeType: String?
    public let selectedResourceIds: [UUID]
    public let inputs: [String: ScanActionInputValue]
    public var expectedPlanHash: String? = nil

    private enum CodingKeys: String, CodingKey { case workflowId, code, codeType, selectedResourceIds, inputs, expectedPlanHash }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(workflowId.uuidString.lowercased(), forKey: .workflowId)
        try container.encode(code, forKey: .code)
        try container.encodeIfPresent(codeType, forKey: .codeType)
        try container.encode(selectedResourceIds.map { $0.uuidString.lowercased() }, forKey: .selectedResourceIds)
        try container.encode(inputs, forKey: .inputs)
        try container.encodeIfPresent(expectedPlanHash, forKey: .expectedPlanHash)
    }
}
public struct ActionChainComponentReport: Codable, Equatable, Sendable {
    public let name: String
    public let quantity: Int
    public let codes: [String]
}
public struct ActionChainStepReport: Codable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let type: String
    public let skipped: Bool
    public let target: String?
    public var code: String? = nil
    public var eventName: String? = nil
    public var quantityBefore: Int? = nil
    public var quantityAfter: Int? = nil
    public var statusBefore: String? = nil
    public var statusAfter: String? = nil
    public var locationBefore: String? = nil
    public var locationAfter: String? = nil
    public var metadata: [String: ActionChainJSON]? = nil
    public var customFields: [String: ActionChainJSON]? = nil
    public var components: [ActionChainComponentReport]? = nil
}
public struct ActionChainReport: Codable, Equatable, Sendable {
    public let workflowId: UUID
    public let revision: Int
    public let identifier: String
    public let planHash: String
    public let steps: [ActionChainStepReport]
    public var replayed: Bool? = nil
}

// Keep the reviewed request and key together, including after an uncertain
// network result. A retry must never construct a new execution request.
struct ActionChainReview {
    var report: ActionChainReport?
    private(set) var request: ActionChainRunRequest?
    private(set) var key = UUID()
    var confirmationUncertain = false
    var completed = false

    mutating func reviewed(_ report: ActionChainReport, request: ActionChainRunRequest) {
        self.report = report
        self.request = request
        self.request?.expectedPlanHash = report.planHash
        key = UUID()
        completed = report.replayed == true
        confirmationUncertain = false
    }
    mutating func invalidate() {
        guard !confirmationUncertain else { return }
        report = nil; request = nil; completed = false
    }
}
