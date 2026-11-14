/**
 * colaboradoresRoutes.js
 *
 * Rotas de gestão de colaboradores da Geração Digital & Vexo OS.
 * Centraliza telefones oficiais, cargos, usuários do Trello e flags de cobrança
 * para agentes autônomos (GoClaw / Heloísa / Vigia).
 */

import { pgDatabasePool } from "../../services/database.js";
import { requireGdOrGoclawAuth } from "./routes.js";
import { normalizarNumerosWhatsApp } from "../../scripts/vigia-gd.mjs";

export function registerGdColaboradoresRoutes(app, pool = pgDatabasePool, authMiddleware = requireGdOrGoclawAuth()) {
  // ─── Listar Colaboradores ──────────────────────────────────────────────────
  app.get("/api/gd/colaboradores", authMiddleware, async (req, res) => {
    try {
      const { ativo } = req.query;
      let queryText = `
        SELECT id, nome, funcao, telefone, email, trello_username, recebe_cobranca_whatsapp, ativo, observacoes, created_at, updated_at
        FROM public.gd_colaboradores
      `;
      const params = [];

      if (ativo !== undefined) {
        params.push(ativo === "true" || ativo === true);
        queryText += ` WHERE ativo = $1`;
      }

      queryText += ` ORDER BY nome ASC`;

      const { rows } = await pool.query(queryText, params);
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[gd-colaboradores] Erro ao listar colaboradores:", err);
      return res.status(500).json({ error: "Erro interno ao listar colaboradores." });
    }
  });

  // ─── Obter Colaborador por ID ──────────────────────────────────────────────
  app.get("/api/gd/colaboradores/:id", authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(
        `SELECT id, nome, funcao, telefone, email, trello_username, recebe_cobranca_whatsapp, ativo, observacoes, created_at, updated_at
         FROM public.gd_colaboradores WHERE id = $1`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Colaborador não encontrado." });
      }

      return res.json({ ok: true, data: rows[0] });
    } catch (err) {
      console.error("[gd-colaboradores] Erro ao buscar colaborador:", err);
      return res.status(500).json({ error: "Erro interno ao buscar colaborador." });
    }
  });

  // ─── Criar Colaborador ─────────────────────────────────────────────────────
  app.post("/api/gd/colaboradores", authMiddleware, async (req, res) => {
    try {
      const {
        nome,
        funcao,
        telefone,
        email,
        trello_username,
        recebe_cobranca_whatsapp = true,
        ativo = true,
        observacoes,
      } = req.body || {};

      if (!nome || typeof nome !== "string" || !nome.trim()) {
        return res.status(422).json({ error: "O nome do colaborador é obrigatório." });
      }

      if (!funcao || typeof funcao !== "string" || !funcao.trim()) {
        return res.status(422).json({ error: "A função/cargo do colaborador é obrigatória." });
      }

      if (!telefone) {
        return res.status(422).json({ error: "O telefone de WhatsApp do colaborador é obrigatório." });
      }

      const numerosValidos = normalizarNumerosWhatsApp(telefone);
      if (numerosValidos.length === 0) {
        return res.status(422).json({
          error: "Telefone de WhatsApp inválido. Formato esperado com DDD (ex: 34997719779).",
        });
      }

      const telCanonico = numerosValidos[0];

      const insertSql = `
        INSERT INTO public.gd_colaboradores (
          nome, funcao, telefone, email, trello_username, recebe_cobranca_whatsapp, ativo, observacoes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const { rows } = await pool.query(insertSql, [
        nome.trim(),
        funcao.trim(),
        telCanonico,
        email ? email.trim() : null,
        trello_username ? trello_username.trim() : null,
        Boolean(recebe_cobranca_whatsapp),
        Boolean(ativo),
        observacoes ? observacoes.trim() : null,
      ]);

      return res.status(201).json({ ok: true, item: rows[0] });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "Já existe um colaborador cadastrado com este telefone de WhatsApp." });
      }
      console.error("[gd-colaboradores] Erro ao criar colaborador:", err);
      return res.status(500).json({ error: "Erro interno ao cadastrar colaborador." });
    }
  });

  // ─── Atualizar Colaborador ─────────────────────────────────────────────────
  app.patch("/api/gd/colaboradores/:id", authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        nome,
        funcao,
        telefone,
        email,
        trello_username,
        recebe_cobranca_whatsapp,
        ativo,
        observacoes,
      } = req.body || {};

      const fields = [];
      const values = [];
      let idx = 1;

      if (nome !== undefined) {
        if (!nome || typeof nome !== "string" || !nome.trim()) {
          return res.status(422).json({ error: "O nome não pode ser vazio." });
        }
        fields.push(`nome = $${idx++}`);
        values.push(nome.trim());
      }

      if (funcao !== undefined) {
        if (!funcao || typeof funcao !== "string" || !funcao.trim()) {
          return res.status(422).json({ error: "A função não pode ser vazia." });
        }
        fields.push(`funcao = $${idx++}`);
        values.push(funcao.trim());
      }

      if (telefone !== undefined) {
        const numerosValidos = normalizarNumerosWhatsApp(telefone);
        if (numerosValidos.length === 0) {
          return res.status(422).json({
            error: "Telefone de WhatsApp inválido. Formato esperado com DDD (ex: 34997719779).",
          });
        }
        fields.push(`telefone = $${idx++}`);
        values.push(numerosValidos[0]);
      }

      if (email !== undefined) {
        fields.push(`email = $${idx++}`);
        values.push(email ? email.trim() : null);
      }

      if (trello_username !== undefined) {
        fields.push(`trello_username = $${idx++}`);
        values.push(trello_username ? trello_username.trim() : null);
      }

      if (recebe_cobranca_whatsapp !== undefined) {
        fields.push(`recebe_cobranca_whatsapp = $${idx++}`);
        values.push(Boolean(recebe_cobranca_whatsapp));
      }

      if (ativo !== undefined) {
        fields.push(`ativo = $${idx++}`);
        values.push(Boolean(ativo));
      }

      if (observacoes !== undefined) {
        fields.push(`observacoes = $${idx++}`);
        values.push(observacoes ? observacoes.trim() : null);
      }

      if (fields.length === 0) {
        return res.status(400).json({ error: "Nenhum campo fornecido para atualização." });
      }

      values.push(id);
      const updateSql = `
        UPDATE public.gd_colaboradores
        SET ${fields.join(", ")}, updated_at = now()
        WHERE id = $${idx}
        RETURNING *
      `;

      const { rows } = await pool.query(updateSql, values);
      if (rows.length === 0) {
        return res.status(404).json({ error: "Colaborador não encontrado." });
      }

      return res.json({ ok: true, item: rows[0] });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "Já existe outro colaborador cadastrado com este telefone." });
      }
      console.error("[gd-colaboradores] Erro ao atualizar colaborador:", err);
      return res.status(500).json({ error: "Erro interno ao atualizar colaborador." });
    }
  });

  // ─── Excluir Colaborador ───────────────────────────────────────────────────
  app.delete("/api/gd/colaboradores/:id", authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(
        `DELETE FROM public.gd_colaboradores WHERE id = $1 RETURNING id, nome`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Colaborador não encontrado." });
      }

      return res.json({ ok: true, deleted: rows[0] });
    } catch (err) {
      console.error("[gd-colaboradores] Erro ao excluir colaborador:", err);
      return res.status(500).json({ error: "Erro interno ao excluir colaborador." });
    }
  });
}
