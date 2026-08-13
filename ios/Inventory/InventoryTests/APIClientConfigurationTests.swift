import Foundation
import XCTest
@testable import Inventory

final class APIClientConfigurationTests: XCTestCase {
    func testReadOnlyCapabilitiesRemainUsable() {
        XCTAssertTrue(AppState.supportsInventory(scopes: ["read"]))
        XCTAssertTrue(AppState.supportsInventory(scopes: ["read", "write"]))
        XCTAssertFalse(AppState.supportsInventory(scopes: ["write"]))
        XCTAssertFalse(AppState.supportsInventory(scopes: []))
    }

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

    func testOrganizationScopedRequestsSendOrganizationHeader() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OrganizationHeaderURLProtocol.self]
        let organizationID = try XCTUnwrap(
            UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        )
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "organization-test-token"),
            organizationID: organizationID,
            session: URLSession(configuration: configuration)
        )

        let response = try await client.listResources(page: 1, pageSize: 1)

        XCTAssertTrue(response.resources.isEmpty)
        XCTAssertEqual(
            client.contextIdentifier,
            "https://inventory.example#aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#anonymous"
        )
    }

    func testOrganizationDiscoveryAndSelectionContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OrganizationEndpointsURLProtocol.self]
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "organization-test-token"),
            session: URLSession(configuration: configuration)
        )
        let organizationID = try XCTUnwrap(
            UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        )
        let selectionBody = try JSONEncoder().encode(
            OrganizationSelectionRequest(
                organizationID: organizationID.uuidString.lowercased()
            )
        )
        let selectionObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: selectionBody) as? [String: String]
        )

        let list = try await client.organizations()
        let selection = try await client.selectOrganization(id: organizationID)

        XCTAssertEqual(
            selectionObject,
            ["organizationId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]
        )
        XCTAssertEqual(list.activeOrganizationId, organizationID)
        XCTAssertEqual(list.organizations.map(\.id), [organizationID])
        XCTAssertEqual(selection.organization.id, organizationID)
        XCTAssertEqual(selection.organization.roleName, "Administrator")
    }

    func testAuthenticationPayloadsDecodeTheActiveOrganization() throws {
        let organization =
            #"{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Alpha","slug":"alpha","role":"admin","roleName":"Administrator"}"#
        let capabilities = try JSONDecoder().decode(
            CapabilitiesResponse.self,
            from: Data(
                "{\"name\":\"Ada\",\"principal\":\"principal-alpha\",\"scopes\":[\"read\"],\"organization\":\(organization),\"organizations\":[\(organization)]}".utf8
            )
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let login = try decoder.decode(
            LoginResponse.self,
            from: Data(
                "{\"token\":\"inv_test\",\"user\":{\"id\":\"user-1\",\"name\":\"Ada\",\"email\":\"ada@example.com\",\"role\":\"admin\"},\"scopes\":[\"read\"],\"expiresAt\":\"2026-08-13T12:00:00Z\",\"organization\":\(organization),\"organizations\":[\(organization)]}".utf8
            )
        )

        XCTAssertEqual(capabilities.activeOrganization?.id, login.activeOrganization?.id)
        XCTAssertEqual(capabilities.principal, "principal-alpha")
        XCTAssertEqual(login.activeOrganization?.name, "Alpha")
    }

    func testOrganizationHeaderIsLimitedToSameOriginMedia() async throws {
        let organizationID = try XCTUnwrap(
            UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        )
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "organization-test-token"),
            organizationID: organizationID
        )
        let protectedMedia = InventoryMedia(
            id: UUID(),
            resourceID: UUID(),
            url: "/api/files/item.jpg",
            name: "item.jpg",
            mimeType: "image/jpeg",
            kind: .image,
            position: 0,
            source: .upload
        )
        let externalMedia = InventoryMedia(
            id: UUID(),
            resourceID: UUID(),
            url: "https://cdn.example/item.jpg",
            name: "item.jpg",
            mimeType: "image/jpeg",
            kind: .image,
            position: 0,
            source: .upload
        )

        let protectedRequest = try await client.mediaRequest(for: protectedMedia)
        let externalRequest = try await client.mediaRequest(for: externalMedia)

        XCTAssertEqual(
            protectedRequest.value(forHTTPHeaderField: "X-Organization-ID"),
            organizationID.uuidString.lowercased()
        )
        XCTAssertEqual(protectedRequest.cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertNil(externalRequest.value(forHTTPHeaderField: "X-Organization-ID"))
        XCTAssertNil(externalRequest.value(forHTTPHeaderField: "Authorization"))
    }
}

private final class OrganizationHeaderURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard request.httpMethod == "GET",
              request.url?.path == "/api/v1/resources",
              request.value(forHTTPHeaderField: "Authorization")
                == "Bearer organization-test-token",
              request.value(forHTTPHeaderField: "X-Organization-ID")
                == "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
            #"{"resources":[],"pagination":{"page":1,"pageSize":1,"total":0,"pages":1}}"#.utf8
        )
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() { }
}

private final class OrganizationEndpointsURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard request.value(forHTTPHeaderField: "Authorization")
                == "Bearer organization-test-token",
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

        let organization =
            #"{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Alpha","slug":"alpha","role":"admin","roleName":"Administrator"}"#
        let body: Data
        switch (request.httpMethod, request.url?.path) {
        case ("GET", "/api/v1/organizations"):
            guard request.value(forHTTPHeaderField: "X-Organization-ID") == nil else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
                return
            }
            body = Data(
                "{\"organizations\":[\(organization)],\"activeOrganizationId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\"}".utf8
            )
        case ("POST", "/api/v1/organizations/select"):
            guard request.value(forHTTPHeaderField: "Content-Type") == "application/json" else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
                return
            }
            body = Data("{\"organization\":\(organization)}".utf8)
        default:
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() { }
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
