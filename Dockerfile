FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app.py serve.py ./
COPY templates ./templates
COPY static ./static

ENV PATH="/app/.venv/bin:$PATH"
ENV APP_ENV=production
EXPOSE 8080

CMD ["python", "serve.py"]
