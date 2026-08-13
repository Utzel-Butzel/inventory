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
        for index in segments.indices {
            let nextIndex = segments.index(after: index)
            guard nextIndex < segments.endIndex else { continue }

            let segment = segments[index].lowercased()
            if segment == "r", let resourceID = shortResourceID(segments[nextIndex]) {
                return resourceID
            }

            guard resourceSegments.contains(segment) else { continue }
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

    /// Decode an unpadded, canonical base64url UUID. Compact ids are only
    /// considered by `resourceID(in:)` after an `r` URL segment so a scanned
    /// 22-character SKU or serial number remains available for exact lookup.
    private static func shortResourceID(_ value: String) -> UUID? {
        let characters = Array(value.utf8)
        guard characters.count == 22, characters.allSatisfy(isBase64URL) else {
            return nil
        }

        let base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + "=="
        guard let data = Data(base64Encoded: base64), data.count == 16 else {
            return nil
        }

        let canonical = data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        guard canonical == value else { return nil }

        let hexBytes: [String] = data.map { byte -> String in
            String(format: "%02x", Int(byte))
        }
        let hex = hexBytes.joined()
        var resourceID = hex
        for offset in [20, 16, 12, 8] {
            let index = resourceID.index(resourceID.startIndex, offsetBy: offset)
            resourceID.insert("-", at: index)
        }
        return validResourceID(resourceID)
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

    private static func isBase64URL(_ value: UInt8) -> Bool {
        switch value {
        case 48 ... 57, 65 ... 90, 97 ... 122, 45, 95:
            return true
        default:
            return false
        }
    }
}
