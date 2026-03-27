import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary/15 text-primary hover:bg-primary/20',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive/15 text-destructive hover:bg-destructive/20',
        outline:
          'border-border text-muted-foreground hover:border-primary/40',
        // Tag colour variants
        indigo: 'border-transparent bg-indigo-500/20 text-indigo-400',
        purple: 'border-transparent bg-purple-500/20 text-purple-400',
        emerald: 'border-transparent bg-emerald-500/20 text-emerald-400',
        amber: 'border-transparent bg-amber-500/20 text-amber-400',
        rose: 'border-transparent bg-rose-500/20 text-rose-400',
        sky: 'border-transparent bg-sky-500/20 text-sky-400',
        cyan: 'border-transparent bg-cyan-500/20 text-cyan-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

/**
 * TagBadge renders a badge using a custom colour from the tag's `color` field.
 */
interface TagBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string
  color?: string | null
}

function TagBadge({ name, color, className, ...props }: TagBadgeProps) {
  const style = color
    ? {
        backgroundColor: `${color}25`,
        borderColor: `${color}40`,
        color: color,
      }
    : undefined

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
        !color && 'border-transparent bg-primary/15 text-primary',
        className
      )}
      style={style}
      {...props}
    >
      #{name}
    </div>
  )
}

export { Badge, TagBadge, badgeVariants }
