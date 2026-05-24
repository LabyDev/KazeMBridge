"""Temperature sensor entities for the MHI WF-RAC integration.

Exposes indoor and outdoor temperatures parsed from the airconStat binary blob.
Both sensors share the coordinator so no extra HTTP requests are made. Sensors
are marked unavailable when the AC hasn't reported a reading in the blob (the
extension tuple for that sensor is simply absent).
"""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN
from .coordinator import MhiCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: MhiCoordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    aircon_id = entry.data["aircon_id"]
    async_add_entities([
        MhiTemperatureSensor(coordinator, aircon_id, "indoor", "Indoor Temperature"),
        MhiTemperatureSensor(coordinator, aircon_id, "outdoor", "Outdoor Temperature"),
    ])


class MhiTemperatureSensor(CoordinatorEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS

    def __init__(
        self,
        coordinator: MhiCoordinator,
        aircon_id: str,
        sensor_type: str,
        name: str,
    ) -> None:
        super().__init__(coordinator)
        self._key = f"{sensor_type}_temp"
        self._attr_name = name
        self._attr_unique_id = f"{aircon_id}_{sensor_type}_temp"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, aircon_id)},
        )

    @property
    def native_value(self):
        return self.coordinator.data.get(self._key)

    @property
    def available(self) -> bool:
        return super().available and self.native_value is not None
