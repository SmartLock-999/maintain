import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="close" />
      <div className="relative mx-auto mt-24 w-[92vw] max-w-lg">
        <div
          className={cn(
            'overflow-hidden rounded-xl border border-slate-800/70 bg-[#0F1730] shadow-[0_0_0_1px_rgba(0,229,255,0.06)_inset]',
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
            <div className="text-sm font-semibold tracking-wide text-slate-100">{title}</div>
            <button className="text-sm text-slate-400 hover:text-slate-200" onClick={onClose}>
              關閉
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
