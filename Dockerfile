# One image for every Arterial pipeline stage on Condense; ARTERIAL_STAGE picks the stage.
# Kafka settings (KAFKA_BOOTSTRAP_SERVERS, KAFKA_SECURITY_PROTOCOL, KAFKA_SASL_MECHANISM,
# KAFKA_USERNAME, KAFKA_PASSWORD) and TEAM_PREFIX come from the transform's environment
# variables in Condense, never from the image.
FROM python:3.12-slim
WORKDIR /app
COPY pipeline/requirements.txt pipeline/requirements.txt
RUN pip install --no-cache-dir -r pipeline/requirements.txt
COPY pipeline/ pipeline/
COPY data/networks/ data/networks/
ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "pipeline.run"]
