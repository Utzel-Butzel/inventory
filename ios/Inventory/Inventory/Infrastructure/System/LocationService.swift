import CoreLocation
import Foundation

@MainActor
final class LocationService: NSObject, ObservableObject {
    struct Coordinates: Codable, Equatable, Sendable {
        let latitude: Double
        let longitude: Double
        let altitude: Double?
        let accuracy: Double
    }

    @Published private(set) var coordinates: Coordinates?
    @Published private(set) var isRequesting = false
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
            errorMessage = "Standortzugriff ist deaktiviert."
        @unknown default:
            errorMessage = "Der Standort ist derzeit nicht verfügbar."
        }
    }
}

extension LocationService: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            guard let self else { return }
            if status == .authorizedAlways || status == .authorizedWhenInUse {
                self.isRequesting = true
                self.manager.requestLocation()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        let altitude = location.verticalAccuracy >= 0 ? location.altitude : nil
        let accuracy = location.horizontalAccuracy
        Task { @MainActor [weak self] in
            self?.coordinates = Coordinates(
                latitude: latitude,
                longitude: longitude,
                altitude: altitude,
                accuracy: accuracy
            )
            self?.isRequesting = false
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            self?.isRequesting = false
            self?.errorMessage = "Der Standort konnte nicht ermittelt werden."
        }
    }
}
