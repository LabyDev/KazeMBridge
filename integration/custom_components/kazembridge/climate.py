"""Climate entity for the MHI WF-RAC integration.

Each set_* method reads the current coordinator state, applies only the changed
parameter, re-encodes the full blob with mhi_codec.encode(), and sends it via
setAirconStat. A coordinator refresh is requested immediately after so the UI
updates without waiting for the next poll cycle.
"""

from homeassistant.components.climate import (
    ClimateEntity,
    ClimateEntityFeature,
    HVACMode,
    PRESET_NONE,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN, FAN_MODES, FAN_MODE_TO_INT, FAN_INT_TO_MODE, SWING_MODES, SWING_MODE_TO_INT, SWING_INT_TO_MODE, H_SWING_OPTIONS, H_SWING_TO_INT, H_SWING_INT_TO_OPT
from .coordinator import MhiCoordinator
from .mhi_codec import encode

_HA_TO_AC_MODE = {
    HVACMode.AUTO: 0,
    HVACMode.COOL: 1,
    HVACMode.HEAT: 2,
    HVACMode.FAN_ONLY: 3,
    HVACMode.DRY: 4,
}
_AC_TO_HA_MODE = {v: k for k, v in _HA_TO_AC_MODE.items()}


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: MhiCoordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    async_add_entities([MhiClimate(coordinator, entry)])


class MhiClimate(CoordinatorEntity, ClimateEntity):
    _attr_has_entity_name = True
    _attr_name = None
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_min_temp = 16.0
    _attr_max_temp = 31.0
    _attr_target_temperature_step = 0.5
    _attr_hvac_modes = [
        HVACMode.OFF,
        HVACMode.AUTO,
        HVACMode.COOL,
        HVACMode.HEAT,
        HVACMode.FAN_ONLY,
        HVACMode.DRY,
    ]
    _attr_fan_modes = FAN_MODES
    _attr_swing_modes = SWING_MODES
    _attr_swing_horizontal_modes = H_SWING_OPTIONS
    _attr_preset_modes = [PRESET_NONE, "3d_auto"]
    _attr_supported_features = (
        ClimateEntityFeature.TURN_ON
        | ClimateEntityFeature.TURN_OFF
        | ClimateEntityFeature.TARGET_TEMPERATURE
        | ClimateEntityFeature.FAN_MODE
        | ClimateEntityFeature.SWING_MODE
        | ClimateEntityFeature.SWING_HORIZONTAL_MODE
        | ClimateEntityFeature.PRESET_MODE
    )

    def __init__(self, coordinator: MhiCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._aircon_id = entry.data["aircon_id"]
        self._attr_unique_id = self._aircon_id
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, self._aircon_id)},
            name="MHI AC",
            manufacturer="Mitsubishi Heavy Industries",
            model="WF-RAC",
        )

    @property
    def hvac_mode(self) -> HVACMode:
        if not self.coordinator.data["operation"]:
            return HVACMode.OFF
        return _AC_TO_HA_MODE.get(self.coordinator.data["mode"], HVACMode.AUTO)

    @property
    def target_temperature(self) -> float:
        return self.coordinator.data["temp_setpoint"]

    @property
    def fan_mode(self) -> str:
        return FAN_INT_TO_MODE.get(self.coordinator.data["fan"], "auto")

    @property
    def swing_mode(self) -> str:
        return SWING_INT_TO_MODE.get(self.coordinator.data["wind_ud"], "1")

    @property
    def swing_horizontal_mode(self) -> str:
        return H_SWING_INT_TO_OPT.get(self.coordinator.data.get("wind_lr", 1), "normal")

    @property
    def preset_mode(self) -> str:
        return "3d_auto" if self.coordinator.data.get("entrust") else PRESET_NONE

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        await self._send(entrust=1 if preset_mode == "3d_auto" else 0)

    @property
    def extra_state_attributes(self) -> dict:
        d = self.coordinator.data
        return {
            "indoor_temp": d.get("indoor_temp"),
            "outdoor_temp": d.get("outdoor_temp"),
            "model_type": d.get("model_type"),
            "error_code": d.get("error_code"),
        }

    def _params(self) -> dict:
        d = self.coordinator.data
        return {
            "operation": 1 if d["operation"] else 0,
            "mode": d["mode"],
            "temp": d["temp_setpoint"],
            "fan": d["fan"],
            "wind_ud": d["wind_ud"],
            "wind_lr": d["wind_lr"],
            "entrust": 1 if d.get("entrust") else 0,
        }

    async def _send(self, **overrides) -> None:
        p = self._params()
        p.update(overrides)
        b64 = encode(**p)
        resp = await self.coordinator.api.set_aircon_stat(self._aircon_id, b64)
        result = resp.get("result", -1) if resp else -1
        if result != 0:
            raise HomeAssistantError(f"AC rejected command (result={result})")
        await self.coordinator.async_request_refresh()

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        if hvac_mode == HVACMode.OFF:
            await self._send(operation=0)
        else:
            await self._send(operation=1, mode=_HA_TO_AC_MODE[hvac_mode])

    async def async_set_temperature(self, **kwargs) -> None:
        await self._send(temp=kwargs["temperature"])

    async def async_set_fan_mode(self, fan_mode: str) -> None:
        await self._send(fan=FAN_MODE_TO_INT[fan_mode])

    async def async_set_swing_mode(self, swing_mode: str) -> None:
        await self._send(wind_ud=SWING_MODE_TO_INT[swing_mode])

    async def async_set_swing_horizontal_mode(self, swing_mode: str) -> None:
        await self._send(wind_lr=H_SWING_TO_INT[swing_mode])

    async def async_turn_on(self) -> None:
        await self._send(operation=1)

    async def async_turn_off(self) -> None:
        await self._send(operation=0)
