---
"@iv-stpn/vitest-mobile": patch
---

fix: don't delete the other platform's native dir during artifact trimming

`trimAndroidBuildArtifacts` was deleting `projectDir/ios` and `trimIOSBuildArtifacts` was deleting `projectDir/android`. Because the scaffold is shared between platforms, this left the `.vitest-mobile-customized` marker in place while removing the native project the other build needed — causing the subsequent build to skip scaffolding and crash.

Both trim functions now only remove their own platform's intermediates. The `isProjectReady` check in `ensureHarnessBinary` also now verifies that the native dir for the target platform exists alongside the marker, so a partially-trimmed cache entry correctly triggers a re-scaffold.

Also fixes `typeText` on native inputs: after `typeIntoView`, the resulting `onChangeText`/`setState` re-render isn't guaranteed to have committed before the promise resolves. We now drain the UI queue and yield to JS (matching the host-bridge path) so that a subsequent `tap()` whose handler closes over the input value sees the post-type state.
