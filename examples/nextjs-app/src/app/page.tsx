"use client"

import { UserList } from "~/components/UserList"
import { CreateUser } from "~/components/CreateUser"
import { PostList } from "~/components/PostList"

export default function Home() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="space-y-6">
        <UserList />
        <CreateUser />
      </div>
      <div>
        <PostList />
      </div>
    </div>
  )
}
