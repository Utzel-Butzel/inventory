import XCTest
@testable import Inventory

final class SpatialCaptureStateTests: XCTestCase {
    func testStartingAnotherRoomRejectsTheLatePreviousWorldMap() {
        let firstScanID = UUID()
        let secondScanID = UUID()
        var state = SpatialWorldMapSelectionState()

        let firstGeneration = state.begin(scanID: firstScanID)
        let secondGeneration = state.begin(scanID: secondScanID)

        XCTAssertFalse(state.accepts(scanID: firstScanID, generation: firstGeneration))
        XCTAssertTrue(state.accepts(scanID: secondScanID, generation: secondGeneration))
    }

    func testCancellingSelectionInvalidatesItsInFlightWorldMap() {
        let scanID = UUID()
        var state = SpatialWorldMapSelectionState()
        let generation = state.begin(scanID: scanID)

        state.cancel()

        XCTAssertFalse(state.accepts(scanID: scanID, generation: generation))
        XCTAssertNil(state.scanID)
    }

    func testRelocalizationTimeoutCannotFailAReadySession() {
        var gate = SpatialRelocalizationGate()

        gate.markReady()

        XCTAssertTrue(gate.isReady)
        XCTAssertFalse(gate.failIfSearching())
        XCTAssertEqual(gate.phase, .ready)
    }

    func testInterruptionRearmsRelocalizationFailurePath() {
        var gate = SpatialRelocalizationGate()
        gate.markReady()

        gate.beginSearching()

        XCTAssertTrue(gate.failIfSearching())
        XCTAssertTrue(gate.isFailed)
        XCTAssertFalse(gate.failIfSearching(), "A terminal failure must only be reported once")
    }
}
