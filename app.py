"""Thin entrypoint for local development and direct launches."""

from backend import app, create_app, run_dev_server, socketio


def main() -> None:
    run_dev_server()


if __name__ == "__main__":
    main()
