import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Props = SelectHTMLAttributes<HTMLSelectElement>

export function Select({ className, ...props }: Props) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-slate-700/60 bg-slate-950/40 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20',
        className,
      )}
      {...props}
    />
  )
}
