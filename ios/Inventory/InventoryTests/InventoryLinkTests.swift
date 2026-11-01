import XCTest
@testable import Inventory

final class InventoryLinkTests: XCTestCase {
    private let id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
    private let unit = "4f2504e0-4f89-41d3-9a0c-0305e82c3302"
    private let origin = "https://inventory.peoplelesspaper.de"

    func testDestinationURLPreservesResourceUnitAndServer() throws {
        let link = try XCTUnwrap(InventoryLink(url: URL(string: "\(origin)/r/PyUE4E-JQdOaDAMF6CwzAQ?unit=TyUE4E-JQdOaDAMF6CwzAg")!))
        XCTAssertEqual(link.resourceID, UUID(uuidString: id))
        XCTAssertEqual(link.unitID, UUID(uuidString: unit))
        XCTAssertEqual(link.serverURL?.absoluteString, origin)
        XCTAssertTrue(link.matches(server: URL(string: "\(origin):443/")!))
        XCTAssertFalse(link.matches(server: URL(string: "https://other.example")!))
        XCTAssertFalse(link.matches(server: URL(string: "http://inventory.peoplelesspaper.de")!))
        XCTAssertFalse(link.matches(server: URL(string: "\(origin):8443")!))
        XCTAssertFalse(link.matches(server: URL(string: "\(origin)/other-installation")!))
    }

    func testSelfHostedButtonPreservesOrganizationAndUnit() throws {
        var url = URLComponents(string: "inventory://open")!
        url.queryItems = [URLQueryItem(name: "url", value: "\(origin)/warehouse/inventory/\(id)/stock?unit=\(unit)")]
        let link = try XCTUnwrap(InventoryLink(url: url.url!))
        XCTAssertEqual(link.organization, "warehouse")
        XCTAssertEqual(link.resourceID, UUID(uuidString: id))
        XCTAssertEqual(link.unitID, UUID(uuidString: unit))
        XCTAssertFalse(link.matches(organization: nil))
    }

    func testLegacySchemeStillWorksOnTheActiveServer() throws {
        let link = try XCTUnwrap(InventoryLink(url: URL(string: "inventory://resource/\(id)")!))
        XCTAssertEqual(link.resourceID, UUID(uuidString: id))
        XCTAssertNil(link.serverURL)
        XCTAssertTrue(link.matches(server: URL(string: origin)!))
    }

    func testRejectsMalformedAndAmbiguousExternalLinks() {
        for value in [
            "\(origin)/r/PyUE4E-JQdOaDAMF6CwzAR",
            "\(origin)/r/PyUE4E-JQdOaDAMF6CwzAQ/extra",
            "\(origin)/r/PyUE4E-JQdOaDAMF6CwzAQ?unit=TyUE4E-JQdOaDAMF6CwzAg/extra",
            "\(origin)/r/PyUE4E-JQdOaDAMF6CwzAQ?unit=bad",
            "\(origin)/inventory/\(id)?unit=\(unit)&unit=\(unit)",
            "\(origin)/inventory/\(id)?unit=inventory://resource/\(unit)",
            "\(origin)/settings", "\(origin)/inventory/new",
            "\(origin)/inventory/\(id)/edit", "\(origin)/scan?id=\(id)",
            "https://user:password@inventory.peoplelesspaper.de/inventory/\(id)",
            "inventory://open?url=inventory://resource/\(id)",
            "inventory://open?url=https://example.com&url=https://example.org",
            "file:///inventory/\(id)",
        ] {
            XCTAssertNil(InventoryLink(url: URL(string: value)!), value)
        }
    }
}
