import SwiftUI

@main
struct InventoryApp: App {
    @StateObject private var state = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .preferredColorScheme(.light)
                .onOpenURL { url in
                    guard let link = InventoryLink(url: url) else { return }
                    state.pendingInventoryLink = link
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { state.resumeUploads() }
        }
    }
}
