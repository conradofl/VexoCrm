export function EmptyChart({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-[1.25rem] border border-dashed border-border bg-card px-6 text-center text-card-foreground">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
