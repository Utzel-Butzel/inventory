import SwiftUI

struct RootView: View {
    @EnvironmentObject private var state: AppState
    @State private var searchQuery = ""
    @State private var presentedInventoryLink: InventoryLink?

    var body: some View {
        Group {
            if state.isRestoringSession || state.isVerifyingStoredCredential {
                sessionLoadingView
            } else if state.isConfigured {
                configuredContent
                    .disabled(state.isConnecting)
                    .overlay {
                        if state.isChangingConnection {
                            ProgressView(L10n.text("ui_switching_account"))
                                .padding(24)
                                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                        }
                    }
            } else if state.hasStoredToken || state.restorationFailed {
                sessionRecoveryView
            } else {
                SettingsView(onboarding: true)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: state.isConfigured)
        .onChange(of: state.organizationContextIdentifier) { _, _ in
            searchQuery = ""
        }
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

    private var sessionLoadingView: some View {
        VStack(spacing: 20) {
            Image(systemName: "shippingbox")
                .font(.system(size: 48))
                .foregroundStyle(InventoryTheme.accent)
            Text(L10n.text("ui_open_inventory_166dbd73")).font(.title2.bold())
            ProgressView(L10n.text("ui_restoring_session"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var sessionRecoveryView: some View {
        ContentUnavailableView {
            Label(L10n.text("ui_connection_unavailable"), systemImage: "wifi.exclamationmark")
        } description: {
            Text(state.configurationError ?? L10n.text("ui_connection_retry_hint"))
        } actions: {
            Button(L10n.text("ui_retry_session")) {
                Task { await state.retryRestoration() }
            }
            .buttonStyle(.borderedProminent)
            if !state.restorationFailed { AccountSwitcherMenu() }
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
            Tab(L10n.text("ui_inventory_d602900f"), systemImage: "shippingbox", value: RootTab.inventory) {
                primaryInventoryList
            }

            Tab(L10n.text("ui_map_36a8c499"), systemImage: "map", value: RootTab.map) {
                InventoryMapView()
            }

            if state.canReadSpatial {
                Tab(L10n.text("ui_rooms_c8bb1368"), systemImage: "cube.transparent", value: RootTab.rooms) {
                    SpatialRoomsView()
                }
            }

            Tab(L10n.text("ui_settings_f5750a5d"), systemImage: "gearshape", value: RootTab.settings) {
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
                    Label(L10n.text("ui_inventory_d602900f"), systemImage: "shippingbox")
                }
                .tag(RootTab.inventory)

            InventoryMapView()
                .tabItem {
                    Label(L10n.text("ui_map_36a8c499"), systemImage: "map")
                }
                .tag(RootTab.map)

            if state.canReadSpatial {
                SpatialRoomsView()
                    .tabItem {
                        Label(L10n.text("ui_rooms_c8bb1368"), systemImage: "cube.transparent")
                    }
                    .tag(RootTab.rooms)
            }

            SettingsView(onboarding: false)
                .tabItem {
                    Label(L10n.text("ui_settings_f5750a5d"), systemImage: "gearshape")
                }
                .tag(RootTab.settings)

            inventoryList(query: $searchQuery)
                .searchable(text: $searchQuery, prompt: L10n.text("ui_name_sku_tag_or_location_a7c32941"))
                .tabItem {
                    Label(L10n.text("ui_search_dd097e77"), systemImage: "magnifyingglass")
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
            .searchable(text: $searchQuery, prompt: L10n.text("ui_name_sku_tag_or_location_a7c32941"))
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
