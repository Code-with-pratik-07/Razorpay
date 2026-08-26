from fastapi import APIRouter, Depends

from app.ml.predict import predict_recovery
from app.ml.train import MODEL_PATH, train_and_save_model
from app.schemas.model import ModelPredictionRequest, ModelPredictionResult, ModelTrainingResult

router = APIRouter(prefix="/api/model", tags=["model"])


@router.post("/train", response_model=ModelTrainingResult)
def train_model() -> ModelTrainingResult:
    model_path = train_and_save_model()
    return ModelTrainingResult(samples_trained=5000, model_path=str(model_path))


@router.get("/predict", response_model=ModelPredictionResult)
def model_prediction(features: ModelPredictionRequest = Depends()) -> ModelPredictionResult:
    return ModelPredictionResult(**predict_recovery(features.model_dump()))
