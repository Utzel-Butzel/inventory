import Foundation
import XCTest
@testable import Inventory

final class ResourceLookupResponseTests: XCTestCase {
    func testDecodesVariantAsIndependentResource() throws {
        let json = """
        {
          "resource": {
            "id": "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
            "name": "T-Shirt Blue / Large",
            "description": "",
            "type": "clothing",
            "status": "available",
            "sku": "SHIRT-BLU-L",
            "barcode": "4006381333931",
            "quantity": 4,
            "location": null,
            "serialNumber": null,
            "valueCents": null,
            "currency": "EUR",
            "priority": 3,
            "tags": [],
            "categories": [],
            "relatedResourceIds": [],
            "gpsLatitude": null,
            "gpsLongitude": null,
            "gpsAltitude": null,
            "notes": "",
            "aiMetadata": null,
            "createdBy": null,
            "createdAt": "2026-08-13T10:00:00.000Z",
            "updatedAt": "2026-08-13T10:00:00.000Z",
            "media": [],
            "cover": null
          },
          "matchedBy": "barcode"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = formatter.date(from: value) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid ISO-8601 date"
                )
            }
            return date
        }
        let decoded = try decoder.decode(ResourceLookupResponse.self, from: json)
        XCTAssertEqual(decoded.matchedBy, .barcode)
        XCTAssertEqual(decoded.resource.name, "T-Shirt Blue / Large")
        XCTAssertEqual(decoded.resource.barcode, "4006381333931")
        XCTAssertEqual(decoded.resource.quantity, 4)
    }
}
