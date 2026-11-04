import CoreLocation
import Foundation

@MainActor
final class LocationService: NSObject, ObservableObject {
    struct Coordinates: Codable, Equatable, Sendable {
        let latitude: Double
        let longitude: Double
        let altitude: Double?
        let accuracy: Double
        let verticalAccuracy: Double?
        let capturedAt: Date
    }

    struct Heading: Codable, Equatable, Sendable {
        let trueHeading: Double
        let accuracy: Double
        let capturedAt: Date
    }

    @Published private(set) var coordinates: Coordinates?
    @Published private(set) var heading: Heading?
    @Published private(set) var isRequesting = false
    @Published private(set) var isRequestingHeading = false
    @Published private(set) var errorMessage: String?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func requestCurrentLocation() {
        errorMessage = nil
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            isRequesting = true
            manager.requestLocation()
        case .denied, .restricted:
            errorMessage = L10n.text("ui_location_access_is_disabled_2659bec3")
        @unknown default:
            errorMessage = L10n.text("ui_location_is_currently_unavailable_88dc7699")
        }
    }

    /// Captures the geographic position and a true-north compass bearing used
    /// to align a shared ARKit coordinate space with the map.
    func requestCurrentGeoreference() {
        coordinates = nil
        heading = nil
        guard CLLocationManager.headingAvailable() else {
            isRequestingHeading = false
            errorMessage = L10n.text("ui_compass_heading_is_not_available_on_this_cef16ea7")
            return
        }
        isRequestingHeading = true
        manager.headingFilter = 2
        manager.startUpdatingHeading()
        requestCurrentLocation()
    }

    func stopGeoreferenceCapture() {
        manager.stopUpdatingHeading()
        isRequestingHeading = false
    }
}

extension LocationService: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            guard let self else { return }
            switch status {
            case .authorizedAlways, .authorizedWhenInUse:
                self.isRequesting = true
                self.manager.requestLocation()
            case .denied, .restricted:
                self.isRequesting = false
                self.stopGeoreferenceCapture()
                self.errorMessage = L10n.text("ui_location_access_is_disabled_2659bec3")
            case .notDetermined:
                break
            @unknown default:
                self.isRequesting = false
                self.stopGeoreferenceCapture()
                self.errorMessage = L10n.text("ui_location_is_currently_unavailable_88dc7699")
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        let altitude = location.verticalAccuracy >= 0 ? location.altitude : nil
        let verticalAccuracy = location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil
        let accuracy = location.horizontalAccuracy
        let capturedAt = location.timestamp
        Task { @MainActor [weak self] in
            self?.coordinates = Coordinates(
                latitude: latitude,
                longitude: longitude,
                altitude: altitude,
                accuracy: accuracy,
                verticalAccuracy: verticalAccuracy,
                capturedAt: capturedAt
            )
            self?.isRequesting = false
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateHeading newHeading: CLHeading
    ) {
        guard newHeading.headingAccuracy >= 0, newHeading.trueHeading >= 0 else { return }
        let value = newHeading.trueHeading
        let accuracy = newHeading.headingAccuracy
        let capturedAt = newHeading.timestamp
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.heading = Heading(
                trueHeading: value,
                accuracy: accuracy,
                capturedAt: capturedAt
            )
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.isRequesting = false
            self.stopGeoreferenceCapture()
            self.errorMessage = L10n.text("ui_could_not_determine_location_5d80bebf")
        }
    }
}
