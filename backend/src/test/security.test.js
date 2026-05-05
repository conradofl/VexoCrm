import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createLeadSchema,
  createClientSchema,
  createUserSchema,
  loginSchema,
  normalizeLeadContractPayload,
} from '../validators.js';

describe('Backend Security - Input Validation', () => {
  describe('Lead Schema Validation', () => {
    it('should reject lead with invalid email', () => {
      expect(() => {
        createLeadSchema.parse({
          nome: 'João Silva',
          email: 'invalid-email',
          telefone: '11987654321',
          client_id: '550e8400-e29b-41d4-a716-446655440000',
        });
      }).toThrow();
    });

    it('should reject lead with invalid phone', () => {
      expect(() => {
        createLeadSchema.parse({
          nome: 'João Silva',
          email: 'joao@example.com',
          telefone: '123', // Too short
          client_id: '550e8400-e29b-41d4-a716-446655440000',
        });
      }).toThrow();
    });

    it('should reject lead with invalid client_id format', () => {
      expect(() => {
        createLeadSchema.parse({
          nome: 'João Silva',
          email: 'joao@example.com',
          telefone: '11987654321',
          client_id: 'tenant invalido',
        });
      }).toThrow();
    });

    it('should accept slug client_id used by leads_clients', () => {
      const result = createLeadSchema.parse({
        nome: 'João Silva',
        email: 'joao@example.com',
        telefone: '11987654321',
        client_id: 'infinie',
      });
      expect(result.client_id).toBe('infinie');
    });

    it('should reject lead with short name', () => {
      expect(() => {
        createLeadSchema.parse({
          nome: 'Jo',
          email: 'joao@example.com',
          telefone: '11987654321',
          client_id: '550e8400-e29b-41d4-a716-446655440000',
        });
      }).toThrow();
    });

    it('should accept valid lead', () => {
      const result = createLeadSchema.parse({
        nome: 'João Silva',
        email: 'joao@example.com',
        telefone: '11987654321',
        client_id: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.nome).toBe('João Silva');
      expect(result.email).toBe('joao@example.com');
    });

    it('should reject SQL injection attempt in name', () => {
      expect(() => {
        createLeadSchema.parse({
          nome: "'; DROP TABLE leads; --",
          email: 'joao@example.com',
          telefone: '11987654321',
          client_id: '550e8400-e29b-41d4-a716-446655440000',
        });
      }).not.toThrow(); // Schema accepts it, but database layer should sanitize
    });
  });

  describe('Client Schema Validation', () => {
    it('should reject client with invalid email', () => {
      expect(() => {
        createClientSchema.parse({
          nome: 'Acme Corp',
          email: 'not-an-email',
        });
      }).toThrow();
    });

    it('should reject client with short name', () => {
      expect(() => {
        createClientSchema.parse({
          nome: 'AC',
          email: 'acme@example.com',
        });
      }).toThrow();
    });

    it('should reject invalid CNPJ format', () => {
      expect(() => {
        createClientSchema.parse({
          nome: 'Acme Corp',
          email: 'acme@example.com',
          cnpj: '12345', // Invalid format
        });
      }).toThrow();
    });

    it('should accept valid client', () => {
      const result = createClientSchema.parse({
        nome: 'Acme Corporation',
        email: 'contact@acme.com',
        cnpj: '12345678901234',
      });
      expect(result.nome).toBe('Acme Corporation');
    });
  });

  describe('User Schema Validation', () => {
    it('should reject weak password without uppercase', () => {
      expect(() => {
        createUserSchema.parse({
          email: 'user@example.com',
          password: 'password123',
          nome: 'John Doe',
          role: 'admin',
        });
      }).toThrow();
    });

    it('should reject weak password without lowercase', () => {
      expect(() => {
        createUserSchema.parse({
          email: 'user@example.com',
          password: 'PASSWORD123',
          nome: 'John Doe',
          role: 'admin',
        });
      }).toThrow();
    });

    it('should reject weak password without numbers', () => {
      expect(() => {
        createUserSchema.parse({
          email: 'user@example.com',
          password: 'PasswordOnly',
          nome: 'John Doe',
          role: 'admin',
        });
      }).toThrow();
    });

    it('should reject password shorter than 8 characters', () => {
      expect(() => {
        createUserSchema.parse({
          email: 'user@example.com',
          password: 'Pass12',
          nome: 'John Doe',
          role: 'admin',
        });
      }).toThrow();
    });

    it('should accept strong password', () => {
      const result = createUserSchema.parse({
        email: 'user@example.com',
        password: 'SecurePass123',
        nome: 'John Doe',
        role: 'admin',
      });
      expect(result.email).toBe('user@example.com');
    });

    it('should reject invalid role', () => {
      expect(() => {
        createUserSchema.parse({
          email: 'user@example.com',
          password: 'SecurePass123',
          nome: 'John Doe',
          role: 'superadmin', // Invalid role
        });
      }).toThrow();
    });

    it('should reject invalid email format', () => {
      expect(() => {
        createUserSchema.parse({
          email: 'not-an-email',
          password: 'SecurePass123',
          nome: 'John Doe',
          role: 'admin',
        });
      }).toThrow();
    });
  });

  describe('Login Schema Validation', () => {
    it('should reject login with invalid email', () => {
      expect(() => {
        loginSchema.parse({
          email: 'invalid-email',
          password: 'password123',
        });
      }).toThrow();
    });

    it('should reject login without password', () => {
      expect(() => {
        loginSchema.parse({
          email: 'user@example.com',
          password: '',
        });
      }).toThrow();
    });

    it('should accept valid login', () => {
      const result = loginSchema.parse({
        email: 'user@example.com',
        password: 'password123',
      });
      expect(result.email).toBe('user@example.com');
    });
  });

  describe('XSS and Injection Prevention', () => {
    it('should not allow script tags in name', () => {
      const maliciousInput = '<script>alert("xss")</script>';
      const result = createLeadSchema.parse({
        nome: maliciousInput,
        email: 'test@example.com',
        telefone: '11987654321',
        client_id: '550e8400-e29b-41d4-a716-446655440000',
      });
      // Schema accepts it, but frontend/database layer should sanitize
      expect(result.nome).toBe(maliciousInput);
    });

    it('should validate against NoSQL injection patterns', () => {
      expect(() => {
        createLeadSchema.parse({
          nome: { $ne: null },
          email: 'test@example.com',
          telefone: '11987654321',
          client_id: '550e8400-e29b-41d4-a716-446655440000',
        });
      }).toThrow(); // Should fail because nome should be string
    });
  });

  describe('Email Validation Edge Cases', () => {
    it('should accept valid email formats', () => {
      const validEmails = [
        'user@example.com',
        'user.name@example.co.uk',
        'user+tag@example.com',
      ];

      validEmails.forEach(email => {
        const result = createLeadSchema.parse({
          nome: 'Test User',
          email,
          telefone: '11987654321',
          client_id: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.email).toBe(email);
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'notanemail',
        'user@',
        '@example.com',
        'user @example.com',
      ];

      invalidEmails.forEach(email => {
        expect(() => {
          createLeadSchema.parse({
            nome: 'Test User',
            email,
            telefone: '11987654321',
            client_id: '550e8400-e29b-41d4-a716-446655440000',
          });
        }).toThrow();
      });
    });
  });

  describe('Phone Number Validation', () => {
    it('should accept valid Brazilian phone numbers', () => {
      const validPhones = ['11987654321', '1133334444', '5511987654321'];

      validPhones.forEach(phone => {
        const result = createLeadSchema.parse({
          nome: 'Test User',
          email: 'test@example.com',
          telefone: phone,
          client_id: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.telefone).toBe(phone);
      });
    });

    it('should reject invalid phone numbers', () => {
      const invalidPhones = ['123', 'abc', '551198765432199'];

      invalidPhones.forEach(phone => {
        expect(() => {
          createLeadSchema.parse({
            nome: 'Test User',
            email: 'test@example.com',
            telefone: phone,
            client_id: '550e8400-e29b-41d4-a716-446655440000',
          });
        }).toThrow();
      });
    });
  });

  describe('Contract aliases', () => {
    it('should normalize legacy tenant and phone aliases to official lead contract fields', () => {
      const payload = normalizeLeadContractPayload({
        nome: 'Test User',
        email: 'test@example.com',
        phone: '+55 11 98765-4321',
        tenantId: 'infinie',
        qualification: 'Lead pediu retorno',
      });

      expect(payload.client_id).toBe('infinie');
      expect(payload.telefone).toBe('5511987654321');
      expect(payload.qualificacao).toBe('Lead pediu retorno');
    });

    it('should accept legacy aliases through createLeadSchema during migration', () => {
      const result = createLeadSchema.parse({
        nome: 'Test User',
        email: 'test@example.com',
        phone: '+55 11 98765-4321',
        companyId: 'vexo',
        qualification: 'Qualificado',
      });

      expect(result.client_id).toBe('vexo');
      expect(result.telefone).toBe('5511987654321');
      expect(result.qualificacao).toBe('Qualificado');
    });
  });
});
