#!/bin/bash
# Test script para Hardcoded Chatbot
# Use: bash test-hardcoded-chatbot.sh

API_URL="http://localhost:3001"
PHONE="5511999999999"
CLIENT_ID="outlier"

echo "🤖 Testing Hardcoded Chatbot Endpoints"
echo "========================================"
echo ""

# Teste 1: Iniciar conversa
echo "1️⃣  Iniciando conversa..."
RESPONSE1=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\"
  }")

echo "$RESPONSE1" | jq '.' 2>/dev/null || echo "$RESPONSE1"
echo ""
echo "---"
echo ""

# Teste 2: Responder "Sim"
echo "2️⃣  Respondendo 'Sim' ao interesse..."
RESPONSE2=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"Sim\"
  }")

echo "$RESPONSE2" | jq '.' 2>/dev/null || echo "$RESPONSE2"
echo ""
echo "---"
echo ""

# Teste 3: Responder objetivo
echo "3️⃣  Respondendo objetivo..."
RESPONSE3=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"Refinanciar dívidas\"
  }")

echo "$RESPONSE3" | jq '.' 2>/dev/null || echo "$RESPONSE3"
echo ""
echo "---"
echo ""

# Teste 4: Responder estado
echo "4️⃣  Respondendo estado..."
RESPONSE4=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"São Paulo\"
  }")

echo "$RESPONSE4" | jq '.' 2>/dev/null || echo "$RESPONSE4"
echo ""
echo "---"
echo ""

# Teste 5: Responder cidade
echo "5️⃣  Respondendo cidade..."
RESPONSE5=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"São Paulo\"
  }")

echo "$RESPONSE5" | jq '.' 2>/dev/null || echo "$RESPONSE5"
echo ""
echo "---"
echo ""

# Teste 6: Responder crédito
echo "6️⃣  Respondendo crédito..."
RESPONSE6=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"Bom\"
  }")

echo "$RESPONSE6" | jq '.' 2>/dev/null || echo "$RESPONSE6"
echo ""
echo "---"
echo ""

# Teste 7: Responder parcelas
echo "7️⃣  Respondendo parcelas..."
RESPONSE7=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"12\"
  }")

echo "$RESPONSE7" | jq '.' 2>/dev/null || echo "$RESPONSE7"
echo ""
echo "---"
echo ""

# Teste 8: Responder prazo
echo "8️⃣  Respondendo prazo..."
RESPONSE8=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"Imediato\"
  }")

echo "$RESPONSE8" | jq '.' 2>/dev/null || echo "$RESPONSE8"
echo ""
echo "---"
echo ""

# Teste 9: Responder FGTS
echo "9️⃣  Respondendo FGTS..."
RESPONSE9=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"Sim\"
  }")

echo "$RESPONSE9" | jq '.' 2>/dev/null || echo "$RESPONSE9"
echo ""
echo "---"
echo ""

# Teste 10: Responder horário (finaliza)
echo "🔟 Respondendo horário (finalizará conversa)..."
RESPONSE10=$(curl -s -X POST "$API_URL/api/hardcoded-chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\",
    \"message\": \"Manhã\"
  }")

echo "$RESPONSE10" | jq '.' 2>/dev/null || echo "$RESPONSE10"
echo ""
echo "---"
echo ""

# Teste 11: Extrair briefing
echo "📊 Extraindo briefing da conversa finalizada..."
RESPONSE11=$(curl -s -X POST "$API_URL/api/hardcoded-chat-extract" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$CLIENT_ID\",
    \"phone\": \"$PHONE\"
  }")

echo "$RESPONSE11" | jq '.' 2>/dev/null || echo "$RESPONSE11"
echo ""
echo "========================================"
echo "✅ Testes concluídos!"
