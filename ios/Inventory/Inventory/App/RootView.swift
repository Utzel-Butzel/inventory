import SwiftUI

struct RootView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        Group {
            if state.isConfigured {
                TabView(selection: $state.selectedTab) {
                    CaptureView { state.intakeQueue.enqueue($0) }
                        .tag(RootTab.capture)
                        .tabItem { Label("Erfassen", systemImage: "camera.fill") }

                    ScannerView()
                        .tag(RootTab.scanner)
                        .tabItem { Label("Scannen", systemImage: "qrcode.viewfinder") }

                    InventoryListView()
                        .tag(RootTab.inventory)
                        .tabItem { Label("Inventar", systemImage: "shippingbox.fill") }

                    UploadJobsView()
                        .tag(RootTab.uploads)
                        .tabItem { Label("Uploads", systemImage: "arrow.up.circle.fill") }
                        .badge(activeJobCount)

                    SettingsView(onboarding: false)
                        .tag(RootTab.settings)
                        .tabItem { Label("Einstellungen", systemImage: "gearshape.fill") }
                }
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
