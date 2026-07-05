import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # App General Settings
    APP_NAME: str = "ServiceNow AI Incident Assigner"
    PORT: int = 8000
    
    # Database Settings
    DATABASE_URL: str = "sqlite:///./incident_assignment.db"
    
    # Ollama Settings
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_TEXT_MODEL: str = "qwen3:1.7b"  # Fast local model
    OLLAMA_EMBED_MODEL: str = "qwen3-embedding:4b"  # Native embedding model

    # ChromaDB Settings
    CHROMA_PERSIST_DIR: str = "./chroma_db"
    CHROMA_COLLECTION_NAME: str = "resolved_incidents"
    
    # ServiceNow Settings
    SERVICENOW_URL: str = os.getenv("SERVICENOW_URL", "")
    SERVICENOW_USER: str = os.getenv("SERVICENOW_USER", "")
    SERVICENOW_PASSWORD: str = os.getenv("SERVICENOW_PASSWORD", "")
    
    # Roster Settings
    ROSTER_FILE_PATH: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shift_roster.xlsx")
    
    # Confidence Score Threshold (Below this will require Human Review)
    CONFIDENCE_THRESHOLD: float = 70.0
    
    @property
    def is_servicenow_mocked(self) -> bool:
        # If no URL is provided, run in simulator mode
        return not bool(self.SERVICENOW_URL)

    class Config:
        env_file = ".env"

settings = Settings()
