import Foundation
import XCTest
@testable import Inventory

final class SpatialRoomSceneContractTests: XCTestCase {
    func testRoomSceneDecodesWebViewerContract() throws {
        let data = Data(
            #"""
            {
              "scene": {
                "room": {
                  "id": "11111111-1111-1111-1111-111111111111",
                  "name": "Werkstatt",
                  "description": "Mit RoomPlan erfasster 3D-Raum."
                },
                "scan": {
                  "id": "22222222-2222-2222-2222-222222222222",
                  "revision": 3,
                  "status": "active",
                  "scene": {
                    "schemaVersion": 1,
                    "coordinateSystem": "arkit-right-handed-y-up",
                    "units": "meter",
                    "matrixOrder": "column-major",
                    "worldFromModel": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    "webFromWorld": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    "bounds": { "min": [-2, 0, -3], "max": [2, 2.5, 3] },
                    "surfaces": [{
                      "id": "33333333-3333-3333-3333-333333333333",
                      "category": "floor",
                      "dimensions": [4, 0, 6],
                      "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                      "polygonCorners": [[-2, -3, 0], [2, -3, 0], [2, 3, 0], [-2, 3, 0]],
                      "confidence": "high"
                    }],
                    "objects": []
                  },
                  "capturedAt": "2026-08-12T10:00:00.000Z",
                  "deviceModel": "iPhone",
                  "assets": []
                },
                "placements": [{
                  "id": "44444444-4444-4444-4444-444444444444",
                  "resource": {
                    "id": "55555555-5555-5555-5555-555555555555",
                    "name": "Bohrmaschine",
                    "description": "Akku-Bohrmaschine",
                    "type": "equipment",
                    "status": "available",
                    "location": "Werkbank",
                    "cover": null
                  },
                  "position": [0.5, 0.8, -1.2],
                  "orientation": [0, 0, 0, 1],
                  "extent": [0.3, 0.4, 0.2],
                  "confidence": 0.92,
                  "method": "scene-depth",
                  "anchorIdentifier": null,
                  "capturedAt": "2026-08-12T10:01:00.000Z",
                  "updatedAt": "2026-08-12T10:01:00.000Z"
                }]
              }
            }
            """#.utf8
        )

        let response = try decoder().decode(SpatialRoomSceneResponse.self, from: data)

        XCTAssertEqual(response.scene.room.name, "Werkstatt")
        XCTAssertEqual(response.scene.scan.revision, 3)
        XCTAssertEqual(response.scene.scan.scene.surfaces.first?.category, "floor")
        XCTAssertEqual(response.scene.scan.scene.surfaces.first?.polygonCorners?.count, 4)
        XCTAssertEqual(response.scene.placements.first?.resource.name, "Bohrmaschine")
        XCTAssertEqual(response.scene.placements.first?.position, [0.5, 0.8, -1.2])
    }

    private func decoder() -> JSONDecoder {
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
                debugDescription: "Ungültiges Testdatum: \(value)"
            )
        }
        return decoder
    }
}
