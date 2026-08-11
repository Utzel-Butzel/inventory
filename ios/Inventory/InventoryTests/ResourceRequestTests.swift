import XCTest
@testable import Inventory

final class ResourceRequestTests: XCTestCase {
    func testEmptyPatchDoesNotEncodeCreateDefaults() throws {
        let data = try JSONEncoder().encode(ResourcePatchRequest())
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(object.isEmpty)
    }

    func testPatchDistinguishesNullFromUnchanged() throws {
        let patch = ResourcePatchRequest(name: "Bohrmaschine", sku: .null)
        let data = try JSONEncoder().encode(patch)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["name"] as? String, "Bohrmaschine")
        XCTAssertTrue(object.keys.contains("sku"))
        XCTAssertTrue(object["sku"] is NSNull)
        XCTAssertFalse(object.keys.contains("location"))
        XCTAssertFalse(object.keys.contains("quantity"))
    }

    func testUnknownResourceTypeRoundTripsWithoutLosingServerValue() throws {
        let source = try XCTUnwrap("\"network-switch\"".data(using: .utf8))

        let decoded = try JSONDecoder().decode(InventoryResourceType.self, from: source)

        XCTAssertEqual(decoded, .custom("network-switch"))
        XCTAssertEqual(decoded.rawValue, "network-switch")
        XCTAssertEqual(try JSONEncoder().encode(decoded), source)
    }

    func testUnknownResourceTypeCanBeSentInPatchRequest() throws {
        let patch = ResourcePatchRequest(type: .custom("network-switch"))
        let data = try JSONEncoder().encode(patch)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["type"] as? String, "network-switch")
    }

    func testBuiltInPickerCasesRemainStable() {
        XCTAssertEqual(InventoryResourceType.allCases.count, 9)
        XCTAssertTrue(InventoryResourceType.allCases.allSatisfy(\.isBuiltIn))
        XCTAssertEqual(InventoryResourceType(rawValue: "tool"), .tool)
    }
}
