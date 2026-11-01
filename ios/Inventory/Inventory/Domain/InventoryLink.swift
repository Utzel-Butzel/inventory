import Foundation

/// External navigation is stricter than barcode/SKU lookup. Never infer a server
/// from an arbitrary path or send the active server's credentials to a link host.
struct InventoryLink: Identifiable, Equatable {
    let id = UUID()
    let resourceID: UUID
    let unitID: UUID?
    let serverURL: URL?
    let organization: String?

    init?(url: URL) {
        guard url.absoluteString.count <= 4_096,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.user == nil, components.password == nil else { return nil }
        if components.scheme?.lowercased() == "inventory" {
            if components.host == "open" {
                let values = components.queryItems?.filter { $0.name == "url" } ?? []
                guard values.count == 1, let value = values.first?.value,
                      let target = URL(string: value),
                      ["https", "http"].contains(target.scheme?.lowercased() ?? ""),
                      let link = InventoryLink(url: target) else { return nil }
                self.resourceID = link.resourceID
                self.unitID = link.unitID
                self.serverURL = link.serverURL
                self.organization = link.organization
                return
            }
            // Preserve previously supported, serverless inventory://resource/UUID links.
            guard components.queryItems == nil,
                  let resourceID = ResourceCodeParser.parse(url.absoluteString).resourceID else { return nil }
            self.resourceID = resourceID
            unitID = nil
            serverURL = nil
            organization = nil
            return
        }
        guard ["https", "http"].contains(components.scheme?.lowercased() ?? ""),
              let host = components.host, !host.isEmpty else { return nil }
        var parts = components.path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.first == "" else { return nil }
        parts.removeFirst()
        var organization: String?
        if parts.count >= 3, parts[1] == "inventory" {
            guard parts[0].range(of: "^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$", options: .regularExpression) != nil else { return nil }
            organization = parts.removeFirst().lowercased()
        }
        guard parts.count == 2 || (parts.count == 3 && parts[2] == "stock"),
              parts[0] == "r" || parts[0] == "inventory",
              !(parts[0] == "r" && parts.count != 2),
              let resourceID = ResourceCodeParser.parse("https://link.invalid/\(parts[0])/\(parts[1])").resourceID else { return nil }
        if parts[0] == "r" {
            guard parts[1].range(of: "^[A-Za-z0-9_-]{22}$", options: .regularExpression) != nil else { return nil }
        } else {
            guard parts[1].lowercased() == resourceID.uuidString.lowercased() else { return nil }
        }
        let units = components.queryItems?.filter { $0.name == "unit" } ?? []
        guard units.count <= 1 else { return nil }
        var unitID: UUID?
        if let unit = units.first {
            guard let value = unit.value else { return nil }
            if parts[0] == "r" {
                guard value.range(of: "^[A-Za-z0-9_-]{22}$", options: .regularExpression) != nil else { return nil }
            }
            unitID = parts[0] == "r"
                ? ResourceCodeParser.parse("https://link.invalid/r/\(value)").resourceID
                : ResourceCodeParser.parse(value).resourceID
            guard let parsed = unitID,
                  parts[0] == "r" || parsed.uuidString.lowercased() == value.lowercased() else { return nil }
        }
        var origin = URLComponents()
        origin.scheme = components.scheme?.lowercased()
        origin.host = host.lowercased()
        origin.port = components.port
        guard let server = origin.url else { return nil }
        self.resourceID = resourceID
        self.unitID = unitID
        self.serverURL = server
        self.organization = organization
    }

    func matches(server: URL) -> Bool {
        guard let serverURL else { return true }
        func port(_ url: URL) -> Int { url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80) }
        return server.scheme?.lowercased() == serverURL.scheme?.lowercased()
            && server.host?.lowercased() == serverURL.host?.lowercased()
            && port(server) == port(serverURL)
            && (server.path.isEmpty || server.path == "/")
    }

    func matches(organization candidate: InventoryOrganization?) -> Bool {
        guard let organization else { return true }
        return candidate?.id.uuidString.lowercased() == organization || candidate?.slug.lowercased() == organization
    }
}
