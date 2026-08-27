# Base image
FROM python:3.13-slim

# Set working directory
WORKDIR /app

# Install dependencies required by psycopg2
RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Pre-train the ML model synthetic data
# This ensures model.joblib exists before Uvicorn starts
RUN python -c "from app.ml.train import train_and_save_model; train_and_save_model()"

# Start the application
# Render binds the port via the PORT environment variable
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
