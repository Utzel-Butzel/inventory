import SwiftUI

struct CustomFieldEditorSection: View {
    let definitions: [CustomFieldDefinition]
    let client: APIClient?
    @Binding var values: [String: CustomFieldValue]
    @Binding var numberDrafts: [String: String]

    var body: some View {
        Section("Benutzerdefinierte Felder") {
            ForEach(definitions) { definition in
                field(definition)
            }
        }
    }

    @ViewBuilder
    private func field(_ definition: CustomFieldDefinition) -> some View {
        switch definition.fieldType {
        case .text, .email, .url:
            TextField(
                placeholder(for: definition),
                text: stringBinding(for: definition.key)
            )
            .textInputAutocapitalization(definition.fieldType == .text ? .sentences : .never)
            .autocorrectionDisabled(definition.fieldType != .text)
            .keyboardType(keyboardType(for: definition.fieldType))
            .labeled(definition)

        case .textarea:
            TextField(
                placeholder(for: definition),
                text: stringBinding(for: definition.key),
                axis: .vertical
            )
            .lineLimit(3 ... 8)
            .labeled(definition)

        case .number:
            TextField(
                placeholder(for: definition),
                text: numberBinding(for: definition)
            )
            .keyboardType(.decimalPad)
            .labeled(definition)

        case .boolean:
            Toggle(label(for: definition), isOn: booleanBinding(for: definition.key))

        case .date:
            TextField("JJJJ-MM-TT", text: stringBinding(for: definition.key))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .labeled(definition)

        case .datetime:
            TextField("JJJJ-MM-TTThh:mm:ssZ", text: stringBinding(for: definition.key))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .labeled(definition)

        case .select:
            Picker(label(for: definition), selection: stringBinding(for: definition.key)) {
                if !definition.required {
                    Text("Keine Auswahl").tag("")
                }
                ForEach(definition.options) { option in
                    Text(option.label).tag(option.value)
                }
            }

        case .multiSelect:
            Menu {
                ForEach(definition.options) { option in
                    Button {
                        toggle(option.value, for: definition.key)
                    } label: {
                        if selectedStrings(for: definition.key).contains(option.value) {
                            Label(option.label, systemImage: "checkmark")
                        } else {
                            Text(option.label)
                        }
                    }
                }
                if !selectedStrings(for: definition.key).isEmpty {
                    Divider()
                    Button("Auswahl löschen", role: .destructive) {
                        values.removeValue(forKey: definition.key)
                    }
                }
            } label: {
                LabeledContent(
                    label(for: definition),
                    value: selectedOptionLabels(for: definition)
                )
            }

        case .reference:
            CustomFieldReferenceField(
                definition: definition,
                client: client,
                value: valueBinding(for: definition.key)
            )
        }

        if !definition.description.isEmpty {
            Text(definition.description)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func label(for definition: CustomFieldDefinition) -> String {
        definition.required ? "\(definition.label) *" : definition.label
    }

    private func placeholder(for definition: CustomFieldDefinition) -> String {
        definition.placeholder.isEmpty ? definition.label : definition.placeholder
    }

    private func keyboardType(for type: CustomFieldValueType) -> UIKeyboardType {
        switch type {
        case .email: .emailAddress
        case .url: .URL
        default: .default
        }
    }

    private func stringBinding(for key: String) -> Binding<String> {
        Binding(
            get: {
                guard case .string(let value) = values[key] else { return "" }
                return value
            },
            set: { value in
                if value.isEmpty {
                    values.removeValue(forKey: key)
                } else {
                    values[key] = .string(value)
                }
            }
        )
    }

    private func numberBinding(for definition: CustomFieldDefinition) -> Binding<String> {
        Binding(
            get: {
                if let draft = numberDrafts[definition.key] { return draft }
                guard case .number(let value) = values[definition.key] else { return "" }
                return value.formatted(.number.grouping(.never))
            },
            set: { draft in
                numberDrafts[definition.key] = draft
                let normalized = draft.replacingOccurrences(of: ",", with: ".")
                if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    values.removeValue(forKey: definition.key)
                } else if let value = Double(normalized) {
                    values[definition.key] = .number(value)
                }
            }
        )
    }

    private func booleanBinding(for key: String) -> Binding<Bool> {
        Binding(
            get: {
                guard case .boolean(let value) = values[key] else { return false }
                return value
            },
            set: { values[key] = .boolean($0) }
        )
    }

    private func valueBinding(for key: String) -> Binding<CustomFieldValue?> {
        Binding(
            get: { values[key] },
            set: { newValue in
                if let newValue {
                    values[key] = newValue
                } else {
                    values.removeValue(forKey: key)
                }
            }
        )
    }

    private func selectedStrings(for key: String) -> [String] {
        guard case .strings(let selected) = values[key] else { return [] }
        return selected
    }

    private func toggle(_ option: String, for key: String) {
        var selected = selectedStrings(for: key)
        if let index = selected.firstIndex(of: option) {
            selected.remove(at: index)
        } else {
            selected.append(option)
        }
        if selected.isEmpty {
            values.removeValue(forKey: key)
        } else {
            values[key] = .strings(selected)
        }
    }

    private func selectedOptionLabels(for definition: CustomFieldDefinition) -> String {
        let selected = Set(selectedStrings(for: definition.key))
        let labels = definition.options.filter { selected.contains($0.value) }.map(\.label)
        return labels.isEmpty ? "Keine Auswahl" : labels.joined(separator: ", ")
    }
}

private struct CustomFieldReferenceField: View {
    let definition: CustomFieldDefinition
    let client: APIClient?
    @Binding var value: CustomFieldValue?
    @State private var resolvedOptions: [CustomFieldReferenceOption] = []

