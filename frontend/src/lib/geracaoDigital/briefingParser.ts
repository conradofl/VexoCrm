import { TRANSCRIPT_OPTIONS } from "./constants";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — movimento puro, sem alteração de forma.
// Lógica pura de derivação dos valores do briefing a partir da transcrição (parte não-estatal de processBriefingWithGemini).
export function deriveExtractedValues(transcriptText: string): Record<string, string> {
    const matchedPreset = TRANSCRIPT_OPTIONS.find((t) => transcriptText.includes(t.text.substring(0, 30)));
    
    let extractedValues: Record<string, string> = {};
    if (matchedPreset) {
      extractedValues = matchedPreset.extractedValues;
    } else {
      // Heuristic parsing on custom transcript text
      const text = transcriptText;
      
      const whatsappMatch = text.match(/(?:whatsapp|whats|tel|fone|contato|celular|cel)[\s:a-zA-Z]*(\(?\d{2}\)?\s?\d{4,5}[-.\s]?\d{4})/i) || text.match(/(\(?\d{2}\)?\s?\d{4,5}[-.\s]?\d{4})/);
      const whatsapp = whatsappMatch ? whatsappMatch[1] : "(11) 99999-9999 (Solicitar)";
      
      const siteMatch = text.match(/(?:site|domain|domínio|web|www)[\s:a-zA-Z]*([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/i) || text.match(/([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/);
      const site = siteMatch ? siteMatch[1] : "Não citado no briefing";
      
      const igMatch = text.match(/(?:instagram|insta|ig|perfil)[\s:a-zA-Z]*@([a-zA-Z0-9._]+)/i) || text.match(/@([a-zA-Z0-9._]+)/);
      const instagram = igMatch ? `@${igMatch[1]}` : "@cliente (Pendente)";
      
      const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/);
      const email = emailMatch ? emailMatch[1] : "contato@empresa.com.br";
      
      const passwordMatch = text.match(/(?:senha|password|pass|acesso)[\s:a-zA-Z]*([a-zA-Z0-9@#$_!-]+)/i);
      const password = passwordMatch ? passwordMatch[1] : "senha123";
      
      const compMatch = text.match(/(?:concorrentes|concorrente|compete|competidor|rivais)[\s:a-zA-Z]*([^\.]+)/i);
      const concorrentes = compMatch ? compMatch[1].trim() : "Mapeando concorrência local";

      const inspMatch = text.match(/(?:inspiração|inspirar|referência|gostamos)[\s:a-zA-Z]*([^\.]+)/i);
      const inspiracao = inspMatch ? inspMatch[1].trim() : "Clean e moderno";

      const geoMatch = text.match(/(?:atuação|cidade|estado|região|localizado|endereço)[\s:a-zA-Z]*([^\.]+)/i);
      const atuacao = geoMatch ? geoMatch[1].trim() : "Local";

      const targetMatch = text.match(/(?:público|publico|persona|idade)[\s:a-zA-Z]*([^\.]+)/i);
      const publico = targetMatch ? targetMatch[1].trim() : "Consumidores do segmento";

      const blockMatch = text.match(/(?:bloqueado|não abordar|nunca falar|assuntos)[\s:a-zA-Z]*([^\.]+)/i);
      const bloqueado = blockMatch ? blockMatch[1].trim() : "Política, religião e polêmicas";

      const themesMatch = text.match(/(?:temas|conteúdo|postagens|linha editorial)[\s:a-zA-Z]*([^\.]+)/i);
      const temas = themesMatch ? themesMatch[1].trim() : "Dicas úteis, bastidores e depoimentos";

      const prodMatch = text.match(/(?:serviços|produtos|vende|contratamos|fechamos)[\s:a-zA-Z]*([^\.]+)/i);
      const produtos = prodMatch ? prodMatch[1].trim() : "Gestão de Tráfego Pago + Social Media";

      extractedValues = {
        produtos: produtos.substring(0, 80),
        logo: text.includes("drive.google") || text.includes("dropbox") 
          ? "Link de nuvem detectado no áudio" 
          : "Link de pasta compartilhada pendente",
        instagram: `User: ${instagram} | Senha: ${password}`,
        facebook: `Página comercial vinculada a ${instagram}`,
        google: `User: ${email} | Senha: ${password}`,
        site,
        whatsapp,
        concorrentes: concorrentes.substring(0, 80),
        inspiracao: inspiracao.substring(0, 80),
        servicos: text.slice(0, 100) + "...",
        atuacao: atuacao.substring(0, 80),
        publico: publico.substring(0, 80),
        bloqueado: bloqueado.substring(0, 80),
        temas: temas.substring(0, 80)
      };
    }

  return extractedValues;
}
