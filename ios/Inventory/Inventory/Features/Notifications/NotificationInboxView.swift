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
                ProgressView(L10n.text("ui_loading_notifications_6eef5eb5"))
            } else if notifications.isEmpty {
                ContentUnavailableView {
                    Label(
                        unreadOnly ? L10n.text("ui_no_unread_notices_0de3e0a2") : L10n.text("ui_no_notifications_d4c242c5"),
                        systemImage: "bell.slash"
                    )
                } description: {
                    Text(
                        unreadOnly
                            ? L10n.text("ui_all_notices_have_been_read_4f979f6b")
                            : L10n.text("ui_new_stock_deadline_and_return_notices_appear_15a7c533")
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
        .navigationTitle(L10n.text("ui_notifications_f7205df4"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel(L10n.text("ui_notification_rules_154e021e"))

                Menu {
                    Toggle(L10n.text("ui_unread_only_e7f3c3d5"), isOn: $unreadOnly)

                    Button {
                        Task { await markAllRead() }
                    } label: {
                        Label(L10n.text("ui_mark_all_as_read_f5a8697d"), systemImage: "checkmark.circle")
                    }
                    .disabled(unreadCount == 0 || markingAllRead || organizationIsReadOnly)
                } label: {
                    Image(systemName: unreadCount > 0 ? "bell.badge.fill" : "bell")
                }
                .accessibilityLabel(L10n.text("ui_notification_options_0ef76186"))
                .accessibilityValue(
                    unreadCount == 1 ? L10n.text("ui_1_unread_8cde719b") : L10n.text("ui_0_unread_d2a37de5", unreadCount)
                )
            }
        }
        .task(id: loadKey) { await load() }
        .alert(
            L10n.text("ui_could_not_update_notifications_7252a324"),
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button(L10n.text("ui_retry_948643cb")) { Task { await load() } }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
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
                            .accessibilityLabel(L10n.text("ui_unread_de3a8021"))
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
                    Label(L10n.text("ui_inventory_item_unavailable_9d3512e1"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button(L10n.text("ui_retry_948643cb")) { Task { await load() } }
                }
            } else {
                ProgressView(L10n.text("ui_loading_item_b6c8e052"))
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
