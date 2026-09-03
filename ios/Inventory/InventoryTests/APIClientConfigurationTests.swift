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

    func testFeatureParityRequestsFollowWebAPIContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FeatureParityURLProtocol.self]
        let organizationID = try XCTUnwrap(
            UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        )
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "feature-parity-test-token"),
            organizationID: organizationID,
            session: URLSession(configuration: configuration)
        )
        let notificationID = try XCTUnwrap(
            UUID(uuidString: "22222222-2222-4222-8222-222222222222")
        )
        let resourceID = try XCTUnwrap(
            UUID(uuidString: "11111111-1111-4111-8111-111111111111")
        )
        let assignmentID = try XCTUnwrap(
            UUID(uuidString: "33333333-3333-4333-8333-333333333333")
        )
        let assignmentIdempotencyKey = try XCTUnwrap(
            UUID(uuidString: "44444444-4444-4444-8444-444444444444")
        )

        let favorites = try await client.listResources(
            favoritesOnly: true,
            page: 1,
            pageSize: 1
        )
        let inbox = try await client.listNotifications(limit: 25, unreadOnly: true)
        let updated = try await client.markNotificationRead(id: notificationID)
        let allRead = try await client.markAllNotificationsRead()
        let favorite = try await client.setResourceFavorite(
            resourceID: resourceID,
            favorite: true
        )
        let settings = try await client.notificationSettings()
        var preference = settings.preference
        preference.frequency = .immediate
        let savedSettings = try await client.updateNotificationSettings(
            NotificationPreferenceUpdateRequest(preference: preference)
        )
        let preview = try await client.previewNotificationChannel(.email)
        let loans = try await client.listLoans()
        try await client.completeAssignment(
            id: assignmentID,
            status: .returned,
            idempotencyKey: assignmentIdempotencyKey
        )

        XCTAssertEqual(favorites.resources.first?.id, resourceID)
        XCTAssertEqual(favorites.resources.first?.isFavorite, true)
        XCTAssertEqual(inbox.unread, 1)
        XCTAssertEqual(inbox.notifications.first?.resourceID, resourceID)
        XCTAssertNil(inbox.notifications.first?.readAt)
        XCTAssertNotNil(updated.notification.readAt)
        XCTAssertEqual(allRead.updated, 1)
        XCTAssertTrue(favorite.favorite)
        XCTAssertEqual(settings.preference.timezone, "Europe/Berlin")
        XCTAssertEqual(savedSettings.preference.frequency, .immediate)
        XCTAssertTrue(preview.preview.dryRun)
        XCTAssertEqual(preview.preview.channel, .email)
        XCTAssertEqual(loans.assignments.first?.id, assignmentID)
        XCTAssertEqual(loans.assignments.first?.resourceId, resourceID)
        XCTAssertEqual(loans.assignments.first?.assignee.label, "Ada")
        XCTAssertEqual(loans.assignments.first?.kind, .checkout)
        XCTAssertTrue(loans.capabilities.canManage)
    }

    func testResourceAssignmentRequestsFollowWebAPIContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ResourceAssignmentsURLProtocol.self]
        let resourceID = try XCTUnwrap(
            UUID(uuidString: "11111111-1111-4111-8111-111111111111")
        )
        let assignmentID = try XCTUnwrap(
            UUID(uuidString: "33333333-3333-4333-8333-333333333333")
        )
        let unitID = try XCTUnwrap(
            UUID(uuidString: "66666666-6666-4666-8666-666666666666")
        )
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "assignment-test-token"),
            organizationID: try XCTUnwrap(
                UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
            ),
            session: URLSession(configuration: configuration)
        )
        let startsAt = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-03T08:00:00Z"))
        let dueAt = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-10T08:00:00Z"))

        let assignments = try await client.resourceAssignments(resourceID: resourceID)
        try await client.createResourceAssignment(
            resourceID: resourceID,
            input: ResourceAssignmentCreateRequest(
                kind: .checkout,
                quantity: 1,
                stockUnitId: unitID,
                recipient: .label(" Werkstatt "),
                startsAt: startsAt,
                dueAt: dueAt,
                note: " Ausgabe "
            ),
            idempotencyKey: try XCTUnwrap(
                UUID(uuidString: "77777777-7777-4777-8777-777777777777")
            )
        )
        let lending = try await client.updateResourceLendingSettings(
            resourceID: resourceID,
            settings: ResourceLendingSettings(
                enabled: true,
                approvalRequired: false,
                defaultDurationDays: 5,
                maxDurationDays: 20
            )
        )
        try await client.activateReservation(
            id: assignmentID,
            stockUnitID: unitID,
            idempotencyKey: try XCTUnwrap(
                UUID(uuidString: "88888888-8888-4888-8888-888888888888")
            )
        )
        try await client.completeAssignment(
            id: assignmentID,
            status: .cancelled,
            idempotencyKey: try XCTUnwrap(
                UUID(uuidString: "99999999-9999-4999-8999-999999999999")
            )
        )

        XCTAssertEqual(assignments.resource.id, resourceID)
        XCTAssertEqual(assignments.trackingMode, .serialized)
        XCTAssertEqual(assignments.availableUnits.first?.id, unitID)
        XCTAssertEqual(assignments.assignments.first?.kind, .reservation)
        XCTAssertEqual(assignments.assignments.first?.assignee.label, "Ada")
        XCTAssertTrue(assignments.lending.enabled)
        XCTAssertEqual(lending.lending.defaultDurationDays, 5)
        XCTAssertEqual(lending.lending.maxDurationDays, 20)
    }

    func testInternalRequestRequestsFollowWebAPIContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [InternalRequestsURLProtocol.self]
        let requestID = try XCTUnwrap(
            UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        )
        let client = try APIClient(
            serverURL: try XCTUnwrap(URL(string: "https://inventory.example")),
            credentialStore: InMemoryCredentialStore(token: "internal-request-test-token"),
            organizationID: try XCTUnwrap(
                UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
            ),
            session: URLSession(configuration: configuration)
        )
        let resourceID = try XCTUnwrap(
            UUID(uuidString: "11111111-1111-4111-8111-111111111111")
        )
        let startsAt = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-09-03T08:00:00Z")
        )
        let dueAt = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-09-10T08:00:00Z")
        )

        let loanable = try await client.listResources(
            query: "Akku",
            loanableOnly: true,
            page: 1,
            pageSize: 8
        )
        let list = try await client.listInternalRequests(
            limit: 200,
            status: .submitted,
            mineOnly: true
        )
        let detail = try await client.internalRequest(id: requestID)
        let created = try await client.createInternalRequest(
            input: InternalRequestCreateRequest(
                deliveryResourceId: try XCTUnwrap(
                    UUID(uuidString: "ffffffff-ffff-4fff-8fff-ffffffffffff")
                ),
                startsAt: startsAt,
                dueAt: dueAt,
                note: " Bitte bereitstellen ",
                lines: [
                    InternalRequestCreateLineRequest(
                        resourceId: resourceID,
                        quantity: 2,
                        note: " Mit Akku "
                    ),
                ]
            ),
            idempotencyKey: try XCTUnwrap(
                UUID(uuidString: "99999999-9999-4999-8999-999999999999")
            )
        )
        let approved = try await client.transitionInternalRequest(
            id: requestID,
            action: .approve,
            note: " Freigegeben "
        )

        XCTAssertEqual(loanable.resources.first?.id, resourceID)
        XCTAssertEqual(list.requests.first?.id, requestID)
        XCTAssertEqual(list.requests.first?.reference, "REQ-2026-0042")
        XCTAssertEqual(list.requests.first?.requester.name, "Ada")
        XCTAssertEqual(list.requests.first?.delivery?.name, "Werkstatt")
        XCTAssertEqual(list.requests.first?.lines.first?.resource.name, "Akkuschrauber")
        XCTAssertEqual(list.requests.first?.events.first?.type, .submitted)
        XCTAssertTrue(list.requests.first?.canCancel == true)
        XCTAssertTrue(list.capabilities.canCreate)
        XCTAssertTrue(list.capabilities.canManage)
        XCTAssertEqual(detail.request.id, requestID)
        XCTAssertEqual(created.request.id, requestID)
        XCTAssertEqual(approved.request.status, .approved)
        XCTAssertEqual(approved.request.decisionNote, "Freigegeben")
    }
}

