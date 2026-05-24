"""DataUpdateCoordinator for the MHI WF-RAC integration.

Polls getAirconStat every SCAN_INTERVAL seconds and decodes the binary blob.
All entity platforms share this single coordinator so only one HTTP request is
made per poll cycle regardless of how many entities are registered.
"""

import logging
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from .api import MhiApi, CannotConnect
from .const import DOMAIN, SCAN_INTERVAL
from .mhi_codec import decode

_LOGGER = logging.getLogger(__name__)


class MhiCoordinator(DataUpdateCoordinator):
    """Fetches and caches AC state for all entities in this config entry."""

    def __init__(self, hass: HomeAssistant, api: MhiApi, aircon_id: str) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self.api = api
        self.aircon_id = aircon_id

    async def _async_update_data(self) -> dict:
        """Poll the device, decode the blob, and return a flat state dict.

        The returned dict contains everything from mhi_codec.decode() plus a
        few raw JSON fields (led_stat, num_of_account) appended on top.
        """
        try:
            resp = await self.api.get_aircon_stat(self.aircon_id)
        except CannotConnect as exc:
            raise UpdateFailed(exc) from exc
        if resp.get("result") != 0:
            raise UpdateFailed(f"getAirconStat result={resp.get('result')}")
        contents = resp["contents"]
        data = decode(contents["airconStat"])
        data["led_stat"] = contents.get("ledStat")
        data["num_of_account"] = contents.get("numOfAccount")
        return data
