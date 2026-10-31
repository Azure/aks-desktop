export const acrTaskRunnerScript = String.raw`#!/usr/bin/env python3
"""Bounded ACR Tasks build through ARM. Azure CLI is used only for the login token."""
import codecs
import email.utils
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ARM = "https://management.azure.com"
TASKS_API = "2019-04-01"
REGISTRY_API = "2023-07-01"
TERMINAL_FAILURE = {"failed", "canceled", "cancelled", "error", "timeout", "timedout"}
ACTIVE = {"queued", "started", "running", "pending", "accepted", "creating", "inprogress"}
REGISTRY_ID_PATTERN = r"/subscriptions/[^/?#]+/resourceGroups/[^/?#]+/providers/Microsoft.ContainerRegistry/registries/[a-zA-Z0-9]+"


class BuildError(Exception):
    pass


class Interrupted(BuildError):
    pass


def secure_url(url, arm=False):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.fragment or (arm and (
                parsed.hostname != "management.azure.com" or parsed.port not in (None, 443)))):
        raise BuildError("Service returned an invalid HTTPS endpoint")
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LogStream:
    def __init__(self, client, offset):
        self.client, self.offset = client, offset
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self.pending = ""
        self.url = self.query = False
        self.more = False

    def write(self, raw=b"", final=False):
        text = self.pending + self.decoder.decode(raw, final=final)
        tokens = self.client.tokens
        overlap = max([8] + [len(token) for token in tokens])
        limit = len(text) if final else max(0, len(text) - overlap + 1)
        secrets = "|".join(re.escape(token) for token in tokens)
        outside = re.compile((secrets + "|" if secrets else "") + r"https://")
        within = re.compile((secrets + "|" if secrets else "") + r"[?\s<>\"']")
        delimiter = re.compile(r"[\s<>\"']")
        output, position = [], 0
        while position < limit:
            pattern = delimiter if self.query else within if self.url else outside
            match = pattern.search(text, position)
            if not match or match.start() >= limit:
                if not self.query:
                    output.append(text[position:limit])
                position = limit
                break
            if not self.query:
                output.append(text[position:match.start()])
            value = match.group()
            if self.query:
                self.url = self.query = False
                output.append(value)
            elif value in tokens:
                output.append("[REDACTED]")
            elif value == "https://":
                self.url = True
                output.append(value)
            elif self.url and value == "?":
                # Suppress a signed query across arbitrarily many chunks without buffering it.
                self.query = True
                output.append("?[REDACTED signed query]")
            else:
                self.url = False
                output.append(value)
            position = match.end()
        self.pending = text[position:]
        print("".join(output), end="", flush=True)

    def read(self, response, headers):
        skip = self.offset if response.status == 200 else 0
        expected_end, self.more = None, False
        if response.status == 200 and "content-length" in headers:
            length = headers["content-length"]
            if not re.fullmatch(r"\d+", length):
                raise BuildError("ACR returned an invalid build log size")
            expected_end = int(length)
        elif response.status == 206:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+|\*)", headers.get("content-range", ""))
            if not match or int(match.group(1)) != self.offset or int(match.group(2)) < self.offset:
                raise BuildError("ACR returned an invalid build log range")
            expected_end = int(match.group(2)) + 1
            self.more = match.group(3) == "*"
            if match.group(3) != "*":
                if int(match.group(3)) < expected_end:
                    raise BuildError("ACR returned an invalid build log size")
                self.more = expected_end < int(match.group(3))
        while True:
            self.client.remaining()
            raw = response.read(64 * 1024)
            if not raw:
                break
            omitted = min(skip, len(raw))
            skip -= omitted
            raw = raw[omitted:]
            if raw:
                self.write(raw)
                self.offset += len(raw)
        if skip:
            raise BuildError("ACR build logs were truncated")
        if expected_end is not None and self.offset != expected_end:
            raise BuildError("ACR returned incomplete build logs")


class Client:
    def __init__(self, timeout=4200):
        self.deadline = time.monotonic() + timeout
        self.token = None
        self.tokens = []
        self.log_stream = None
        self.opener = urllib.request.build_opener(NoRedirect())

    def remaining(self):
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise BuildError("ACR build wait deadline exceeded")
        return left

    def pause(self, headers=None):
        value = (headers or {}).get("Retry-After", "5")
        try:
            delay = max(0.0, float(value))
        except (ValueError, TypeError):
            try:
                date = email.utils.parsedate_to_datetime(value)
                delay = max(0.0, date.timestamp() - time.time())
            except (ValueError, TypeError, OverflowError):
                delay = 5
        time.sleep(min(delay, self.remaining()))
        self.remaining()

    def get_token(self, refresh=False):
        if self.token is None or refresh:
            args = ["az", "account", "get-access-token", "--resource", ARM + "/",
                    "--query", "accessToken", "--output", "tsv"]
            if os.environ.get("AZURE_SUBSCRIPTION_ID"):
                args += ["--subscription", os.environ["AZURE_SUBSCRIPTION_ID"]]
            try:
                result = subprocess.run(args, capture_output=True, text=True,
                                        timeout=min(60, self.remaining()), check=True)
            except (OSError, subprocess.SubprocessError):
                raise BuildError("Unable to acquire ARM token from the existing Azure login") from None
            self.token = result.stdout.strip()
            if not self.token or "\n" in self.token:
                raise BuildError("Azure login did not return a valid ARM access token")
            self.tokens.append(self.token)
        return self.token

    def request(self, method, url, body=None, arm=True, retry=True, headers=None, log_stream=None):
        secure_url(url, arm)
        renewed = False
        attempts = 0
        while True:
            self.remaining()
            request_headers = dict(headers or {})
            if log_stream and log_stream.offset:
                request_headers["Range"] = "bytes=" + str(log_stream.offset) + "-"
            data = body
            if isinstance(body, dict):
                data = json.dumps(body).encode()
                request_headers["Content-Type"] = "application/json"
            if arm:
                request_headers["Authorization"] = "Bearer " + self.get_token()
            if hasattr(data, "seek"):
                data.seek(0)
            request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
            try:
                with self.opener.open(request, timeout=min(60, self.remaining())) as response:
                    response_headers = {key.lower(): value for key, value in response.headers.items()}
                    if log_stream:
                        log_stream.read(response, response_headers)
                        return response.status, response_headers, b""
                    # Only ARM control responses are capped; log content is streamed without a size cap.
                    raw = response.read(16 * 1024 * 1024 + 1)
                    if len(raw) > 16 * 1024 * 1024:
                        raise BuildError("ACR response exceeded the 16 MiB download limit")
                    return response.status, response_headers, raw
            except urllib.error.HTTPError as error:
                code = error.code
                response_headers = {key.lower(): value for key, value in error.headers.items()}
                error.close()
                if log_stream and code == 416:
                    size = re.fullmatch(r"bytes \*/(\d+)", response_headers.get("content-range", ""))
                    if size and int(size.group(1)) == log_stream.offset:
                        log_stream.more = False
                        return code, response_headers, b""
                if arm and code == 401 and not renewed:
                    renewed = True
                    self.get_token(refresh=True)
                    continue
                if retry and code in (408, 429, 500, 502, 503, 504) and attempts < 4:
                    attempts += 1
                    self.pause({"Retry-After": response_headers.get("retry-after", str(2 ** attempts))})
                    continue
                suffix = "; schedule acceptance is uncertain; not resubmitted" if not retry else ""
                raise BuildError("ACR HTTP " + str(code) + " during " + method + suffix) from None
            except (urllib.error.URLError, TimeoutError, OSError, http.client.IncompleteRead):
                if retry and attempts < 4:
                    attempts += 1
                    self.pause({"Retry-After": str(2 ** attempts)})
                    continue
                suffix = "; schedule acceptance is uncertain; not resubmitted" if not retry else ""
                raise BuildError("ACR transport failure during " + method + suffix) from None

    def json(self, method, url, body=None, retry=True):
        code, headers, raw = self.request(method, url, body, retry=retry)
        try:
            data = json.loads(raw) if raw.strip() else {}
            if not isinstance(data, dict):
                raise ValueError()
        except (ValueError, UnicodeError):
            raise BuildError("ACR returned an invalid JSON object") from None
        return code, headers, data

def api(resource, action="", version=TASKS_API):
    return ARM + urllib.parse.quote(resource + action, safe="/") + "?api-version=" + version


def registry_id(client):
    explicit = os.environ.get("AZURE_ACR_RESOURCE_ID", "").strip().rstrip("/")
    pattern = REGISTRY_ID_PATTERN
    if explicit:
        if not re.fullmatch(pattern, explicit, re.IGNORECASE):
            raise BuildError("AZURE_ACR_RESOURCE_ID must be a full registry ARM resource ID")
        return explicit
    subscription = required("AZURE_SUBSCRIPTION_ID")
    if not re.fullmatch(r"[a-zA-Z0-9-]+", subscription):
        raise BuildError("Invalid subscription ID")
    login = required("AZURE_CONTAINER_REGISTRY").lower()
    name = login.split(".")[0]
    if not re.fullmatch(r"[a-z0-9]+", name):
        raise BuildError("Invalid registry login name")
    url = api("/subscriptions/" + subscription + "/providers/Microsoft.ContainerRegistry/registries",
              version=REGISTRY_API)
    matches = []
    visited = set()
    while url:
        if url in visited:
            raise BuildError("Registry list repeated a pagination link")
        visited.add(url)
        _, _, data = client.json("GET", url)
        if not isinstance(data.get("value"), list):
            raise BuildError("Registry list response has no registry array")
        for item in data["value"]:
            server = item.get("properties", {}).get("loginServer", "").lower()
            if item.get("name", "").lower() == name and ("." not in login or server == login):
                candidate = item.get("id", "")
                if not re.fullmatch(pattern, candidate, re.IGNORECASE):
                    raise BuildError("Registry lookup returned an invalid ARM resource ID")
                matches.append(candidate)
        url = data.get("nextLink")
        if url:
            secure_url(url, True)
            if urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get("api-version") != [REGISTRY_API]:
                raise BuildError("Registry pagination changed the stable API version")
    if len(matches) != 1:
        raise BuildError("Registry lookup must find exactly one matching registry; set AZURE_ACR_RESOURCE_ID")
    return matches[0]


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise BuildError("Missing required input " + name)
    return value


def state_path():
    identity = [os.environ.get(name, "") for name in (
        "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB",
        "GITHUB_WORKSPACE", "CONTAINER_NAME")]
    key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:24]
    return Path(required("RUNNER_TEMP")) / ("aksd-acr-" + key + ".json")


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix(".new")
    with open(pending, "w", encoding="utf-8", opener=lambda name, flags: os.open(name, flags, 0o600)) as out:
        json.dump(state, out)
    os.replace(pending, path)


def read_state(path):
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        if (not isinstance(data, dict) or not isinstance(data.get("registry"), str)
                or not re.fullmatch(REGISTRY_ID_PATTERN, data["registry"], re.IGNORECASE)
                or (not data.get("runId") and not data.get("operation") and not data.get("scheduling"))):
            raise ValueError()
        if data.get("runId") and not re.fullmatch(r"[a-zA-Z0-9_-]+", data["runId"]):
            raise ValueError()
        if data.get("operation"):
            secure_url(data["operation"], True)
        return data
    except (ValueError, TypeError, OSError):
        raise BuildError("Persisted ACR cancellation state is malformed") from None


def run_id(data):
    properties = data.get("properties") or {}
    value = properties.get("runId") or data.get("runId")
    resource = data.get("id", "")
    if not value and "/runs/" in resource:
        value = resource.rsplit("/", 1)[-1]
    if not value and data.get("name") and ("status" in properties or not data.get("status")):
        value = data["name"]
    if value and not re.fullmatch(r"[a-zA-Z0-9_-]+", value):
        raise BuildError("Service returned an invalid ACR run ID")
    return value


def resolve_run(client, state, path, data=None, headers=None):
    data, headers = data or {}, headers or {}
    while True:
        found = run_id(data)
        if found:
            state["runId"] = found
            save_state(path, state)
            return found
        status = str(data.get("status", "")).lower()
        if status in TERMINAL_FAILURE:
            raise BuildError("ACR schedule operation ended in " + status)
        location = headers.get("location") or state.get("location")
        operation = (headers.get("azure-asyncoperation") or headers.get("operation-location")
                     or state.get("operation") or location)
        if status == "succeeded":
            result = data.get("resourceLocation") or data.get("properties", {}).get("resourceLocation")
            if result:
                operation = result if result.startswith("https://") else ARM + result
            elif location and location != operation:
                operation = location
            else:
                raise BuildError("ACR schedule completed without a run ID or result location")
        if not operation:
            raise BuildError("ACR schedule returned no run ID or polling endpoint")
        secure_url(operation, True)
        state["operation"] = operation
        if location:
            secure_url(location, True)
            state["location"] = location
        save_state(path, state)
        client.pause({"Retry-After": headers.get("retry-after", "5")})
        _, headers, data = client.json("GET", operation)


def logs(client, resource, offset=0, final=False):
    _, _, data = client.json("POST", api(resource, "/listLogSasUrl"), {})
    link = data.get("logLink")
    if not link:
        raise BuildError("ACR did not return a build log URL")
    if client.log_stream is None:
        client.log_stream = LogStream(client, offset)
    while True:
        client.request("GET", link, arm=False, log_stream=client.log_stream)
        if not client.log_stream.more:
            break
    if final:
        client.log_stream.write(final=True)
    return client.log_stream.offset


def cancel(client, path, state):
    client.deadline = time.monotonic() + 120
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, signal.SIG_IGN)
    if state.get("scheduling") and not state.get("runId") and not state.get("operation"):
        raise BuildError("Schedule acceptance is uncertain; no run ID is available to cancel")
    identifier = state.get("runId") or resolve_run(client, state, path)
    resource = state["registry"] + "/runs/" + identifier
    deadline = client.deadline
    client.deadline = min(deadline, time.monotonic() + 30)
    try:
        _, _, data = client.json("GET", api(resource))
        status = str(data.get("properties", {}).get("status", "")).lower()
    except BuildError:
        # A broken status endpoint must not prevent cancellation of a known run.
        status = ""
    finally:
        client.deadline = deadline
    if status == "succeeded" or status in TERMINAL_FAILURE:
        return
    client.json("POST", api(resource, "/cancel"), {})
    print("ACR cancellation requested for run " + identifier, flush=True)


def build(client, path):
    workspace = Path(os.environ.get("GITHUB_WORKSPACE", os.getcwd())).resolve()
    container, sha = required("CONTAINER_NAME"), required("GITHUB_SHA")
    if not re.fullmatch(r"[a-z0-9]+(?:[._/-][a-z0-9]+)*", container):
        raise BuildError("CONTAINER_NAME must be a lowercase image repository")
    if not re.fullmatch(r"[a-fA-F0-9]{7,64}", sha):
        raise BuildError("GITHUB_SHA must be a commit SHA")
    try:
        arguments = json.loads(os.environ.get("BUILD_ARGUMENTS", "{}"))
        if not isinstance(arguments, dict) or any(not isinstance(value, str) for value in arguments.values()):
            raise ValueError()
    except ValueError:
        raise BuildError("BUILD_ARGUMENTS must be a JSON object with string values") from None
    registry = registry_id(client)
    archive_path = path.with_suffix(".tar.gz")
    specification = importlib.util.spec_from_file_location(
        "aksd_acr_context", Path(__file__).with_name("aksd-acr-context.py"))
    helper = importlib.util.module_from_spec(specification)
    # Importing the packager must not add helper bytecode to the build context.
    sys.dont_write_bytecode = True
    specification.loader.exec_module(helper)
    try:
        dockerfile = helper.create_context(workspace, os.environ.get("BUILD_CONTEXT_PATH", "."),
                                          os.environ.get("DOCKER_FILE", "Dockerfile"), archive_path,
                                          client.remaining)
        _, _, upload = client.json("POST", api(registry, "/listBuildSourceUploadUrl"), {})
        if not upload.get("uploadUrl") or not upload.get("relativePath"):
            raise BuildError("ACR source upload response is missing uploadUrl or relativePath")
        with archive_path.open("rb") as source:
            client.request("PUT", upload["uploadUrl"], source, arm=False,
                           headers={"x-ms-blob-type": "BlockBlob",
                                    "Content-Type": "application/octet-stream",
                                    "Content-Length": str(archive_path.stat().st_size)})
        payload = {"type": "DockerBuildRequest", "platform": {"os": "Linux"},
                   "dockerFilePath": dockerfile, "imageNames": [container + ":" + sha],
                   "isPushEnabled": True, "timeout": 3600,
                   "arguments": [{"name": key, "value": value, "isSecret": False}
                                 for key, value in arguments.items()],
                   "sourceLocation": upload["relativePath"]}
        print("Uploaded local build context; scheduling ACR run", flush=True)
        state = {"registry": registry, "scheduling": True}
        save_state(path, state)
        _, headers, data = client.json("POST", api(registry, "/scheduleRun"), payload, retry=False)
        identifier = resolve_run(client, state, path, data, headers)
    finally:
        archive_path.unlink(missing_ok=True)
    print("ACR run " + identifier + " scheduled", flush=True)
    resource = registry + "/runs/" + identifier
    offset = 0
    while True:
        _, headers, data = client.json("GET", api(resource))
        status = str(data.get("properties", {}).get("status", "")).lower()
        state["status"] = status
        save_state(path, state)
        print("ACR run " + identifier + ": " + (status or "missing status"), flush=True)
        terminal = status == "succeeded" or status in TERMINAL_FAILURE
        try:
            offset = logs(client, resource, offset, final=terminal)
            state["logOffset"] = offset
            state["logsComplete"] = terminal
            save_state(path, state)
        except Interrupted:
            raise
        except BuildError:
            if terminal:
                raise BuildError("ACR run " + status + "; final build logs could not be downloaded") from None
            print("Build logs not available yet", flush=True)
        if status == "succeeded":
            return
        if status in TERMINAL_FAILURE:
            raise BuildError("ACR run ended in " + status)
        if status not in ACTIVE:
            raise BuildError("ACR returned an unrecognized run status")
        client.pause({"Retry-After": headers.get("retry-after", "5")})


def main():
    client, path = Client(), None
    def interrupted(signum, frame):
        raise Interrupted("Build interrupted; cancelling the ACR run")
    try:
        if sys.argv[1:] not in ([], ["--cancel"]):
            raise BuildError("Usage: aksd-acr-build.py [--cancel]")
        path = state_path()
        if sys.argv[1:] == ["--cancel"]:
            state = read_state(path)
            if state:
                cancel(client, path, state)
            return 0
        for signum in (signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, interrupted)
        if path.exists():
            raise BuildError("A build state already exists for this job; refusing to schedule a duplicate")
        build(client, path)
        return 0
    except (BuildError, ValueError, OSError) as error:
        message = str(error) if isinstance(error, (BuildError, ValueError)) else "Local build file operation failed"
        print("ACR build error: " + message, file=sys.stderr, flush=True)
        if path and sys.argv[1:] != ["--cancel"]:
            try:
                state = read_state(path)
                if state:
                    cancel(client, path, state)
            except (BuildError, ValueError, OSError):
                print("ACR cancellation could not be confirmed; cleanup --cancel must retry",
                      file=sys.stderr, flush=True)
            if path.exists():
                try:
                    state = read_state(path)
                    if state and state.get("runId") and not state.get("logsComplete"):
                        client.deadline = time.monotonic() + 30
                        logs(client, state["registry"] + "/runs/" + state["runId"],
                             state.get("logOffset", 0), final=True)
                except (BuildError, ValueError, OSError):
                    print("Build logs unavailable after failure", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
`;
