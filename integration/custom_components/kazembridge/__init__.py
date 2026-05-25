"""KazeMBridge — Home Assistant integration for MHI WF-RAC Wi-Fi adapters.

Entry point for the integration. Creates one MhiApi + MhiCoordinator per config
entry and forwards setup to the climate and sensor platforms.
"""

from pathlib import Path
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from .api import MhiApi
from .const import DOMAIN
from .coordinator import MhiCoordinator

PLATFORMS = ["climate", "sensor"]
_CARD_URL = "/kazembridge_static/kazembridge-card.js"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.http.register_static_path(
        "/kazembridge_static",
        str(Path(__file__).parent / "www"),
        cache_headers=False,
    )
    add_extra_js_url(hass, _CARD_URL)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up a config entry: create the API client, start the coordinator, forward to platforms."""
    api = MhiApi(
        host=entry.data["host"],
        operator_id=entry.data["operator_id"],
        device_id=entry.data.get("device_id", "kazembridge"),
    )
    coordinator = MhiCoordinator(hass, api, entry.data["aircon_id"])
    # Perform the first poll before platforms set up their entities so they
    # have data immediately on load instead of showing "unavailable".
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "coordinator": coordinator,
        "api": api,
    }
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry: tear down platforms and close the HTTP session."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        data = hass.data[DOMAIN].pop(entry.entry_id)
        await data["api"].close()
    return unload_ok
