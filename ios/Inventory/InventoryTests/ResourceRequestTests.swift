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

    func testResourceRequestEncodesBarcodeAndCustomFields() throws {
        let request = ResourceCreateRequest(
            name: "Messgerät",
            barcode: "4006381333931",
            customFields: [
                "calibrated": .boolean(true),
                "accuracy": .number(0.01),
                "owners": .strings(["7ad4ac4e-189e-4bc9-ab2d-6bd2ac3ff9bb"]),
            ]
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let fields = try XCTUnwrap(object["customFields"] as? [String: Any])

        XCTAssertEqual(object["barcode"] as? String, "4006381333931")
        XCTAssertEqual(fields["calibrated"] as? Bool, true)
        XCTAssertEqual(fields["accuracy"] as? Double, 0.01)
        XCTAssertEqual(
            fields["owners"] as? [String],
            ["7ad4ac4e-189e-4bc9-ab2d-6bd2ac3ff9bb"]
        )
    }

    func testPatchCanExplicitlyClearBarcode() throws {
        let data = try JSONEncoder().encode(ResourcePatchRequest(barcode: .null))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertTrue(object.keys.contains("barcode"))
        XCTAssertTrue(object["barcode"] is NSNull)
    }

    func testCapabilitiesDecodeGranularPermissionsAndStockPolicy() throws {
        let data = Data(
            #"{"name":"Editor","principal":"user:abc","scopes":["read","write"],"permissions":["inventory.read","inventory.update","stock.manage"],"organization":{"id":"7ad4ac4e-189e-4bc9-ab2d-6bd2ac3ff9bb","name":"Werkstatt","slug":"werkstatt","role":"editor","roleName":"Editor","isReadOnly":false,"allowNegativeStock":true,"canManage":false}}"#.utf8
        )

        let response = try JSONDecoder().decode(CapabilitiesResponse.self, from: data)

        XCTAssertEqual(response.permissions, ["inventory.read", "inventory.update", "stock.manage"])
        XCTAssertEqual(response.activeOrganization?.allowNegativeStock, true)
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

    func testModelMediaKindDecodesAndUnknownKindsRemainReadable() throws {
        let decoder = JSONDecoder()
        let model = try decoder.decode(
            InventoryMediaKind.self,
            from: Data("\"model\"".utf8)
        )
        let future = try decoder.decode(
            InventoryMediaKind.self,
            from: Data("\"point-cloud\"".utf8)
        )

        XCTAssertEqual(model, .model)
        XCTAssertEqual(future, .unknown)
    }
}
