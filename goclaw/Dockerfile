FROM ghcr.io/roelfdiedericks/goclaw:latest

WORKDIR /root/.goclaw

# Copia configurações, mapeamento de colaboradores e prompts
COPY goclaw.json users.json /root/.goclaw/
COPY prompts/ /root/.goclaw/prompts/

EXPOSE 1337

CMD ["goclaw"]
