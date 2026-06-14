import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-slate-200/90 bg-white/90 px-2.5 py-1.5 text-sm text-foreground ring-0 ring-offset-0 transition-colors file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-muted-foreground placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 [-webkit-text-fill-color:theme(colors.slate.900)] autofill:[-webkit-text-fill-color:theme(colors.slate.900)] autofill:[box-shadow:inset_0_0_0px_1000px_rgba(255,255,255,0.95)] dark:border-border/80 dark:bg-[rgba(10,12,24,0.92)] dark:[-webkit-text-fill-color:theme(colors.white)] dark:autofill:[-webkit-text-fill-color:theme(colors.white)] dark:autofill:[box-shadow:inset_0_0_0px_1000px_rgba(10,12,24,0.95)]",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
