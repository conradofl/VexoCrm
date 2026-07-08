import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EvolutionInstanceRow } from "@/lib/evolutionAdmin/types";
import { formatDate, shortUrl } from "@/lib/evolutionAdmin/helpers";
import { SecretBadge } from "@/lib/evolutionAdmin/SecretBadge";

interface InstancesTableProps {
  instances: EvolutionInstanceRow[];
  onEdit: (row: EvolutionInstanceRow) => void;
}

export function InstancesTable({ instances, onEdit }: InstancesTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Instancias Evolution por tenant</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Instancia</TableHead>
              <TableHead>URL de disparo</TableHead>
              <TableHead>API key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{row.client_name}</div>
                  <div className="text-[11px] text-muted-foreground">{row.client_id}</div>
                </TableCell>
                <TableCell>
                  <div>{row.name}</div>
                  <div className="text-[11px] text-muted-foreground">{row.is_default ? "default" : row.chip_state}</div>
                </TableCell>
                <TableCell className="max-w-[360px] truncate font-mono text-[11px]" title={row.dispatch_webhook_url || ""}>
                  {shortUrl(row.dispatch_webhook_url)}
                </TableCell>
                <TableCell><SecretBadge defined={row.has_dispatch_webhook_token} /></TableCell>
                <TableCell>{row.active ? <Badge>ativa</Badge> : <Badge variant="secondary">inativa</Badge>}</TableCell>
                <TableCell>{formatDate(row.updated_at)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => onEdit(row)}>Editar</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
