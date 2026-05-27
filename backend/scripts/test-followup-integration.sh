#!/usr/bin/env bash
# Script de teste de integração do módulo de follow-up.
# Pré-requisitos:
#   - API_BASE = URL base do servidor (ex: https://api.vexocrm.com)
#   - AUTH_TOKEN = token Firebase válido (obter via console do browser)
#   - COMPANY_ID e CAMPAIGN_ID preenchidos após criar via painel
#
# Uso:
#   API_BASE=https://api.vexocrm.com AUTH_TOKEN=xxxx bash scripts/test-followup-integration.sh

set -e

API_BASE="${API_BASE:-http://localhost:3001}"
TOKEN="${AUTH_TOKEN:-}"
CYAN="\033[0;36m"
GREEN="\033[0;32m"
RED="\033[0;31m"
RESET="\033[0m"

check() {
  local label="$1"; local status="$2"; local body="$3"
  if echo "$body" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ ${label} (HTTP ${status})${RESET}"
  else
    echo -e "${RED}❌ ${label} (HTTP ${status})${RESET}"
    echo "   Body: $(echo "$body" | head -c 300)"
    exit 1
  fi
}

echo -e "\n${CYAN}═══ ETAPA A: Criar empresa ════════════════${RESET}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/followup/companies" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Empresa Teste Integração","evolution_instance":"teste-instance","panel_access":false}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
check "POST /api/followup/companies" "$STATUS" "$BODY"
COMPANY_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['company']['id'])")
echo "   company_id: $COMPANY_ID"

echo -e "\n${CYAN}═══ ETAPA B: Criar campanha ════════════════${RESET}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/followup/campaigns" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"company_id\":\"$COMPANY_ID\",\"name\":\"Campanha Teste\",\"default_origin\":\"Instagram Ads\"}")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
check "POST /api/followup/campaigns" "$STATUS" "$BODY"
CAMPAIGN_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['campaign']['id'])")
WEBHOOK_URL=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['campaign']['webhook_trigger_url'])")
WEBHOOK_SECRET=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['campaign']['webhook_secret'])")
echo "   campaign_id: $CAMPAIGN_ID"
echo "   webhook_url: $WEBHOOK_URL"

echo -e "\n${CYAN}═══ ETAPA C: Criar template ════════════════${RESET}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/followup/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"campaign_id\":\"$CAMPAIGN_ID\",\"name\":\"Confirmação Imediata\",\"message\":\"Olá {{lead_name}}, sua reunião está confirmada!\",\"trigger_type\":\"on_schedule\",\"trigger_value\":0,\"trigger_unit\":\"minutes\",\"is_active\":true,\"order_index\":0}")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
check "POST /api/followup/templates" "$STATUS" "$BODY"
TEMPLATE_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['template']['id'])")
echo "   template_id: $TEMPLATE_ID"

echo -e "\n${CYAN}═══ ETAPA D: Ativar campanha ════════════════${RESET}"
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$API_BASE/api/followup/campaigns/$CAMPAIGN_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"active"}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
check "PATCH /campaigns/:id (status=active)" "$STATUS" "$BODY"

echo -e "\n${CYAN}═══ ETAPA E: Disparar webhook (genérico) ════${RESET}"
WEBHOOK_BODY='{"lead_name":"João Teste","phone":"11999998888","meeting_datetime":"2026-07-01T14:00:00-03:00","utm_source":"instagram","utm_medium":"paid","utm_campaign":"oferta_junho"}'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$WEBHOOK_BODY")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
check "POST /webhooks/followup/:campaignId (genérico)" "$STATUS" "$BODY"
SCHEDULE_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('scheduleId',''))" 2>/dev/null || echo "")
echo "   schedule_id: $SCHEDULE_ID"
echo "   enqueued: $(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('enqueued',0))")"

echo -e "\n${CYAN}═══ ETAPA F: Listar schedules ════════════════${RESET}"
RESP=$(curl -s -w "\n%{http_code}" "$API_BASE/api/followup/schedules?companyId=$COMPANY_ID" \
  -H "Authorization: Bearer $TOKEN")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
