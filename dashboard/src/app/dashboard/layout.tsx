import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { RestartButton } from '@/components/RestartButton'
import { SyncButton } from '@/components/SyncButton'
import { LogoutButton } from '@/components/LogoutButton'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { PANEL_TITLE } from '@/lib/panel'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value

  if (!token) {
    redirect('/')
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-16 border-b border-border bg-secondary/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
              </svg>
            </div>
            <div>
              <h1 className="font-semibold text-foreground text-sm">{PANEL_TITLE}</h1>
              <p className="text-xs text-muted-foreground">Painel Administrativo</p>
            </div>
          </div>

          <div className="flex items-center gap-3 border-l border-border pl-4">
            <SyncButton />
            <RestartButton />
            <Link
              href="/setup"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Repositório, token, banco e modo do servidor"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Configuração</span>
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  )
}
