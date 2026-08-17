import Foundation
import XCTest
@testable import Inventory

final class AIPromptPreferencesTests: XCTestCase {
    func testPromptsRoundTripWithinTheirAccountContext() throws {
        let (suiteName, defaults) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(
            AIPromptPreferences.setAnalysisPrompt(
                "  Analyze the main object.  ",
                for: "server-a|org-a|person-a",
                in: defaults
            ),
            "Analyze the main object."
        )
        AIPromptPreferences.setCoverPrompt(
            "Studio cover",
            for: "server-a|org-a|person-a",
            in: defaults
        )
        AIPromptPreferences.setTransparentCoverPrompt(
            "Preserve fine edges",
            for: "server-a|org-a|person-a",
            in: defaults
        )

        XCTAssertEqual(
            AIPromptPreferences.analysisPrompt(
                for: "server-a|org-a|person-a",
                in: defaults
            ),
            "Analyze the main object."
        )
        XCTAssertEqual(
            AIPromptPreferences.coverPrompt(
                for: "server-a|org-a|person-a",
                in: defaults
            ),
            "Studio cover"
        )
        XCTAssertEqual(
            AIPromptPreferences.transparentCoverPrompt(
                for: "server-a|org-a|person-a",
                in: defaults
            ),
            "Preserve fine edges"
        )
    }

    func testPromptsDoNotLeakAcrossAccountContexts() throws {
        let (suiteName, defaults) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        AIPromptPreferences.setAnalysisPrompt(
            "First organization's prompt",
            for: "server-a|org-a|person-a",
            in: defaults
        )

        XCTAssertNil(AIPromptPreferences.analysisPrompt(
            for: "server-a|org-b|person-a",
            in: defaults
        ))
        XCTAssertNil(AIPromptPreferences.analysisPrompt(
            for: "server-a|org-a|person-b",
            in: defaults
        ))
    }

    func testBlankPromptRestoresServerDefault() throws {
        let (suiteName, defaults) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let context = "server-a|org-a|person-a"

        AIPromptPreferences.setCoverPrompt("Custom", for: context, in: defaults)
        XCTAssertNil(AIPromptPreferences.setCoverPrompt(" \n ", for: context, in: defaults))
        XCTAssertNil(AIPromptPreferences.coverPrompt(for: context, in: defaults))
    }

    func testValidationUsesAPISUTF16LimitWithoutSplittingCharacters() {
        let prompt = String(repeating: "a", count: 4_999) + "😀"

        let validated = AIPromptPreferences.validatedPrompt(prompt)

        XCTAssertEqual(validated?.utf16.count, 4_999)
        XCTAssertEqual(validated, String(repeating: "a", count: 4_999))
    }

    private func makeDefaults() throws -> (String, UserDefaults) {
        let suiteName = "AIPromptPreferencesTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        return (suiteName, defaults)
    }
}
