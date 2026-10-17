// frontend/src/pages/LandingPage/LegalModal.tsx
// Modais com os Documentos Legais Reais da Vexo Tecnologia LTDA (CNPJ 65.569.191/0001-52)
// Evita links mortos que travam a validação do jurídico do cliente antes de assinar

import React from "react";
import { createPortal } from "react-dom";
import { FileCheck, Shield, X } from "lucide-react";

export type LegalDocType = "privacy" | "terms" | "lgpd";

interface LegalModalProps {
  isOpen: boolean;
  docType: LegalDocType;
  onClose: () => void;
  onSelectDoc: (docType: LegalDocType) => void;
}

export function LegalModal({
  isOpen,
  docType,
  onClose,
  onSelectDoc,
}: LegalModalProps) {
  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl rounded-3xl border border-white/15 bg-[#0C0B1E] p-6 sm:p-8 shadow-2xl text-white flex flex-col max-h-[85vh]">
        {/* Header do Modal com Seletor de Abas */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#9600FF]/30 text-[#D7B4FF] border border-[#9600FF]/40">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Central Jurídica &amp; Compliance</h3>
              <p className="text-xs text-white/50 font-mono">
                Vexo Tecnologia LTDA · CNPJ 65.569.191/0001-52
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Abas dos 3 Documentos */}
        <div className="flex gap-2 border-b border-white/10 pb-3 mb-4 overflow-x-auto text-xs">
          <button
            onClick={() => onSelectDoc("privacy")}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap ${
              docType === "privacy"
                ? "bg-[#9600FF]/30 text-white border border-[#9600FF]/60"
                : "text-white/60 hover:text-white bg-white/5"
            }`}
          >
            Política de Privacidade
          </button>
          <button
            onClick={() => onSelectDoc("terms")}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap ${
              docType === "terms"
                ? "bg-[#9600FF]/30 text-white border border-[#9600FF]/60"
                : "text-white/60 hover:text-white bg-white/5"
            }`}
          >
            Termos de Uso
          </button>
          <button
            onClick={() => onSelectDoc("lgpd")}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap ${
              docType === "lgpd"
                ? "bg-[#9600FF]/30 text-white border border-[#9600FF]/60"
                : "text-white/60 hover:text-white bg-white/5"
            }`}
          >
            Conformidade LGPD
          </button>
        </div>

        {/* Conteúdo Jurídico Completo com Rolagem */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-4 text-xs text-white/80 leading-relaxed font-light custom-scrollbar">
          {docType === "privacy" && (
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-white">POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS</h4>
              <p>
                A <strong>Vexo Tecnologia LTDA</strong>, inscrita no CNPJ sob o nº <strong>65.569.191/0001-52</strong>, com sede na Rua Paraná, 65, Bairro Tibery, Uberlândia/MG, estabelece a presente Política de Privacidade para regular o tratamento de dados pessoais no âmbito da plataforma Vexo OS.
              </p>
              <h5 className="font-bold text-[#D7B4FF]">1. DADOS COLETADOS E FINALIDADE</h5>
              <p>
                Coletamos exclusivamente os dados necessários para a prestação de serviços comerciais, incluindo nome, telefone comercial, e-mail institucional e dados de leads importados para fins de execução de campanhas e qualificação de vendas.
              </p>
              <h5 className="font-bold text-[#D7B4FF]">2. ARMAZENAMENTO E SEGURANÇA</h5>
              <p>
                Todos os dados são transmitidos via protocolos criptografados (TLS 1.3) e armazenados em infraestrutura de nuvem com isolamento multi-tenant seguro e redundância contínua.
              </p>
              <h5 className="font-bold text-[#D7B4FF]">3. RETENÇÃO E PORTABILIDADE</h5>
              <p>
                Os dados pertencem integralmente ao Contratante. Em caso de cancelamento da assinatura, a base de contatos e os relatórios ficam disponíveis para exportação completa em formato de planilha e JSON antes de sua exclusão definitiva.
              </p>
            </div>
          )}

          {docType === "terms" && (
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-white">TERMOS E CONDIÇÕES DE USO DA PLATAFORMA VEXO OS</h4>
              <p>
                Estes Termos regulam a utilização do software como serviço (SaaS) Vexo OS. Ao acessar ou contratar nossos planos, você concorda com as disposições a seguir:
              </p>
              <h5 className="font-bold text-[#D7B4FF]">1. SEM FIDELIDADE E CANCELAMENTO LIVRE</h5>
              <p>
                Todos os nossos planos comerciais operam sem cláusula de fidelidade temporal ou carência. O Contratante poderá cancelar a renovação mensal a qualquer momento sem incidência de multas rescisórias.
              </p>
              <h5 className="font-bold text-[#D7B4FF]">2. POLÍTICA ANTI-SPAM E TRAVA HUMANA</h5>
              <p>
                O Vexo OS foi desenvolvido para comunicação legítima com bases de clientes existentes e contatos comerciais consentidos. O usuário se compromete a respeitar as diretrizes da Meta/WhatsApp e a utilizar as ferramentas de trava humana com responsabilidade ética.
              </p>
              <h5 className="font-bold text-[#D7B4FF]">3. ESCOPOS PERSONALIZADOS (PROJETOS)</h5>
              <p>
                Funcionalidades adicionais não contempladas no catálogo padrão de 8 módulos constituem Projetos Especiais, cujo escopo, prazo e preço são formalizados previamente por meio de proposta comercial aprovada por ambas as partes.
              </p>
            </div>
          )}

          {docType === "lgpd" && (
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-white">DECLARAÇÃO DE CONFORMIDADE COM A LGPD (LEI 13.709/2018)</h4>
              <p>
                A Vexo Tecnologia atua na qualidade de <strong>Operadora</strong> de dados pessoais sob as ordens e diretrizes do Contratante (<strong>Controlador</strong>), cumprindo rigorosamente os requisitos da Lei Geral de Proteção de Dados.
              </p>
              <h5 className="font-bold text-[#D7B4FF]">1. BASES LEGAIS APLICÁVEIS</h5>
              <p>
                O processamento de dados nas ferramentas de mensageria fundamenta-se na execução de contrato (Art. 7º, V da LGPD) e no legítimo interesse comercial (Art. 7º, IX da LGPD) do Controlador.
              </p>
              <h5 className="font-bold text-[#D7B4FF]">2. ATENDIMENTO AOS DIREITOS DOS TITULARES</h5>
              <p>
                Disponibilizamos ao Controlador ferramentas automáticas para inclusão de contatos em listas de descadastro (opt-out), anonimização e atendimento célere a solicitações de titulares de dados.
              </p>
              <h5 className="font-bold text-[#D7B4FF]">3. ENCARREGADO DE PROTEÇÃO DE DADOS (DPO)</h5>
              <p>
                Para solicitações relativas à privacidade e proteção de dados, disponibilizamos o canal direto de atendimento através do e-mail oficial: <strong>souvexo.ai@gmail.com</strong>.
              </p>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between">
          <span className="text-[11px] text-white/50 font-mono">
            Última atualização: Outubro de 2026
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
