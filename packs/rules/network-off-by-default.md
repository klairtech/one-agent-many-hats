---
id: rule/network-off-by-default
statement: >
  Tool egress is disabled unless network.enabled is true in config. When enabled, requests
  are limited to http/https, denied to link-local and cloud metadata addresses, and
  restricted to network.allowHosts when that list is non-empty.
strength: code
scope: []
enforced_by: core.net.assertToolNetworkAllowed
on_violation: block
version: 1
history:
  - "v1 code: born at strength 3, and deliberately not bundled with the write profiles."
---

The paper's read-only-by-construction argument rests on there being no exfiltration-capable
tool to invoke: an injected instruction can change what the model says, but it cannot aim
anything outward. `fetch_url` is the tool that breaks that property, so it is gated
separately from file writing. "Let it edit my files" and "let it reach the internet" are
different decisions with different blast radii, and collapsing them into one flag would be
the single worst usability-for-safety trade available here.

This guard governs *tool* egress only. Calls to the configured model provider are egress by
definition and are not covered — if you point hats at a hosted provider, your prompt goes
to that provider.
