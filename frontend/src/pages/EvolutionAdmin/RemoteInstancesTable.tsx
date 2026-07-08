import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link2 } from "lucide-react";
import { RemoteEvolutionInstanceRow } from "@/lib/evolutionAdmin/types";
import { shortUrl } from "@/lib/evolutionAdmin/helpers";

interface RemoteInstancesTableProps {
  instances: RemoteEvolutionInstanceRow[];
  onEdit: (row: RemoteEvolutionInstanceRow) => void;
}

export function RemoteInstancesTable({ instances, onEdit }: RemoteInstancesTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Instancias na Evolution API</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instancia</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Integracao</TableHead>
              <TableHead>Vinculo local</TableHead>
              <TableHead>URL de disparo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.map((row) => (
              <TableRow key={row.name}>
                <TableCell>
                  <div className="font-medium">{row.display_name || row.name}</div>
                  <div className="text-[11px] text-muted-foreground">{row.name}</div>
                </TableCell>
                <TableCell>{row.status ? <Badge variant="secondary">{row.status}</Badge> : "-"}</TableCell>
                <TableCell className="font-mono text-[11px]">{row.integration || "-"}</TableCell>
                <TableCell>
                  {row.local_instance_id ? (
                    <>
                      <div className="font-medium">{row.local_client_name}</div>
                      <div className="text-[11px] text-muted-foreground">{row.local_client_id}</div>
                    </>
                  ) : (
                    <Badge variant="secondary">sem vinculo</Badge>
                  )}
                </TableCell>
                <TableCell className="max-w-[360px] truncate font-mono text-[11px]" title={row.dispatch_webhook_url || ""}>
                  {shortUrl(row.dispatch_webhook_url)}
                </TableCell>
                <TableCell className="text-right">
                  {row.local_instance_id ? (
                    <Badge>editavel no banco</Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => onEdit(row)}>
                      <Link2 className="mr-2 h-3.5 w-3.5" />
                      Vincular
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
