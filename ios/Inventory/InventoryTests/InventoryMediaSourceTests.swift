import Foundation
import XCTest
@testable import Inventory

final class InventoryMediaSourceTests: XCTestCase {
    func testDemoMediaAndFutureServerSourcesDoNotBreakInventoryDecoding() throws {
        for (source, expected) in [
            ("demo-imagegen", InventoryMediaSource.demoImagegen),
            ("future-server-import", .unknown),
            ("upload", .upload),
            ("ai", .ai),
        ] {
            let json = """
            {"id":"d3e00000-0000-4000-8000-000000000801",
             "resourceId":"d3e00000-0000-4000-8000-000000000201",
             "url":"/api/files/demo/drill.webp","name":"drill.webp",
             "mimeType":"image/webp","kind":"image","position":0,
             "altText":"Demo drill","source":"\(source)"}
            """.data(using: .utf8)!
            let media = try JSONDecoder().decode(InventoryMedia.self, from: json)
            XCTAssertEqual(media.source, expected)
            XCTAssertEqual(media.url, "/api/files/demo/drill.webp")
            XCTAssertEqual(media.kind, .image)
        }
    }

    func testKnownDemoSourceSurvivesEncoding() throws {
        let data = try JSONEncoder().encode(InventoryMediaSource.demoImagegen)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "\"demo-imagegen\"")
    }
}
