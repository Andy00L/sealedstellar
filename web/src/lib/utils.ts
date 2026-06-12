import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Standard shadcn class combiner: clsx resolves conditionals, twMerge
// resolves conflicting Tailwind utilities (last one wins).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
