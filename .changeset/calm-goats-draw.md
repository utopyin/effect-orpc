---
"effect-orpc": minor
---

Add `eoc`, an Effect-aware wrapper around `@orpc/contract`'s `oc`, so contract definitions can reuse tagged error classes directly in `.errors(...)`.

Example:

```ts
class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
  code: "NOT_FOUND",
  schema: z.object({ userId: z.string() }),
}) {}

const contract = {
  users: {
    find: eoc
      .errors({
        NOT_FOUND: UserNotFoundError,
      })
      .input(z.object({ userId: z.string() }))
      .output(z.object({ userId: z.string() })),
  },
};
```
