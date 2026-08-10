import SwiftUI

@main
struct InventoryApp: App {
    @StateObject private var state = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .tint(InventoryTheme.accent)
                .preferredColorScheme(.light)
                .onOpenURL { url in
                    guard ResourceCodeParser.parse(url.absoluteString).resourceID != nil else { return }
                    state.pendingScanCode = url.absoluteString
                    state.selectedTab = .scanner
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { state.resumeUploads() }
        }
    }
}
