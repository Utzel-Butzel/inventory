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
}
