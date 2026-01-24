"""Main entry point for the CareerSim Agent."""

import logging
import os
import sys
from pathlib import Path

# Add the project root to path for relative imports
project_root = Path(__file__).parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))


def setup_logging():
    """Configure logging for the application."""
    from .config import get_settings
    
    settings = get_settings()
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)
    
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )
    
    # Reduce noise from libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("transformers").setLevel(logging.WARNING)


def validate_config():
    """Validate required configuration."""
    from .config import get_settings
    
    settings = get_settings()
    
    if not settings.openai_api_key or settings.openai_api_key.startswith("sk-your"):
        print("\n" + "=" * 60)
        print("WARNING: OpenAI API key not configured!")
        print("=" * 60)
        print("\nPlease set OPENAI_API_KEY in your environment or .env file.")
        print("The agent will not work without a valid API key.\n")
        print("To configure:")
        print("  1. Copy .env.example to .env")
        print("  2. Edit .env and add your OpenAI API key")
        print("=" * 60 + "\n")
        return False
    
    return True


def preload_models():
    """Optionally preload transformer models for faster first response."""
    import os
    
    # Skip preload if SKIP_PRELOAD is set (useful for faster startup during dev)
    if os.getenv("SKIP_PRELOAD", "").lower() in ("1", "true", "yes"):
        print("Skipping model preload (SKIP_PRELOAD=1)")
        return
    
    print("Preloading transformer models (set SKIP_PRELOAD=1 to skip)...")
    
    try:
        from .services import get_transformers_service
        service = get_transformers_service()
        service.preload_models()
        print("Models preloaded successfully")
    except Exception as e:
        print(f"Warning: Failed to preload models: {e}")
        print("Models will be loaded on first use")


def main():
    """Run the CareerSim Agent with Gradio UI."""
    # Setup logging first
    setup_logging()
    logger = logging.getLogger(__name__)
    
    logger.info("Starting CareerSim Agent...")
    
    # Validate configuration
    if not validate_config():
        logger.warning("Configuration incomplete - some features may not work")
    
    # Optionally preload models
    preload_models()
    
    # Import and create Gradio app
    from .config import get_settings
    from .ui import create_gradio_app
    
    settings = get_settings()
    
    logger.info("Creating Gradio application...")
    app = create_gradio_app()
    
    # Launch the app
    logger.info(f"Launching Gradio UI on port {settings.gradio_server_port}...")
    
    print("\n" + "=" * 60)
    print("CareerSim Agent - Developer Console")
    print("=" * 60)
    print(f"\n  URL: http://localhost:{settings.gradio_server_port}")
    print("\n  Features:")
    print("    - Select a simulation to start a session")
    print("    - Chat with the AI persona")
    print("    - View goal progress in real-time")
    print("    - Inspect state, traces, and analysis")
    print("    - Manual triggers for proactive messages")
    print("\n  Press Ctrl+C to stop")
    print("=" * 60 + "\n")
    
    app.launch(
        server_port=settings.gradio_server_port,
        share=settings.gradio_share,
        show_error=True,
    )


if __name__ == "__main__":
    main()
