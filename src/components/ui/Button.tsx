import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
}

export function Button({ className, variant = 'primary', size = 'md', ...props }: Props) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-9 px-3' : 'h-10 px-4',
        variant === 'primary' &&
          'border-cyan-400/30 bg-cyan-400/15 text-cyan-50 hover:bg-cyan-400/20',
        variant === 'secondary' &&
          'border-cyan-400/40 bg-transparent text-cyan-100 hover:bg-cyan-400/10',
        variant === 'ghost' &&
          'border-transparent bg-transparent text-zinc-200 hover:bg-white/5 hover:text-white',
        className,
      )}
      {...props}
    />
  )
}
