---
"effect-orpc": patch
---

Support Effect 4.0.0.

The `typescript` peer range is now `>=5.9`, matching Effect's requirement.

Effect 4.0.0 keeps a handler's failure when a finalizer also dies, so such a procedure now returns the handler's error instead of an `INTERNAL_SERVER_ERROR` for the finalizer defect.
