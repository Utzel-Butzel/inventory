import Foundation
import XCTest
@testable import Inventory

final class APIClientConfigurationTests: XCTestCase {
    func testServerURLAcceptsDeploymentRootOrAPIBase() throws {
        let store = InMemoryCredentialStore(token: "inv_test_token_abcdefghijklmnopqrstuvwxyz")
        let root = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example/")),
            credentialStore: store
        )
        let apiBase = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example/api/v1/")),
            credentialStore: store
        )

        XCTAssertEqual(root.serverURL.absoluteString, "https://inventory.example/")
        XCTAssertEqual(apiBase.serverURL.absoluteString, "https://inventory.example/")
        XCTAssertEqual(apiBase.apiBaseURL.absoluteString, "https://inventory.example/api/v1/")
    }

    func testMediaURLRejectsNonHTTPProtocols() throws {
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "inv_test_token_abcdefghijklmnopqrstuvwxyz")
        )

        XCTAssertThrowsError(try client.resolveMediaURL("file:///private/secret.jpg"))
        XCTAssertThrowsError(try client.resolveMediaURL("data:image/png;base64,AA=="))
    }

    func testPlainHTTPIsLimitedToLocalDevelopmentHosts() throws {
        XCTAssertNoThrow(
            try APIClient(
                serverURL: XCTUnwrap(URL(string: "http://localhost:3000")),
                credentialStore: InMemoryCredentialStore(token: "inv_test_token_abcdefghijklmnopqrstuvwxyz")
            )
        )
        XCTAssertThrowsError(
            try APIClient(
                serverURL: XCTUnwrap(URL(string: "http://inventory.example")),
                credentialStore: InMemoryCredentialStore(token: "inv_test_token_abcdefghijklmnopqrstuvwxyz")
            )
        )
    }
}
