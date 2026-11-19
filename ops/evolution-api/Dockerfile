# Evolution API 2.3.7 oficial + ack do nó <status> na Baileys 7.0.0-rc.9 (Baileys PR 2883, ainda não lançado).
#
# Por quê: sem esse ack o WhatsApp segura as mensagens novas da sessão e fecha o stream a cada ~50 min. No Vexo isso
# deixou 4 instâncias "open" recebendo com 8 a 37 horas de atraso (medido em 19/11/2026).
#
# Parte da imagem OFICIAL fixada por digest (nada de imagem ou fork de terceiro). O único ajuste é o
# patch-baileys-status-ack.mjs, que confere versão, sha256 do arquivo original e cada âncora, roda node --check e
# FALHA o build se qualquer coisa não bater.
#
# Para tirar: quando sair Evolution com Baileys que já tenha o ack do <status>, voltar a usar a imagem oficial.
FROM evoapicloud/evolution-api:v2.3.7@sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339

COPY patch-baileys-status-ack.mjs /tmp/vexo-patch/patch-baileys-status-ack.mjs
RUN node /tmp/vexo-patch/patch-baileys-status-ack.mjs /evolution/node_modules/baileys/lib/Socket/messages-recv.js \
 && grep -q "ws.on('CB:status'" /evolution/node_modules/baileys/lib/Socket/messages-recv.js \
 && rm -rf /tmp/vexo-patch

LABEL org.opencontainers.image.description="evoapicloud/evolution-api:v2.3.7 + ack do <status> na Baileys rc.9 (Vexo)"
# WORKDIR, ENV e ENTRYPOINT vêm da imagem oficial, sem mudança.
