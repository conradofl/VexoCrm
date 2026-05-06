import { body, param, validationResult, query } from 'express-validator';
import { z } from 'zod';

/**
 * Middleware para manipular erros de validação
 */
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: errors.array().map(err => ({
          field: err.path,
          message: err.msg
        }))
      }
    });
  }
  next();
};

/**
 * Schemas Zod para validação de dados
 */

const tenantIdentifierSchema = z
  .string()
  .trim()
  .min(1, 'client_id é obrigatório')
  .max(100, 'client_id deve ter no máximo 100 caracteres')
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'client_id deve ser um identificador válido');

const brazilianPhoneSchema = z
  .string()
  .regex(/^\d{10,13}$/, 'Telefone deve ter entre 10 e 13 dígitos');

const normalizeString = (value) => {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

const normalizePhone = (value) => {
  const normalized = normalizeString(value);
  return normalized ? normalized.replace(/\D/g, '') : undefined;
};

export const normalizeLeadContractPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  return {
    ...payload,
    client_id: normalizeString(
      payload.client_id ??
      payload.clientId ??
      payload.tenant_id ??
      payload.tenantId ??
      payload.company_id ??
      payload.companyId
    ),
    telefone: normalizePhone(payload.telefone ?? payload.phone),
    qualificacao: normalizeString(payload.qualificacao ?? payload.qualification),
  };
};

// Lead Schema
const leadBaseSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório').min(3, 'Nome deve ter mínimo 3 caracteres').max(255),
  email: z.string().email('E-mail inválido'),
  telefone: brazilianPhoneSchema,
  empresa: z.string().max(255).optional(),
  status: z.enum(['novo', 'contato', 'proposta', 'cliente']).optional(),
  client_id: tenantIdentifierSchema,
  origem: z.string().max(100).optional(),
  qualificacao: z.string().max(2000).optional(),
});

export const createLeadSchema = z.preprocess(normalizeLeadContractPayload, leadBaseSchema);

export const updateLeadSchema = leadBaseSchema.partial().extend({
  id: z.string().uuid()
});

// Client Schema
export const createClientSchema = z.object({
  nome: z.string().min(1).min(3).max(255),
  email: z.string().email(),
  telefone: z.string().regex(/^\d{10,11}$/).optional(),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos').optional(),
  endereco: z.string().max(500).optional(),
});

// User Schema
export const createUserSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string()
    .min(8, 'Senha deve ter mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Senha deve conter letras maiúsculas')
    .regex(/[a-z]/, 'Senha deve conter letras minúsculas')
    .regex(/\d/, 'Senha deve conter números'),
  nome: z.string().min(1).min(3).max(255),
  role: z.enum(['admin', 'client', 'internal']),
});

// Login Schema
export const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

// WhatsApp Session Schema
export const createWhatsAppSessionSchema = z.object({
  client_id: tenantIdentifierSchema,
  phone: brazilianPhoneSchema,
});

/**
 * Middleware de validação com express-validator
 */

// Validação de Lead
export const validateCreateLead = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome é obrigatório')
    .isLength({ min: 3 }).withMessage('Nome deve ter mínimo 3 caracteres')
    .isLength({ max: 255 }).withMessage('Nome pode ter máximo 255 caracteres'),

  body('email')
    .trim()
    .isEmail().withMessage('E-mail inválido')
    .normalizeEmail(),

  body('telefone')
    .trim()
    .customSanitizer((value) => String(value || '').replace(/\D/g, ''))
    .matches(/^\d{10,13}$/).withMessage('Telefone deve ter entre 10 e 13 dígitos'),

  body('empresa')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Empresa pode ter máximo 255 caracteres'),

  body('status')
    .optional()
    .isIn(['novo', 'contato', 'proposta', 'cliente']).withMessage('Status inválido'),

  body('client_id')
    .trim()
    .notEmpty().withMessage('client_id é obrigatório')
    .matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).withMessage('client_id deve ser um identificador válido'),

  body('origem')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Origem pode ter máximo 100 caracteres'),
];

// Validação de atualização de Lead
export const validateUpdateLead = [
  param('id')
    .isUUID().withMessage('ID deve ser um UUID válido'),

  body('nome')
    .optional()
    .trim()
    .isLength({ min: 3 }).withMessage('Nome deve ter mínimo 3 caracteres')
    .isLength({ max: 255 }).withMessage('Nome pode ter máximo 255 caracteres'),

  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('E-mail inválido')
    .normalizeEmail(),

  body('telefone')
    .optional()
    .trim()
    .customSanitizer((value) => String(value || '').replace(/\D/g, ''))
    .matches(/^\d{10,13}$/).withMessage('Telefone deve ter entre 10 e 13 dígitos'),

  body('status')
    .optional()
    .isIn(['novo', 'contato', 'proposta', 'cliente']).withMessage('Status inválido'),
];

// Validação de Cliente
export const validateCreateClient = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome é obrigatório')
    .isLength({ min: 3 }).withMessage('Nome deve ter mínimo 3 caracteres')
    .isLength({ max: 255 }).withMessage('Nome pode ter máximo 255 caracteres'),

  body('email')
    .trim()
    .isEmail().withMessage('E-mail inválido')
    .normalizeEmail(),

  body('telefone')
    .optional()
    .trim()
    .matches(/^\d{10,11}$/).withMessage('Telefone deve ter 10 ou 11 dígitos'),

  body('cnpj')
    .optional()
    .trim()
    .matches(/^\d{14}$/).withMessage('CNPJ deve ter 14 dígitos'),
];

// Validação de query parameters para paginação
export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page deve ser um número positivo'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit deve estar entre 1 e 100'),
];

/**
 * Função auxiliar para validar request com Zod
 */
export const validateWithZod = (schema) => async (req, res, next) => {
  try {
    req.body = await schema.parseAsync(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        }
      });
    }
    next(error);
  }
};

/**
 * Sanitização customizada
 */
export const sanitizeLeadData = (req, res, next) => {
  if (req.body) {
    if (req.body.nome) {
      req.body.nome = req.body.nome.trim().substring(0, 255);
    }
    if (req.body.email) {
      req.body.email = req.body.email.trim().toLowerCase();
    }
    if (req.body.telefone) {
      req.body.telefone = req.body.telefone.replace(/\D/g, '');
    }
  }
  next();
};
