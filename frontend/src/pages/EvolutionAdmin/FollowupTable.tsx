import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FollowupCompanyRow } from "@/lib/evolutionAdmin/types";
import { shortUrl } from "@/lib/evolutionAdmin/helpers";

interface FollowupTableProps {
  companies: FollowupCompanyRow[];
  onEdit: (row: FollowupCompanyRow) => void;
}

export function FollowupTable({ companies, onEdit }: FollowupTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Follow-up</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Instancia Evolution</TableHead>
              <TableHead>Webhook de repasse</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="font-mono text-[11px]">{row.evolution_instance || "-"}</TableCell>
                <TableCell className="max-w-[420px] truncate font-mono text-[11px]" title={row.webhook_url || ""}>
                  {shortUrl(row.webhook_url)}
                </TableCell>
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
