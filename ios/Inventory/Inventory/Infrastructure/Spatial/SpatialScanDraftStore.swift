import CryptoKit
import Foundation

struct SpatialPendingScan: Codable, Identifiable, Sendable {
    let id: UUID
    let contextIdentifier: String
    let mode: SpatialRoomScanMode
    var drafts: [SpatialRoomScanDraft]
    var roomResourceIDs: [UUID: UUID]
    var uploadedScanIDs: Set<UUID>

    var title: String { drafts.first?.structureName ?? drafts.first?.roomName ?? "Raumscan" }
}

/// Upload checkpoints are scoped to server, organization and signed-in user.
/// Persist the exact upload identity before making any network changes.
struct SpatialScanDraftStore {
    let directory: URL
    let contextIdentifier: String

    init(contextIdentifier: String, root: URL? = nil) throws {
        self.contextIdentifier = contextIdentifier
        let base = try root ?? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        )
        let scope = SHA256.hash(data: Data(contextIdentifier.utf8))
            .map { String(format: "%02x", $0) }.joined()
        directory = base.appendingPathComponent("RoomScanDrafts", isDirectory: true)
            .appendingPathComponent(scope, isDirectory: true)
    }

    func load() throws -> [SpatialPendingScan] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]
        ).compactMap { folder in
            let manifest = folder.appendingPathComponent("scan.json")
            guard FileManager.default.fileExists(atPath: manifest.path) else { return nil }
            var scan = try JSONDecoder().decode(SpatialPendingScan.self, from: Data(contentsOf: manifest))
            guard folder.lastPathComponent == scan.id.uuidString,
                  scan.contextIdentifier == contextIdentifier else { return nil }
            scan.drafts = scan.drafts.map {
                $0.relocated(to: folder.appendingPathComponent("inventory-room-scan-\($0.id.uuidString)"))
            }
            return scan
        }.sorted { ($0.drafts.first?.capturedAt ?? .distantPast) > ($1.drafts.first?.capturedAt ?? .distantPast) }
    }

    @discardableResult
    func save(_ scan: SpatialPendingScan) throws -> SpatialPendingScan {
        guard scan.contextIdentifier == contextIdentifier else {
            throw APIClientError.invalidUpload("Dieser Scan gehört zu einem anderen Konto oder einer anderen Organisation.")
        }
        let folder = directory.appendingPathComponent(scan.id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var saved = scan
        saved.drafts = try scan.drafts.map { draft in
            let source = draft.modelURL.deletingLastPathComponent().standardizedFileURL
            let target = folder.appendingPathComponent("inventory-room-scan-\(draft.id.uuidString)")
            if source != target.standardizedFileURL {
                // A previous interrupted copy has no committed manifest. Rebuild it
                // from the still-owned source; never alter a persisted payload.
                if FileManager.default.fileExists(atPath: target.path) {
                    try FileManager.default.removeItem(at: target)
                }
                try FileManager.default.copyItem(at: source, to: target)
            }
            return draft.relocated(to: target)
        }
        try JSONEncoder().encode(saved).write(to: folder.appendingPathComponent("scan.json"), options: .atomic)
        return saved
    }

    func remove(id: UUID) throws {
        let folder = directory.appendingPathComponent(id.uuidString, isDirectory: true)
        if FileManager.default.fileExists(atPath: folder.path) {
            try FileManager.default.removeItem(at: folder)
        }
    }
}
