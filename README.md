# KazeMBridge

Reverse-engineering the local HTTP API of two Mitsubishi Electric ACs running the **Smart M-Air** app, with the eventual goal of a Home Assistant custom integration.

## Approach

The ACs communicate over the local network via their WiFi adapters (MAC-300IF/558IF series). We intercept that traffic using [mitmproxy](https://mitmproxy.org/) to map every endpoint the app calls.

### Setup mitmproxy

```bash
pip install mitmproxy
mitmproxy --listen-port 8080
```

On your phone, set the WiFi proxy to `<your-pc-ip>:8080`. Install the mitmproxy CA cert (visit `mitm.it` on the proxied device) to capture HTTPS too.

Perform every action in Smart M-Air — power, mode, temperature, fan speed, swing — and watch the requests roll in.

### Try the AC directly

Before proxying, just probe the adapter's IP:

```bash
python tools/api_test.py --host 192.168.x.x --path /
python tools/api_test.py --host 192.168.x.x --path /aircon/get_control_info
```

Some adapters have open endpoints that respond without any auth.

## Findings

See [research/endpoints.md](research/endpoints.md) for the running log of discovered endpoints.

## Repo structure

```
tools/           CLI scripts for probing the AC
research/        Endpoint log and raw captures (captures/ is gitignored)
```
