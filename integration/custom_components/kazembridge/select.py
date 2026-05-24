"""Select entity for horizontal vane position on MHI WF-RAC units.

HA's ClimateEntity only supports a single swing_mode (vertical here), so
horizontal position is exposed as a separate select entity. It shares the
coordinator so no extra HTTP requests are made.
"""

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN, H_SWING_OPTIONS, H_SWING_TO_INT, H_SWING_INT_TO_OPT
from .coordinator import MhiCoordinator
from .mhi_codec import encode


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: MhiCoordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    async_add_entities([MhiHorizontalVane(coordinator, entry)])


class MhiHorizontalVane(CoordinatorEntity, SelectEntity):
    """Horizontal vane position selector (wind_lr: 0=swing, 1-7=fixed)."""

    _attr_options = H_SWING_OPTIONS
    _attr_icon = "mdi:arrow-left-right"

    def __init__(self, coordinator: MhiCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        aircon_id = entry.data["aircon_id"]
        self._entry = entry
        self._aircon_id = aircon_id
        self._attr_name = "Horizontal Vane"
        self._attr_unique_id = f"{aircon_id}_horizontal_vane"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, aircon_id)},
        )

    @property
    def current_option(self) -> str:
        wind_lr = self.coordinator.data.get("wind_lr", 1)
        return H_SWING_INT_TO_OPT.get(wind_lr, "normal")

    async def async_select_option(self, option: str) -> None:
        d = self.coordinator.data
        b64 = encode(
            operation=1 if d["operation"] else 0,
            mode=d["mode"],
            temp=d["temp_setpoint"],
            fan=d["fan"],
            wind_ud=d["wind_ud"],
            wind_lr=H_SWING_TO_INT[option],
            entrust=1 if d.get("entrust") else 0,
            model_type=d.get("model_type", 0),
        )
        await self.coordinator.api.set_aircon_stat(self._aircon_id, b64)
        await self.coordinator.async_request_refresh()
