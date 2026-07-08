import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LegacySettingsRow } from "@/lib/evolutionAdmin/types";
import { shortUrl } from "@/lib/evolutionAdmin/helpers";
import { SecretBadge } from "@/lib/evolutionAdmin/SecretBadge";

interface LegacySettingsTableProps {
  rows: LegacySettingsRow[];
  onEdit: (row: LegacySettingsRow) => void;
}

export function LegacySettingsTable({ rows, onEdit }: LegacySettingsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Settings legados por tenant</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>URL de disparo</TableHead>
              <TableHead>API key</TableHead>
              <TableHead>Inbound</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.client_id}>
                <TableCell>
                  <div className="font-medium">{row.client_name}</div>
                  <div className="text-[11px] text-muted-foreground">{row.client_id}</div>
                </TableCell>
                <TableCell className="max-w-[420px] truncate font-mono text-[11px]" title={row.dispatch_webhook_url || ""}>
                  {shortUrl(row.dispatch_webhook_url)}
                </TableCell>
                <TableCell><SecretBadge defined={row.has_dispatch_webhook_token} /></TableCell>
                <TableCell><SecretBadge defined={row.has_inbound_bearer_token} /></TableCell>
                <TableCell>{row.active ? <Badge>ativo</Badge> : <Badge variant="secondary">inativo</Badge>}</TableCell>
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
