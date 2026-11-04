import XCTest
@testable import Inventory

final class LocalizationTests: XCTestCase {
    func testBothLanguagesResolveFromTheAppBundle() throws {
        for (language, expected) in [("en", "Sign in"), ("de", "Anmelden")] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
            let bundle = try XCTUnwrap(Bundle(path: path))
            XCTAssertEqual(bundle.localizedString(forKey: "ui_sign_in_a329a322", value: nil, table: nil), expected)
            XCTAssertNotEqual(bundle.localizedString(forKey: "NSCameraUsageDescription", value: nil, table: "InfoPlist"), "NSCameraUsageDescription")
        }
    }

    func testInterpolationPreservesUserContentAndSupportsReordering() {
        XCTAssertEqual(L10n.render("{1} / {0}", arguments: ["Part {1}", 12]), "12 / Part {1}")
        XCTAssertEqual(L10n.render("{0} · {1}", arguments: ["50%", "$5"]), "50% · $5")
        XCTAssertEqual(L10n.render("{3}", arguments: ["one"]), "{3}")
    }
}
