// Expressões SQL que classificam a última mensagem de uma conversa do inbox.
// Moram aqui (e não dentro de domains/chatbot/routes.js) para que a rota e o
// cálculo dos estados de trabalho (services/inboxWorkState.js) usem exatamente
// o mesmo texto: duas cópias divergiriam na primeira frase nova.

export const SQL_NUMBER_CHANGE_MATCH = (col) => `(
  ${col} ~* 'estamos\\s+desativando\\s+esse\\s+n[úu]mero|chama\\s+meu\\s+vendedor|nos\\s+chame\\s+no\\s+(contato|n[úu]mero|link)|novo\\s+n[úu]mero|troca\\s+de\\s+n[úu]mero'
)`;

export const SQL_AUTOMATION_MATCH = (col) => `(
  ${col} ~* 'digite\\s+(apenas\\s+)?(o\\s+)?(n[úu]mero|\\d)|(escolha|selecione|escreva)\\s+(uma\\s+)?(das\\s+)?opç[õo]|escolha\\s+(um\\s+)?(dos\\s+)?n[úu]meros?|opç[ãa]o\\s+(desejada|inv[áa]lida)|\\bmenu\\b|atendimento\\s+autom[áa]tico|protocolo\\s+de\\s+atendimento|resposta\\s+autom[áa]tica|\\[mensagem\\s+autom[áa]tica\\]|((esse\\s+|o\\s+)?(atendimento|chamado|contato)\\s+(est[áa]\\s+)?(sendo\\s+)?transferid[oa]\\s+para|(vou\\s+te\\s+transferir|transferindo|transferid[oa])\\s+para\\s+(um\\s+|o\\s+|a\\s+|noss[oa]\\s+)?(atendente|consultor[a]?|especialista|setor|departamento|escrit[óo]rio|equipe|humano|suporte|operador[a]?))|n[ãa]o\\s+(consegui\\s+identificar|entendi)\\s+(a\\s+)?(sua\\s+)?resposta|agradece(mos)?\\s+(o\\s+)?seu\\s+contato|agradecemos\\s+a\\s+prefer[êe]ncia|bem[- ]vindo\\(a\\)|hor[áa]rios?\\s+de\\s+atendimento|nosso\\s+(showroom|card[áa]pio|cat[áa]logo|site)|finalizarei\\s+nossa\\s+intera[çc][ãa]o|vou\\s+encerrar\\s+esse\\s+atendimento|atendimento\\s+foi\\s+finalizado|responder\\s+a\\s+nossa\\s+pesquisa'
)`;

// Conversa da fila de trabalho: não é grupo, está ativa e a última mensagem não
// parece automação de terceiro. `m` = última mensagem, `cs` = whatsapp_chat_states.
export const SQL_WORK_QUEUE_MATCH = (m = "m", cs = "cs") => `(
  ${m}.is_group IS NOT TRUE
  AND (COALESCE(${cs}.state, 'ativa') = 'ativa' OR ${SQL_NUMBER_CHANGE_MATCH(`${m}.message_text`)})
  AND (${cs}.state IS NOT NULL OR NOT ${SQL_AUTOMATION_MATCH(`${m}.message_text`)} OR ${SQL_NUMBER_CHANGE_MATCH(`${m}.message_text`)})
)`;
