'use client'

import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()
  const logout = async () => {
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => {})
    router.push('/')
    router.refresh()
  }
  return (
    <button onClick={logout} className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline transition-colors">
      Sair
    </button>
  )
}
