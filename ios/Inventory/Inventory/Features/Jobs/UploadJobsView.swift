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
                ContentUnavailableView("Keine Uploads", systemImage: "arrow.up.circle")
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
        .navigationTitle("Uploads")
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
                Label("\(job.filenames.count) Foto(s)", systemImage: "photo.stack")
                if job.resourceID != nil {
                    Label("Servereintrag erstellt", systemImage: "checkmark.circle")
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
                        Label("Erneut versuchen", systemImage: "arrow.clockwise")
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
                    Label("Aus Liste entfernen", systemImage: "checkmark")
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
        case .preparing: "Fotos vorbereiten"
        case .queued: "Wartet auf Upload"
        case .creating: "Gegenstand anlegen"
        case .placing: "Position im Raum speichern"
        case .uploading: "Fotos hochladen"
        case .analyzing: "Fotos analysieren"
        case .generatingCover: "Cover erzeugen"
        case .complete: "Fertig"
        case .warning: "Gespeichert mit Hinweis"
        case .failed: "Fehlgeschlagen"
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
