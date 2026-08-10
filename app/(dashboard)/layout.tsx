import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Sidebar from "@/components/Sidebar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div className="flex h-full min-h-screen bg-fond">
      <Sidebar user={session.user as any} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
