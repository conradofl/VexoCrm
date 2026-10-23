FROM ubuntu:24.04

# Evita perguntas interativas durante a instalação
ENV DEBIAN_FRONTEND=noninteractive

# Instala certificados, curl, tar e libgomp1 no Ubuntu 24.04 (GLIBC 2.39 nativa)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tar \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Baixa e instala o binário oficial do GoClaw para Linux x86_64
RUN curl -fsSL https://git.goclaw.org/roelfdiedericks/goclaw/releases/download/v0.1.21/goclaw_0.1.21_linux_amd64.tar.gz -o /tmp/goclaw.tar.gz \
    && tar -xzf /tmp/goclaw.tar.gz -C /usr/local/bin/ \
    && chmod +x /usr/local/bin/goclaw \
    && rm /tmp/goclaw.tar.gz

WORKDIR /root/.goclaw

# Copia configurações, mapeamento dos 8 colaboradores e prompts
COPY goclaw.json users.json /root/.goclaw/
COPY prompts/ /root/.goclaw/prompts/

EXPOSE 1337

CMD ["goclaw"]
