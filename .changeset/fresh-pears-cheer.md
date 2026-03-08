---
"effect-orpc": minor
---

Add `implementEffect(contract, runtime)` for contract-first oRPC handlers backed by Effect, including contract leaf `.effect(...)` support and root router enhancement.

Example:

```ts
const oe = implementEffect(contract, runtime);

export const router = oe.router({
  users: {
    list: oe.users.list.effect(function* ({ input }) {
      return yield* UsersRepo.list(input.amount);
    }),
  },
});
```
