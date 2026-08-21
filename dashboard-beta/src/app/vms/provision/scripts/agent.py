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
import select
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
        **memory(),
    }


def memory():
    """How much of itself this machine is using, asked of the machine.

    VIRTUALBOX CANNOT ANSWER THIS WITHOUT THE GUEST ADDITIONS. Its memory
    metrics come FROM the additions -- so a machine built without them, which is
    now every runner that has no desktop, reports nothing at all on the host
    side. The host can see how much memory the VM process has taken from
    Windows, which is not the same number and is not the one anybody wants.

    This machine knows perfectly well, and there is already a channel for it to
    say so. Read from /proc/meminfo rather than by running `free`, because it is
    a file read rather than a process, and this happens on every beat.

    Returns nothing at all rather than zeroes if it cannot be read: a missing
    fact is honest, and "0 MB used" would be a lie that looks like a reading.
    """
    try:
        seen = {}
        with open("/proc/meminfo", "r") as fh:
            for line in fh:
                key, _, rest = line.partition(":")
                if key in ("MemTotal", "MemAvailable"):
                    seen[key] = int(rest.strip().split()[0]) // 1024
        if "MemTotal" not in seen or "MemAvailable" not in seen:
            return {}
        # AVAILABLE, not free. Linux uses everything spare for cache, so "free"
        # on a healthy machine is near zero and means nothing; available is what
        # could actually be given to something new.
        return {
            "memoryTotalMB": seen["MemTotal"],
            "memoryUsedMB": seen["MemTotal"] - seen["MemAvailable"],
        }
    except Exception:
        return {}


class Link:
    """One lock around EVERY use of the TLS socket, reads included.

    OPENSSL DOES NOT ALLOW ONE CONNECTION TO BE USED FROM TWO THREADS AT ONCE,
    and Python does no locking on your behalf. This had a lock, but only around
    sending -- so writes could not corrupt each other, while a write from the
    beat thread or from a running command could and did collide with the main
    thread sitting in recv.

    The result is not an error. The TLS state machine is left inconsistent and
    the connection is torn down CLEANLY, so both ends see an orderly shutdown and
    each reports the other as having closed first. Which is precisely the
    symptom: a channel that dropped the moment a command produced output, one run
    in four or five, indifferent to what the command was or how long it took, and
    stable for as long as nothing was running -- because idle, the only writer is
    one small beat every twenty seconds and the odds of overlapping a read are
    slim. Streaming output makes it likely.

    So reads go through here too. `select` waits on the file descriptor, which
    touches no TLS state and therefore needs no lock; only the recv itself is
    taken under it, briefly, so a writer is never held up for long.
    """

    def __init__(self, sock):
        self.sock = sock
        self.lock = threading.Lock()

    def send(self, message):
        line = (json.dumps(message) + "\n").encode()
        with self.lock:
            self.sock.sendall(line)

    def receive(self):
        """Bytes if any arrived, b"" if the far end closed, None if simply nothing yet."""
        try:
            ready, _, _ = select.select([self.sock], [], [], 0.5)
        except Exception:
            return b""

        with self.lock:
            # Decrypted bytes already buffered inside openssl will never make the
            # descriptor readable, so select alone would leave them sitting there.
            if not ready and not self.sock.pending():
                return None
            try:
                # Short, because this is held under the lock. The long silence is
                # measured by the caller against its own clock instead.
                self.sock.settimeout(5)
                return self.sock.recv(65536)
            except (socket.timeout, TimeoutError):
                return None


