"use client"

import { trpc } from "~/lib/trpc"

/**
 * PostList component demonstrating top-level procedure group access.
 *
 * Uses: api.post.list (flat path: post -> list)
 *
 * This shows that you can mix nested routers with flat procedure groups.
 */
export function PostList() {
  // Using flat procedure group path: post.list
  const { data: posts, isLoading, error, refetch } = trpc.procedures.post.list.useQuery()

  if (isLoading) {
    return <div className="p-4">Loading posts...</div>
  }

  if (error) {
    return (
      <div className="p-4 text-red-500">
        Error loading posts: {String(error)}
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Posts</h2>
        <button
          onClick={() => refetch()}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Refresh
        </button>
      </div>
      <div className="space-y-4">
        {posts?.map((post: { id: string; title: string; content: string; authorId: string }) => (
          <article
            key={post.id}
            className="p-4 bg-gray-50 rounded border"
          >
            <h3 className="font-bold text-lg">{post.title}</h3>
            <p className="text-gray-700 mt-2">{post.content}</p>
            <div className="text-sm text-gray-500 mt-2">
              By author #{post.authorId}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
