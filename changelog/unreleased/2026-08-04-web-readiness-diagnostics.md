# CLI explains web readiness failures

`penguin web` previously discarded every exception raised while probing the newly started local server, so users saw only a generic "Server is not responding yet" message even when the service was listening and a firewall was blocking the loopback connection.

## Details

- Readiness polling now retains the final nested Node/undici error and writes its stable error code and message to stderr after the polling deadline.
- Connection timeout, refusal, reset, permission, and DNS failures receive separate localized guidance; timeout guidance asks the user to allow PenguinHarness to communicate on the configured local port.
- Any HTTP response still counts as ready, preserving the existing redirect and startup behavior.
- Focused CLI tests cover successful responses, nested timeout causes, failure classification, and the English and Chinese timeout prompts.
