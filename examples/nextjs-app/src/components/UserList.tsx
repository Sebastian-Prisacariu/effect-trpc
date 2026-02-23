"use client"

import { trpc } from "~/lib/trpc"

/**
 * UserList component demonstrating nested router usage.
 *
 * Uses: api.admin.users.list (nested path: admin -> users -> list)
 */
export function UserList() {
  // Using nested router path: admin.users.list
  const { data: users, isLoading, error, refetch } = trpc.procedures.admin.users.list.useQuery()

  if (isLoading) {
    return <div className="p-4">Loading users...</div>
  }

  if (error) {
    return (
      <div className="p-4 text-red-500">
        Error loading users: {String(error)}
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Users (Admin)</h2>
        <button
          onClick={() => refetch()}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Refresh
        </button>
      </div>
      <ul className="space-y-2">
        {users?.map((user: { id: string; name: string; email: string }) => (
          <li
            key={user.id}
            className="p-3 bg-gray-100 rounded border"
          >
            <div className="font-medium">{user.name}</div>
            <div className="text-sm text-gray-600">{user.email}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
