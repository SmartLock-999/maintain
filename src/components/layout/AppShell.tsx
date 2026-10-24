import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, HardDriveDownload, X } from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { cn } from '@/lib/utils'

export function AppShell({ children }: { children: ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#0B1020] text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-[1400px] grid-cols-1 lg:grid-cols-[260px_1fr]">
        <Sidebar />
        <div className="flex min-h-screen flex-col">
          <TopBar onMenuClick={() => setIsMobileMenuOpen(true)} />
          <main className="flex-1 px-4 pb-24 pt-4 lg:px-6 lg:pb-10">{children}</main>
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-[70] w-72 transform bg-[#0F1730] transition-transform duration-300 ease-in-out lg:hidden',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-end p-4">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/5"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
          <Sidebar className="!block border-r-0 bg-transparent" onItemClick={() => setIsMobileMenuOpen(false)} />
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-800/60 bg-[#0F1730]/90 px-6 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-around">
          <NavLink
            to="/"
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 text-xs transition',
                isActive ? 'text-cyan-400' : 'text-slate-400',
              )
            }
            end
          >
            <LayoutDashboard className="h-5 w-5" />
            <span>總覽</span>
          </NavLink>

          <NavLink
            to="/firmware"
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 text-xs transition',
                isActive ? 'text-cyan-400' : 'text-slate-400',
              )
            }
          >
            <HardDriveDownload className="h-5 w-5" />
            <span>韌體更新</span>
          </NavLink>
        </div>
      </nav>
    </div>
  )
}
