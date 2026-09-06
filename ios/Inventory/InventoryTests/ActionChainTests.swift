import Foundation
import SwiftUI
import XCTest
@testable import Inventory

private let chainID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
private let productID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
private let variantID = UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!
private let planHash = String(repeating: "a", count: 64)
private let configurationJSON = #"""
{"workflow":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"OpenPaper 7 fertigen","description":"Platine zum Bilderrahmen fertigstellen","identifier":"PCB-123","targetSelectionMode":"all","targetGroups":[{"resourceId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","name":"OpenPaper 7","options":[{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","name":"Schwarz"},{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","name":"Weiß"}]}],"inputFields":[{"key":"color","label":"Farbe","required":true,"type":"select","options":[{"value":"black","label":"Schwarz"},{"value":"white","label":"Weiß"}]},{"key":"engraving","label":"Gravur","required":true,"type":"text","visibleWhen":{"mode":"all","rules":[{"left":{"source":"input","key":"color"},"operator":"equals","right":{"source":"literal","value":"white"}}]}},{"key":"note","label":"Notiz","required":false,"type":"text","visibleWhen":{"mode":"all","rules":[{"left":{"source":"input","key":"engraving"},"operator":"exists"}]}}],"actions":[{"id":"pcb","label":"Platine finden","type":"find-unit","enabled":true},{"id":"build","label":"Bilderrahmen fertigstellen","type":"assembly-build","enabled":true}]}}
"""#
private let reportJSON = """
{"workflowId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","revision":2,"identifier":"PCB-123","planHash":"\(planHash)","steps":[{"id":"pcb","label":"Platine finden","type":"find-unit","skipped":false,"target":"Platine","code":"PCB-123"},{"id":"build","label":"Bilderrahmen fertigstellen","type":"assembly-build","skipped":false,"target":"OpenPaper 7 · Schwarz","code":"PCB-123","quantityBefore":0,"quantityAfter":1,"statusBefore":null,"statusAfter":"available","metadata":{"Farbe":"Schwarz","Prüfung bestanden":true},"components":[{"name":"Platine","quantity":1,"codes":["PCB-123"]},{"name":"Rahmen Schwarz","quantity":1,"codes":[]}]},{"id":"check","label":"Optionale Prüfung","type":"assert","skipped":true,"target":null}]}
"""

final class ActionChainTests: XCTestCase {
    func testConfigurationIncludesVariantsAndDefaults() throws {
        let value = try JSONDecoder().decode(ActionChainConfigurationResponse.self, from: Data(configurationJSON.utf8)).workflow
        XCTAssertEqual(value.identifier, "PCB-123")
        XCTAssertEqual(value.defaultSelection, [productID: variantID])
        XCTAssertEqual(value.targetGroups[0].options.count, 2)
        XCTAssertEqual(value.actions.map(\.label), ["Platine finden", "Bilderrahmen fertigstellen"])
    }

    func testHiddenRequiredFieldsAndTheirStaleValuesAreExcluded() throws {
        let value = try JSONDecoder().decode(ActionChainConfigurationResponse.self, from: Data(configurationJSON.utf8)).workflow
        XCTAssertEqual(value.visibleFields(raw: "raw", inputs: ["color": .string("black"), "engraving": .string("stale")]).map(\.key), ["color"])
        XCTAssertEqual(value.visibleFields(raw: "raw", inputs: ["color": .string("white"), "engraving": .string("Hello")]).map(\.key), ["color", "engraving", "note"])
    }

    func testConditionsPreserveScalarTypesAndServerExtractedIdentifier() {
        let numeric = ActionChainConditions(mode: "all", rules: [.init(left: .init(source: "input", key: "quantity"), operator: "gte", right: .init(source: "literal", value: .number(2)))])
        XCTAssertTrue(numeric.matches(identifier: "PCB-123", raw: "", inputs: ["quantity": .number(2)]))
        XCTAssertFalse(numeric.matches(identifier: "PCB-123", raw: "", inputs: ["quantity": .string("2")]))
        let identifier = ActionChainConditions(mode: "all", rules: [.init(left: .init(source: "scan", field: "identifier"), operator: "equals", right: .init(source: "literal", value: .string("PCB-123")))])
        XCTAssertTrue(identifier.matches(identifier: "PCB-123", raw: "https://example.test?d=PCB-123", inputs: [:]))
        let present = ActionChainConditions(mode: "all", rules: [.init(left: .init(source: "input", key: "check"), operator: "exists")])
        XCTAssertTrue(present.matches(identifier: "", raw: "", inputs: ["check": .bool(false)]))
        XCTAssertFalse(present.matches(identifier: "", raw: "", inputs: [:]))
        let attachments: [String: ActionChainJSON] = ["first": .array([.string("selected")]), "second": .array([.string("selected")])]
        let differentFiles = ActionChainConditions(mode: "all", rules: [.init(left: .init(source: "input", key: "first"), operator: "equals", right: .init(source: "input", key: "second"))])
        XCTAssertFalse(differentFiles.matches(identifier: "", raw: "", inputs: attachments))
        let sameFiles = ActionChainConditions(mode: "all", rules: [.init(left: .init(source: "input", key: "first"), operator: "equals", right: .init(source: "input", key: "first"))])
        XCTAssertTrue(sameFiles.matches(identifier: "", raw: "", inputs: attachments))
    }

    func testRequestEncodesSelectedVariantAndLowercaseUUIDs() throws {
        let request = ActionChainRunRequest(workflowId: chainID, code: "PCB-123", codeType: "qr_code", selectedResourceIds: [variantID], inputs: ["color": .text("black"), "quantity": .number(2), "checked": .boolean(false)])
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        XCTAssertEqual(object["workflowId"] as? String, chainID.uuidString.lowercased())
        XCTAssertEqual(object["selectedResourceIds"] as? [String], [variantID.uuidString.lowercased()])
        XCTAssertNil(object["expectedPlanHash"])
        XCTAssertEqual((object["inputs"] as? [String: Any])?["quantity"] as? Double, 2)
    }

    func testUncertainConfirmationKeepsExactRequestAndKeyUntilResolved() throws {
        let report = try JSONDecoder().decode(ActionChainReport.self, from: Data(reportJSON.utf8))
        let request = ActionChainRunRequest(workflowId: chainID, code: "PCB-123", codeType: nil, selectedResourceIds: [variantID], inputs: ["color": .text("black")])
        var review = ActionChainReview()
        review.reviewed(report, request: request)
        let original = review.request
        let key = review.key
        XCTAssertEqual(original?.expectedPlanHash, planHash)
        review.confirmationUncertain = true
        review.invalidate()
        XCTAssertEqual(review.request, original)
        XCTAssertEqual(review.key, key)
        review.confirmationUncertain = false
        review.invalidate()
        XCTAssertNil(review.request)
        XCTAssertNil(review.report)
    }

    func testReplayedPreviewIsAlreadyComplete() throws {
        var report = try JSONDecoder().decode(ActionChainReport.self, from: Data(reportJSON.utf8))
        report.replayed = true
        var review = ActionChainReview()
        review.reviewed(report, request: .init(workflowId: chainID, code: "PCB-123", codeType: nil, selectedResourceIds: [variantID], inputs: [:]))
        XCTAssertTrue(review.completed)
        XCTAssertEqual(report.steps[1].components?.first?.codes, ["PCB-123"])
        XCTAssertTrue(report.steps[2].skipped)
    }

    func testOlderWorkflowPayloadStillDecodesWithoutActions() throws {
        let json = """
        {"id":"\(chainID)","name":"Alt","description":"","enabled":true,"resourceId":"\(productID)","codeTypes":["qr_code"],"revision":1,"operation":{"type":"unit"},"inputFields":[]}
        """
        let workflow = try JSONDecoder().decode(ScanActionWorkflow.self, from: Data(json.utf8))
        XCTAssertFalse(workflow.hasActionChain)
    }

    func testNativeAPIUsesPreparePreviewAndConfirmationWithOrganizationAndStableKey() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ActionChainURLProtocol.self]
        let client = try APIClient(serverURL: URL(string: "https://inventory.example")!, credentialStore: InMemoryCredentialStore(token: "chain-test-token"), organizationID: productID, session: URLSession(configuration: configuration))
        let prepared = try await client.prepareActionChain(workflowID: chainID, code: "PCB-123", codeType: "qr_code")
        XCTAssertEqual(prepared.identifier, "PCB-123")
        var request = ActionChainRunRequest(workflowId: chainID, code: "PCB-123", codeType: "qr_code", selectedResourceIds: [variantID], inputs: ["color": .text("black")])
        let report = try await client.previewActionChain(request)
        request.expectedPlanHash = report.planHash
        let first = try await client.executeActionChain(request, idempotencyKey: chainID)
        let retry = try await client.executeActionChain(request, idempotencyKey: chainID)
        XCTAssertEqual(first, retry)
    }

    @MainActor func testReviewLayoutOnPhoneAndLargeText() throws {
        let report = try JSONDecoder().decode(ActionChainReport.self, from: Data(reportJSON.utf8))
        for large in [false, true] {
            let content = ActionChainReportCard(report: report, completed: false)
                .padding(16).background(InventoryTheme.canvas)
                .environment(\.dynamicTypeSize, large ? .accessibility2 : .large)
            let host = UIHostingController(rootView: content)
            let fitting = host.sizeThatFits(in: CGSize(width: 390, height: 10_000))
            XCTAssertLessThanOrEqual(fitting.width, 391)
            XCTAssertGreaterThan(fitting.height, 300)
            let renderer = ImageRenderer(content: content)
            renderer.proposedSize = ProposedViewSize(width: 390, height: nil)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.uiImage)
            let attachment = XCTAttachment(image: image)
            attachment.name = large ? "action-chain-large-text" : "action-chain-phone"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
}

private final class ActionChainURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer chain-test-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Organization-ID"), productID.uuidString.lowercased())
            var data = request.httpBody
            if data == nil, let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var bytes = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; bytes.append(buffer, count: count) }
                data = bytes
            }
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [String: Any])
            let url = try XCTUnwrap(request.url)
            if url.path.hasSuffix("/runner") {
                XCTAssertEqual(url.path, "/api/v1/stock/scan-workflows/\(chainID.uuidString.lowercased())/runner")
            } else {
                XCTAssertEqual(body["selectedResourceIds"] as? [String], [variantID.uuidString.lowercased()])
                if url.path.hasSuffix("/execute") {
                    XCTAssertEqual(body["expectedPlanHash"] as? String, planHash)
                    XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), chainID.uuidString.lowercased())
                } else { XCTAssertEqual(url.path, "/api/v1/stock/action-chains/preview") }
            }
            let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"]))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data((url.path.hasSuffix("/runner") ? configurationJSON : reportJSON).utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
