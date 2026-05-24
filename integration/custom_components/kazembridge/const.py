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
    "swing",
    "normal",
    "both_left",
    "left_center",
    "both_center",
    "center_right",
    "both_right",
    "wide",
]
H_SWING_TO_INT = {
    "swing":        0,
    "normal":       1,
    "both_left":    2,
    "left_center":  3,
    "both_center":  4,
    "center_right": 5,
    "both_right":   6,
    "wide":         7,
}
H_SWING_INT_TO_OPT = {v: k for k, v in H_SWING_TO_INT.items()}
