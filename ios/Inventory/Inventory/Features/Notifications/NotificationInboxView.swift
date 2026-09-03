import SwiftUI

struct NotificationInboxView: View {
    @EnvironmentObject private var state: AppState
    @State private var notifications: [InventoryNotification] = []
    @State private var unreadCount = 0
    @State private var unreadOnly = false
    @State private var loading = false
    @State private var markingAllRead = false
    @State private var updatingIDs: Set<UUID> = []
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if loading && notifications.isEmpty {
                ProgressView("Benachrichtigungen werden geladen …")
            } else if notifications.isEmpty {
                ContentUnavailableView {
                    Label(
                        unreadOnly ? "Keine ungelesenen Hinweise" : "Keine Benachrichtigungen",
                        systemImage: "bell.slash"
                    )
                } description: {
                    Text(
                        unreadOnly
                            ? "Alle Hinweise wurden gelesen."
                            : "Neue Bestands-, Frist- und Rückgabehinweise erscheinen hier."
                    )
                }
            } else {
                List(notifications) { notification in
                    notificationRow(notification)
                }
                .listStyle(.plain)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Benachrichtigungen")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("Benachrichtigungsregeln")

                Menu {
                    Toggle("Nur ungelesene", isOn: $unreadOnly)

                    Button {
                        Task { await markAllRead() }
                    } label: {
                        Label("Alle als gelesen markieren", systemImage: "checkmark.circle")
                    }
                    .disabled(unreadCount == 0 || markingAllRead || organizationIsReadOnly)
                } label: {
                    Image(systemName: unreadCount > 0 ? "bell.badge.fill" : "bell")
                }
                .accessibilityLabel("Benachrichtigungsoptionen")
                .accessibilityValue(
                    unreadCount == 1 ? "1 ungelesen" : "\(unreadCount) ungelesen"
                )
            }
        }
        .task(id: loadKey) { await load() }
        .alert(
            "Benachrichtigungen konnten nicht aktualisiert werden",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("Erneut versuchen") { Task { await load() } }
            Button("Abbrechen", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
    }

    @ViewBuilder
    private func notificationRow(_ notification: InventoryNotification) -> some View {
        if let resourceID = notification.resourceID {
            NavigationLink {
                NotificationResourceDestinationView(resourceID: resourceID)
            } label: {
                notificationLabel(notification)
            }
            .simultaneousGesture(
                TapGesture().onEnded { markReadIfNeeded(notification) }
            )
        } else {
            Button {
                markReadIfNeeded(notification)
            } label: {
                notificationLabel(notification)
            }
            .buttonStyle(.plain)
        }
    }

    private func notificationLabel(_ notification: InventoryNotification) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbolName(for: notification.eventType))
                .font(.title3)
                .foregroundStyle(tint(for: notification.eventType))
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(notification.title)
                        .font(notification.readAt == nil ? .headline : .body)
                    Spacer(minLength: 4)
                    if notification.readAt == nil {
                        Circle()
                            .fill(InventoryTheme.accent)
                            .frame(width: 8, height: 8)
                            .accessibilityLabel("Ungelesen")
                    }
                }
                Text(notification.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(notification.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            if updatingIDs.contains(notification.id) {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }

    private var loadKey: NotificationLoadKey {
        NotificationLoadKey(
            contextIdentifier: state.client?.contextIdentifier,
            unreadOnly: unreadOnly
        )
    }

    private var organizationIsReadOnly: Bool {
        state.activeOrganization?.isReadOnly == true
    }

    private func load() async {
        guard let client = state.client else { return }
        loading = true
        defer { loading = false }
        do {
            let response = try await client.listNotifications(unreadOnly: unreadOnly)
            try Task.checkCancellation()
            notifications = response.notifications
            unreadCount = response.unread
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func markReadIfNeeded(_ notification: InventoryNotification) {
        guard notification.readAt == nil,
              !organizationIsReadOnly,
              !updatingIDs.contains(notification.id),
              let client = state.client else { return }
        updatingIDs.insert(notification.id)
        Task {
            defer { updatingIDs.remove(notification.id) }
            do {
                let response = try await client.markNotificationRead(id: notification.id)
                unreadCount = max(0, unreadCount - 1)
                if unreadOnly {
                    withAnimation {
                        notifications.removeAll { $0.id == notification.id }
                    }
                } else if let index = notifications.firstIndex(where: { $0.id == notification.id }) {
                    notifications[index] = response.notification
                }
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func markAllRead() async {
        guard !organizationIsReadOnly,
              unreadCount > 0,
              let client = state.client else { return }
        markingAllRead = true
        defer { markingAllRead = false }
        do {
            _ = try await client.markAllNotificationsRead()
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func symbolName(for eventType: String) -> String {
        switch eventType {
        case "low_stock": "shippingbox.fill"
        case "expiry": "calendar.badge.exclamationmark"
        case "maintenance": "wrench.and.screwdriver.fill"
        case "return_due": "arrow.uturn.backward.circle.fill"
        default: "bell.fill"
        }
    }

    private func tint(for eventType: String) -> Color {
        switch eventType {
        case "low_stock", "expiry": .orange
        case "maintenance": .blue
        case "return_due": .purple
        default: InventoryTheme.accent
        }
    }
}

private struct NotificationLoadKey: Hashable {
    let contextIdentifier: String?
    let unreadOnly: Bool
}

private struct NotificationResourceDestinationView: View {
    @EnvironmentObject private var state: AppState
    let resourceID: UUID
    @State private var resource: InventoryResource?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let resource {
                ResourceDetailView(resource: resource)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Eintrag nicht verfügbar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Erneut versuchen") { Task { await load() } }
                }
            } else {
                ProgressView("Eintrag wird geladen …")
            }
        }
        .task(id: state.client?.contextIdentifier) { await load() }
    }

    private func load() async {
        guard let client = state.client else { return }
        do {
            resource = try await client.getResource(id: resourceID)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
