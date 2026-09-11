import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import ts from "typescript";

function getMissingJsxImports(filePath: string): string[] {
  const code = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const importedIdentifiers = new Set<string>();

  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause) {
        if (node.importClause.name) importedIdentifiers.add(node.importClause.name.text);
        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            node.importClause.namedBindings.elements.forEach(el => {
              importedIdentifiers.add(el.name.text);
            });
          }
        }
      }
    }
  });

  const jsxTags = new Set<string>();
  function visitJSX(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      if (/^[A-Z][a-zA-Z0-9]*$/.test(tagName)) {
        jsxTags.add(tagName);
      }
    }
    ts.forEachChild(node, visitJSX);
  }
  visitJSX(sourceFile);

  const missing: string[] = [];
  for (const tag of jsxTags) {
    if (importedIdentifiers.has(tag)) continue;

    let isDeclared = false;
    function checkDecl(node: ts.Node) {
      if (
        (ts.isVariableDeclaration(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isParameter(node)) &&
        node.name &&
        node.name.getText(sourceFile) === tag
      ) {
        isDeclared = true;
      }
      if (!isDeclared) ts.forEachChild(node, checkDecl);
    }
    checkDecl(sourceFile);

    if (!isDeclared) {
      missing.push(tag);
    }
  }

  return missing;
}

describe("Integridade de Imports de Componentes JSX", () => {
  it("WhatsAppInbox não deve usar componentes JSX sem import ou declaração (ex: ChevronUp)", () => {
    const filePath = path.resolve(__dirname, "../pages/WhatsAppInbox.tsx");
    const missing = getMissingJsxImports(filePath);
    expect(missing).toEqual([]);
  });

  it("BancoDeDados não deve usar componentes JSX sem import ou declaração", () => {
    const filePath = path.resolve(__dirname, "../pages/BancoDeDados.tsx");
    const missing = getMissingJsxImports(filePath);
    expect(missing).toEqual([]);
  });

  it("Prova de mutação: quebra se simular código com ChevronUp sem import", () => {
    const sampleCodeWithoutImport = `
      import React from "react";
      import { ChevronDown } from "lucide-react";
      export function TestComponent({ show }: { show: boolean }) {
        return <div>{show ? <ChevronUp /> : <ChevronDown />}</div>;
      }
    `;
    const tempFile = path.resolve(__dirname, "./temp_mutation_test.tsx");
    try {
      fs.writeFileSync(tempFile, sampleCodeWithoutImport, "utf8");
      const missing = getMissingJsxImports(tempFile);
      expect(missing).toContain("ChevronUp");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