def run_command(link, job, command, what):
    """Streams output as it happens rather than at the end, because a long step with
    nothing on screen is indistinguishable from a hung one.

    A login shell, so the user's own environment applies -- their nvm-installed node,
    and whatever their ~/.profile sets up. This process is already the user, so there
    is nothing to drop to and no notion of "as root" here at all: anything needing
    privilege says `sudo` in the command, which is what a person would type.

    A DEAD LINK IS NOT AN ERROR HERE. The session can end while a command is
    still running -- that is ordinary, and the dashboard has already given up on
    the job by then -- but every send after that raised out of this thread as an
    unhandled traceback, twenty lines of it, into the journal. Which is worse
    than noise: the journal is the back door's whole value, and a real fault
    arriving there has to be found among these. The command is still allowed to
    finish and be reaped; nobody is listening, so nothing is sent.
    """
    try:
        link.send({"type": "out", "job": job, "text": f"$ {what}"})
    except OSError:
        return

    try:
        process = subprocess.Popen(
            [SHELL, "-lc", command],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except Exception as err:
        try:
            link.send({"type": "done", "job": job, "code": 127, "what": f"{what}: {err}"})
        except OSError:
            pass
        return

    lost = False
    for line in process.stdout:
        if lost:
            continue    # drained rather than abandoned, so the child is not left
                        # blocked on a full pipe with nobody reading it
        try:
            link.send({"type": "out", "job": job, "text": line.rstrip()})
        except OSError:
            print(f"okc-agent: the link went while running {what}; letting it finish quietly", flush=True)
            lost = True

    # Always waited for. Returning early from this loop would leave a zombie for
    # every command that outlived its session.
    process.wait()
    if lost:
        return
    try:
        link.send({"type": "done", "job": job, "code": process.returncode, "what": what})
    except OSError:
        pass


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
    is gone whatever this socket believes.

    IT NO LONGER CLOSES THE SOCKET ITSELF. Closing sends a TLS close_notify --
    which is one more use of the connection from one more thread, the very thing
    that was corrupting it. It raises a flag instead; the main loop is never more
    than half a second from reading it, and closing is that loop's own job.
    """
    SILENCE = 70    # three missed answers, and a little slack for a slow host

    while not stop.wait(20):
        try:
            # Memory rides on the beat rather than being asked for, because it
            # is only interesting while it changes and a beat is already going.
            link.send({"type": "beat", "desktop": desktop_ready(), **memory()})
        except Exception as err:
            print(f"okc-agent: beat failed ({err}); dropping the session", flush=True)
            heard["give_up"] = "a beat could not be sent"
            return

        quiet = time.time() - heard["at"]
        if quiet > SILENCE:
            heard["give_up"] = f"nothing from the dashboard for {int(quiet)}s"
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
    # A short timeout now, not ninety seconds. The long silence is measured
    # against a clock in the loop below rather than by blocking, because a read
    # that blocks for ninety seconds is a read that holds the TLS lock for ninety
    # seconds -- and everything else here would have to wait for it.
    sock.settimeout(5)
    # When anything last arrived, and the reason the beat thread wants out. Shared
    # rather than returned, because the thread that notices is not the thread that
    # can act on it.
    heard = {"at": time.time(), "give_up": None}
    link = Link(sock)
    link.send({"type": "hello", "vm": VM, "token": TOKEN, "facts": facts()})

    stop = threading.Event()
    threading.Thread(target=beat, args=(link, stop, sock, heard), daemon=True).start()

    # A minute and a half of nothing at all, on a connection the dashboard
    # answers every twenty seconds. Checked against the clock rather than by
    # blocking, so noticing it costs nothing and holds nothing.
    QUIET_TOO_LONG = 90

    buffer = ""
    try:
        while True:
            if heard.get("give_up"):
                print(f"okc-agent: {heard['give_up']}; reconnecting", flush=True)
                return

            chunk = link.receive()
            if chunk is None:
                if time.time() - heard["at"] > QUIET_TOO_LONG:
                    print("okc-agent: the dashboard has gone quiet; reconnecting", flush=True)
                    return
                continue
            if not chunk:
                # SAID OUT LOUD, because this is the branch that ends a session
                # without anybody knowing. Both ends were reporting the other as
                # having closed first -- the dashboard logging "hung up" on a
                # clean close, this returning silently on an empty read -- and
                # with neither of them naming the other, there was no way to tell
                # which was true.
                print("okc-agent: the dashboard closed the connection", flush=True)
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
