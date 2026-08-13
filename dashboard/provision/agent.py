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

It runs as the ordinary user, never as root. Nothing it does needs root -- and being
root only because you could is how a home directory ends up full of files its owner
cannot manage. Anything privileged says `sudo` in the command, which works because
provisioning gave that user passwordless sudo, and which is what a person at a
terminal would type anyway.

Configuration comes from the environment, written into its service unit by
first-boot.sh:

    OKC_VM, OKC_TOKEN, OKC_HOST, OKC_CHANNEL_PORT
"""

import json
import os
import platform
import socket
import ssl
import subprocess
import sys
import threading
import time

VM = os.environ.get("OKC_VM", "")
TOKEN = os.environ.get("OKC_TOKEN", "")
HOST = os.environ.get("OKC_HOST", "")
PORT = int(os.environ.get("OKC_CHANNEL_PORT", "7374"))
# The authority that signed the dashboard's certificate. Written by first-boot.sh
# after checking it against a fingerprint that arrived by another route, so this
# file is trusted because of how it got here rather than because it is here.
CA = os.environ.get("OKC_CA", "/etc/okc/ca.pem")

# /bin/bash on any machine this actually runs on. Overridable so this file can be
# exercised somewhere else -- a script that can only be tested by installing an
# operating system is a script nobody tests.
SHELL = os.environ.get("OKC_SHELL", "/bin/bash")

if not VM or not TOKEN or not HOST:
    sys.exit("okc-agent: needs OKC_VM, OKC_TOKEN and OKC_HOST")


def desktop_ready():
    """Whether there is a graphical session this user could actually be shown in.

    BOOTED IS NOT USABLE, and until now nothing could tell the two apart. The
    agent connects as soon as the network works, which is well before the
    desktop exists -- so a machine reported itself ready while it was still
    showing a splash screen, and anything that needs a display (opening an
    editor, a browser sign-in) would arrive too early and fail for a reason that
    pointed nowhere near the cause.

    Asked of logind rather than guessed from an environment variable: this
    process is a system service and has no DISPLAY of its own, so its own
    environment says nothing about whether anybody has a desktop.
    """
    user = os.environ.get("USER") or ""
    try:
        out = subprocess.run(
            ["loginctl", "list-sessions", "--no-legend"],
            capture_output=True, text=True, timeout=5,
        ).stdout
    except Exception:
        return False
    for line in out.splitlines():
        # SESSION  UID  USER  SEAT  TTY -- a seated session is a desktop; an ssh
        # login has no seat, and reporting one as a desktop would be the same
        # false "ready" in a different costume.
        parts = line.split()
        if len(parts) >= 4 and parts[2] == user and parts[3].startswith("seat"):
            return True
    return False


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
        # Who this is running as, which should not be root.
        "user": os.environ.get("USER") or subprocess.run(["id", "-un"], capture_output=True, text=True).stdout.strip(),
        "desktop": desktop_ready(),
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
    """Streams output as it happens rather than at the end, because a long step with
    nothing on screen is indistinguishable from a hung one.

    A login shell, so the user's own environment applies -- their nvm-installed node,
    and whatever their ~/.profile sets up. This process is already the user, so there
    is nothing to drop to and no notion of "as root" here at all: anything needing
    privilege says `sudo` in the command, which is what a person would type.
    """
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


def beat(link, stop, sock, heard):
    """Say we are alive, and drop the session when the dashboard stops answering.

    A ONE-WAY HEARTBEAT PROVES NOTHING, which took two attempts to accept.

    Sending does not fail when the network goes away: the data sits in the
    kernel's send buffer being retransmitted, for about fifteen minutes by
    default, and `sendall` returns happily the whole time. TCP keepalive does not
    help either -- it only fires on an IDLE connection, and beating every twenty
    seconds means the idle timer never gets there. Both were tried; a cable
    pulled for ninety seconds still left the agent stuck.

    What settles it is expecting an ANSWER. The dashboard replies to every beat,
    so silence is measurable: if nothing has arrived for long enough, the far end
    is gone whatever this socket believes, and closing it is the only way to get
    the main loop out of a blocking read.
    """
    SILENCE = 70    # three missed answers, and a little slack for a slow host

    while not stop.wait(20):
        try:
            link.send({"type": "beat", "desktop": desktop_ready()})
        except Exception as err:
            print(f"okc-agent: beat failed ({err}); dropping the session", flush=True)
            try:
                sock.close()
            except Exception:
                pass
            return

        quiet = time.time() - heard["at"]
        if quiet > SILENCE:
            print(
                f"okc-agent: nothing from the dashboard for {int(quiet)}s; dropping the session",
                flush=True,
            )
            try:
                sock.close()
            except Exception:
                pass
            return


def session():
    raw = socket.create_connection((HOST, PORT), timeout=15)

    # Encrypted, and VERIFIED against the authority this machine was given when it
    # was built.
    #
    # The first thing sent below is this machine's token, which decides what it is
    # allowed to push. On a plain socket that crossed the network in clear on
    # every reconnect -- and a reboot is an ordinary reconnect, so it was not a
    # rare event.
    #
    # check_hostname stays on and the mode stays CERT_REQUIRED. Turning either
    # off is the usual way a self-signed certificate is made to "work", and it
    # would leave this accepting any certificate at all -- which is no better than
    # the plain socket it replaces, while looking like it is.
    context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=CA)
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    sock = context.wrap_socket(raw, server_hostname=HOST)

    # Keepalive as well, which costs nothing and covers the case where this is
    # genuinely idle. It is NOT what catches a network outage here: keepalive
    # only fires on an idle connection, and a beat every twenty seconds means the
    # idle timer never gets there. The silence check in `beat` is what does that.
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    for option, value in (("TCP_KEEPIDLE", 30), ("TCP_KEEPINTVL", 10), ("TCP_KEEPCNT", 3)):
        try:
            sock.setsockopt(socket.IPPROTO_TCP, getattr(socket, option), value)
        except Exception:
            pass    # not this platform's spelling

    # A READ TIMEOUT, which is the thing that actually gets this unstuck.
    #
    # Third attempt, and the first two are worth knowing about because both
    # looked right. Keepalive does not fire on a connection that beats every
    # twenty seconds -- it is never idle. Closing the socket from the beat thread
    # does not wake a `recv` that is already blocked inside the syscall: the
    # descriptor goes away and the thread stays parked. The agent detected the
    # silence correctly, said so in its journal, and then sat there anyway:
    #
    #     okc-agent: nothing from the dashboard for 80s; dropping the session
    #     (and nothing, ever again)
    #
    # A timeout needs no other thread to co-operate. It is safe because the
    # dashboard ANSWERS every beat, so this connection is never quiet for more
    # than twenty seconds while it is healthy -- a minute and a half of nothing
    # means the far end is gone, whatever the socket believes.
    sock.settimeout(90)
    heard = {"at": time.time()}
    link = Link(sock)
    link.send({"type": "hello", "vm": VM, "token": TOKEN, "facts": facts()})

    stop = threading.Event()
    threading.Thread(target=beat, args=(link, stop, sock, heard), daemon=True).start()

    buffer = ""
    try:
        while True:
            try:
                chunk = sock.recv(65536)
            except (socket.timeout, TimeoutError):
                # Ninety seconds without a word, on a connection that is answered
                # every twenty. Returning here reconnects, which is the whole
                # point: nothing else can free a blocked read.
                print("okc-agent: the dashboard has gone quiet; reconnecting", flush=True)
                return
            if not chunk:
                return
            # Anything at all counts: this is what makes the far end's silence
            # measurable, and the dashboard answers every beat so it is never
            # quiet for long unless something is wrong.
            heard["at"] = time.time()
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
                        args=(
                            link,
                            message["job"],
                            message["command"],
                            message.get("what", "command"),
                        ),
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
