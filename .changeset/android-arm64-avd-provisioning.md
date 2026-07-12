---
"@iv-stpn/vitest-mobile": patch
---

fix(android): provision arm64-compatible AVDs on Apple Silicon, fix partition size and app launch

QEMU2 cannot emulate a foreign CPU architecture, so running Android tests on Apple Silicon (aarch64) Macs previously failed with "Avd's CPU Architecture 'x86_64' is not supported by the QEMU2 emulator on aarch64 host."

- Auto-detect host CPU arch (`os.arch()`): default to `arm64-v8a` + `google_apis` system image on arm64 hosts, `x86_64` + `default` elsewhere
- Expand AVD `disk.dataPartition.size` to 2 GB (default 512 MB caused out-of-space errors during harness installation)
- Resolve the launcher component name dynamically via `cmd package resolve-activity --brief` instead of hardcoding, fixing `adb shell monkey` failures (exit 251) on physical-key-less arm64 emulators
- Switch app launch from `adb shell monkey` to `adb shell am start -n <component>` with monkey as fallback
- Filter AVD picker to only show AVDs whose `abi.type` matches the host architecture
