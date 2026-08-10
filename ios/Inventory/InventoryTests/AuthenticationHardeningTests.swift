import Foundation
import XCTest
@testable import Inventory

final class AuthenticationHardeningTests: XCTestCase {
    func testUnauthorizedResponseInvokesClientCallback() async throws {
        let recorder = UnauthorizedRecorder()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UnauthorizedURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "old-device-token"),
            session: session,
            onUnauthorized: {
                await recorder.record()
            }
        )

        do {
            _ = try await client.capabilities()
            XCTFail("Expected a 401 response")
        } catch let error as APIClientError {
            XCTAssertEqual(error.statusCode, 401)
        }
        let callbackCount = await recorder.count
        XCTAssertEqual(callbackCount, 1)
    }

    func testExternalCredentialFreeMedia401DoesNotInvokeClientCallback() async throws {
        let recorder = UnauthorizedRecorder()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UnauthorizedURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "active-device-token"),
            session: session,
            onUnauthorized: { await recorder.record() }
        )
        let media = InventoryMedia(
            id: UUID(),
            resourceID: UUID(),
            url: "https://cdn.example/item.jpg",
            name: "item.jpg",
            mimeType: "image/jpeg",
            kind: .image,
            position: 0,
            source: .upload
        )

        do {
            _ = try await client.mediaData(for: media)
            XCTFail("Expected a 401 response")
        } catch let error as APIClientError {
            XCTAssertEqual(error.statusCode, 401)
        }
        let callbackCount = await recorder.count
        XCTAssertEqual(callbackCount, 0)
    }

    func testConditionalDeleteCannotRemoveNewerCredential() async throws {
        let store = InMemoryCredentialStore(token: "old-device-token")
        try await store.saveBearerToken("new-device-token")

        let deleted = try await store.deleteBearerToken(matching: "old-device-token")

        XCTAssertFalse(deleted)
        let storedToken = try await store.loadBearerToken()
        XCTAssertEqual(storedToken, "new-device-token")
    }

    func testRedirectPolicyAllowsOnlySameOrigin() throws {
        let origin = try XCTUnwrap(URL(string: "https://inventory.example/app"))
        let policy = SameOriginRedirectDelegate(allowedOrigin: origin)

        XCTAssertTrue(policy.allowsRedirect(to: try XCTUnwrap(
            URL(string: "https://inventory.example/api/v1/resources")
        )))
        XCTAssertTrue(policy.allowsRedirect(to: try XCTUnwrap(
            URL(string: "https://inventory.example:443/api/v1/resources")
        )))
        XCTAssertFalse(policy.allowsRedirect(to: try XCTUnwrap(
            URL(string: "http://inventory.example/api/v1/resources")
        )))
        XCTAssertFalse(policy.allowsRedirect(to: try XCTUnwrap(
            URL(string: "https://inventory.example:8443/api/v1/resources")
        )))
        XCTAssertFalse(policy.allowsRedirect(to: try XCTUnwrap(
            URL(string: "https://other.example/api/v1/resources")
        )))
    }

    func testRedirectPolicyAllowsCredentialFreeHTTPSCDNRedirect() throws {
        let policy = SameOriginRedirectDelegate(
            allowedOrigin: try XCTUnwrap(URL(string: "https://inventory.example"))
        )
        let externalRequest = URLRequest(
            url: try XCTUnwrap(URL(string: "https://images.example/item.jpg"))
        )
        let httpsRedirect = URLRequest(
            url: try XCTUnwrap(URL(string: "https://cdn.example/item.jpg"))
        )
        let downgrade = URLRequest(
            url: try XCTUnwrap(URL(string: "http://cdn.example/item.jpg"))
        )

        XCTAssertNotNil(policy.redirectedRequest(from: externalRequest, to: httpsRedirect))
        XCTAssertNil(policy.redirectedRequest(from: externalRequest, to: downgrade))
    }

    func testRedirectPolicyBlocksCredentialedCrossOriginRedirect() throws {
        let policy = SameOriginRedirectDelegate(
            allowedOrigin: try XCTUnwrap(URL(string: "https://inventory.example"))
        )
        var original = URLRequest(
            url: try XCTUnwrap(URL(string: "https://inventory.example/api/v1/resources"))
        )
        original.setValue("Bearer secret", forHTTPHeaderField: "Authorization")
        let redirected = URLRequest(
            url: try XCTUnwrap(URL(string: "https://other.example/collect"))
        )

        XCTAssertNil(policy.redirectedRequest(from: original, to: redirected))
    }

    func testQueueTreatsUnauthorizedAsPausedAuthentication() {
        XCTAssertTrue(IntakeQueue.requiresAuthentication(
            APIClientError.http(statusCode: 401, message: "Unauthorized", retryAfter: nil)
        ))
        XCTAssertFalse(IntakeQueue.requiresAuthentication(
            APIClientError.http(statusCode: 500, message: "Server error", retryAfter: nil)
        ))
        XCTAssertFalse(IntakeQueue.requiresAuthentication(
            APIClientError.transport("Offline")
        ))
    }
}

private actor UnauthorizedRecorder {
    private(set) var count = 0

    func record() {
        count += 1
    }
}

private final class UnauthorizedURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url,
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: 401,
                  httpVersion: "HTTP/1.1",
                  headerFields: ["Content-Type": "application/json"]
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"error":"Unauthorized"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
