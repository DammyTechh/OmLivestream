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
  // A restrained shadow, not a neon bloom. The old one threw a 40px purple
  // halo on hover, which on a light background looked like the button was lit
  // from inside. This is a normal elevation shadow tinted with the brand.
  primary:   'text-white shadow-[0_6px_16px_-8px_rgba(109,40,217,0.45)] hover:brightness-110 hover:shadow-[0_10px_22px_-10px_rgba(109,40,217,0.55)]',
  secondary: 'bg-veil/5 border border-veil/10 text-text hover:bg-veil/10 hover:border-veil/20',
  ghost:     'text-muted hover:text-text hover:bg-veil/5',
  danger:    'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20',
};

const sizes: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm rounded-xl',
  md: 'px-6 py-3 text-[15px] rounded-2xl',
  lg: 'px-8 py-4 text-base rounded-2xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, children, className, disabled, style, ...rest },
  ref
) {
  // A solid fill, not a gradient.
  //
  // This used to be an animated violet→purple→pink sweep. Three brand colours
  // moving under the label is the kind of thing that reads as decoration
  // rather than as a control — and because it never sits still, the eye keeps
  // going back to it. A single flat primary with a normal hover state is what
  // a production tool looks like, and it costs no animation frames.
  const primaryBg =
    variant === 'primary'
      ? { background: 'rgb(var(--c-primary))' }
      : undefined;

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
      style={{ ...primaryBg, ...style }}
      {...rest}
    >
      {loading ? (
        <div className="w-5 h-5 border-2 border-veil/30 border-t-white rounded-full animate-spin" />
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </motion.button>
  );
});
