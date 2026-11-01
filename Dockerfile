FROM python:3.12.8-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    gcc \
    g++ \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --default-timeout=1000 --prefer-binary -r requirements.txt

COPY . .

EXPOSE 8800

CMD ["uvicorn", "llama_project:app", "--host", "0.0.0.0", "--port", "8800"]