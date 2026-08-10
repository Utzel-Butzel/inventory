import Foundation

public struct ParsedResourceCode: Equatable, Sendable {
    public let code: String
    public let resourceID: UUID?

    public init(code: String, resourceID: UUID?) {
        self.code = code
        self.resourceID = resourceID
    }
}

public enum ResourceCodeParser {
    /// Mirrors the server parser while keeping unknown values unchanged for exact
    /// SKU and serial-number lookup.
    public static func parse(_ value: String) -> ParsedResourceCode {
        let code = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            return ParsedResourceCode(code: "", resourceID: nil)
        }

        if let resourceID = validResourceID(code) {
            return ParsedResourceCode(code: code, resourceID: resourceID)
        }

        if let components = URLComponents(string: code), components.scheme != nil {
            let segments = ([components.host] + components.path.split(separator: "/").map(String.init))
                .compactMap { segment in
                    segment?.removingPercentEncoding ?? segment
                }

            if let resourceID = resourceID(in: segments) {
                return ParsedResourceCode(code: code, resourceID: resourceID)
            }

            for name in ["resourceId", "id"] {
                if let candidate = components.queryItems?.first(where: { $0.name == name })?.value,
                   let resourceID = validResourceID(candidate) {
                    return ParsedResourceCode(code: code, resourceID: resourceID)
                }
            }
        }

        if let compactID = compactResourceID(in: code) {
            return ParsedResourceCode(code: code, resourceID: compactID)
        }

        return ParsedResourceCode(code: code, resourceID: nil)
    }

    private static func resourceID(in segments: [String]) -> UUID? {
        let resourceSegments = Set(["inventory", "resource", "resources"])
        for index in segments.indices where resourceSegments.contains(segments[index].lowercased()) {
            let nextIndex = segments.index(after: index)
            guard nextIndex < segments.endIndex else { continue }
            if let resourceID = validResourceID(segments[nextIndex]) {
                return resourceID
            }
        }
        return nil
    }

    private static func compactResourceID(in code: String) -> UUID? {
        let lowercased = code.lowercased()
        guard lowercased.hasPrefix("inventory:") else { return nil }

        var remainder = String(code.dropFirst("inventory:".count))
        if remainder.hasPrefix("//") {
            remainder.removeFirst(2)
        }
        if remainder.lowercased().hasPrefix("resource/") {
            remainder.removeFirst("resource/".count)
        }
        return validResourceID(remainder)
    }

    /// The backend accepts RFC 4122 variants with versions one through five.
    private static func validResourceID(_ value: String) -> UUID? {
        let characters = Array(value.utf8)
        guard characters.count == 36 else { return nil }
        let hyphenIndexes = Set([8, 13, 18, 23])

        for (index, character) in characters.enumerated() {
            if hyphenIndexes.contains(index) {
                guard character == 45 else { return nil }
            } else {
                guard isHexadecimal(character) else { return nil }
            }
        }

        guard (49 ... 53).contains(characters[14]) else {
            return nil
        }
        guard [56, 57, 65, 66, 97, 98].contains(characters[19]) else {
            return nil
        }
        return UUID(uuidString: value)
    }

    private static func isHexadecimal(_ value: UInt8) -> Bool {
        switch value {
        case 48 ... 57, 97 ... 102, 65 ... 70:
            return true
        default:
            return false
        }
    }
}
