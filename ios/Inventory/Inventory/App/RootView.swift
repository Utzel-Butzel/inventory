import SwiftUI

struct RootView: View {
    @EnvironmentObject private var state: AppState
    @State private var searchQuery = ""
    @State private var presentedInventoryLink: InventoryLink?

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
        .onChange(of: state.pendingInventoryLink?.id, initial: true) { _, _ in
            if state.presentedTool != nil {
                // Wait for an active camera presentation to finish dismissing.
                state.presentedTool = nil
            } else {
                presentedInventoryLink = state.pendingInventoryLink
            }
        }
        .sheet(item: $presentedInventoryLink, onDismiss: {
            state.pendingInventoryLink = nil
        }) { link in
            InventoryLinkView(link: link)
                .id(link.id)
        }
    }

    private var configuredContent: some View {
        configuredTabs
            .id(state.organizationContextIdentifier)
            .fullScreenCover(isPresented: toolIsPresented, onDismiss: {
                presentedInventoryLink = state.pendingInventoryLink
            }) {
                presentedTool
            }
    }

    @ViewBuilder
    private var configuredTabs: some View {
        if #available(iOS 18.0, *) {
            modernTabs
        } else {
            legacyTabs
        }
    }

    @available(iOS 18.0, *)
    @ViewBuilder
    private var modernTabs: some View {
        if #available(iOS 26.0, *) {
            modernTabView
                .tabViewSearchActivation(.searchTabSelection)
        } else {
            modernTabView
        }
    }

    @available(iOS 18.0, *)
    private var modernTabView: some View {
        TabView(selection: $state.selectedTab) {
            Tab("Inventar", systemImage: "shippingbox", value: RootTab.inventory) {
                primaryInventoryList
            }

            Tab("Karte", systemImage: "map", value: RootTab.map) {
                InventoryMapView()
            }

            if state.canReadSpatial {
                Tab("Räume", systemImage: "cube.transparent", value: RootTab.rooms) {
                    SpatialRoomsView()
                }
            }

            Tab("Einstellungen", systemImage: "gearshape", value: RootTab.settings) {
                SettingsView(onboarding: false)
            }

            Tab(value: RootTab.search, role: .search) {
                searchableInventoryList
            }
        }
    }

    private var legacyTabs: some View {
        TabView(selection: $state.selectedTab) {
            primaryInventoryList
                .tabItem {
                    Label("Inventar", systemImage: "shippingbox")
                }
                .tag(RootTab.inventory)

            InventoryMapView()
                .tabItem {
                    Label("Karte", systemImage: "map")
                }
                .tag(RootTab.map)

            if state.canReadSpatial {
                SpatialRoomsView()
                    .tabItem {
                        Label("Räume", systemImage: "cube.transparent")
                    }
                    .tag(RootTab.rooms)
            }

            SettingsView(onboarding: false)
                .tabItem {
                    Label("Einstellungen", systemImage: "gearshape")
                }
                .tag(RootTab.settings)

            inventoryList(query: $searchQuery)
                .searchable(text: $searchQuery, prompt: "Name, SKU, Tag oder Ort")
                .tabItem {
                    Label("Suchen", systemImage: "magnifyingglass")
                }
                .tag(RootTab.search)
        }
    }

    @ViewBuilder
    private var primaryInventoryList: some View {
        if #available(iOS 26.0, *) {
            inventoryList(query: .constant(""))
                .toolbar(removing: .search)
        } else {
            inventoryList(query: .constant(""))
        }
    }

    private var searchableInventoryList: some View {
        searchInventoryList
            .searchable(text: $searchQuery, prompt: "Name, SKU, Tag oder Ort")
    }

    @ViewBuilder
    private var searchInventoryList: some View {
        if #available(iOS 26.0, *) {
            inventoryList(query: $searchQuery)
                .toolbar(removing: .search)
        } else {
            inventoryList(query: $searchQuery)
        }
    }

    private func inventoryList(query: Binding<String>) -> some View {
        InventoryListView(
            query: query,
            onCapture: { state.presentedTool = .capture },
            onScan: { state.presentedTool = .scanner }
        )
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
            if state.canCaptureInventory {
                UnifiedCameraView(
                    initialMode: .capture,
                    maximumUploadImagePixelSize: state.maximumUploadImagePixelSize,
                    onClose: { state.presentedTool = nil },
                    onSubmit: { state.intakeQueue.enqueue($0) }
                )
            }
        case .scanner:
            UnifiedCameraView(
                initialMode: .scan,
                maximumUploadImagePixelSize: state.maximumUploadImagePixelSize,
                onClose: { state.presentedTool = nil },
                onSubmit: { state.intakeQueue.enqueue($0) }
            )
        case nil:
            EmptyView()
        }
    }
}
