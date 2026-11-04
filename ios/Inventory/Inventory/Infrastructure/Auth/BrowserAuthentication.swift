import AuthenticationServices
import CryptoKit
import Security
import UIKit

struct BrowserSignInAttempt {
    static let callbackScheme = "de.polyxo.openinventory"
    let verifier: String
    let state: String

    init() throws {
        verifier = try Self.randomSecret()
        state = try Self.randomSecret()
    }

    // Also used by the RFC 7636 test vector.
    init(verifier: String, state: String) {
        self.verifier = verifier
        self.state = state
    }

    var challenge: String {
        Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    func authorizationURL(serverURL: URL, requestID: String) throws -> URL {
        guard Self.isSecret(requestID),
              var components = URLComponents(
                url: serverURL.appendingPathComponent("api/v1/auth/browser/authorize"),
                resolvingAgainstBaseURL: false
              ) else { throw APIClientError.invalidResponse }
        components.queryItems = [URLQueryItem(name: "request", value: requestID)]
        guard let url = components.url else { throw APIClientError.invalidResponse }
        return url
    }

    func code(from callback: URL) throws -> String {
        guard let components = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              components.scheme == Self.callbackScheme,
              components.host == "auth", components.path == "/callback",
              components.user == nil, components.password == nil, components.port == nil,
              components.fragment == nil,
              let items = components.queryItems,
              items.filter({ $0.name == "state" }).count == 1,
              items.first(where: { $0.name == "state" })?.value == state else {
            throw APIClientError.invalidRequest(L10n.text("ui_browser_sign_in_invalid_callback"))
        }
        if items.count == 2, items.first(where: { $0.name == "error" })?.value == "access_denied" {
            throw CancellationError()
        }
        guard items.count == 2, let code = items.first(where: { $0.name == "code" })?.value,
              Self.isSecret(code) else {
            throw APIClientError.invalidRequest(L10n.text("ui_browser_sign_in_invalid_callback"))
        }
        return code
    }

    private static func isSecret(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
    }

    private static func randomSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw APIClientError.invalidRequest(L10n.text("ui_browser_sign_in_unavailable"))
        }
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

@MainActor
final class BrowserAuthentication: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, Error>?
    private var anchor: ASPresentationAnchor?
    private var operationID = UUID()

    func authenticate(url: URL, privateSession: Bool) async throws -> URL {
        guard session == nil,
              let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .filter({ $0.activationState == .foregroundActive })
                .flatMap(\.windows).first(where: \.isKeyWindow) else {
            throw APIClientError.invalidRequest(L10n.text("ui_browser_sign_in_unavailable"))
        }
        anchor = window
        let operationID = UUID()
        self.operationID = operationID
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let session = ASWebAuthenticationSession(
                    url: url, callbackURLScheme: BrowserSignInAttempt.callbackScheme
                ) { [weak self] url, error in
                    Task { @MainActor in
                        if let error = error as? ASWebAuthenticationSessionError,
                           error.code == .canceledLogin {
                            self?.finish(.failure(CancellationError()), operationID: operationID)
                        } else if let error {
                            self?.finish(.failure(error), operationID: operationID)
                        } else if let url {
                            self?.finish(.success(url), operationID: operationID)
                        } else {
                            self?.finish(.failure(APIClientError.invalidResponse), operationID: operationID)
                        }
                    }
                }
                session.presentationContextProvider = self
                // Share Safari's SSO by default; optionally isolate a different account.
                session.prefersEphemeralWebBrowserSession = privateSession
                self.session = session
                if !session.start() {
                    finish(.failure(APIClientError.invalidRequest(L10n.text("ui_browser_sign_in_unavailable"))), operationID: operationID)
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                guard self?.operationID == operationID else { return }
                self?.session?.cancel()
                self?.finish(.failure(CancellationError()), operationID: operationID)
            }
        }
    }

    private func finish(_ result: Result<URL, Error>, operationID: UUID) {
        guard self.operationID == operationID else { return }
        let pending = continuation
        continuation = nil
        session = nil
        anchor = nil
        pending?.resume(with: result)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor ?? ASPresentationAnchor()
    }
}

struct BrowserSignInStartResponse: Decodable, Sendable {
    let requestId: String
    let expiresAt: Date
}

struct ServerAuthOptions: Decodable, Sendable {
    struct Provider: Decodable, Sendable {
        let id: String
        let name: String
    }
    let passwordEnabled: Bool
    let browserSignIn: Bool
    let providers: [Provider]
}
