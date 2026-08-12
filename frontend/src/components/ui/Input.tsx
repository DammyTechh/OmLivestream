'use client';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, icon, className, ...rest },
  ref
) {
  return (
    <div className="w-full">
      {label && <label className="label">{label}</label>}
      <div className="relative">
        {icon && <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{icon}</div>}
        <input
          ref={ref}
          className={cn(
            'w-full px-5 py-3.5 rounded-2xl bg-veil/[0.03] border border-veil/10 text-text',
            'focus:border-primary/60 focus:bg-veil/[0.05] focus:outline-none focus:ring-2 focus:ring-primary/20',
            'transition-all placeholder:text-muted/70',
            icon && 'pl-12',
            error && 'border-danger/60 focus:border-danger/60 focus:ring-danger/20',
            className
          )}
          {...rest}
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
});
