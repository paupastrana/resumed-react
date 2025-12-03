
# Usamos una versión ligera de Python
FROM python:3.9-slim

# Evita archivos basura y permite ver logs en tiempo real
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Directorio de trabajo
WORKDIR /app

# --- BLOQUE DE SEGURIDAD PARA ORACLE LINUX ---
# Instalamos compiladores (gcc, g++) y librerías del sistema necesarias
# para Postgres (libpq-dev) y Spacy.
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    libpq-dev \
    gcc \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copiamos primero los requerimientos para aprovechar la caché
COPY requirements.txt .

# Actualizamos PIP y luego instalamos las librerías
# Usamos un timeout alto (1000s) por si el internet de la nube fluctúa
RUN pip install --upgrade pip
RUN pip install --no-cache-dir --default-timeout=1000 -r requirements.txt

# --- DESCARGA DEL MODELO ---
# Lo descargamos AQUÍ para que quede guardado en la imagen
# Instalamos el modelo directamente desde la fuente oficial usando PIP
RUN pip install https://github.com/explosion/spacy-models/releases/download/es_c>

# Copiamos el resto del código
COPY . .

# Comando de arranque (acepta conexiones externas 0.0.0.0)
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]

