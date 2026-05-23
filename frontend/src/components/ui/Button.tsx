'use client';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size    = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'text-white shadow-[0_10px_30px_-10px_rgba(168,85,247,0.5)] hover:shadow-[0_20px_40px_-10px_rgba(168,85,247,0.7)]',
  secondary: 'bg-white/5 border border-white/10 text-text hover:bg-white/10 hover:border-white/20',
  ghost:     'text-muted hover:text-text hover:bg-white/5',
  danger:    'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20',
};

const sizes: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm rounded-xl',
  md: 'px-6 py-3 text-[15px] rounded-2xl',
  lg: 'px-8 py-4 text-base rounded-2xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...rest },
  ref
) {
  return (
    <motion.button
      ref={ref}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed',
        sizes[size],
        variants[variant],
        variant === 'primary' && 'overflow-hidden',
        className
      )}
      {...rest}
    >
      {variant === 'primary' && (
        <span
          className="absolute inset-0 -z-10"
          style={{
            background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)',
            backgroundSize: '200% 200%',
            animation: 'gradient 6s ease infinite',
          }}
        />
      )}
      {loading ? (
        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </motion.button>
  );
});
