import Foundation

/// Localizes app-authored text only. Server content and identifiers stay untouched.
enum L10n {
    static func text(_ key: String, _ arguments: Any...) -> String {
        render(Bundle.main.localizedString(forKey: key, value: nil, table: nil), arguments: arguments)
    }

    /// One pass prevents user content containing placeholders from being interpolated again.
    static func render(_ template: String, arguments: [Any]) -> String {
        let pattern = /\{([0-9]+)\}/
        return template.replacing(pattern) { match in
            guard let index = Int(match.1), arguments.indices.contains(index) else {
                return String(match.0)
            }
            return String(describing: arguments[index])
        }
    }

    static var language: String {
        Bundle.main.preferredLocalizations.first == "de" ? "de" : "en"
    }
}
