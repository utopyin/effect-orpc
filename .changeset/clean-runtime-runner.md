---
"effect-orpc": minor
---

Add `eos`, the default Effect-aware builder for the `eos.provide(AppLive)` workflow. `ManagedRuntime` is now used only when you pass one explicitly, so applications can use Layer-provided builders by default and opt into a user-owned runtime when they need to control Layer acquisition and release from their application lifecycle.
