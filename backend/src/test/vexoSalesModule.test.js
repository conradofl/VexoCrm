import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync(resolve("src/server.js"), "utf8");
const migrationSource = readFileSync(
  resolve("../frontend/supabase/migrations/20260506000001_create_vexo_sales_tables.sql"),
  "utf8"
);

describe("Vexo Sales module backend guards", () => {
  it("protects every Vexo Sales endpoint with Firebase auth and admin access", () => {
    const routeLines = serverSource
      .split("\n")
      .filter((line) => line.includes('"/api/vexo-sales/'));

    expect(routeLines).toHaveLength(6);
    for (const line of routeLines) {
      expect(line).toContain("requireFirebaseAuth");
      expect(line).toContain("requireVexoSalesAdminAccess");
    }
  });

  it("logs Vexo Sales access failures without logging request payloads", () => {
    expect(serverSource).toContain("function requireVexoSalesAdminAccess");
    expect(serverSource).toContain('logVexoSalesApi("warn", "access_denied"');
    expect(serverSource).toContain('logger("[vexo-sales-api]", event');
    expect(serverSource).not.toContain("req.body,");
  });

  it("uses isolated Vexo Sales tables instead of client CRM lead or campaign tables", () => {
    const vexoSalesBlock = serverSource.slice(
      serverSource.indexOf('app.get("/api/vexo-sales/opportunities"'),
      serverSource.indexOf('app.post("/api/client-signup"')
    );

    expect(vexoSalesBlock).toContain('from("vexo_sales_opportunities")');
    expect(vexoSalesBlock).toContain('from("vexo_sales_interactions")');
    expect(vexoSalesBlock).not.toContain('from("leads")');
    expect(vexoSalesBlock).not.toContain('from("campaigns")');
    expect(vexoSalesBlock).not.toContain("selectedClient");
  });
});

describe("Vexo Sales module Supabase isolation", () => {
  it("creates isolated tables with direct RLS access denied", () => {
    expect(migrationSource).toContain("CREATE TABLE IF NOT EXISTS public.vexo_sales_opportunities");
    expect(migrationSource).toContain("CREATE TABLE IF NOT EXISTS public.vexo_sales_interactions");
    expect(migrationSource).toContain("ALTER TABLE public.vexo_sales_opportunities ENABLE ROW LEVEL SECURITY");
    expect(migrationSource).toContain("ALTER TABLE public.vexo_sales_interactions ENABLE ROW LEVEL SECURITY");
    expect(migrationSource).toContain("USING (false)");
    expect(migrationSource).toContain("WITH CHECK (false)");
  });

  it("adds indexes for operational filters and interaction history", () => {
    expect(migrationSource).toContain("idx_vexo_sales_opportunities_stage");
    expect(migrationSource).toContain("idx_vexo_sales_opportunities_status");
    expect(migrationSource).toContain("idx_vexo_sales_opportunities_priority");
    expect(migrationSource).toContain("idx_vexo_sales_opportunities_assigned_to");
    expect(migrationSource).toContain("idx_vexo_sales_interactions_opportunity_id");
  });
});
