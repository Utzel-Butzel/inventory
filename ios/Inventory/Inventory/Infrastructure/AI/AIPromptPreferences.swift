import Foundation

enum AIPromptPreferences {
    static let maximumUTF16Length = 5_000

    private static let analysisPromptKey = "inventory.ai.analysisPrompt"
    private static let coverPromptKey = "inventory.ai.coverPrompt"
    private static let transparentCoverPromptKey =
        "inventory.ai.transparentCoverPrompt"

    static func analysisPrompt(
        for contextIdentifier: String,
        in defaults: UserDefaults
    ) -> String? {
        prompt(for: contextIdentifier, preferenceKey: analysisPromptKey, in: defaults)
    }

    static func coverPrompt(
        for contextIdentifier: String,
        in defaults: UserDefaults
    ) -> String? {
        prompt(for: contextIdentifier, preferenceKey: coverPromptKey, in: defaults)
    }

    static func transparentCoverPrompt(
        for contextIdentifier: String,
        in defaults: UserDefaults
    ) -> String? {
        prompt(
            for: contextIdentifier,
            preferenceKey: transparentCoverPromptKey,
            in: defaults
        )
    }

    @discardableResult
    static func setAnalysisPrompt(
        _ prompt: String?,
        for contextIdentifier: String,
        in defaults: UserDefaults
    ) -> String? {
        set(prompt, for: contextIdentifier, preferenceKey: analysisPromptKey, in: defaults)
    }

    @discardableResult
    static func setCoverPrompt(
        _ prompt: String?,
        for contextIdentifier: String,
        in defaults: UserDefaults
    ) -> String? {
        set(prompt, for: contextIdentifier, preferenceKey: coverPromptKey, in: defaults)
    }

    @discardableResult
    static func setTransparentCoverPrompt(
        _ prompt: String?,
        for contextIdentifier: String,
        in defaults: UserDefaults
    ) -> String? {
        set(
            prompt,
            for: contextIdentifier,
            preferenceKey: transparentCoverPromptKey,
            in: defaults
        )
    }

    static func validatedPrompt(_ prompt: String?) -> String? {
        guard var normalized = prompt?.trimmingCharacters(in: .whitespacesAndNewlines),
              !normalized.isEmpty else { return nil }

        // The API validates JavaScript string length, which counts UTF-16 code
        // units. Remove whole Swift Characters so a composed character or
        // surrogate pair is never split at the request boundary.
        while normalized.utf16.count > maximumUTF16Length {
            normalized.removeLast()
        }
        return normalized.isEmpty ? nil : normalized
    }

    private static func prompt(
        for contextIdentifier: String,
        preferenceKey: String,
        in defaults: UserDefaults
    ) -> String? {
        guard !contextIdentifier.isEmpty else { return nil }
        let preferences = defaults.dictionary(forKey: preferenceKey)
        return validatedPrompt(preferences?[contextIdentifier] as? String)
    }

    private static func set(
        _ prompt: String?,
        for contextIdentifier: String,
        preferenceKey: String,
        in defaults: UserDefaults
    ) -> String? {
        guard !contextIdentifier.isEmpty else { return nil }
        let normalized = validatedPrompt(prompt)
        var preferences = defaults.dictionary(forKey: preferenceKey)?
            .compactMapValues { $0 as? String } ?? [:]
        if let normalized {
            preferences[contextIdentifier] = normalized
        } else {
            preferences.removeValue(forKey: contextIdentifier)
        }
        if preferences.isEmpty {
            defaults.removeObject(forKey: preferenceKey)
        } else {
            defaults.set(preferences, forKey: preferenceKey)
        }
        return normalized
    }
}
