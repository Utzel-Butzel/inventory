import Foundation

struct MultipartBodyFile: Sendable {
    let fileURL: URL
    let boundary: String
}

enum MultipartFormFileBuilder {
    static func build(files: [MediaUploadFile]) throws -> MultipartBodyFile {
        let boundary = "InventoryBoundary-\(UUID().uuidString)"
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("inventory-upload-\(UUID().uuidString)")
            .appendingPathExtension("multipart")

        guard FileManager.default.createFile(atPath: outputURL.path, contents: nil) else {
            throw APIClientError.invalidUpload("Unable to create the multipart upload body.")
        }

        do {
            let output = try FileHandle(forWritingTo: outputURL)
            defer { try? output.close() }

            for file in files {
                guard file.fileURL.isFileURL else {
                    throw APIClientError.invalidUpload("Uploads must use local file URLs.")
                }
                let values = try file.fileURL.resourceValues(forKeys: [
                    .isRegularFileKey,
                    .fileSizeKey,
                ])
                guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else {
                    throw APIClientError.invalidUpload(
                        "\(file.fileURL.lastPathComponent) is missing or empty."
                    )
                }

                let safeFilename = sanitizeHeaderValue(file.filename)
                let safeMIMEType = sanitizeHeaderValue(file.mimeType)
                try write("--\(boundary)\r\n", to: output)
                try write(
                    "Content-Disposition: form-data; name=\"files\"; filename=\"\(safeFilename)\"\r\n",
                    to: output
                )
                try write("Content-Type: \(safeMIMEType)\r\n\r\n", to: output)
                try copy(file.fileURL, to: output)
                try write("\r\n", to: output)
            }
            try write("--\(boundary)--\r\n", to: output)
            try output.synchronize()
            return MultipartBodyFile(fileURL: outputURL, boundary: boundary)
        } catch {
            try? FileManager.default.removeItem(at: outputURL)
            throw error
        }
    }

    static func buildObjectCount(
        image: MediaUploadFile,
        itemHint: String?
    ) throws -> MultipartBodyFile {
        let boundary = "InventoryBoundary-\(UUID().uuidString)"
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("inventory-count-\(UUID().uuidString)")
            .appendingPathExtension("multipart")

        guard FileManager.default.createFile(atPath: outputURL.path, contents: nil) else {
            throw APIClientError.invalidUpload("Unable to create the multipart count body.")
        }

        do {
            guard image.fileURL.isFileURL else {
                throw APIClientError.invalidUpload("The count image must use a local file URL.")
            }
            let values = try image.fileURL.resourceValues(forKeys: [
                .isRegularFileKey,
                .fileSizeKey,
            ])
            guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else {
                throw APIClientError.invalidUpload("The count image is missing or empty.")
            }

            let output = try FileHandle(forWritingTo: outputURL)
            defer { try? output.close() }

            let safeFilename = sanitizeHeaderValue(image.filename)
            let safeMIMEType = sanitizeHeaderValue(image.mimeType)
            try write("--\(boundary)\r\n", to: output)
            try write(
                "Content-Disposition: form-data; name=\"image\"; filename=\"\(safeFilename)\"\r\n",
                to: output
            )
            try write("Content-Type: \(safeMIMEType)\r\n\r\n", to: output)
            try copy(image.fileURL, to: output)
            try write("\r\n", to: output)

            if let itemHint {
                try write("--\(boundary)\r\n", to: output)
                try write(
                    "Content-Disposition: form-data; name=\"itemHint\"\r\n",
                    to: output
                )
                try write("Content-Type: text/plain; charset=utf-8\r\n\r\n", to: output)
                try output.write(contentsOf: Data(itemHint.utf8))
                try write("\r\n", to: output)
            }

            try write("--\(boundary)--\r\n", to: output)
            try output.synchronize()
            return MultipartBodyFile(fileURL: outputURL, boundary: boundary)
        } catch {
            try? FileManager.default.removeItem(at: outputURL)
            throw error
        }
    }

    private static func copy(_ inputURL: URL, to output: FileHandle) throws {
        let input = try FileHandle(forReadingFrom: inputURL)
        defer { try? input.close() }

        while let chunk = try input.read(upToCount: 64 * 1_024), !chunk.isEmpty {
            try output.write(contentsOf: chunk)
        }
    }

    private static func write(_ string: String, to output: FileHandle) throws {
        try output.write(contentsOf: Data(string.utf8))
    }

    private static func sanitizeHeaderValue(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
            .replacingOccurrences(of: "\"", with: "_")
    }
}
