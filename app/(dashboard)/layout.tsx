import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Sidebar from "@/components/Sidebar"
import { contextePerimetre } from "@/lib/perimetre-session"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const { perimetre, autorises } = await contextePerimetre()

  return (
    <div className="flex h-full min-h-screen bg-fond">
      <Sidebar user={session.user as any} perimetre={perimetre} perimetresAutorises={autorises} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
