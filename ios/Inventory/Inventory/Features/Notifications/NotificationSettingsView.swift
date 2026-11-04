import Foundation
import SwiftUI

struct NotificationSettingsView: View {
    @EnvironmentObject private var state: AppState
    @State private var settings: NotificationSettingsResponse?
    @State private var draft: NotificationPreference?
    @State private var loading = false
    @State private var saving = false
    @State private var previewingChannel: NotificationChannel?
    @State private var errorMessage: String?
    @State private var noticeMessage: String?
    @State private var previewMessage: String?

    var body: some View {
        Group {
            if loading && draft == nil {
                ProgressView(L10n.text("ui_loading_settings_1ebc9020"))
            } else if draft == nil {
                ContentUnavailableView {
                    Label(L10n.text("ui_settings_unavailable_67d8548c"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage ?? L10n.text("ui_could_not_load_notification_settings_bd66d640"))
                } actions: {
                    Button(L10n.text("ui_retry_948643cb")) { Task { await load() } }
                }
            } else {
                settingsForm
            }
        }
        .navigationTitle(L10n.text("ui_notification_rules_154e021e"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(L10n.text("ui_save_f6b2ff39")) { Task { await save() } }
                    .disabled(!hasChanges || saving || organizationIsReadOnly)
            }
        }
        .task(id: state.client?.contextIdentifier) { await load() }
        .alert(
            L10n.text("ui_action_failed_3a20cc65"),
            isPresented: Binding(
                get: { errorMessage != nil && draft != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
        }
        .alert(
            L10n.text("ui_channel_preview_5264869f"),
            isPresented: Binding(
                get: { previewMessage != nil },
                set: { if !$0 { previewMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { previewMessage = nil }
        } message: {
            Text(previewMessage ?? "")
        }
    }

    private var settingsForm: some View {
        Form {
            if organizationIsReadOnly {
                Section {
                    Label(
                        L10n.text("ui_this_workspace_is_read_only_ca669940"),
                        systemImage: "lock.fill"
                    )
                    .foregroundStyle(.secondary)
                }
            }

            if let noticeMessage {
                Section {
                    Label(noticeMessage, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
            }

            Section {
                ForEach(NotificationEventType.allCases) { eventType in
                    Toggle(isOn: eventBinding(eventType)) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(eventTitle(eventType))
                            Text(eventDescription(eventType))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .disabled(saving || organizationIsReadOnly)
                }
            } header: {
                Text(L10n.text("ui_monitored_events_265b1428"))
            } footer: {
                Text(L10n.text("ui_this_selection_controls_the_in_app_inbox_182e4e21"))
            }

            Section(L10n.text("ui_delivery_frequency_1355c6ae")) {
                Picker(
                    L10n.text("ui_external_delivery_70da1701"),
                    selection: preferenceBinding(\.frequency, fallback: .daily)
                ) {
                    Text(L10n.text("ui_daily_summary_ea79c397")).tag(NotificationFrequency.daily)
                    Text(L10n.text("ui_immediate_02f195c0")).tag(NotificationFrequency.immediate)
                }

                Stepper(
                    L10n.text("ui_summary_at_0_00_6858f643", draft?.digestHour ?? 8),
                    value: preferenceBinding(\.digestHour, fallback: 8),
                    in: 0 ... 23
                )
                .disabled(
                    draft?.frequency != .daily || saving || organizationIsReadOnly
                )

                TextField(
                    L10n.text("ui_time_zone_00507b23"),
                    text: preferenceBinding(\.timezone, fallback: "UTC")
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(saving || organizationIsReadOnly)

                Picker(
                    L10n.text("ui_notification_language_c63c42c6"),
                    selection: preferenceBinding(\.locale, fallback: .german)
                ) {
                    Text("Deutsch").tag(NotificationLocale.german)
                    Text("English").tag(NotificationLocale.english)
                }

                Stepper(
                    L10n.text("ui_minimum_interval_0_hours_92dfaa9e", draft?.cooldownHours ?? 24),
                    value: preferenceBinding(\.cooldownHours, fallback: 24),
                    in: 1 ... 720
                )
            }
            .disabled(saving || organizationIsReadOnly)

            Section {
                Stepper(
                    L10n.text("ui_low_stock_0_of_minimum_c405fd6b", draft?.lowStockThresholdPercent ?? 100),
                    value: preferenceBinding(\.lowStockThresholdPercent, fallback: 100),
                    in: 1 ... 500
                )
                Stepper(
                    L10n.text("ui_expiry_window_0_days_3a847fff", draft?.expiryWindowDays ?? 30),
                    value: preferenceBinding(\.expiryWindowDays, fallback: 30),
                    in: 0 ... 3_650
                )
                TextField(
                    L10n.text("ui_expiry_date_field_a59b7f17"),
                    text: preferenceBinding(\.expiryFieldKey, fallback: "expiry_date")
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                Stepper(
                    L10n.text("ui_maintenance_window_0_days_c7ec66ba", draft?.maintenanceWindowDays ?? 7),
                    value: preferenceBinding(\.maintenanceWindowDays, fallback: 7),
                    in: 0 ... 3_650
                )
                TextField(
                    L10n.text("ui_maintenance_date_field_18928d32"),
                    text: preferenceBinding(\.maintenanceFieldKey, fallback: "maintenance_due")
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                Stepper(
                    L10n.text("ui_return_window_0_days_94b0ccf8", draft?.returnDueWindowDays ?? 3),
                    value: preferenceBinding(\.returnDueWindowDays, fallback: 3),
                    in: 0 ... 365
                )
            } header: {
                Text(L10n.text("ui_thresholds_3f793122"))
            } footer: {
                Text(L10n.text("ui_field_keys_start_with_a_lowercase_letter_cff12e57"))
            }
            .disabled(saving || organizationIsReadOnly)

            Section {
                LabeledContent {
                    Text(L10n.text("ui_always_active_af0f7411"))
                        .foregroundStyle(.green)
                } label: {
                    Label(L10n.text("ui_in_app_inbox_f7bd0e62"), systemImage: "bell.fill")
                }

                externalChannelRow(.email)
                webPushRow
                externalChannelRow(.slack)
                externalChannelRow(.teams)
                externalChannelRow(.webhook)
            } header: {
                Text(L10n.text("ui_delivery_channels_c06a4d3b"))
            } footer: {
                Text(L10n.text("ui_external_channels_are_only_used_when_configured_2b731df0"))
            }
        }
        .refreshable { await load() }
    }

    private func externalChannelRow(_ channel: NotificationChannel) -> some View {
        let runtime = runtimeChannel(channel)
        return VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: channelBinding(channel)) {
                Label(channelTitle(channel), systemImage: channelSymbol(channel))
            }
            .disabled(
                runtime?.configured != true || saving || organizationIsReadOnly
            )

            HStack(alignment: .firstTextBaseline) {
                Text(channelStatus(runtime))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(L10n.text("ui_preview_69337f6d")) { Task { await preview(channel) } }
                    .font(.caption.weight(.semibold))
                    .disabled(previewingChannel != nil)
            }
        }
        .padding(.vertical, 3)
    }

    private var webPushRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledContent {
                Text(draft?.pushEnabled == true ? L10n.text("ui_active_on_the_web_42ed9f38") : L10n.text("ui_disabled_bf7c9171"))
                    .foregroundStyle(.secondary)
            } label: {
                Label(L10n.text("ui_web_push_4ba2056e"), systemImage: "safari")
            }
            Text(L10n.text("ui_web_push_is_linked_to_a_browser_d30fb116"))
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Text(channelStatus(runtimeChannel(.push)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(L10n.text("ui_preview_69337f6d")) { Task { await preview(.push) } }
                    .font(.caption.weight(.semibold))
                    .disabled(previewingChannel != nil)
            }
        }
        .padding(.vertical, 3)
    }

    private var hasChanges: Bool {
        guard let original = settings?.preference, let draft else { return false }
        return original != draft
    }

    private var organizationIsReadOnly: Bool {
        state.activeOrganization?.isReadOnly == true
    }

    private func preferenceBinding<Value>(
        _ keyPath: WritableKeyPath<NotificationPreference, Value>,
        fallback: Value
    ) -> Binding<Value> {
        Binding(
            get: { draft?[keyPath: keyPath] ?? fallback },
            set: { value in draft?[keyPath: keyPath] = value }
        )
    }

    private func eventBinding(_ eventType: NotificationEventType) -> Binding<Bool> {
        Binding(
            get: { draft?.enabledEventTypes.contains(eventType) == true },
            set: { enabled in
                guard var eventTypes = draft?.enabledEventTypes else { return }
                if enabled {
                    if !eventTypes.contains(eventType) { eventTypes.append(eventType) }
                } else {
                    eventTypes.removeAll { $0 == eventType }
                }
                draft?.enabledEventTypes = eventTypes
            }
        )
    }

    private func channelBinding(_ channel: NotificationChannel) -> Binding<Bool> {
        switch channel {
        case .email:
            preferenceBinding(\.emailEnabled, fallback: false)
        case .push:
            preferenceBinding(\.pushEnabled, fallback: false)
        case .slack:
            preferenceBinding(\.slackEnabled, fallback: false)
        case .teams:
            preferenceBinding(\.teamsEnabled, fallback: false)
        case .webhook:
            preferenceBinding(\.webhookEnabled, fallback: false)
        }
    }

    private func load() async {
        guard let client = state.client else { return }
        loading = true
        defer { loading = false }
        do {
            let response = try await client.notificationSettings()
            try Task.checkCancellation()
            settings = response
            draft = response.preference
            errorMessage = nil
            noticeMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func save() async {
        guard !organizationIsReadOnly, let client = state.client, let draft else { return }
        guard validate(draft) else { return }
        saving = true
        defer { saving = false }
        do {
            let response = try await client.updateNotificationSettings(
                NotificationPreferenceUpdateRequest(preference: draft)
            )
            settings = settings.map {
                NotificationSettingsResponse(
                    preference: response.preference,
                    runtime: $0.runtime,
                    pushSubscriptionCount: $0.pushSubscriptionCount
                )
            }
            self.draft = response.preference
            errorMessage = nil
            noticeMessage = L10n.text("ui_notification_settings_saved_055f8d25")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func validate(_ preference: NotificationPreference) -> Bool {
        let timezone = preference.timezone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard TimeZone(identifier: timezone) != nil else {
            errorMessage = L10n.text("ui_enter_a_valid_iana_time_zone_such_2cd53870")
            return false
        }
        for fieldKey in [preference.expiryFieldKey, preference.maintenanceFieldKey] {
            let value = fieldKey.trimmingCharacters(in: .whitespacesAndNewlines)
            guard value.range(
                of: #"^[a-z][a-z0-9_]{0,63}$"#,
                options: .regularExpression
            ) != nil else {
                errorMessage = L10n.text("ui_field_keys_may_only_contain_lowercase_letters_6e57f3bd")
                return false
            }
        }
        return true
    }

    private func preview(_ channel: NotificationChannel) async {
        guard let client = state.client else { return }
        previewingChannel = channel
        defer { previewingChannel = nil }
        do {
            let response = try await client.previewNotificationChannel(channel)
            let target = response.preview.target ?? L10n.text("ui_no_destination_configured_25942135")
            let events = response.preview.events
                .map { "\($0.title): \($0.body)" }
                .joined(separator: "\n")
            previewMessage = [response.preview.subject, target, events]
                .filter { !$0.isEmpty }
                .joined(separator: "\n\n")
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func runtimeChannel(_ channel: NotificationChannel) -> NotificationRuntimeChannel? {
        guard let runtime = settings?.runtime else { return nil }
        return switch channel {
        case .email: runtime.email
        case .push: runtime.push
        case .slack: runtime.slack
        case .teams: runtime.teams
        case .webhook: runtime.webhook
        }
    }

    private func channelStatus(_ runtime: NotificationRuntimeChannel?) -> String {
        guard let runtime else { return L10n.text("ui_status_unknown_19b3e98c") }
        guard runtime.configured else { return L10n.text("ui_not_configured_on_server_041e9095") }
        return runtime.target ?? L10n.text("ui_configured_on_server_7410f333")
    }

    private func eventTitle(_ eventType: NotificationEventType) -> String {
        switch eventType {
        case .lowStock: L10n.text("ui_low_stock_a6c3211e")
        case .expiry: L10n.text("ui_expiry_fa1bc3d0")
        case .maintenance: L10n.text("ui_maintenance_854f69bd")
        case .returnDue: L10n.text("ui_return_due_dcfd59d6")
        }
    }

    private func eventDescription(_ eventType: NotificationEventType) -> String {
        switch eventType {
        case .lowStock: L10n.text("ui_notifies_when_stock_reaches_the_configured_proportion_79eed1a5")
        case .expiry: L10n.text("ui_monitors_a_date_field_for_upcoming_or_866e3b92")
        case .maintenance: L10n.text("ui_monitors_maintenance_status_and_the_configured_maintenance_cbaa3ea5")
        case .returnDue: L10n.text("ui_notifies_about_due_loans_assignments_and_reservations_cc58cffe")
        }
    }

    private func channelTitle(_ channel: NotificationChannel) -> String {
        switch channel {
        case .email: L10n.text("ui_email_2fae6fb3")
        case .push: L10n.text("ui_web_push_4ba2056e")
        case .slack: L10n.text("ui_slack_b27fb38b")
        case .teams: L10n.text("ui_microsoft_teams_a7b52b26")
        case .webhook: L10n.text("ui_generic_webhook_a9d57a3e")
        }
    }

    private func channelSymbol(_ channel: NotificationChannel) -> String {
        switch channel {
        case .email: "envelope.fill"
        case .push: "safari"
        case .slack, .teams: "message.fill"
        case .webhook: "point.3.connected.trianglepath.dotted"
        }
    }
}
