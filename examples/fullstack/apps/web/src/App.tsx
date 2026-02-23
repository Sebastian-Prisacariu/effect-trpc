import { useState, useCallback } from "react"
import { trpc } from "./trpc"
import type { Todo } from "@example/api"

export function App() {
  const [newTodoTitle, setNewTodoTitle] = useState("")

  // Queries - cast to get proper types
  const todosQuery = trpc.procedures.todos.list.useQuery() as {
    data: Todo[] | undefined
    error: unknown
    isLoading: boolean
    refetch: () => void
  }
  const healthQuery = trpc.procedures.health.check.useQuery() as {
    data: { status: string; timestamp: Date } | undefined
  }

  // Mutations
  const createMutation = trpc.procedures.todos.create.useMutation({
    onSuccess: () => {
      todosQuery.refetch()
      setNewTodoTitle("")
    },
  }) as { mutateAsync: (input: { title: string }) => Promise<Todo>; isPending: boolean }

  const toggleMutation = trpc.procedures.todos.toggle.useMutation({
    onSuccess: () => todosQuery.refetch(),
  }) as { mutateAsync: (input: { id: string }) => Promise<Todo>; isPending: boolean }

  const deleteMutation = trpc.procedures.todos.delete.useMutation({
    onSuccess: () => todosQuery.refetch(),
  }) as { mutateAsync: (input: { id: string }) => Promise<boolean>; isPending: boolean }

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (newTodoTitle.trim()) {
        createMutation.mutateAsync({ title: newTodoTitle.trim() })
      }
    },
    [newTodoTitle, createMutation],
  )

  return (
    <div>
      <h1>effect-trpc Todo App</h1>

      {/* Health Status */}
      {healthQuery.data ? (
        <div className="health-status">
          Server status: {healthQuery.data.status}
        </div>
      ) : null}

      {/* Error Display */}
      {todosQuery.error ? (
        <div className="error">
          Error loading todos: {String(todosQuery.error)}
        </div>
      ) : null}

      {/* Add Todo Form */}
      <form className="add-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={newTodoTitle}
          onChange={(e) => setNewTodoTitle(e.target.value)}
          placeholder="What needs to be done?"
          disabled={createMutation.isPending}
        />
        <button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "Adding..." : "Add"}
        </button>
      </form>

      {/* Todo List */}
      {todosQuery.isLoading ? (
        <p className="loading">Loading todos...</p>
      ) : (
        <ul className="todo-list">
          {todosQuery.data?.map((todo) => (
            <li
              key={todo.id}
              className={`todo-item ${todo.completed ? "completed" : ""}`}
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleMutation.mutateAsync({ id: todo.id })}
                disabled={toggleMutation.isPending}
              />
              <span>{todo.title}</span>
              <button
                className="delete"
                onClick={() => deleteMutation.mutateAsync({ id: todo.id })}
                disabled={deleteMutation.isPending}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {todosQuery.data?.length === 0 ? (
        <p className="loading">No todos yet. Add one above!</p>
      ) : null}
    </div>
  )
}
