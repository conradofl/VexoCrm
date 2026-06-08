import { Wifi } from "lucide-react";

export default function Conexoes() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200/60 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/40">
        <Wifi className="h-7 w-7 text-amber-500" />
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-foreground">Conexões</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          Gerencie seus chips e instâncias WhatsApp aqui. Em construção.
        </p>
      </div>
    </div>
  );
}
