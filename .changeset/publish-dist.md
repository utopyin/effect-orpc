---
"effect-orpc": patch
---

Publish the compiled `dist` with type declarations. `publishConfig.exports` is not applied by npm or Bun, so 1.0.0 resolved to its TypeScript source at runtime and for type-checking. Consumers now get `dist/*.js` and `dist/*.d.ts`; the monorepo keeps resolving `src` through a `source` condition.
