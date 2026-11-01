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
                    Text("Melde dich am Server dieses Labels an. Der Eintrag wird danach geöffnet.")
                        .font(.callout)
                        .padding()
                    SettingsView(onboarding: true, initialServer: link.serverURL?.absoluteString)
                }
            } else if !link.matches(organization: state.activeOrganization) {
                NavigationStack {
                    VStack(spacing: 16) {
                        Text("Dieses Label gehört zur Organisation \(link.organization ?? "").")
                        ForEach(state.organizations.filter { link.matches(organization: $0) }) { organization in
                            Button("Zu \(organization.name) wechseln") {
                                Task {
                                    do { try await state.switchOrganization(to: organization.id) }
                                    catch { errorMessage = error.localizedDescription }
                                }
                            }
                            .disabled(state.isSwitchingOrganization)
                        }
                        Text(errorMessage ?? "Wähle die passende Organisation. Falls sie fehlt, prüfe den Zugriff deines Kontos.")
                            .foregroundStyle(.secondary)
                        Button("Schließen") { dismiss() }
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
                                Button("Schließen") { dismiss() }
                            }
                        }
                }
            }
        } else if let errorMessage {
            ContentUnavailableView("Eintrag nicht verfügbar", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
        } else {
            ProgressView("Eintrag wird geöffnet …")
        }
    }
}
