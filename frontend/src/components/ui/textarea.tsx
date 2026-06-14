import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[72px] w-full rounded-md border border-slate-200/90 bg-white/90 px-2.5 py-1.5 text-sm text-foreground ring-0 ring-offset-0 transition-colors placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border/80 dark:bg-[rgba(10,12,24,0.92)]",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
