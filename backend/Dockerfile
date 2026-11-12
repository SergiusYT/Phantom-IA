FROM python:3.12-slim
ARG KUBECTL_VERSION=v1.31.5
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client curl ca-certificates \
 && curl -fsSLo /usr/local/bin/kubectl https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl \
 && chmod +x /usr/local/bin/kubectl && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PHANTOM_KUBECTL=/usr/local/bin/kubectl PYTHONUNBUFFERED=1
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py seed_users && python manage.py recover_audits && python manage.py collectstatic --noinput -v0 && gunicorn phantom.wsgi -b 127.0.0.1:8000 -w 3 -t 180"]
