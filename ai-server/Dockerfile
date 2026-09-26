# Hugging Face Space (Docker, free CPU hardware: 2 vCPU, 16 GB).
FROM python:3.11-slim

# CPU-only PyTorch: a fraction of the size of the default (CUDA) build.
RUN pip install --no-cache-dir torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Spaces run as user 1000; models are downloaded to its cache on first start.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user HF_HOME=/home/user/.cache/huggingface PYTHONUNBUFFERED=1
WORKDIR /home/user/app
COPY --chown=user app.py models.py ./

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
