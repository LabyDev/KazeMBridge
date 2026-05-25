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

# Horizontal vane positions (wind_lr 0=swing, 1-7=fixed positions)
H_SWING_OPTIONS = [
    "both_left",
    "left_center",
    "both_center",
    "center_right",
    "both_right",
    "wide",
    "right_left",
    "swing",
]
H_SWING_TO_INT = {
    "both_left":    1,
    "left_center":  2,
    "both_center":  3,
    "center_right": 4,
    "both_right":   5,
    "wide":         6,
    "right_left":   7,
    "swing":        0,
}
H_SWING_INT_TO_OPT = {v: k for k, v in H_SWING_TO_INT.items()}
