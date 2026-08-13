import Foundation

struct MultipartBodyFile: Sendable {
    let fileURL: URL
    let boundary: String
}

enum MultipartFormFileBuilder {
    private struct RoomKeyframeUploadMetadata: Encodable {
        let id: String
        let fileField: String
        let capturedAt: Date
        let timestamp: Double
        let cameraTransform: SpatialMatrix4
        let intrinsics: [Double]
        let width: Int
        let height: Int
        let orientation: String
        let quality: Double
    }

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
        itemHint: String?,
        itemID: UUID? = nil,
        modelID: String? = nil
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
            if let itemID {
                try write("--\(boundary)\r\n", to: output)
                try write(
                    "Content-Disposition: form-data; name=\"itemId\"\r\n\r\n",
                    to: output
                )
                try write("\(itemID.uuidString.lowercased())\r\n", to: output)
            }
            if let modelID, !modelID.isEmpty {
                try write("--\(boundary)\r\n", to: output)
                try write(
                    "Content-Disposition: form-data; name=\"modelId\"\r\n\r\n",
                    to: output
                )
                try output.write(contentsOf: Data(modelID.utf8))
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

    static func buildObjectRecognition(
        image: MediaUploadFile
    ) throws -> MultipartBodyFile {
        let boundary = "InventoryBoundary-\(UUID().uuidString)"
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("inventory-recognition-\(UUID().uuidString)")
            .appendingPathExtension("multipart")

        guard FileManager.default.createFile(atPath: outputURL.path, contents: nil) else {
            throw APIClientError.invalidUpload(
                "Der Upload für die Objekterkennung konnte nicht vorbereitet werden."
            )
        }

        do {
            guard image.fileURL.isFileURL else {
                throw APIClientError.invalidUpload(
                    "Das Erkennungsfoto muss eine lokale Datei sein."
                )
            }
            let values = try image.fileURL.resourceValues(forKeys: [
                .isRegularFileKey,
                .fileSizeKey,
            ])
            guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else {
                throw APIClientError.invalidUpload(
                    "Das Erkennungsfoto fehlt oder ist leer."
                )
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
            try write("\r\n--\(boundary)--\r\n", to: output)
            try output.synchronize()
            return MultipartBodyFile(fileURL: outputURL, boundary: boundary)
        } catch {
            try? FileManager.default.removeItem(at: outputURL)
            throw error
        }
    }

    static func buildRoomScan(
        draft: SpatialRoomScanDraft,
        roomResourceID: UUID
    ) throws -> MultipartBodyFile {
        let boundary = "InventoryBoundary-\(UUID().uuidString)"
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("inventory-room-scan-\(UUID().uuidString)")
            .appendingPathExtension("multipart")

        guard FileManager.default.createFile(atPath: outputURL.path, contents: nil) else {
            throw APIClientError.invalidUpload("Der Raumscan-Upload konnte nicht vorbereitet werden.")
        }

        do {
            let sceneEncoder = JSONEncoder()
            sceneEncoder.outputFormatting = [.sortedKeys]
            let sceneData = try sceneEncoder.encode(draft.scene)
            guard let sceneJSON = String(data: sceneData, encoding: .utf8) else {
                throw APIClientError.invalidUpload("Die Raumgeometrie konnte nicht codiert werden.")
            }

            let output = try FileHandle(forWritingTo: outputURL)
            defer { try? output.close() }

            let iso8601 = ISO8601DateFormatter()
            var fields = [
                ("id", draft.id.uuidString.lowercased()),
                ("roomResourceId", roomResourceID.uuidString.lowercased()),
                ("capturedAt", iso8601.string(from: draft.capturedAt)),
                ("deviceModel", draft.deviceModel),
                ("scene", sceneJSON),
            ]
            if let structureID = draft.structureID {
                fields.append(("structureId", structureID.uuidString.lowercased()))
            }
            if let structureName = draft.structureName {
                fields.append(("structureName", structureName))
            }
            if let floorIdentifier = draft.floorIdentifier {
                fields.append(("floorIdentifier", floorIdentifier))
            }
            if let floorIndex = draft.floorIndex {
                fields.append(("floorIndex", String(floorIndex)))
            }
            if let roomIdentifier = draft.roomIdentifier {
                fields.append(("roomIdentifier", roomIdentifier))
            }
            if let coordinateSpaceID = draft.coordinateSpaceID {
                fields.append(("coordinateSpaceId", coordinateSpaceID.uuidString.lowercased()))
            }
            if let georeference = draft.georeference {
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .iso8601
                encoder.outputFormatting = [.sortedKeys]
                let data = try encoder.encode(georeference)
                guard let json = String(data: data, encoding: .utf8) else {
                    throw APIClientError.invalidUpload(
                        "Die geografische Referenz konnte nicht codiert werden."
                    )
                }
                fields.append(("georeference", json))
            }
            if !draft.keyframes.isEmpty {
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .iso8601
                encoder.outputFormatting = [.sortedKeys]
                let metadata = draft.keyframes.map { keyframe in
                    RoomKeyframeUploadMetadata(
                        id: keyframe.metadata.id.uuidString.lowercased(),
                        fileField: "keyframe:\(keyframe.metadata.id.uuidString.lowercased())",
                        capturedAt: keyframe.metadata.capturedAt,
                        timestamp: keyframe.metadata.timestamp,
                        cameraTransform: keyframe.metadata.cameraTransform,
                        intrinsics: keyframe.metadata.intrinsics,
                        width: keyframe.metadata.width,
                        height: keyframe.metadata.height,
                        orientation: keyframe.metadata.orientation,
                        quality: keyframe.metadata.quality
                    )
                }
                let data = try encoder.encode(metadata)
                guard let json = String(data: data, encoding: .utf8) else {
                    throw APIClientError.invalidUpload(
                        "Die visuellen Raumreferenzen konnten nicht codiert werden."
                    )
                }
                fields.append(("keyframes", json))
            }
            for (name, value) in fields {
                try write("--\(boundary)\r\n", to: output)
                try write(
                    "Content-Disposition: form-data; name=\"\(name)\"\r\n",
                    to: output
                )
                try write("Content-Type: text/plain; charset=utf-8\r\n\r\n", to: output)
                try output.write(contentsOf: Data(value.utf8))
                try write("\r\n", to: output)
            }

            var assets: [(field: String, url: URL, mimeType: String)] = [
                ("worldMap", draft.worldMapURL, "application/vnd.apple.arkit.world-map"),
                ("model", draft.modelURL, "model/vnd.usdz+zip"),
            ]
            if let guideImageURL = draft.guideImageURL {
                assets.append(("guideImage", guideImageURL, "image/jpeg"))
            }
            if let structureModelURL = draft.structureModelURL {
                assets.append(("structureModel", structureModelURL, "model/vnd.usdz+zip"))
            }

            for asset in assets {
                try validateLocalFile(asset.url)
                let filename = sanitizeHeaderValue(asset.url.lastPathComponent)
                try write("--\(boundary)\r\n", to: output)
                try write(
                    "Content-Disposition: form-data; name=\"\(asset.field)\"; filename=\"\(filename)\"\r\n",
                    to: output
                )
                try write("Content-Type: \(asset.mimeType)\r\n\r\n", to: output)
                try copy(asset.url, to: output)
                try write("\r\n", to: output)
            }

            for keyframe in draft.keyframes {
                try validateLocalFile(keyframe.imageURL)
                let id = keyframe.metadata.id.uuidString.lowercased()
                try write("--\(boundary)\r\n", to: output)
                try write(
                    "Content-Disposition: form-data; name=\"keyframe:\(id)\"; filename=\"\(id).jpg\"\r\n",
                    to: output
                )
                try write("Content-Type: image/jpeg\r\n\r\n", to: output)
                try copy(keyframe.imageURL, to: output)
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

    private static func validateLocalFile(_ url: URL) throws {
        guard url.isFileURL else {
            throw APIClientError.invalidUpload("Raumscan-Dateien müssen lokal gespeichert sein.")
        }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else {
            throw APIClientError.invalidUpload("\(url.lastPathComponent) fehlt oder ist leer.")
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
