import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-muted",
  secondary: "border-2 border-ink text-ink hover:bg-paper-raised",
  quiet: "text-ink-muted underline-offset-4 hover:text-ink hover:underline",
  danger: "bg-fascist text-paper hover:opacity-90",
};

export const buttonClass = (variant: ButtonVariant = "primary", extra = "") =>
  [
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 font-display text-lg tracking-wide transition",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    extra,
  ].join(" ");

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
