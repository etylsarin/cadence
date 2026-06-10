# Stage 1: build the Vue frontend
FROM node:20-slim AS frontend
ARG GIT_HASH=dev
ENV GIT_HASH=$GIT_HASH
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python app
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends jq curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY . .
COPY --from=frontend /app/frontend/dist ./frontend/dist
EXPOSE 8000
CMD ["uvicorn", "server:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
