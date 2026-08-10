import XCTest
@testable import Inventory

final class ResourceCodeParserTests: XCTestCase {
    private let id = UUID(uuidString: "3F2504E0-4F89-41D3-9A0C-0305E82C3301")!

    func testRecognizesUUIDAndSupportedResourceLinks() {
        let values = [
            id.uuidString,
            "inventory:\(id.uuidString)",
            "inventory://resource/\(id.uuidString)",
            "https://inventory.example/inventory/\(id.uuidString)",
            "https://inventory.example/api/v1/resources/\(id.uuidString)",
            "https://inventory.example/scan?resourceId=\(id.uuidString)",
        ]

        for value in values {
            XCTAssertEqual(ResourceCodeParser.parse(value).resourceID, id, value)
        }
    }

    func testKeepsUnknownCodeForExactServerLookup() {
        let code = "  SKU-AbC-042  "
        let parsed = ResourceCodeParser.parse(code)
        XCTAssertNil(parsed.resourceID)
        XCTAssertEqual(parsed.code, "SKU-AbC-042")
    }

    func testRejectsMalformedOrUnsupportedUUID() {
        XCTAssertNil(ResourceCodeParser.parse("inventory:not-a-uuid").resourceID)
        XCTAssertNil(
            ResourceCodeParser.parse("3F2504E0-4F89-71D3-9A0C-0305E82C3301").resourceID
        )
    }
}
