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

    func testDeleteResourceUsesResourceDeleteEndpoint() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DeleteResourceURLProtocol.self]
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "delete-test-token"),
            session: URLSession(configuration: configuration)
        )
        let resourceID = try XCTUnwrap(UUID(uuidString: "11111111-1111-1111-1111-111111111111"))

        try await client.deleteResource(id: resourceID)
    }

    func testRecognitionUsesProtectedMultipartEndpointAndIdempotencyKey() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecognitionURLProtocol.self]
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "recognition-test-token"),
            session: URLSession(configuration: configuration)
        )
        let imageURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")
        try Data([0xff, 0xd8, 0xff, 0xd9]).write(to: imageURL)
        defer { try? FileManager.default.removeItem(at: imageURL) }
        let idempotencyKey = try XCTUnwrap(
            UUID(uuidString: "22222222-2222-4222-8222-222222222222")
        )

        let result = try await client.recognizeInventoryObject(
            in: MediaUploadFile(fileURL: imageURL),
            idempotencyKey: idempotencyKey
        )

        XCTAssertTrue(result.matches.isEmpty)
        XCTAssertEqual(result.catalog.considered, 0)
    }
}

private final class DeleteResourceURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard request.httpMethod == "DELETE",
              request.url?.path == "/api/v1/resources/11111111-1111-1111-1111-111111111111",
              request.value(forHTTPHeaderField: "Authorization") == "Bearer delete-test-token",
              let url = request.url,
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: 204,
                  httpVersion: "HTTP/1.1",
                  headerFields: nil
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() { }
}

private final class RecognitionURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let contentType = request.value(forHTTPHeaderField: "Content-Type") ?? ""
        guard request.httpMethod == "POST",
              request.url?.path == "/api/v1/ai/recognize",
              request.value(forHTTPHeaderField: "Authorization")
                == "Bearer recognition-test-token",
              request.value(forHTTPHeaderField: "Idempotency-Key")
                == "22222222-2222-4222-8222-222222222222",
              contentType.hasPrefix("multipart/form-data; boundary="),
              let url = request.url,
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: 200,
                  httpVersion: "HTTP/1.1",
                  headerFields: ["Content-Type": "application/json"]
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        let body = Data(
            #"{"detected":null,"matches":[],"isConfident":false,"model":null,"catalog":{"considered":0,"truncated":false}}"#.utf8
        )
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() { }
}
