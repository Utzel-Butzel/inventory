import SwiftUI

struct ActionChainReportCard: View {
    let report: ActionChainReport
    let completed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(completed ? (report.replayed == true ? "Bereits erledigt" : "Ablauf abgeschlossen") : "Diese Änderungen sind geplant", systemImage: completed ? "checkmark.circle.fill" : "checklist")
                .font(.title3.weight(.semibold))
                .foregroundStyle(completed ? InventoryTheme.success : .primary)
            if completed && report.replayed == true {
                Text("Dieser Code wurde bereits verarbeitet. Es wurde nichts doppelt gebucht.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Text(report.identifier).font(.caption.monospaced()).textSelection(.enabled)
            ForEach(Array(report.steps.enumerated()), id: \.offset) { index, step in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(index + 1)").font(.caption.bold())
                            .frame(width: 26, height: 26).background(.secondary.opacity(0.1), in: Circle())
                        Text(step.label).font(.headline)
                        Spacer(minLength: 0)
                    }
                    if step.skipped {
                        Text("Übersprungen").font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        if let target = step.target { Text(target).font(.subheadline.weight(.medium)) }
                        if let code = step.code { Text(code).font(.caption.monospaced()).textSelection(.enabled) }
                        if let before = step.quantityBefore, let after = step.quantityAfter, before != after {
                            Text("Bestand: \(before) → \(after)").font(.subheadline.monospacedDigit())
                        }
                        if let after = step.statusAfter, after != step.statusBefore {
                            Text("Status: \(statusName(after))").font(.subheadline)
                        }
                        if step.type == "set-location" {
                            Text("Standort: \(step.locationBefore ?? "Ohne Standort") → \(step.locationAfter ?? "Ohne Standort")").font(.subheadline)
                        }
                        ForEach(Array((step.components ?? []).enumerated()), id: \.offset) { _, component in
                            VStack(alignment: .leading, spacing: 3) {
                                Text("\(component.quantity) × \(component.name) verbauen").font(.subheadline)
                                if !component.codes.isEmpty { Text(component.codes.joined(separator: ", ")).font(.caption.monospaced()).foregroundStyle(.secondary) }
                            }
                        }
                        properties(step.metadata ?? [:])
                        properties(step.customFields ?? [:])
                        if step.eventName != nil {
                            Text("Meldung nach erfolgreichem Abschluss senden").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .inventoryCard()
    }

    private func properties(_ values: [String: ActionChainJSON]) -> some View {
        ForEach(values.keys.sorted(), id: \.self) { key in
            Text("\(key): \(values[key]?.display ?? "—")").font(.subheadline).textSelection(.enabled)
        }
    }
    private func statusName(_ status: String) -> String {
        ["available": "Verfügbar", "reserved": "Reserviert", "in-use": "In Benutzung", "maintenance": "Wartung", "consumed": "Verbraucht", "lost": "Verloren", "retired": "Ausgemustert"][status] ?? status
    }
}
