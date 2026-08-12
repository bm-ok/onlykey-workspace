#!/usr/bin/env python3
"""The bit that dials the dashboard and stays connected.

Another dedicated, swappable script -- point a machine at your own and this one
stops being involved. It is deliberately dumb: it knows how to connect, run what it
is told, stream the output back and say what the exit code was. It knows nothing
about what any command is for, so changing what a machine does never means
replacing anything inside it.

Python 3 because Ubuntu already has it. Standard library only, so there is nothing
to install before it can run -- which matters when this is what runs first.

The dashboard listens and this dials in, not the other way round: a reboot is then
an ordinary reconnect, and the dashboard keeps the log across it.

Configuration comes from the environment, written into its service unit by
first-boot.sh:

    OKC_VM, OKC_TOKEN, OKC_HOST, OKC_CHANNEL_PORT
"""

import json
import os
import platform
import socket
import subprocess
import sys
import threading
import time

VM = os.environ.get("OKC_VM", "")
TOKEN = os.environ.get("OKC_TOKEN", "")
HOST = os.environ.get("OKC_HOST", "")
PORT = int(os.environ.get("OKC_CHANNEL_PORT", "7374"))

# /bin/bash on any machine this actually runs on. Overridable so this file can be
# exercised somewhere else -- a script that can only be tested by installing an
# operating system is a script nobody tests.
SHELL = os.environ.get("OKC_SHELL", "/bin/bash")

if not VM or not TOKEN or not HOST:
    sys.exit("okc-agent: needs OKC_VM, OKC_TOKEN and OKC_HOST")


def facts():
    """Said at hello, so the dashboard can show what this machine actually is
    rather than only that something connected."""
    try:
        addresses = subprocess.run(
            ["hostname", "-I"], capture_output=True, text=True, timeout=5
        ).stdout.split()
    except Exception:
        addresses = []
    return {
        "hostname": socket.gethostname(),
        "system": f"{platform.system()} {platform.release()}",
        "addresses": addresses,
        "user": os.environ.get("USER") or os.environ.get("SUDO_USER") or "root",
    }


class Link:
    def __init__(self, sock):
        self.sock = sock
        self.lock = threading.Lock()

    def send(self, message):
        line = (json.dumps(message) + "\n").encode()
        # Locked: output from a running command arrives from a worker thread while
        # heartbeats go out from another, and two half-written lines would corrupt
        # the framing for good.
        with self.lock:
            self.sock.sendall(line)


def run_command(link, job, command, what):
    """Streams output as it happens rather than at the end, because a long step
    with nothing on screen is indistinguishable from a hung one."""
    link.send({"type": "out", "job": job, "text": f"$ {what}"})
    try:
        process = subprocess.Popen(
            [SHELL, "-lc", command],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except Exception as err:
        link.send({"type": "done", "job": job, "code": 127, "what": f"{what}: {err}"})
        return

    for line in process.stdout:
        link.send({"type": "out", "job": job, "text": line.rstrip()})
    process.wait()
    link.send({"type": "done", "job": job, "code": process.returncode, "what": what})


def beat(link, stop):
    while not stop.wait(20):
        try:
            link.send({"type": "beat"})
        except Exception:
            return


def session():
    sock = socket.create_connection((HOST, PORT), timeout=15)
    sock.settimeout(None)
    link = Link(sock)
    link.send({"type": "hello", "vm": VM, "token": TOKEN, "facts": facts()})

    stop = threading.Event()
    threading.Thread(target=beat, args=(link, stop), daemon=True).start()

    buffer = ""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                return
            buffer += chunk.decode("utf-8", "replace")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                if not line.strip():
                    continue
                message = json.loads(line)
                if message.get("type") == "run":
                    # In a thread, so a long command does not stop this agent from
                    # answering anything else meanwhile.
                    threading.Thread(
                        target=run_command,
                        args=(link, message["job"], message["command"], message.get("what", "command")),
                        daemon=True,
                    ).start()
                elif message.get("type") == "bye":
                    print("okc-agent: dashboard said:", message.get("why", ""), flush=True)
                    return
    finally:
        stop.set()
        try:
            sock.close()
        except Exception:
            pass


# Forever, with a pause. The dashboard being restarted, or not up yet, is normal
# and not a reason to stop trying -- this runs as a service and a service that
# gives up has to be noticed by a person.
delay = 2
while True:
    try:
        session()
        delay = 2
    except Exception as err:
        print(f"okc-agent: {err}; retrying in {delay}s", flush=True)
        time.sleep(delay)
        delay = min(delay * 2, 30)
    else:
        time.sleep(2)
