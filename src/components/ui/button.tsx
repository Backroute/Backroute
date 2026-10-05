import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  // The one black button on a screen (white in dark mode): the thing to tap. Everything else is grey or a plain link.
  primary: "bg-[var(--action)] text-[var(--action-ink)] hover:bg-[var(--action-strong)] disabled:bg-ink-300",
  secondary: "bg-ink-100 text-ink-950 hover:bg-ink-150",
  outline: "bg-transparent text-ink-700 border border-line-strong hover:border-ink-950 hover:text-ink-950",
  ghost: "bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-950",
  danger: "bg-ink-100 text-[var(--accent-danger)] hover:bg-ink-150",
};

const sizeClasses: Record<Size, string> = {
  sm: "text-[13px] px-3.5 py-1.5 gap-1.5 rounded-lg",
  md: "text-sm px-4 py-2.5 gap-2 rounded-xl",
  lg: "text-base px-6 py-3.5 gap-2 rounded-xl",
};

interface BaseProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children?: React.ReactNode;
}

type ButtonAsButton = BaseProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type ButtonAsLink = BaseProps & { href: string } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    "href"
  >;

type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button({ variant = "primary", size = "md", className, children, ...props }: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center font-semibold transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed whitespace-nowrap",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );

  if ("href" in props && props.href) {
    const { href, ...rest } = props as ButtonAsLink;
    return (
      <Link href={href} className={classes} {...rest}>
        {children}
      </Link>
    );
  }

  const { ...rest } = props as ButtonAsButton;
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
