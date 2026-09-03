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
                ProgressView("Einstellungen werden geladen …")
            } else if draft == nil {
                ContentUnavailableView {
                    Label("Einstellungen nicht verfügbar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage ?? "Die Benachrichtigungseinstellungen konnten nicht geladen werden.")
                } actions: {
                    Button("Erneut versuchen") { Task { await load() } }
                }
            } else {
                settingsForm
            }
        }
        .navigationTitle("Benachrichtigungsregeln")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Speichern") { Task { await save() } }
                    .disabled(!hasChanges || saving || organizationIsReadOnly)
            }
        }
        .task(id: state.client?.contextIdentifier) { await load() }
        .alert(
            "Aktion fehlgeschlagen",
            isPresented: Binding(
                get: { errorMessage != nil && draft != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
        .alert(
            "Kanalvorschau",
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
                        "Dieser Arbeitsbereich ist schreibgeschützt.",
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
                Text("Beobachtete Ereignisse")
            } footer: {
                Text("Diese Auswahl steuert das In-App-Postfach und alle aktivierten externen Kanäle.")
            }

            Section("Versandhäufigkeit") {
                Picker(
                    "Externe Zustellung",
                    selection: preferenceBinding(\.frequency, fallback: .daily)
                ) {
                    Text("Tägliche Zusammenfassung").tag(NotificationFrequency.daily)
                    Text("Sofort").tag(NotificationFrequency.immediate)
                }

                Stepper(
                    "Zusammenfassung um \(draft?.digestHour ?? 8) Uhr",
                    value: preferenceBinding(\.digestHour, fallback: 8),
                    in: 0 ... 23
                )
                .disabled(
                    draft?.frequency != .daily || saving || organizationIsReadOnly
                )

                TextField(
                    "Zeitzone",
                    text: preferenceBinding(\.timezone, fallback: "UTC")
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(saving || organizationIsReadOnly)

                Picker(
                    "Benachrichtigungssprache",
                    selection: preferenceBinding(\.locale, fallback: .german)
                ) {
                    Text("Deutsch").tag(NotificationLocale.german)
                    Text("English").tag(NotificationLocale.english)
                }

                Stepper(
                    "Mindestabstand: \(draft?.cooldownHours ?? 24) Stunden",
                    value: preferenceBinding(\.cooldownHours, fallback: 24),
                    in: 1 ... 720
                )
            }
            .disabled(saving || organizationIsReadOnly)

            Section {
                Stepper(
                    "Niedrigbestand: \(draft?.lowStockThresholdPercent ?? 100) % vom Minimum",
                    value: preferenceBinding(\.lowStockThresholdPercent, fallback: 100),
                    in: 1 ... 500
                )
                Stepper(
                    "Ablauf-Fenster: \(draft?.expiryWindowDays ?? 30) Tage",
                    value: preferenceBinding(\.expiryWindowDays, fallback: 30),
                    in: 0 ... 3_650
                )
                TextField(
                    "Feld für Ablaufdatum",
                    text: preferenceBinding(\.expiryFieldKey, fallback: "expiry_date")
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                Stepper(
                    "Wartungsfenster: \(draft?.maintenanceWindowDays ?? 7) Tage",
                    value: preferenceBinding(\.maintenanceWindowDays, fallback: 7),
                    in: 0 ... 3_650
                )
                TextField(
                    "Feld für Wartungsdatum",
                    text: preferenceBinding(\.maintenanceFieldKey, fallback: "maintenance_due")
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                Stepper(
                    "Rückgabefenster: \(draft?.returnDueWindowDays ?? 3) Tage",
                    value: preferenceBinding(\.returnDueWindowDays, fallback: 3),
                    in: 0 ... 365
                )
            } header: {
                Text("Schwellenwerte")
            } footer: {
                Text("Feldschlüssel beginnen mit einem Kleinbuchstaben und enthalten nur Kleinbuchstaben, Zahlen oder Unterstriche.")
            }
            .disabled(saving || organizationIsReadOnly)

            Section {
                LabeledContent {
                    Text("Immer aktiv")
                        .foregroundStyle(.green)
                } label: {
                    Label("In-App-Postfach", systemImage: "bell.fill")
                }

                externalChannelRow(.email)
                webPushRow
                externalChannelRow(.slack)
                externalChannelRow(.teams)
                externalChannelRow(.webhook)
            } header: {
                Text("Zustellkanäle")
            } footer: {
                Text("Externe Kanäle werden nur verwendet, wenn sie serverseitig eingerichtet und hier aktiviert sind.")
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
                Button("Vorschau") { Task { await preview(channel) } }
                    .font(.caption.weight(.semibold))
                    .disabled(previewingChannel != nil)
            }
        }
        .padding(.vertical, 3)
    }

    private var webPushRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledContent {
                Text(draft?.pushEnabled == true ? "Im Web aktiv" : "Inaktiv")
                    .foregroundStyle(.secondary)
            } label: {
                Label("Web Push", systemImage: "safari")
            }
            Text("Web Push ist an ein Browser-Abo gebunden und wird deshalb in der Webapp verwaltet.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Text(channelStatus(runtimeChannel(.push)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Vorschau") { Task { await preview(.push) } }
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
            noticeMessage = "Benachrichtigungseinstellungen gespeichert."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func validate(_ preference: NotificationPreference) -> Bool {
        let timezone = preference.timezone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard TimeZone(identifier: timezone) != nil else {
            errorMessage = "Gib eine gültige IANA-Zeitzone ein, zum Beispiel Europe/Berlin."
            return false
        }
        for fieldKey in [preference.expiryFieldKey, preference.maintenanceFieldKey] {
            let value = fieldKey.trimmingCharacters(in: .whitespacesAndNewlines)
            guard value.range(
                of: #"^[a-z][a-z0-9_]{0,63}$"#,
                options: .regularExpression
            ) != nil else {
                errorMessage = "Die Feldschlüssel dürfen nur Kleinbuchstaben, Zahlen und Unterstriche enthalten."
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
            let target = response.preview.target ?? "Kein Ziel konfiguriert"
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
        guard let runtime else { return "Status unbekannt" }
        guard runtime.configured else { return "Serverseitig nicht konfiguriert" }
        return runtime.target ?? "Serverseitig konfiguriert"
    }

    private func eventTitle(_ eventType: NotificationEventType) -> String {
        switch eventType {
        case .lowStock: "Niedriger Bestand"
        case .expiry: "Ablaufdatum"
        case .maintenance: "Wartung"
        case .returnDue: "Rückgabe fällig"
        }
    }

    private func eventDescription(_ eventType: NotificationEventType) -> String {
        switch eventType {
        case .lowStock: "Meldet, wenn der Bestand den festgelegten Anteil des Minimums erreicht."
        case .expiry: "Überwacht ein Datumsfeld auf bevorstehende oder überfällige Abläufe."
        case .maintenance: "Überwacht Wartungsstatus und das konfigurierte Wartungsdatum."
        case .returnDue: "Meldet fällige Ausleihen, Zuordnungen und Reservierungen."
        }
    }

    private func channelTitle(_ channel: NotificationChannel) -> String {
        switch channel {
        case .email: "E-Mail"
        case .push: "Web Push"
        case .slack: "Slack"
        case .teams: "Microsoft Teams"
        case .webhook: "Generischer Webhook"
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
