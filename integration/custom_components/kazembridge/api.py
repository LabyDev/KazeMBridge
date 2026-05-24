"""Thin async HTTP client for the MHI WF-RAC local API.

The adapter listens on HTTPS port 51443 with a self-signed certificate, so SSL
verification is disabled. Every request body must include apiVer, command,
deviceId, operatorId and a Unix timestamp — even though command also appears in
the URL path; the device rejects requests where the two don't match.
"""

import time
import aiohttp
from .const import DEFAULT_DEVICE_ID, PORT


class CannotConnect(Exception):
    """Raised when the device is unreachable or returns a network error."""


class MhiApi:
    """Wrapper around the device's local HTTPS API.

    One instance is created per config entry and shared between the coordinator
    and all entity platforms. Call `close()` when the entry is unloaded.
    """

    def __init__(self, host: str, operator_id: str, device_id: str = DEFAULT_DEVICE_ID) -> None:
        self._host = host
        self._operator_id = operator_id
        self._device_id = device_id
        self._session: aiohttp.ClientSession | None = None

    def _session_(self) -> aiohttp.ClientSession:
        """Return the shared session, creating it if needed."""
        if self._session is None or self._session.closed:
            # ssl=False because the adapter uses a self-signed certificate
            connector = aiohttp.TCPConnector(ssl=False)
            self._session = aiohttp.ClientSession(connector=connector)
        return self._session

    async def close(self) -> None:
        """Close the underlying aiohttp session."""
        if self._session and not self._session.closed:
            await self._session.close()

    def _payload(self, command: str) -> dict:
        """Build the base request payload required on every API call."""
        return {
            "apiVer": "1.0",
            "command": command,          # must match the URL path exactly
            "deviceId": self._device_id,
            "operatorId": self._operator_id,
            "timestamp": int(time.time()),
        }

    async def _post(self, command: str, payload: dict) -> dict:
        """POST to /beaver/command/<command> and return the parsed JSON body."""
        url = f"https://{self._host}:{PORT}/beaver/command/{command}"
        try:
            async with self._session_().post(url, json=payload) as resp:
                return await resp.json(content_type=None)
        except aiohttp.ClientError as exc:
            raise CannotConnect(str(exc)) from exc

    async def get_device_info(self) -> dict:
        """Fetch device metadata (airconId, MAC address).

        Works before the operatorId is registered, so it's safe to call during
        config flow setup.
        """
        return await self._post("getDeviceInfo", self._payload("getDeviceInfo"))

    async def get_aircon_stat(self, aircon_id: str) -> dict:
        """Fetch current AC state.

        The `airconStat` field in `contents` is a base64 binary blob — pass it
        to `mhi_codec.decode()` to get a readable dict.
        """
        payload = self._payload("getAirconStat")
        payload["contents"] = {"airconId": aircon_id}
        return await self._post("getAirconStat", payload)

    async def set_aircon_stat(self, aircon_id: str, b64: str) -> dict:
        """Send a new AC state blob.

        Build `b64` with `mhi_codec.encode()`. The device returns result=99 if
        the physical AC unit doesn't confirm within 30 s.
        """
        payload = self._payload("setAirconStat")
        payload["contents"] = {"airconId": aircon_id, "airconStat": b64}
        return await self._post("setAirconStat", payload)

    async def update_account_info(self, aircon_id: str, timezone: str = "UTC") -> int:
        """Register this operatorId with the AC. Returns the result code.

        Result 0 = success, 2 = operator list full (max ~4 slots).
        Must succeed before any other authenticated command will work.
        """
        payload = self._payload("updateAccountInfo")
        payload["contents"] = {
            "airconId": aircon_id,
            "accountId": self._operator_id,  # accountId must equal operatorId
            "remote": 0,                      # 0 = local mode
            "timezone": timezone,
        }
        resp = await self._post("updateAccountInfo", payload)
        return resp.get("result", -1)

    async def delete_account_info(self, aircon_id: str, account_id: str) -> int:
        """Remove an operatorId slot from the AC.

        The caller (self._operator_id) must already be registered. Use to free
        a slot when `update_account_info` returns result=2.
        """
        payload = self._payload("deleteAccountInfo")
        payload["contents"] = {"airconId": aircon_id, "accountId": account_id}
        resp = await self._post("deleteAccountInfo", payload)
        return resp.get("result", -1)
