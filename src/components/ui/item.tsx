import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

function ItemGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card',
        className,
      )}
      {...props}
    />
  );
}

function ItemSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('h-px bg-border', className)}
      {...props}
    />
  );
}

const itemVariants = cva('flex w-full items-center gap-3 px-4 py-3 text-start', {
  variants: {
    variant: {
      default: 'bg-transparent',
      muted: 'bg-muted/60',
    },
    size: {
      default: 'min-h-12',
      sm: 'min-h-10 px-3 py-2',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

function Item({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemVariants>) {
  return (
    <div className={cn(itemVariants({ variant, size }), className)} {...props} />
  );
}

const itemMediaVariants = cva(
  'flex shrink-0 items-center justify-center overflow-hidden',
  {
    variants: {
      variant: {
        default: 'size-8 rounded-lg bg-muted text-muted-foreground [&_svg]:size-4',
        icon: 'size-8 rounded-lg bg-muted text-muted-foreground [&_svg]:size-4',
        image: 'size-10 rounded-lg outline-1 -outline-offset-1 outline-border [&_img]:size-full [&_img]:object-cover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function ItemMedia({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div className={cn(itemMediaVariants({ variant }), className)} {...props} />
  );
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('min-w-0 flex-1', className)} {...props} />
  );
}

function ItemTitle({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn('truncate text-xs font-medium text-foreground', className)}
      {...props}
    />
  );
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn('truncate text-[11px] text-muted-foreground', className)}
      {...props}
    />
  );
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-1', className)}
      {...props}
    />
  );
}

function ItemHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('px-4 pb-1 pt-3 text-[11px] font-semibold text-muted-foreground', className)}
      {...props}
    />
  );
}

function ItemFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('border-t px-4 py-2 text-[11px] text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Item,
  ItemGroup,
  ItemSeparator,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemHeader,
  ItemFooter,
};
