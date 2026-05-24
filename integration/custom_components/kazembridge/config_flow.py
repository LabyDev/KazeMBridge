"""Config flow for the KazeMBridge integration.

Single-step flow: user enters the adapter's local IP address. The flow then:
  1. Calls getDeviceInfo to validate connectivity and retrieve the airconId.
  2. Generates a fresh UUID operatorId and registers it via updateAccountInfo.
  3. Creates the config entry on success.

The airconId is used as the unique ID so the same device can't be added twice.
There is no way to list existing registered operators on the AC (remoteList is
always empty), so if the slot list is full the user must free one via the
official SmartM-Air app.
"""

import logging
import uuid
import voluptuous as vol
from homeassistant import config_entries
from .api import MhiApi, CannotConnect
from .const import DOMAIN, DEFAULT_DEVICE_ID

_LOGGER = logging.getLogger(__name__)


class KazemBridgeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the user-initiated setup flow."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Show the IP address form; on submit, validate and register."""
        errors = {}
        if user_input is not None:
            host = user_input["host"].strip()
            operator_id = str(uuid.uuid4())
            api = MhiApi(host=host, operator_id=operator_id)
            try:
                resp = await api.get_device_info()
                if resp.get("result") != 0:
                    errors["base"] = "cannot_connect"
                else:
                    aircon_id = resp["contents"]["airconId"]
                    # Use airconId (= MAC address) as the unique ID to prevent duplicates
                    await self.async_set_unique_id(aircon_id)
                    self._abort_if_unique_id_configured()
                    result = await api.update_account_info(aircon_id)
                    if result == 0:
                        return self.async_create_entry(
                            title=f"MHI AC ({host})",
                            data={
                                "host": host,
                                "aircon_id": aircon_id,
                                "operator_id": operator_id,
                                "device_id": DEFAULT_DEVICE_ID,
                            },
                        )
                    elif result == 2:
                        errors["base"] = "operator_list_full"
                    else:
                        errors["base"] = "register_failed"
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except Exception:
                _LOGGER.exception("Unexpected error during config flow")
                errors["base"] = "unknown"
            finally:
                await api.close()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required("host"): str}),
            errors=errors,
        )
