"""Config flow for the KazeMBridge integration.

Manual flow: user enters the adapter's local IP address.
Auto-discovery flow: Home Assistant detects the adapter via mDNS (service type
  _beaver._tcp.local.) and pre-fills the IP, asking the user to confirm.

Either path then:
  1. Calls getDeviceInfo to validate connectivity and retrieve the airconId.
  2. Generates a fresh UUID operatorId and registers it via updateAccountInfo.
  3. Creates the config entry on success.

The airconId (= MAC address) is used as the unique ID so the same device
cannot be added twice.

There is no way to list existing registered operators on the AC (remoteList is
always empty), so if the operator slot list is full the user must free a slot
via the official SmartM-Air app or by power-cycling the Wi-Fi module.
"""

import logging
import uuid
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import AbortFlow
from .api import MhiApi, CannotConnect
from .const import DOMAIN, DEFAULT_DEVICE_ID

_LOGGER = logging.getLogger(__name__)


class KazemBridgeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle user-initiated and mDNS-discovered setup flows."""

    VERSION = 1

    def __init__(self) -> None:
        super().__init__()
        # Populated by async_step_zeroconf when the adapter is auto-discovered.
        # async_step_user uses it to pre-fill the host field.
        self._discovered_host: str | None = None

    async def async_step_zeroconf(self, discovery_info):
        """Called by HA when it spots a _beaver._tcp.local. mDNS advertisement.

        The service name published by the adapter follows the pattern
        'beaver_<mac>._beaver._tcp.local.' so we can extract the MAC
        (= airconId) and set it as the unique ID early, which lets HA
        abort duplicate discovery flows before we even show the user a form.
        """
        service_name = discovery_info.name or ""
        # The name field looks like 'beaver_348e89a28855._beaver._tcp.local.'
        # Split on '.' and take the first segment, then strip the 'beaver_' prefix.
        first_segment = service_name.split(".")[0]
        if first_segment.startswith("beaver_"):
            mac_address = first_segment.removeprefix("beaver_")
            await self.async_set_unique_id(mac_address)
            self._abort_if_unique_id_configured()

        self._discovered_host = discovery_info.host
        self._async_abort_entries_match({"host": discovery_info.host})
        # Surface the discovered host in the HA notification title.
        self.context["title_placeholders"] = {"host": discovery_info.host}
        return await self.async_step_user()

    async def async_step_user(self, user_input=None):
        """Show the IP address form; on submit, validate connectivity and register."""
        errors = {}

        if user_input is not None:
            host = user_input["host"].strip()
            operator_id = str(uuid.uuid4())
            api = MhiApi(host=host, operator_id=operator_id)
            try:
                device_info_response = await api.get_device_info()
                if device_info_response.get("result") != 0:
                    errors["base"] = "cannot_connect"
                else:
                    aircon_id = device_info_response["contents"]["airconId"]
                    # Use airconId (= MAC address) as the unique ID to prevent duplicates.
                    await self.async_set_unique_id(aircon_id)
                    self._abort_if_unique_id_configured()
                    registration_result = await api.update_account_info(aircon_id)
                    if registration_result == 0:
                        return self.async_create_entry(
                            title=f"MHI AC ({host})",
                            data={
                                "host": host,
                                "aircon_id": aircon_id,
                                "operator_id": operator_id,
                                "device_id": DEFAULT_DEVICE_ID,
                            },
                        )
                    elif registration_result == 2:
                        errors["base"] = "operator_list_full"
                    else:
                        errors["base"] = "register_failed"
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except AbortFlow:
                raise
            except Exception:
                _LOGGER.exception("Unexpected error during config flow")
                errors["base"] = "unknown"
            finally:
                await api.close()

        # Pre-fill the host field when we arrived via zeroconf discovery.
        default_host = self._discovered_host or vol.UNDEFINED
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required("host", default=default_host): str}),
            errors=errors,
        )
