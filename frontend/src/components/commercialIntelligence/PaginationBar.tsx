import { Button } from "@/components/ui/button";

export function PaginationBar({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (value: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <p className="text-xs text-muted-foreground">
        Pagina {page} de {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
          Proxima
        </Button>
      </div>
    </div>
  );
}
