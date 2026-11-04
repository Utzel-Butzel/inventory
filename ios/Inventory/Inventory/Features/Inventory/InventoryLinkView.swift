import SwiftUI

struct InventoryLinkView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var resource: InventoryResource?
    @State private var errorMessage: String?
    let link: InventoryLink

    private var serverMatches: Bool {
        state.client.map { link.matches(server: $0.serverURL) } ?? false
    }

    var body: some View {
        Group {
            if !state.isConfigured || !serverMatches {
                VStack(spacing: 0) {
                    Text(L10n.text("ui_sign_in_to_this_label_s_server_a702e7ad"))
                        .font(.callout)
                        .padding()
                    SettingsView(onboarding: true, initialServer: link.serverURL?.absoluteString)
                }
            } else if !link.matches(organization: state.activeOrganization) {
                NavigationStack {
                    VStack(spacing: 16) {
                        Text(L10n.text("ui_this_label_belongs_to_organization_0_9e9ee47b", link.organization ?? ""))
                        ForEach(state.organizations.filter { link.matches(organization: $0) }) { organization in
                            Button(L10n.text("ui_switch_to_0_9f038d19", organization.name)) {
                                Task {
                                    do { try await state.switchOrganization(to: organization.id) }
                                    catch { errorMessage = error.localizedDescription }
                                }
                            }
                            .disabled(state.isSwitchingOrganization)
                        }
                        Text(errorMessage ?? L10n.text("ui_select_the_matching_organization_if_it_is_cfc1ee35"))
                            .foregroundStyle(.secondary)
                        Button(L10n.text("ui_close_b808f6e9")) { dismiss() }
                    }
                    .padding()
                }
            } else {
                destination
                    .id(state.organizationContextIdentifier)
            }
        }
        .task(id: state.organizationContextIdentifier) {
            resource = nil
            errorMessage = nil
            guard let client = state.client, state.isConfigured,
                  link.matches(server: client.serverURL),
                  link.matches(organization: state.activeOrganization) else { return }
            do {
                let result = try await client.lookupResource(code: link.resourceID.uuidString)
                try Task.checkCancellation()
                resource = result.resource
            } catch is CancellationError {
                // Changing server/organization cancels the previous lookup.
            } catch {
                if !Task.isCancelled { errorMessage = error.localizedDescription }
            }
        }
    }

    @ViewBuilder
    private var destination: some View {
        if let resource {
            if let unitID = link.unitID {
                StockManagementView(resource: resource, selectedUnitID: unitID)
            } else {
                NavigationStack {
                    ResourceDetailView(resource: resource)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button(L10n.text("ui_close_b808f6e9")) { dismiss() }
                            }
                        }
                }
            }
        } else if let errorMessage {
            ContentUnavailableView(L10n.text("ui_inventory_item_unavailable_9d3512e1"), systemImage: "exclamationmark.triangle", description: Text(errorMessage))
        } else {
            ProgressView(L10n.text("ui_opening_item_b8088698"))
        }
    }
}
