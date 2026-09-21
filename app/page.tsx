import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STEPS = [
  { fase: "Fase 0", estado: "siguiente", detalle: "CSVs Premier + próximos 7 días con cuotas" },
  { fase: "Fase 1", estado: "pendiente", detalle: "Ingesta Supabase + team_aliases + api_usage" },
  { fase: "Fase 2", estado: "pendiente", detalle: "Poisson + backtest + calibración" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Pizarrón FC</h1>
        <Badge variant="secondary">Paso 1 OK</Badge>
        <Badge variant="outline">+18 · juego responsable</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plataforma de análisis de fútbol</CardTitle>
          <CardDescription>
            Probabilidades estimadas por el modelo bajo ciertas condiciones. Sin
            &ldquo;apuestas seguras&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Base Next.js + Tailwind + shadcn/ui + Supabase lista. El frontend
            nunca llamará a APIs externas: todo pasa por Supabase.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roadmap</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fase</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STEPS.map((s) => (
                <TableRow key={s.fase}>
                  <TableCell>{s.fase}</TableCell>
                  <TableCell>{s.estado}</TableCell>
                  <TableCell>{s.detalle}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
