import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function RankingDetailDialog({
  title,
  open,
  onOpenChange,
  rows,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Breakdown operacional do item selecionado.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