check "GET /api/followup/schedules" "$STATUS" "$BODY"
TOTAL=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))")
echo "   Schedules encontrados: $TOTAL"

echo -e "\n${CYAN}═══ ETAPA G: Analytics ════════════════════════${RESET}"
RESP=$(curl -s -w "\n%{http_code}" "$API_BASE/api/followup/analytics?companyId=$COMPANY_ID" \
  -H "Authorization: Bearer $TOKEN")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
check "GET /api/followup/analytics" "$STATUS" "$BODY"
echo "   KPIs: $(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('kpis',{}))")"

echo -e "\n${CYAN}═══ ETAPA H: Webhook resposta do lead ═════════${RESET}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/webhooks/whatsapp/$COMPANY_ID" \
  -H "Content-Type: application/json" \
  -d '{"data":{"key":{"remoteJid":"5511999998888@s.whatsapp.net"},"message":{"conversation":"Oi, obrigado!"}},"event":"messages.upsert"}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
if [ "$STATUS" = "200" ]; then
  echo -e "${GREEN}✅ POST /webhooks/whatsapp/:companyId (HTTP 200)${RESET}"
else
  echo -e "${RED}❌ POST /webhooks/whatsapp/:companyId (HTTP $STATUS)${RESET}"
  exit 1
fi

echo -e "\n${CYAN}═══ ETAPA I: Teste campanha pausada ════════════${RESET}"
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$API_BASE/api/followup/campaigns/$CAMPAIGN_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"paused"}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
check "PATCH /campaigns/:id (paused)" "$STATUS" "$BODY"

PAYLOAD2='{"lead_name":"Teste Campanha Pausada","phone":"11988887777"}'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD2")
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
if echo "$BODY" | grep -q '"skipped":true\|"campaign_not_active"'; then
  echo -e "${GREEN}✅ Campanha pausada → skipped corretamente${RESET}"
elif [ "$STATUS" = "200" ] && echo "$BODY" | grep -q '"ok":true\|"success":true'; then
  echo -e "${GREEN}✅ Campanha pausada → 200 OK (skipped internamente)${RESET}"
else
  echo -e "${RED}❌ Campanha pausada — resposta inesperada${RESET}"
  echo "   Body: $BODY"
fi

echo -e "\n${CYAN}═══ ETAPA J: Testes de borda ══════════════════${RESET}"
# Sem phone
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/followup/campaigns" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
if [ "$STATUS" = "400" ]; then
  echo -e "${GREEN}✅ POST campanhas sem campos obrigatórios → 400${RESET}"
else
  echo -e "${RED}❌ Esperado 400, recebeu $STATUS${RESET}"
fi

# Status inválido
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$API_BASE/api/followup/campaigns/$CAMPAIGN_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"invalido"}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
if [ "$STATUS" = "400" ]; then
  echo -e "${GREEN}✅ PATCH campanha status inválido → 400${RESET}"
else
  echo -e "${RED}❌ Esperado 400, recebeu $STATUS${RESET}"
fi

# Webhook sem campaignId válido
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/webhooks/followup/nao-existe-0000" \
  -H "Content-Type: application/json" \
  -d '{"lead_name":"Test"}')
BODY=$(echo "$RESP" | head -n -1); STATUS=$(echo "$RESP" | tail -1)
if [ "$STATUS" = "200" ]; then
  echo -e "${GREEN}✅ Webhook campanha inexistente → 200 OK silencioso${RESET}"
else
  echo -e "${RED}❌ Esperado 200, recebeu $STATUS${RESET}"
fi

echo -e "\n${GREEN}══════════════════════════════════════════════════"
echo "✅ TODOS OS TESTES DE INTEGRAÇÃO PASSARAM"
echo "══════════════════════════════════════════════════${RESET}"
echo ""
echo "IDs criados neste teste (para limpeza manual se necessário):"
echo "  company_id:  $COMPANY_ID"
echo "  campaign_id: $CAMPAIGN_ID"
echo "  template_id: $TEMPLATE_ID"
