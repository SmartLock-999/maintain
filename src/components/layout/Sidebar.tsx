import { NavLink } from 'react-router-dom'
import { Cpu, LayoutDashboard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

export function Sidebar() {
  const user = useAuthStore((s) => s.user)

  return (
    <aside className="hidden border-r border-slate-800/60 bg-[#0F1730]/60 px-4 py-6 lg:block">
      <div className="flex items-center gap-2">
        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-200">
          <Cpu className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide">Smart Lock Console</div>
          <div className="text-xs text-slate-400">Realtime Device Ops</div>
        </div>
      </div>

      <div className="mt-8 space-y-2">
        <NavLink
          to="/"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-white/5',
              isActive ? 'bg-white/5 text-cyan-100' : 'text-slate-300',
            )
          }
          end
        >
          <LayoutDashboard className="h-4 w-4" />
          總覽
        </NavLink>
      </div>

      <div className="mt-10 rounded-xl border border-slate-800/60 bg-slate-950/30 px-4 py-3">
        <div className="text-xs text-slate-400">登入帳號</div>
        <div className="mt-1 truncate text-sm text-slate-100">{user?.email ?? '—'}</div>
      </div>
    </aside>
  )
}
