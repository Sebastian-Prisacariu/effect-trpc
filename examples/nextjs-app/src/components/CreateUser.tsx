"use client"

import { useState } from "react"
import { trpc } from "~/lib/trpc"

/**
 * CreateUser component demonstrating nested router mutations.
 *
 * Uses: api.user.profile.update (nested path: user -> profile -> update)
 *
 * Note: In a real app, this would create a new user. Here we're demonstrating
 * the profile update mutation for the nested router pattern.
 */
export function CreateUser() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")

  // Using nested router path: user.profile.update
  const { mutateAsync, isPending, isError, error, isSuccess, data, reset } =
    trpc.procedures.user.profile.update.useMutation({
      invalidates: ["user.profile.get"],
    })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await mutateAsync({ name, email })
      setName("")
      setEmail("")
    } catch (err) {
      // Error is handled by mutation state
    }
  }

  return (
    <div className="p-4 border rounded">
      <h3 className="text-lg font-bold mb-4">Create User</h3>
      
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="Enter name"
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="Enter email"
            required
          />
        </div>
        
        <button
          type="submit"
          disabled={isPending}
          className="w-full p-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
        >
          {isPending ? "Creating..." : "Create User"}
        </button>
      </form>

      {isSuccess && data && (
        <div className="mt-3 p-2 bg-green-100 text-green-800 rounded">
          Updated profile: {data.name}
        </div>
      )}

      {isError && (
        <div className="mt-3 p-2 bg-red-100 text-red-800 rounded">
          Error: {String(error)}
        </div>
      )}
    </div>
  )
}
