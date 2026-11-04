import SwiftUI

struct ActionChainReportCard: View {
    let report: ActionChainReport
    let completed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(completed ? (report.replayed == true ? L10n.text("ui_already_completed_8cb1f3fb") : L10n.text("ui_workflow_completed_bbb13de6")) : L10n.text("ui_these_changes_are_planned_472703f9"), systemImage: completed ? "checkmark.circle.fill" : "checklist")
                .font(.title3.weight(.semibold))
                .foregroundStyle(completed ? InventoryTheme.success : .primary)
            if completed && report.replayed == true {
                Text(L10n.text("ui_this_code_has_already_been_processed_nothing_70454060"))
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
                        Text(L10n.text("ui_skipped_538eb08f")).font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        if let target = step.target { Text(target).font(.subheadline.weight(.medium)) }
                        if let code = step.code { Text(code).font(.caption.monospaced()).textSelection(.enabled) }
                        if let before = step.quantityBefore, let after = step.quantityAfter, before != after {
                            Text(L10n.text("ui_stock_0_1_e8afd637", before, after)).font(.subheadline.monospacedDigit())
                        }
                        if let after = step.statusAfter, after != step.statusBefore {
                            Text(L10n.text("ui_status_0_390591ea", statusName(after))).font(.subheadline)
                        }
                        if step.type == "set-location" {
                            Text(L10n.text("ui_location_0_1_ec3855f5", step.locationBefore ?? "Ohne Standort", step.locationAfter ?? "Ohne Standort")).font(.subheadline)
                        }
                        ForEach(Array((step.components ?? []).enumerated()), id: \.offset) { _, component in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(L10n.text("ui_use_0_1_4f9f7dd0", component.quantity, component.name)).font(.subheadline)
                                if !component.codes.isEmpty { Text(component.codes.joined(separator: ", ")).font(.caption.monospaced()).foregroundStyle(.secondary) }
                            }
                        }
                        properties(step.metadata ?? [:])
                        properties(step.customFields ?? [:])
                        if step.eventName != nil {
                            Text(L10n.text("ui_send_a_notification_after_successful_completion_a2de2c27")).font(.subheadline).foregroundStyle(.secondary)
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
        ["available": L10n.text("ui_available_3aa55273"), "reserved": L10n.text("ui_reserved_10814cd6"), "in-use": L10n.text("ui_in_use_d4800d74"), "maintenance": L10n.text("ui_maintenance_854f69bd"), "consumed": L10n.text("ui_consumed_417c49fe"), "lost": L10n.text("ui_lost_4b067d9b"), "retired": L10n.text("ui_retired_ff85d35e")][status] ?? status
    }
}
