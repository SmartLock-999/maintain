import { LogOut, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'

export function TopBar() {
  const signOut = useAuthStore((s) => s.signOut)

  return (
    <header className="sticky top-0 z-10 border-b border-slate-800/60 bg-[#0B1020]/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 lg:px-6">
        <div className="text-sm font-semibold tracking-wide">設備管理</div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.reload()}
            title="重新整理"
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" />
            登出
          </Button>
        </div>
      </div>
    </header>
  )
}
