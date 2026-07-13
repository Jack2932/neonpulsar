import os
import sys
import time
import socket
import subprocess

HOST = "127.0.0.1"
PORT = 5000

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ELECTRON_DIR = os.path.join(ROOT, "desktop_electron_ptt")
NEONCHAT_URL = f"http://{HOST}:{PORT}"

def wait_port(host: str, port: int, timeout: float = 25.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False

def main():
    env = os.environ.copy()

    # 1) Start NeonChat (Python)
    server = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], cwd=ROOT, env=env)

    try:
        if not wait_port(HOST, PORT, timeout=30.0):
            raise RuntimeError("NeonChat server did not open port 127.0.0.1:5000.")

        # 2) Start Electron PTT
        env["NEONCHAT_URL"] = NEONCHAT_URL

        # On Windows, npm is typically npm.cmd; shell=True makes it resolve cleanly.
        electron = subprocess.Popen("npm start", cwd=ELECTRON_DIR, env=env, shell=(os.name == "nt"))

        # Keep running while both processes are alive
        while True:
            if server.poll() is not None:
                raise RuntimeError("NeonChat (Python) exited.")
            if electron.poll() is not None:
                raise RuntimeError("Electron PTT exited.")
            time.sleep(0.5)

    except KeyboardInterrupt:
        pass
    finally:
        for p in (locals().get("electron"), locals().get("server")):
            try:
                if p and p.poll() is None:
                    p.terminate()
            except Exception:
                pass

if __name__ == "__main__":
    main()
