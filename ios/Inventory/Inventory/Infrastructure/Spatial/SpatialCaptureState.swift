import Foundation

/// Couples an asynchronous world-map download to the room selection that
/// started it. Starting or cancelling a selection invalidates every older
/// generation, even when an underlying networking stack completes late.
struct SpatialWorldMapSelectionState: Equatable, Sendable {
    private(set) var scanID: UUID?
    private(set) var generation = UUID()

    @discardableResult
    mutating func begin(scanID: UUID) -> UUID {
        generation = UUID()
        self.scanID = scanID
        return generation
    }

    mutating func cancel() {
        generation = UUID()
        scanID = nil
    }

    func accepts(scanID: UUID, generation: UUID) -> Bool {
        self.scanID == scanID && self.generation == generation
    }
}

/// Small, hardware-independent state machine for AR relocalization. It keeps
/// a delayed timeout from failing a session that has already become ready and
/// allows an interruption to arm a fresh timeout afterwards.
struct SpatialRelocalizationGate: Equatable, Sendable {
    enum Phase: Equatable, Sendable {
        case searching
        case ready
        case failed
    }

    private(set) var phase: Phase = .searching

    var isReady: Bool { phase == .ready }
    var isFailed: Bool { phase == .failed }

    mutating func beginSearching() {
        guard !isFailed else { return }
        phase = .searching
    }

    mutating func markReady() {
        guard !isFailed else { return }
        phase = .ready
    }

    @discardableResult
    mutating func failIfSearching() -> Bool {
        guard phase == .searching else { return false }
        phase = .failed
        return true
    }

    @discardableResult
    mutating func fail() -> Bool {
        guard !isFailed else { return false }
        phase = .failed
        return true
    }
}
