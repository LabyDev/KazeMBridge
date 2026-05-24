from datetime import timedelta

DOMAIN = "kazembridge"
DEFAULT_DEVICE_ID = "kazembridge"
PORT = 51443
SCAN_INTERVAL = timedelta(seconds=30)

FAN_MODES = ["auto", "1", "2", "3", "4"]
FAN_MODE_TO_INT = {"auto": 0, "1": 1, "2": 2, "3": 3, "4": 4}
FAN_INT_TO_MODE = {0: "auto", 1: "1", 2: "2", 3: "3", 4: "4"}

SWING_MODES = ["swing", "1", "2", "3", "4"]
SWING_MODE_TO_INT = {"swing": 0, "1": 1, "2": 2, "3": 3, "4": 4}
SWING_INT_TO_MODE = {0: "swing", 1: "1", 2: "2", 3: "3", 4: "4"}
