# Pagination & Infinite Scroll

Load data incrementally with cursor-based pagination.

---

## Overview

Use `useInfiniteQuery` for "Load More" / infinite scroll patterns. Built on Effect Atom's `Atom.pull`.

---

## Procedure Definition

Define a paginated query with cursor and items:

```typescript
const listPosts = Procedure.query({
  payload: Schema.Struct({
    cursor: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number).pipe(Schema.withDefault(() => 20)),
  }),
  success: Schema.Struct({
    items: Schema.Array(Post),
    nextCursor: Schema.optional(Schema.String),  // undefined = no more pages
  }),
})

export const PostProcedures = Procedure.family("posts", {
  list: listPosts,
})
```

---

## useInfiniteQuery

```typescript
function PostFeed() {
  const query = api.posts.list.useInfiniteQuery(
    { limit: 10 },  // Initial params (cursor starts undefined)
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  )

  return (
    <div>
      {/* Flatten all pages */}
      {query.data.pages.flatMap(page =>
        page.items.map(post => <PostCard key={post.id} post={post} />)
      )}

      {/* Load more button */}
      {query.hasNextPage && (
        <button
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? "Loading..." : "Load More"}
        </button>
      )}
    </div>
  )
}
```

---

## Return Value

```typescript
const query = api.posts.list.useInfiniteQuery(params, options)

// Data
query.data.pages        // Page[] — all loaded pages
query.data.pageParams   // Cursor[] — cursors used for each page

// Pagination
query.fetchNextPage()       // Load next page
query.fetchPreviousPage()   // Load previous page (bidirectional)
query.hasNextPage           // boolean
query.hasPreviousPage       // boolean
query.isFetchingNextPage    // boolean
query.isFetchingPreviousPage // boolean

// Standard query props
query.isLoading      // Initial load
query.isError        // Error state
query.error          // Typed error
query.refetch()      // Refetch all pages
```

---

## Infinite Scroll (Intersection Observer)

Auto-load when user scrolls to bottom:

```typescript
function InfinitePostFeed() {
  const query = api.posts.list.useInfiniteQuery(
    { limit: 10 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor }
  )

  const loadMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          query.fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [query.hasNextPage, query.isFetchingNextPage])

  return (
    <div>
      {query.data.pages.flatMap(page =>
        page.items.map(post => <PostCard key={post.id} post={post} />)
      )}
      
      {/* Sentinel element */}
      <div ref={loadMoreRef}>
        {query.isFetchingNextPage && <Spinner />}
      </div>
    </div>
  )
}
```

---

## Bidirectional Pagination

For chat/timeline where you can scroll both ways:

```typescript
const query = api.messages.list.useInfiniteQuery(
  { limit: 20 },
  {
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    getPreviousPageParam: (firstPage) => firstPage.previousCursor,
  }
)

// Load older messages
query.fetchNextPage()

// Load newer messages
query.fetchPreviousPage()
```

---

## Under the Hood: Atom.pull

`useInfiniteQuery` uses Effect Atom's `Atom.pull` internally:

```typescript
// Conceptual implementation
const postsInfiniteAtom = Atom.pull(
  Stream.paginateEffect(undefined, (cursor) =>
    api.posts.list.run({ cursor, limit: 10 }).pipe(
      Effect.map(page => [
        page.items,
        Option.fromNullable(page.nextCursor)
      ])
    )
  )
)

// Atom.pull returns:
// {
//   items: Post[],        // All accumulated items
//   done: boolean,        // No more pages
//   pull: () => void,     // Fetch next page
// }
```

---

## Optimistic Updates with Pagination

Adding items to a paginated list:

```typescript
const createPost = Procedure.mutation({
  payload: CreatePostInput,
  success: Post,
  invalidates: ["posts.list"],  // Refetch all pages
  optimistic: {
    target: "posts.list",
    // Prepend to first page
    reducer: (data, input) => ({
      ...data,
      pages: [
        {
          ...data.pages[0],
          items: [{ ...input, id: `temp-${Date.now()}` }, ...data.pages[0].items],
        },
        ...data.pages.slice(1),
      ],
    }),
  },
})
```

---

## Offset-Based Pagination

For offset/limit instead of cursor:

```typescript
const listProducts = Procedure.query({
  payload: Schema.Struct({
    offset: Schema.Number.pipe(Schema.withDefault(() => 0)),
    limit: Schema.Number.pipe(Schema.withDefault(() => 20)),
  }),
  success: Schema.Struct({
    items: Schema.Array(Product),
    total: Schema.Number,  // Total count
  }),
})

// Usage
const query = api.products.list.useInfiniteQuery(
  { limit: 20 },
  {
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + p.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
  }
)
```

---

## Imperative Usage

Outside React:

```typescript
// Using Effect + Stream
const allPosts = await Stream.paginateEffect(undefined, (cursor) =>
  api.posts.list.run({ cursor, limit: 50 }).pipe(
    Effect.map(page => [
      page.items,
      Option.fromNullable(page.nextCursor)
    ])
  )
).pipe(
  Stream.runCollect,
  Effect.map(Chunk.toArray),
  Effect.map(chunks => chunks.flat()),
  Effect.provide(transport),
  Effect.runPromise
)
```

---

## Summary

| Pattern | Hook | Use Case |
|---------|------|----------|
| Single page | `useQuery` | Tables, grids with page buttons |
| Infinite scroll | `useInfiniteQuery` | Feeds, timelines, "Load More" |
| Bidirectional | `useInfiniteQuery` + both params | Chat, centered timeline |
