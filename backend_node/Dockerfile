FROM node:18-slim

# --- BLOQUE DE DEPENDENCIAS DEL SISTEMA ---
# Instalamos:
# 1. python3, make, g++ -> Necesarios para compilar 'bcrypt' y otras librerías n>
# 2. ffmpeg -> Aunque usas ffmpeg-static, tenerlo en el sistema evita errores de>
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# 1. Copiar primero los archivos de dependencias (para aprovechar caché)
COPY package*.json ./

# 2. Instalar dependencias
RUN npm install

# 3. Copiar el resto del código (incluyendo server.cjs, public/, etc.)
COPY . .

# Exponer el puerto donde corre tu Express
EXPOSE 3000

# --- COMANDO DE ARRANQUE ---
# Apuntando a tu archivo específico
CMD ["node", "server.cjs"]


