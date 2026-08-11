import SwiftUI

struct RootView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        Group {
            if state.isConfigured {
                TabView(selection: $state.selectedTab) {
                    CaptureView { state.intakeQueue.enqueue($0) }
                        .tint(InventoryTheme.accent)
                        .tag(RootTab.capture)
                        .tabItem { Label("Erfassen", systemImage: "camera.fill") }

                    ScannerView()
                        .tint(InventoryTheme.accent)
                        .tag(RootTab.scanner)
                        .tabItem { Label("Scannen", systemImage: "qrcode.viewfinder") }

                    InventoryListView()
                        .tint(InventoryTheme.accent)
                        .tag(RootTab.inventory)
                        .tabItem { Label("Inventar", systemImage: "shippingbox.fill") }

                    UploadJobsView()
                        .tint(InventoryTheme.accent)
                        .tag(RootTab.uploads)
                        .tabItem { Label("Uploads", systemImage: "arrow.up.circle.fill") }
                        .badge(activeJobCount)

                    SettingsView(onboarding: false)
                        .tint(InventoryTheme.accent)
                        .tag(RootTab.settings)
                        .tabItem { Label("Einstellungen", systemImage: "gearshape.fill") }
                }
                .tint(InventoryTheme.highlight)
                .toolbarColorScheme(.dark, for: .tabBar)
                .toolbarBackground(InventoryTheme.ink, for: .tabBar)
                .toolbarBackground(.visible, for: .tabBar)
            } else {
                SettingsView(onboarding: true)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: state.isConfigured)
        .background(KeyboardDismissalView())
    }

    private var activeJobCount: Int {
        state.intakeQueue.jobs.filter { !$0.stage.isTerminal }.count
    }
}