    var body: some View {
        NavigationLink {
            CustomFieldReferenceSelectionView(
                definition: definition,
                client: client,
                value: $value
            )
        } label: {
            LabeledContent(label, value: selectionLabel)
        }
        .task(id: selectedIDs) {
            guard let client, !selectedIDs.isEmpty else {
                resolvedOptions = []
                return
            }
            do {
                resolvedOptions = try await client.customFieldReferenceOptions(
                    definitionID: definition.id,
                    selectedIDs: selectedIDs
                ).options
            } catch {
                resolvedOptions = []
            }
        }
    }

    private var label: String {
        definition.required ? "\(definition.label) *" : definition.label
    }

    private var selectedIDs: [String] {
        switch value {
        case .string(let identifier): [identifier]
        case .strings(let identifiers): identifiers
        default: []
        }
    }

    private var selectionLabel: String {
        guard !selectedIDs.isEmpty else { return "Keine Auswahl" }
        let labelsByID = Dictionary(uniqueKeysWithValues: resolvedOptions.map { ($0.id, $0.label) })
        return selectedIDs.map { labelsByID[$0] ?? $0 }.joined(separator: ", ")
    }
}

private struct CustomFieldReferenceSelectionView: View {
    let definition: CustomFieldDefinition
    let client: APIClient?
    @Binding var value: CustomFieldValue?
    @State private var query = ""
    @State private var options: [CustomFieldReferenceOption] = []
    @State private var loading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if !definition.required && !selectedIDs.isEmpty {
                Button("Auswahl löschen", role: .destructive) { value = nil }
            }
            ForEach(options) { option in
                Button {
                    select(option.id)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(option.label).foregroundStyle(.primary)
                            if !option.description.isEmpty {
                                Text(option.description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if selectedIDs.contains(option.id) {
                            Image(systemName: "checkmark.circle.fill")
                        }
                    }
                }
            }
            if loading { ProgressView().frame(maxWidth: .infinity) }
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
        }
        .navigationTitle(definition.label)
        .searchable(text: $query, prompt: "Suchen")
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            guard !Task.isCancelled, let client else { return }
            loading = true
            errorMessage = nil
            defer { loading = false }
            do {
                options = try await client.customFieldReferenceOptions(
                    definitionID: definition.id,
                    query: query,
                    selectedIDs: selectedIDs
                ).options
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private var selectedIDs: [String] {
        switch value {
        case .string(let identifier): [identifier]
        case .strings(let identifiers): identifiers
        default: []
        }
    }

    private func select(_ identifier: String) {
        if definition.referenceMultiple == true {
            var identifiers = selectedIDs
            if let index = identifiers.firstIndex(of: identifier) {
                identifiers.remove(at: index)
            } else {
                identifiers.append(identifier)
            }
            value = identifiers.isEmpty ? nil : .strings(identifiers)
        } else {
            value = .string(identifier)
        }
    }
}

private extension View {
    @ViewBuilder
    func labeled(_ definition: CustomFieldDefinition) -> some View {
        LabeledContent(definition.required ? "\(definition.label) *" : definition.label) {
            self.multilineTextAlignment(.trailing)
        }
    }
}
