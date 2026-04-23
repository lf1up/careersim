"""Main entry point for the CareerSIM Agent.

Supports two modes:
    python -m careersim_agent.main              # Gradio dev console (default)
    python -m careersim_agent.main --serve api  # FastAPI production server
"""

import argparse
import logging
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


def run_gradio():
    """Run the Gradio developer console."""
    from .config import get_settings
    from .ui import create_gradio_app

    settings = get_settings()

    logger = logging.getLogger(__name__)
    logger.info(f"Eval model: {settings.openai_eval_config['model']}")
    logger.info("Creating Gradio application...")
    app = create_gradio_app()

    logger.info(f"Launching Gradio UI on port {settings.gradio_server_port}...")

    print("\n" + "=" * 60)
    print("CareerSIM Agent - Developer Console")
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


def run_api(host: str = "0.0.0.0", port: int = 8000):
    """Run the FastAPI production server."""
    import uvicorn

    from .api import create_api_app

    logger = logging.getLogger(__name__)

    app = create_api_app()

    print("\n" + "=" * 60)
    print("CareerSIM Agent - Production API")
    print("=" * 60)
    print(f"\n  URL:  http://{host}:{port}")
    print(f"  Docs: http://{host}:{port}/docs")
    print("\n  Press Ctrl+C to stop")
    print("=" * 60 + "\n")

    uvicorn.run(app, host=host, port=port, log_level="info")


def main():
    """Parse arguments and launch the appropriate server."""
    parser = argparse.ArgumentParser(description="CareerSIM Agent")
    parser.add_argument(
        "--serve",
        choices=["gradio", "api"],
        default="gradio",
        help="Which server to run (default: gradio)",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="API server host (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Server port (default: 7860 for gradio, 8000 for api)",
    )

    args = parser.parse_args()

    setup_logging()
    logger = logging.getLogger(__name__)
    logger.info("Starting CareerSIM Agent...")

    if not validate_config():
        logger.warning("Configuration incomplete - some features may not work")

    if args.serve == "api":
        port = args.port or 8000
        run_api(host=args.host, port=port)
    else:
        if args.port:
            from .config import get_settings
            get_settings().gradio_server_port = args.port
        run_gradio()


if __name__ == "__main__":
    main()
