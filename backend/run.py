"""
Run script for LuminaIQ Main API (backend)

Development  : python run.py
Production   : gunicorn -c gunicorn.conf.py main:app
               (or set GUNICORN=1 to let this script invoke gunicorn)

The number of workers is controlled by settings.GUNICORN_WORKERS.
"""

import os
import sys


def run_uvicorn():
    """Single-worker dev server (hot-reload friendly)"""
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=os.environ.get("ENVIRONMENT", "development") == "development",
        log_level="info",
        access_log=True,
    )


def run_gunicorn():
    """
    Multi-worker production server using Gunicorn + UvicornWorker.
    Worker count is read from settings.GUNICORN_WORKERS (default 3).

    On Azure App Service: set GUNICORN=1 in env vars.
    Render: update startCommand in render.yaml.
    """
    from config.settings import settings

    workers = int(os.environ.get("WEB_CONCURRENCY", settings.GUNICORN_WORKERS))
    port = int(os.environ.get("PORT", 8000))

    print(f"[run.py] Starting Gunicorn with {workers} workers on port {port}")

    # Import Gunicorn's BaseApplication to run programmatically
    try:
        from gunicorn.app.base import BaseApplication

        class StandaloneApp(BaseApplication):
            def __init__(self, app, options=None):
                self.options = options or {}
                self.application = app
                super().__init__()

            def load_config(self):
                cfg = {
                    k: v
                    for k, v in self.options.items()
                    if k in self.cfg.settings and v is not None
                }
                for key, value in cfg.items():
                    self.cfg.set(key.lower(), value)

            def load(self):
                return self.application

        from main import app as fastapi_app

        options = {
            "bind": f"0.0.0.0:{port}",
            "workers": workers,
            "worker_class": "uvicorn.workers.UvicornWorker",
            "timeout": 600,           # Long timeout for LLM inference
            "keepalive": 30,
            "max_requests": 1000,     # Recycle workers to prevent memory bloat
            "max_requests_jitter": 50,
            "loglevel": "info",
            "accesslog": "-",
            "errorlog": "-",
        }

        StandaloneApp(fastapi_app, options).run()

    except ImportError:
        print("[run.py] Gunicorn not installed — falling back to Uvicorn")
        run_uvicorn()


if __name__ == "__main__":
    # Set GUNICORN=1 in production to use multi-worker mode
    use_gunicorn = os.environ.get("GUNICORN", "0") == "1"

    if use_gunicorn:
        run_gunicorn()
    else:
        run_uvicorn()