private final class InternalRequestsURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard request.value(forHTTPHeaderField: "Authorization")
                == "Bearer internal-request-test-token",
              request.value(forHTTPHeaderField: "X-Organization-ID")
                == "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              let url = request.url else {
            fail()
            return
        }

        let submitted = requestJSON(status: "submitted", decisionNote: "")
        let approved = requestJSON(status: "approved", decisionNote: "Freigegeben")
        let responseBody: Data
        var statusCode = 200

        switch (request.httpMethod, url.path) {
        case ("GET", "/api/v1/resources"):
            let query = queryValues(for: url)
            guard query == [
                "page": "1",
                "pageSize": "8",
                "q": "Akku",
                "loanable": "true",
            ] else {
                fail()
                return
            }
            let resource = #"{"id":"11111111-1111-4111-8111-111111111111","name":"Akkuschrauber","description":"","type":"tool","status":"available","sku":"AKKU-1","quantity":3,"currency":"EUR","priority":3,"tags":[],"categories":[],"relatedResourceIds":[],"notes":"","createdAt":"2026-09-02T08:00:00Z","updatedAt":"2026-09-02T08:00:00Z","media":[],"cover":null}"#
            responseBody = Data(
                "{\"resources\":[\(resource)],\"pagination\":{\"page\":1,\"pageSize\":8,\"total\":1,\"pages\":1}}".utf8
            )
        case ("GET", "/api/v1/internal-requests"):
            let query = queryValues(for: url)
            guard query == [
                "limit": "200",
                "status": "submitted",
                "mine": "true",
            ] else {
                fail()
                return
            }
            responseBody = Data(
                "{\"requests\":[\(submitted)],\"capabilities\":{\"canCreate\":true,\"canManage\":true}}".utf8
            )
        case ("GET", "/api/v1/internal-requests/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"):
            responseBody = Data("{\"request\":\(submitted)}".utf8)
        case ("POST", "/api/v1/internal-requests"):
            guard request.value(forHTTPHeaderField: "Content-Type") == "application/json",
                  request.value(forHTTPHeaderField: "Idempotency-Key")
                    == "99999999-9999-4999-8999-999999999999",
                  let object = requestObject(),
                  object["deliveryResourceId"] as? String
                    == "ffffffff-ffff-4fff-8fff-ffffffffffff",
                  object["startsAt"] as? String != nil,
                  object["dueAt"] as? String != nil,
                  object["note"] as? String == "Bitte bereitstellen",
                  let lines = object["lines"] as? [[String: Any]],
                  lines.count == 1,
                  lines[0]["resourceId"] as? String
                    == "11111111-1111-4111-8111-111111111111",
                  lines[0]["quantity"] as? Int == 2,
                  lines[0]["note"] as? String == "Mit Akku" else {
                fail()
                return
            }
            statusCode = 201
            responseBody = Data("{\"request\":\(submitted)}".utf8)
        case ("PATCH", "/api/v1/internal-requests/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"):
            guard request.value(forHTTPHeaderField: "Content-Type") == "application/json",
                  request.value(forHTTPHeaderField: "Idempotency-Key") == nil,
                  let object = requestObject(),
                  object["action"] as? String == "approve",
                  object["note"] as? String == "Freigegeben" else {
                fail()
                return
            }
            responseBody = Data("{\"request\":\(approved)}".utf8)
        default:
            fail()
            return
        }

        guard let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        ) else {
            fail()
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() { }

    private func requestObject() -> [String: Any]? {
        guard let body = request.httpBody else { return nil }
        return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    }

    private func queryValues(for url: URL) -> [String: String] {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        return Dictionary(
            uniqueKeysWithValues: (components?.queryItems ?? []).map {
                ($0.name, $0.value ?? "")
            }
        )
    }

    private func requestJSON(status: String, decisionNote: String) -> String {
        let event = #"{"id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","type":"submitted","actor":"ada@example.com","note":"Bitte bereitstellen","occurredAt":"2026-09-02T08:00:00Z"}"#
        let line = #"{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","resource":{"id":"11111111-1111-4111-8111-111111111111","name":"Akkuschrauber","sku":"AKKU-1","status":"available","currentQuantity":3,"trackingMode":"bulk"},"quantity":1,"note":"Mit Akku","createdAt":"2026-09-02T08:00:00Z","updatedAt":"2026-09-02T08:00:00Z"}"#
        return "{\"id\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\",\"reference\":\"REQ-2026-0042\",\"status\":\"\(status)\",\"requester\":{\"userId\":\"cccccccc-cccc-4ccc-8ccc-cccccccccccc\",\"name\":\"Ada\",\"email\":\"ada@example.com\"},\"delivery\":{\"resourceId\":\"ffffffff-ffff-4fff-8fff-ffffffffffff\",\"name\":\"Werkstatt\"},\"startsAt\":\"2026-09-03T08:00:00Z\",\"dueAt\":\"2026-09-10T08:00:00Z\",\"note\":\"Bitte bereitstellen\",\"decisionNote\":\"\(decisionNote)\",\"decidedBy\":null,\"decidedAt\":null,\"fulfilledBy\":null,\"fulfilledAt\":null,\"createdBy\":\"ada@example.com\",\"createdAt\":\"2026-09-02T08:00:00Z\",\"updatedAt\":\"2026-09-02T08:00:00Z\",\"canCancel\":true,\"lines\":[\(line)],\"events\":[\(event)]}"
    }

    private func fail() {
        client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
    }
}

