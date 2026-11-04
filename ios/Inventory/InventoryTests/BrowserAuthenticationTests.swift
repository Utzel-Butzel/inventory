import XCTest
@testable import Inventory

final class BrowserAuthenticationTests: XCTestCase {
    private let state = String(repeating: "s", count: 43)
    private let code = String(repeating: "c", count: 43)

    func testProviderDiscoveryUsesSelectedDomainWithoutCredentials() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthOptionsURLProtocol.self]
        let session = URLSession(configuration: configuration)
        for (host, enabled) in [("configured.example", true), ("other.example", false)] {
            let client = try APIClient(serverURL: XCTUnwrap(URL(string: "https://\(host)")),
                credentialStore: InMemoryCredentialStore(token: "must-not-be-forwarded"), session: session)
            let options = try await client.authOptions()
            XCTAssertEqual(options.browserSignIn, enabled)
            XCTAssertEqual(options.passwordEnabled, !enabled)
            XCTAssertEqual(options.providers.map(\.name), enabled ? ["Konglomerat"] : [])
        }
    }

    func testPKCEUsesRFC7636S256Vector() {
        let attempt = BrowserSignInAttempt(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state: state)
        XCTAssertEqual(attempt.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testAttemptsHaveIndependentVerifierAndState() throws {
        let first = try BrowserSignInAttempt(), second = try BrowserSignInAttempt()
        XCTAssertEqual(first.verifier.count, 43)
        XCTAssertEqual(first.state.count, 43)
        XCTAssertNotEqual(first.verifier, first.state)
        XCTAssertNotEqual(first.verifier, second.verifier)
        XCTAssertNotEqual(first.state, second.state)
    }

    func testAuthorizationStaysOnChosenDeploymentAndDoesNotExposeVerifier() throws {
        let attempt = try BrowserSignInAttempt()
        let url = try attempt.authorizationURL(serverURL: XCTUnwrap(URL(string: "https://inventory.example/base")), requestID: state)
        XCTAssertEqual(url.host, "inventory.example")
        XCTAssertEqual(url.path, "/base/api/v1/auth/browser/authorize")
        XCTAssertFalse(url.absoluteString.contains(attempt.verifier))
        XCTAssertThrowsError(try attempt.authorizationURL(serverURL: url, requestID: "invalid"))
    }

    func testCallbackAcceptsOnlyMatchingStateAndExactDestination() throws {
        let attempt = BrowserSignInAttempt(verifier: state, state: state)
        let valid = "de.polyxo.openinventory://auth/callback?state=\(state)&code=\(code)"
        XCTAssertEqual(try attempt.code(from: XCTUnwrap(URL(string: valid))), code)
        for invalid in [
            valid.replacingOccurrences(of: "de.polyxo.openinventory:", with: "inventory:"),
            valid.replacingOccurrences(of: "//auth/", with: "//evil/"),
            valid.replacingOccurrences(of: "/callback?", with: "/other?"),
            valid.replacingOccurrences(of: "state=\(state)", with: "state=wrong"),
            valid + "&state=\(state)", valid + "&token=secret", valid + "#fragment",
            valid.replacingOccurrences(of: "code=\(code)", with: "code=short"),
            valid.replacingOccurrences(of: "//auth/", with: "//user@auth/")
        ] {
            XCTAssertThrowsError(try attempt.code(from: XCTUnwrap(URL(string: invalid))), invalid)
        }
    }

    func testDenialCancelsOnlyTheMatchingAttempt() throws {
        let attempt = BrowserSignInAttempt(verifier: state, state: state)
        let url = try XCTUnwrap(URL(string: "de.polyxo.openinventory://auth/callback?state=\(state)&error=access_denied"))
        XCTAssertThrowsError(try attempt.code(from: url)) { XCTAssertTrue($0 is CancellationError) }
    }

    func testSSOCallbackDoesNotOpenAnInventoryResource() throws {
        let url = try XCTUnwrap(URL(string: "de.polyxo.openinventory://auth/callback?state=\(state)&code=\(code)"))
        XCTAssertNil(InventoryLink(url: url))
    }
}

private final class AuthOptionsURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.url?.path, "/api/v1/auth/options")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(request.value(forHTTPHeaderField: "X-Organization-ID"))
        XCTAssertFalse(request.httpShouldHandleCookies)
        let configured = request.url?.host == "configured.example"
        let data = (configured
            ? #"{"passwordEnabled":false,"browserSignIn":true,"providers":[{"id":"supabase","name":"Konglomerat"}]}"#
            : #"{"passwordEnabled":true,"browserSignIn":false,"providers":[]}"#).data(using: .utf8)!
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
