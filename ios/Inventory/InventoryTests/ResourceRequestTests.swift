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
            slugs: ["messgeraet", "kalibrierung-messgeraet"],
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
        XCTAssertEqual(
            object["slugs"] as? [String],
            ["messgeraet", "kalibrierung-messgeraet"]
        )
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

    func testPatchCanReplaceAllResourceSlugs() throws {
        let data = try JSONEncoder().encode(
            ResourcePatchRequest(slugs: ["bohrmaschine", "werkstatt-bohrer"])
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(
            object["slugs"] as? [String],
            ["bohrmaschine", "werkstatt-bohrer"]
        )
    }

    func testManualTranslationOperationUsesAPIContractKeys() throws {
        let data = try JSONEncoder().encode(
            ResourceTranslationOperation.set(
                fieldKey: "description",
                translatedText: "Übersetzter Text"
            )
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["action"] as? String, "set")
        XCTAssertEqual(object["fieldKey"] as? String, "description")
        XCTAssertEqual(object["translatedText"] as? String, "Übersetzter Text")
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

    func testResourceFamilyDecodesServerContract() throws {
        let data = Data(
            #"{"role":"variant","currentResourceId":"11111111-1111-1111-1111-111111111111","primary":{"id":"22222222-2222-2222-2222-222222222222","name":"Akkuschrauber","type":"tool","status":"available","sku":"TOOL-1","barcode":null,"quantity":3,"trackingMode":"bulk","updatedAt":"2026-08-21T10:00:00Z","overriddenFields":[]},"variants":[{"id":"11111111-1111-1111-1111-111111111111","name":"Akkuschrauber 18 V","type":"tool","status":"available","sku":"TOOL-18","barcode":"4006381333931","quantity":2,"trackingMode":"serialized","updatedAt":"2026-08-21T11:00:00Z","overriddenFields":["name"]}],"legacyVariantCount":0,"optionGroupCount":0,"summary":{"totalQuantity":5,"primaryQuantity":3,"variantQuantity":2,"variantCount":1,"serializedVariantCount":1}}"#.utf8
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let response = try decoder.decode(ResourceFamilyResponse.self, from: data)

        XCTAssertEqual(response.role, .variant)
        XCTAssertEqual(response.primary.name, "Akkuschrauber")
        XCTAssertEqual(response.variants.first?.trackingMode, .serialized)
        XCTAssertEqual(response.variants.first?.overriddenFields, ["name"])
        XCTAssertEqual(response.summary.totalQuantity, 5)
    }

    func testRelationshipRequestEncodesDirectionalEndpoints() throws {
        let request = ResourceRelationCreateRequest(
            sourceResourceId: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            targetResourceId: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
            relationTypeKey: "contains"
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["sourceResourceId"] as? String, request.sourceResourceId.uuidString)
        XCTAssertEqual(object["targetResourceId"] as? String, request.targetResourceId.uuidString)
        XCTAssertEqual(object["relationTypeKey"] as? String, "contains")
    }

    func testBillOfMaterialsReplacementPreservesSlotAndOrder() throws {
        let request = BillOfMaterialsReplaceRequest(
            components: [
                BillOfMaterialsComponentRequest(
                    resourceId: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!,
                    slotKey: "motor_slot",
                    quantityPerAssembly: 2,
                    position: 0,
                    note: nil
                ),
                BillOfMaterialsComponentRequest(
                    resourceId: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!,
                    slotKey: "screw_slot",
                    quantityPerAssembly: 8,
                    position: 1,
                    note: "M4"
                ),
            ]
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let components = try XCTUnwrap(object["components"] as? [[String: Any]])

        XCTAssertEqual(components.map { $0["slotKey"] as? String }, ["motor_slot", "screw_slot"])
        XCTAssertEqual(components.map { $0["position"] as? Int }, [0, 1])
        XCTAssertEqual(components[0]["quantityPerAssembly"] as? Int, 2)
        XCTAssertFalse(components[0].keys.contains("note"))
        XCTAssertEqual(components[1]["note"] as? String, "M4")
    }
}
