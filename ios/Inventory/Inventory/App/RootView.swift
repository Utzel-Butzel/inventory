import SwiftUI

struct RootView: View {
    @EnvironmentObject private var state: AppState
    @State private var searchRequested = false

    var body: some View {
        Group {
            if state.isConfigured {
                configuredContent
            } else {
                SettingsView(onboarding: true)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: state.isConfigured)
        .background(KeyboardDismissalView())
    }

    private var configuredContent: some View {
        TabView(selection: $state.selectedTab) {
            InventoryListView(
                searchRequested: $searchRequested,
                onCapture: { state.presentedTool = .capture },
                onScan: { state.presentedTool = .scanner }
            )
            .tag(RootTab.inventory)

            InventoryMapView()
                .tag(RootTab.map)

            SpatialRoomsView()
                .tag(RootTab.rooms)

            SettingsView(onboarding: false)
                .tag(RootTab.settings)
        }
        .toolbar(.hidden, for: .tabBar)
        .tint(InventoryTheme.accent)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomDock
        }
        .fullScreenCover(isPresented: toolIsPresented) {
            presentedTool
        }
    }

    private var toolIsPresented: Binding<Bool> {
        Binding(
            get: { state.presentedTool != nil },
            set: { presented in
                if !presented { state.presentedTool = nil }
            }
        )
    }

    @ViewBuilder
    private var presentedTool: some View {
        switch state.presentedTool {
        case .capture:
            CaptureView(onClose: { state.presentedTool = nil }) {
                state.intakeQueue.enqueue($0)
            }
            .tint(InventoryTheme.accent)
        case .scanner:
            ScannerView(onClose: { state.presentedTool = nil })
                .tint(InventoryTheme.accent)
        case nil:
            EmptyView()
        }
    }

    private var bottomDock: some View {
        HStack(alignment: .bottom, spacing: 10) {
            HStack(spacing: 2) {
                dockButton(
                    title: "Inventar",
                    systemImage: "shippingbox.fill",
                    tab: .inventory
                )
                dockButton(
                    title: "Karte",
                    systemImage: "map.fill",
                    tab: .map
                )
                dockButton(
                    title: "Räume",
                    systemImage: "cube.transparent.fill",
                    tab: .rooms
                )
                dockButton(
                    title: "Einstellungen",
                    systemImage: "gearshape.fill",
                    tab: .settings
                )
            }
            .padding(5)
            .frame(maxWidth: .infinity)
            .background(InventoryTheme.ink, in: Capsule())

            Button {
                state.selectedTab = .inventory
                searchRequested = true
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(InventoryTheme.ink)
                    .frame(width: 56, height: 56)
                    .background(InventoryTheme.lime, in: Circle())
                    .overlay {
                        Circle().stroke(.black.opacity(0.12), lineWidth: 1)
                    }
            }
            .accessibilityLabel("Inventar durchsuchen")
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 5)
        .background(.ultraThinMaterial)
    }

    private func dockButton(
        title: String,
        systemImage: String,
        tab: RootTab
    ) -> some View {
        let selected = state.selectedTab == tab
        return Button {
            state.selectedTab = tab
        } label: {
            VStack(spacing: 3) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
            .foregroundStyle(selected ? InventoryTheme.ink : Color.white.opacity(0.88))
            .frame(maxWidth: .infinity, minHeight: 46)
            .padding(.horizontal, 3)
            .background(selected ? InventoryTheme.highlight : .clear, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
