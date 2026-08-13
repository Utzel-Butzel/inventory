import Foundation
import XCTest
@testable import Inventory

final class StockContractTests: XCTestCase {
    func testStockDetailDecodesWebAPIContract() throws {
        let data = Data(
            #"""
            {
              "resource": {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "Bohrmaschine",
                "quantity": 4
              },
              "config": {
                "trackingMode": "serialized",
                "minimumStock": 2,
                "reorderQuantity": 5,
                "leadTimeDays": 7,
                "unitName": "Geräte"
              },
              "forecast": {
                "averageDailyUsage": 0.5,
                "daysUntilStockout": 8,
                "predictedStockoutAt": "2026-08-18T10:00:00.000Z",
                "isBelowMinimum": false,
                "suggestedReorderQuantity": 3
              },
              "procurement": {
                "onOrder": 2,
                "projectedQuantity": 6,
                "nextExpectedAt": "2026-08-14T10:00:00.000Z",
                "openLines": [{
                  "lineId": "22222222-2222-2222-2222-222222222222",
                  "orderId": "33333333-3333-3333-3333-333333333333",
                  "reference": "PO-42",
                  "supplier": "Werkzeug GmbH",
                  "orderedQuantity": 4,
                  "receivedQuantity": 2,
                  "openQuantity": 2,
                  "expectedAt": "2026-08-14T10:00:00.000Z"
                }]
              },
              "movements": [{
                "id": "44444444-4444-4444-4444-444444444444",
                "resourceId": "11111111-1111-1111-1111-111111111111",
                "delta": -1,
                "balanceAfter": 4,
                "type": "issue",
                "reason": "Ausgabe",
                "note": "Baustelle Nord",
                "location": "Regal A",
                "occurredAt": "2026-08-10T10:00:00.000Z",
                "createdAt": "2026-08-10T10:01:00.000Z",
                "createdBy": "user-1"
              }],
              "units": [{
                "id": "55555555-5555-5555-5555-555555555555",
                "resourceId": "11111111-1111-1111-1111-111111111111",
                "code": "DRILL-001",
                "status": "available",
                "location": "Regal A",
                "metadata": {},
                "acquiredAt": "2026-08-01T10:00:00.000Z",
                "lastMovedAt": "2026-08-10T10:00:00.000Z",
                "createdAt": "2026-08-01T10:00:00.000Z",
                "updatedAt": "2026-08-10T10:00:00.000Z"
              }]
            }
            """#.utf8
        )

        let detail = try stockDecoder().decode(StockDetailResponse.self, from: data)

        XCTAssertEqual(detail.resource.quantity, 4)
        XCTAssertEqual(detail.config.trackingMode, .serialized)
        XCTAssertEqual(detail.forecast.suggestedReorderQuantity, 3)
        XCTAssertEqual(detail.procurement.openLines.first?.reference, "PO-42")
        XCTAssertEqual(detail.movements.first?.type, "issue")
        XCTAssertEqual(detail.units.first?.code, "DRILL-001")
    }

    func testMovementRequestEncodesFullBookingMetadata() throws {
        let date = Date(timeIntervalSince1970: 1_786_356_000)
        let request = StockMovementRequest(
            delta: -3,
            type: StockMovementType.issue.rawValue,
            reason: "Verbrauch",
            note: "Projekt Atlas",
            location: "Werkstatt",
            occurredAt: date
        )

        let object = try jsonObject(for: request)

        XCTAssertEqual(object["delta"] as? Int, -3)
        XCTAssertEqual(object["type"] as? String, "issue")
        XCTAssertEqual(object["reason"] as? String, "Verbrauch")
        XCTAssertEqual(object["note"] as? String, "Projekt Atlas")
        XCTAssertEqual(object["location"] as? String, "Werkstatt")
        XCTAssertNotNil(object["occurredAt"] as? String)
    }

    func testUnitPatchEncodesClearedLocationAsExplicitNull() throws {
        let request = StockUnitPatchRequest(
            status: .maintenance,
            location: nil,
            occurredAt: Date(timeIntervalSince1970: 1_786_356_000),
            reason: "Prüfung"
        )

        let object = try jsonObject(for: request)

        XCTAssertEqual(object["status"] as? String, "maintenance")
        XCTAssertTrue(object.keys.contains("location"))
        XCTAssertTrue(object["location"] is NSNull)
    }

    func testObjectCountResponseDecodesOneMarkerPerPart() throws {
        let data = Data(
            #"""
            {
              "count": 2,
              "confidence": 0.94,
              "detectedItem": "Unterlegscheiben",
              "isExact": true,
              "explanation": "Zwei Teile sind einzeln sichtbar.",
              "warnings": [],
              "markers": [
                { "x": 125, "y": 250 },
                { "x": 875, "y": 750 }
              ],
              "model": "vision-test"
            }
            """#.utf8
        )

        let result = try JSONDecoder().decode(ObjectCountResponse.self, from: data)

        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(
            result.markers,
            [ObjectCountMarker(x: 125, y: 250), ObjectCountMarker(x: 875, y: 750)]
        )
    }

    func testObjectCountResponseTreatsMissingMarkersAsEmptyForOlderServers() throws {
        let data = Data(
            #"""
            {
              "count": 1,
              "confidence": 0.8,
              "detectedItem": "Teil",
              "isExact": false,
              "explanation": "Ein Teil ist sichtbar.",
              "warnings": [],
              "model": "legacy-vision-test"
            }
            """#.utf8
        )

        let result = try JSONDecoder().decode(ObjectCountResponse.self, from: data)

        XCTAssertEqual(result.count, 1)
        XCTAssertTrue(result.markers.isEmpty)
    }

    func testInventoryRecognitionResponseDecodesRankedResourceMatches() throws {
        let data = Data(
            #"""
            {
              "detected": {
                "label": "Haartrockner",
                "category": "Elektrogerät",
                "brand": "Philips",
                "model": "Series 5000",
                "color": "schwarz",
                "material": "Kunststoff",
                "visibleText": ["Philips"],
                "searchTerms": ["Fön", "hair dryer"],
                "confidence": 0.95
              },
              "matches": [{
                "resourceId": "11111111-1111-1111-1111-111111111111",
                "confidence": 0.91,
                "reason": "Marke, Modell und Form stimmen überein.",
                "evidence": ["Philips", "schwarzes Gehäuse"],
                "resource": {
                  "id": "11111111-1111-1111-1111-111111111111",
                  "name": "Philips Series 5000 Haartrockner",
                  "description": "Fön im Materialschrank",
                  "type": "object",
                  "status": "available",
                  "sku": "BHD510",
                  "quantity": 1,
                  "location": "Bad",
                  "serialNumber": null,
                  "valueCents": 5900,
                  "currency": "EUR",
                  "priority": 3,
                  "tags": ["Fön"],
                  "categories": [],
                  "relatedResourceIds": [],
                  "gpsLatitude": null,
                  "gpsLongitude": null,
                  "gpsAltitude": null,
                  "notes": "",
                  "aiMetadata": null,
                  "createdBy": "test@example.com",
                  "createdAt": "2026-08-10T10:00:00.000Z",
                  "updatedAt": "2026-08-13T10:00:00.000Z",
                  "media": [],
                  "cover": null
                }
              }],
              "isConfident": true,
              "model": "vision-test",
              "catalog": { "considered": 42, "truncated": false }
            }
            """#.utf8
        )

        let response = try stockDecoder().decode(
            InventoryRecognitionResponse.self,
            from: data
        )

        XCTAssertEqual(response.detected?.label, "Haartrockner")
        XCTAssertEqual(response.matches.first?.resource.name, "Philips Series 5000 Haartrockner")
        XCTAssertEqual(response.matches.first?.confidence, 0.91)
        XCTAssertTrue(response.isConfident)
        XCTAssertEqual(response.catalog.considered, 42)
    }

    private func jsonObject<Value: Encodable>(for value: Value) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(value)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func stockDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid test date: \(value)"
            )
        }
        return decoder
    }
}
