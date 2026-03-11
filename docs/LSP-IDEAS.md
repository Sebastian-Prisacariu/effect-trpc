# LSP Ideas

Future ideas for an effect-trpc Language Server Plugin.

---

## Warnings

### Missing reconcile or invalidates with optimistic

If a mutation has `optimistic` defined but neither `reconcile` nor `invalidates`, show a warning:

```typescript
const create = Procedure.mutation({
  payload: CreateUserInput,
  success: User,
  optimistic: {
    target: "user.list",
    reducer: (users, input) => [...users, { ...input, id: "temp" }],
    // ⚠️ Warning: optimistic update without reconcile or invalidates
    //    Temp items will persist after mutation succeeds.
    //    Add `reconcile` to merge server response, or `invalidates` to refetch.
  },
})
```

---

## Future Ideas

- Validate `target` paths exist in router
- Validate `invalidates` paths exist in router
- Type-check reducer return type matches target query's success type
- Warn if middleware error types aren't handled in client
- Suggest adding `.middleware()` if handler uses `yield* CurrentUser` without it
