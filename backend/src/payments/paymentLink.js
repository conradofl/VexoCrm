/**
 * Stub de pagamentos simulando a resposta da API da Sympla
 */
export async function createPaymentLinkStub(eventId, customerData, ticketType, quantity = 1, value = 100.00) {
  // Simulando a estrutura exata da Sympla para a criação/recuperação de um pedido
  const stubResponse = {
    data: {
      id: "BC" + Math.floor(Math.random() * 10000).toString(16).toUpperCase(),
      event_id: eventId,
      order_status: "pending",
      order_date: new Date().toISOString(),
      first_name: customerData.firstName || "Teste",
      last_name: customerData.lastName || "Sympla",
      email: customerData.email || "teste@exemplo.com",
      items: [
        {
          ticket_name: ticketType || "Ingresso Pista",
          quantity: quantity,
          value: value
        }
      ],
      payment_method: "credit_card",
      payment_url: `https://checkout.sympla.com.br/pay/${eventId}/${Math.random().toString(36).substring(7)}`
    }
  };

  console.log("[Sympla API Stub] JSON da estrutura simulada:", JSON.stringify(stubResponse, null, 2));

  return stubResponse;
}
