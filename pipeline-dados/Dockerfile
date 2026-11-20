# Como se fosse um computador virtual onde o airflow roda
FROM apache/airflow:2.10.5-python3.12
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
# Roda como o usuário sem privilégios da imagem oficial (não root): exigência do Trivy (DS-0002).
USER airflow
