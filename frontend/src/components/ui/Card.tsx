import { cn } from '@/lib/utils';

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative rounded-3xl border border-border bg-surface/50 backdrop-blur-sm p-6 overflow-hidden',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
