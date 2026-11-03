import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0] dark:focus-visible:ring-[#a8c7fa] disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-[#0b57d0] dark:bg-[#a8c7fa] text-white dark:text-[#062e6f] shadow-sm hover:bg-[#0842a0] dark:hover:bg-[#d3e3fd] active:scale-[0.98]',
        filled: 'bg-[#0b57d0] dark:bg-[#a8c7fa] text-white dark:text-[#062e6f] shadow-sm hover:bg-[#0842a0] dark:hover:bg-[#d3e3fd] active:scale-[0.98]',
        tonal: 'bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] hover:bg-[#b3dcf8] dark:hover:bg-[#005a92] active:scale-[0.98]',
        text: 'text-[#0b57d0] dark:text-[#a8c7fa] hover:bg-[#0b57d0]/10 dark:hover:bg-[#a8c7fa]/10 px-3 shadow-none border-none',
        outline: 'border border-[#747775]/60 dark:border-[#8e918f]/60 bg-transparent text-slate-800 dark:text-slate-100 hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] active:scale-[0.98]',
        ghost: 'text-slate-700 dark:text-slate-200 hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c]',
        soft: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60',
        danger: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50 hover:bg-red-100 dark:hover:bg-red-900/60 active:scale-[0.98]',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-8 px-3.5 text-xs',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
