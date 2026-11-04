import SwiftUI

struct UploadJobsView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        UploadJobsContent(queue: state.intakeQueue)
    }
}

private struct UploadJobsContent: View {
    @ObservedObject var queue: IntakeQueue

    var body: some View {
        Group {
            if queue.visibleJobs.isEmpty {
                ContentUnavailableView(L10n.text("ui_no_uploads_c1d7982a"), systemImage: "arrow.up.circle")
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if let storageError = queue.storageError {
                            Label(storageError, systemImage: "externaldrive.badge.exclamationmark")
                                .font(.caption)
                                .foregroundStyle(InventoryTheme.danger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .inventoryCard()
                        }
                        ForEach(queue.visibleJobs) { job in
                            jobCard(job)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(InventoryTheme.canvas)
        .navigationTitle(L10n.text("ui_uploads_d084236c"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func jobCard(_ job: IntakeJob) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: job.stage.symbolName)
                    .font(.title3)
                    .foregroundStyle(job.stage.tint)
                    .frame(width: 38, height: 38)
                    .background(job.stage.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 3) {
                    Text(job.resourceName ?? job.request.name)
                        .font(.headline)
                        .lineLimit(2)
                    Text(job.stage.localizedName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(job.stage.tint)
                }
                Spacer()
                Text(job.createdAt, style: .time)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            ProgressView(value: job.progress)
                .tint(job.stage.tint)

            if let message = job.message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Label(L10n.text("ui_photos_0_a51c1926", job.filenames.count), systemImage: "photo.stack")
                if job.resourceID != nil {
                    Label(L10n.text("ui_server_item_created_0b17d4a5"), systemImage: "checkmark.circle")
                }
                Spacer()
            }
            .font(.caption2)
            .foregroundStyle(.secondary)

            if job.stage == .failed || job.stage == .warning {
                HStack {
                    Button {
                        queue.retry(job.id)
                    } label: {
                        Label(L10n.text("ui_retry_948643cb"), systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(InventoryTheme.ink)
                    .disabled(!queue.canProcessJobs)

                    Spacer()

                    Button(role: .destructive) {
                        queue.remove(job.id)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.bordered)
                }
            } else if job.stage == .complete {
                Button {
                    queue.remove(job.id)
                } label: {
                    Label(L10n.text("ui_remove_from_list_c86c7c08"), systemImage: "checkmark")
                }
                .buttonStyle(.bordered)
            }
        }
        .inventoryCard()
    }
}

private extension IntakeJobStage {
    var localizedName: String {
        switch self {
        case .preparing: L10n.text("ui_prepare_photos_77e4bda8")
        case .queued: L10n.text("ui_waiting_for_upload_459b3e1f")
        case .creating: L10n.text("ui_create_item_dcbe30ea")
        case .placing: L10n.text("ui_save_position_in_room_b6186254")
        case .uploading: L10n.text("ui_upload_photos_e80309b4")
        case .analyzing: L10n.text("ui_analyze_photos_957b01f7")
        case .researching: L10n.text("ui_web_research_f9c82c1b")
        case .generatingCover: L10n.text("ui_generate_cover_a4f5e57d")
        case .complete: L10n.text("ui_done_25d52d7e")
        case .warning: L10n.text("ui_saved_with_a_notice_fc397c49")
        case .failed: L10n.text("ui_failed_1c47a973")
        }
    }

    var symbolName: String {
        switch self {
        case .preparing: "photo.badge.arrow.down"
        case .queued: "clock.fill"
        case .creating: "plus.app.fill"
        case .placing: "location.fill"
        case .uploading: "arrow.up.circle.fill"
        case .analyzing: "sparkles"
        case .researching: "globe"
        case .generatingCover: "wand.and.stars"
        case .complete: "checkmark.circle.fill"
        case .warning: "exclamationmark.circle.fill"
        case .failed: "xmark.octagon.fill"
        }
    }

    var tint: Color {
        switch self {
        case .complete: InventoryTheme.success
        case .warning: InventoryTheme.warning
        case .failed: InventoryTheme.danger
        case .queued, .preparing: .secondary
        default: InventoryTheme.info
        }
    }
}