private final class ResourceAssignmentsURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard request.value(forHTTPHeaderField: "Authorization")
                == "Bearer assignment-test-token",
              request.value(forHTTPHeaderField: "X-Organization-ID")
                == "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              let url = request.url else {
            fail()
            return
        }

        let assignment = #"{"id":"33333333-3333-4333-8333-333333333333","resourceId":"11111111-1111-4111-8111-111111111111","stockUnitId":null,"kind":"reservation","status":"active","stockApplied":false,"overdue":false,"quantity":1,"assignee":{"type":"user","id":"55555555-5555-4555-8555-555555555555","label":"Ada","detail":"ada@example.com"},"stockUnit":null,"startsAt":"2026-09-03T08:00:00Z","dueAt":"2026-09-10T08:00:00Z","completedAt":null,"note":"Werkstatt","createdBy":"user:ada","completedBy":null,"createdAt":"2026-09-02T08:00:00Z","updatedAt":"2026-09-02T08:00:00Z"}"#
        let responseBody: Data
        let statusCode: Int

        switch (request.httpMethod, url.path) {
        case ("GET", "/api/v1/resources/11111111-1111-4111-8111-111111111111/assignments"):
            responseBody = Data(
                "{\"resource\":{\"id\":\"11111111-1111-4111-8111-111111111111\",\"name\":\"Akkuschrauber\",\"quantity\":2},\"trackingMode\":\"serialized\",\"lending\":{\"enabled\":true,\"approvalRequired\":true,\"defaultDurationDays\":7,\"maxDurationDays\":30},\"availability\":{\"availableQuantity\":2,\"activeQuantity\":0,\"reservedQuantity\":1},\"recipients\":{\"users\":[{\"id\":\"55555555-5555-4555-8555-555555555555\",\"name\":\"Ada\",\"email\":\"ada@example.com\"}]},\"availableUnits\":[{\"id\":\"66666666-6666-4666-8666-666666666666\",\"code\":\"UNIT-1\",\"status\":\"available\",\"location\":\"Werkstatt\"}],\"assignments\":[\(assignment)]}".utf8
            )
            statusCode = 200
        case ("POST", "/api/v1/resources/11111111-1111-4111-8111-111111111111/assignments"):
            guard request.value(forHTTPHeaderField: "Idempotency-Key")
                    == "77777777-7777-4777-8777-777777777777",
                  let object = requestObject(),
                  object["kind"] as? String == "checkout",
                  object["quantity"] as? Int == 1,
                  object["stockUnitId"] as? String
                    == "66666666-6666-4666-8666-666666666666",
                  object["startsAt"] as? String != nil,
                  object["dueAt"] as? String != nil,
                  object["note"] as? String == "Ausgabe",
                  let recipient = object["recipient"] as? [String: Any],
                  recipient["type"] as? String == "label",
                  recipient["label"] as? String == "Werkstatt" else {
                fail()
                return
            }
            responseBody = Data(#"{"assignment":{"id":"33333333-3333-4333-8333-333333333333"}}"#.utf8)
            statusCode = 201
        case ("PATCH", "/api/v1/resources/11111111-1111-4111-8111-111111111111/lending"):
            guard let object = requestObject(),
                  object["enabled"] as? Bool == true,
                  object["approvalRequired"] as? Bool == false,
                  object["defaultDurationDays"] as? Int == 5,
                  object["maxDurationDays"] as? Int == 20 else {
                fail()
                return
            }
            responseBody = Data(
                #"{"lending":{"enabled":true,"approvalRequired":false,"defaultDurationDays":5,"maxDurationDays":20}}"#.utf8
            )
            statusCode = 200
        case ("PATCH", "/api/v1/assignments/33333333-3333-4333-8333-333333333333"):
            guard let object = requestObject() else {
                fail()
                return
            }
            if object["action"] as? String == "checkout" {
                guard request.value(forHTTPHeaderField: "Idempotency-Key")
                        == "88888888-8888-4888-8888-888888888888",
                      object["stockUnitId"] as? String
                        == "66666666-6666-4666-8666-666666666666" else {
                    fail()
                    return
                }
            } else {
                guard request.value(forHTTPHeaderField: "Idempotency-Key")
                        == "99999999-9999-4999-8999-999999999999",
                      object["status"] as? String == "cancelled" else {
                    fail()
                    return
                }
            }
            responseBody = Data(#"{"assignment":{"id":"33333333-3333-4333-8333-333333333333"}}"#.utf8)
            statusCode = 200
        default:
            fail()
            return
        }

        guard request.value(forHTTPHeaderField: "Content-Type") == "application/json"
                || request.httpMethod == "GET",
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: statusCode,
                  httpVersion: "HTTP/1.1",
                  headerFields: ["Content-Type": "application/json"]
              ) else {
            fail()
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() { }

    private func requestObject() -> [String: Any]? {
        guard let body = request.httpBody else { return nil }
        return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    }

    private func fail() {
        client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
    }
}

private final class FeatureParityURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard request.value(forHTTPHeaderField: "Authorization")
                == "Bearer feature-parity-test-token",
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

        let notification = #"{"id":"22222222-2222-4222-8222-222222222222","eventType":"low_stock","resourceId":"11111111-1111-4111-8111-111111111111","assignmentId":null,"title":"Niedriger Bestand","body":"Nur noch eine Einheit verfügbar.","href":"/inventory/11111111-1111-4111-8111-111111111111/stock","readAt":null,"createdAt":"2026-09-02T08:00:00Z"}"#
        let notificationPreference = #"{"recipientKey":"ada@example.com","recipientEmail":"ada@example.com","recipientName":"Ada","enabledEventTypes":["low_stock","expiry","maintenance","return_due"],"frequency":"daily","digestHour":8,"timezone":"Europe/Berlin","locale":"de","cooldownHours":24,"lowStockThresholdPercent":100,"expiryWindowDays":30,"expiryFieldKey":"expiry_date","maintenanceWindowDays":7,"maintenanceFieldKey":"maintenance_due","returnDueWindowDays":3,"emailEnabled":false,"pushEnabled":false,"slackEnabled":false,"teamsEnabled":false,"webhookEnabled":false,"lastDigestAt":null,"createdAt":"2026-09-02T08:00:00Z","updatedAt":"2026-09-02T08:00:00Z"}"#
        let notificationRuntime = #"{"email":{"configured":true,"target":"a***@example.com"},"push":{"configured":false,"target":null,"publicKey":null},"slack":{"configured":false,"target":null},"teams":{"configured":false,"target":null},"webhook":{"configured":false,"target":null}}"#
        let loan = #"{"id":"33333333-3333-4333-8333-333333333333","resourceId":"11111111-1111-4111-8111-111111111111","stockUnitId":null,"kind":"checkout","status":"active","stockApplied":true,"overdue":false,"quantity":1,"assignee":{"type":"user","id":"55555555-5555-4555-8555-555555555555","label":"Ada","detail":"ada@example.com"},"stockUnit":null,"startsAt":"2026-09-01T08:00:00Z","dueAt":"2026-09-08T08:00:00Z","completedAt":null,"note":"Werkstatt","resource":{"id":"11111111-1111-4111-8111-111111111111","name":"Akkuschrauber","sku":"AKKU-1","status":"in-use"},"trackingMode":"bulk"}"#
        let readNotification = notification.replacingOccurrences(
            of: #""readAt":null"#,
            with: #""readAt":"2026-09-02T08:05:00Z""#
        )
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary(
            uniqueKeysWithValues: (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") }
        )
        let body: Data

        switch (request.httpMethod, url.path) {
        case ("GET", "/api/v1/resources"):
            guard query["favorites"] == "true" else {
                fail()
                return
            }
            let resource = #"{"id":"11111111-1111-4111-8111-111111111111","name":"Akkuschrauber","description":"","type":"tool","status":"available","quantity":1,"currency":"EUR","priority":3,"tags":[],"categories":[],"relatedResourceIds":[],"notes":"","createdAt":"2026-09-02T08:00:00Z","updatedAt":"2026-09-02T08:00:00Z","media":[],"cover":null,"isFavorite":true}"#
            body = Data(
                "{\"resources\":[\(resource)],\"pagination\":{\"page\":1,\"pageSize\":1,\"total\":1,\"pages\":1}}".utf8
            )
        case ("GET", "/api/v1/notifications"):
            guard query["limit"] == "25", query["unreadOnly"] == "true" else {
                fail()
                return
            }
            body = Data("{\"notifications\":[\(notification)],\"unread\":1}".utf8)
        case ("PATCH", "/api/v1/notifications/22222222-2222-4222-8222-222222222222"):
            body = Data("{\"notification\":\(readNotification)}".utf8)
        case ("POST", "/api/v1/notifications/read-all"):
            body = Data(#"{"updated":1}"#.utf8)
        case ("GET", "/api/v1/notifications/preferences"):
            body = Data(
                "{\"preference\":\(notificationPreference),\"runtime\":\(notificationRuntime),\"pushSubscriptionCount\":0}".utf8
            )
        case ("PATCH", "/api/v1/notifications/preferences"):
            guard request.value(forHTTPHeaderField: "Content-Type") == "application/json",
                  let requestBody = request.httpBody,
                  let object = try? JSONSerialization.jsonObject(with: requestBody) as? [String: Any],
                  object["frequency"] as? String == "immediate",
                  object["timezone"] as? String == "Europe/Berlin",
                  object["recipientKey"] == nil,
                  object["recipientEmail"] == nil else {
                fail()
                return
            }
            let updatedPreference = notificationPreference.replacingOccurrences(
                of: #""frequency":"daily""#,
                with: #""frequency":"immediate""#
            )
            body = Data("{\"preference\":\(updatedPreference)}".utf8)
        case ("POST", "/api/v1/notifications/test"):
            guard request.value(forHTTPHeaderField: "Content-Type") == "application/json",
                  let requestBody = request.httpBody,
                  let object = try? JSONSerialization.jsonObject(with: requestBody) as? [String: Any],
                  object["channel"] as? String == "email" else {
                fail()
                return
            }
            body = Data(
                #"{"configured":true,"preview":{"dryRun":true,"channel":"email","target":"a***@example.com","subject":"Inventar-Benachrichtigungen · Vorschau","events":[{"eventType":"low_stock","title":"Niedriger Bestand","body":"Beispielartikel hat nur noch 2 Einheiten."}]}}"#.utf8
            )
        case ("GET", "/api/v1/loans"):
            guard query["limit"] == "500" else {
                fail()
                return
            }
            body = Data(
                "{\"assignments\":[\(loan)],\"capabilities\":{\"canManage\":true}}".utf8
            )
        case ("PATCH", "/api/v1/assignments/33333333-3333-4333-8333-333333333333"):
            guard request.value(forHTTPHeaderField: "Content-Type") == "application/json",
                  request.value(forHTTPHeaderField: "Idempotency-Key")
                    == "44444444-4444-4444-8444-444444444444",
                  let requestBody = request.httpBody,
                  let object = try? JSONSerialization.jsonObject(with: requestBody) as? [String: Any],
                  object["status"] as? String == "returned" else {
                fail()
                return
            }
            body = Data(#"{"assignment":{"id":"33333333-3333-4333-8333-333333333333"}}"#.utf8)
        case ("PUT", "/api/v1/resources/11111111-1111-4111-8111-111111111111/favorite"):
            body = Data(#"{"favorite":true}"#.utf8)
        default:
            fail()
            return
        }

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() { }

    private func fail() {
        client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
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
