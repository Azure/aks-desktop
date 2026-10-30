export const ACR_ARCHIVE_SCRIPT_PATH = '.github/scripts/aksd-acr-context.py';

export const acrArchiveScript = String.raw`"""Local Docker context packaging; no Docker daemon or third-party modules."""
import io
import os
from pathlib import Path
import posixpath
import re
import tarfile


def inside(path, root):
    return path == root or root in path.parents


def symlink_target(path, context, name):
    target = Path(path).resolve()
    if os.path.isabs(os.readlink(path)) or not inside(target, context):
        raise ValueError("Context symlink escapes the build context: " + name)
    return target


def glob_regex(pattern):
    # Match Docker's Linux pattern syntax, including embedded ** and backslash escapes.
    result, kind, cursor = "", "exact", 0
    while cursor < len(pattern):
        start = cursor
        char = pattern[cursor]
        cursor += 1
        if char == "*":
            if cursor < len(pattern) and pattern[cursor] == "*":
                cursor += 1
                if cursor < len(pattern) and pattern[cursor] == "/":
                    cursor += 1
                if cursor == len(pattern):
                    if kind == "exact":
                        kind = "prefix"
                    else:
                        result += ".*"
                        kind = "regex"
                else:
                    result += "(?:.*/)?"
                    kind = "regex"
                if start == 0:
                    kind = "suffix"
            else:
                result += "[^/]*"
                kind = "regex"
        elif char == "?":
            result += "[^/]"
            kind = "regex"
        elif char == "\\":
            if cursor == len(pattern):
                raise ValueError("Invalid trailing escape in Docker ignore pattern")
            result += re.escape(pattern[cursor])
            cursor += 1
            kind = "regex"
        elif char == "[":
            group = ""
            if cursor < len(pattern) and pattern[cursor] == "^":
                group, cursor = "^", cursor + 1
            members = 0
            while cursor < len(pattern) and pattern[cursor] != "]":
                member = pattern[cursor]
                cursor += 1
                if member == "\\":
                    if cursor == len(pattern):
                        raise ValueError("Invalid escape in Docker ignore character class")
                    member = re.escape(pattern[cursor])
                    cursor += 1
                elif member in ("[", "^"):
                    member = "\\" + member
                group += member
                members += 1
            if not members or cursor == len(pattern):
                raise ValueError("Invalid Docker ignore character class")
            result += "[" + group + "]"
            cursor += 1
            kind = "regex"
        else:
            result += re.escape(char)
    if kind == "suffix":
        suffix = pattern[2:]
        result = ".*" + re.escape(suffix)
        if suffix.startswith("/"):
            result += "|" + re.escape(suffix[1:])
    elif kind == "prefix":
        result = re.escape(pattern[:-2]) + ".*"
    try:
        return re.compile("^(?:" + result + ")$")
    except re.error:
        raise ValueError("Invalid Docker ignore pattern") from None


def ignore_rules(path):
    rules = []
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if line.startswith("#"):
                continue
            line = line.strip()
            if not line:
                continue
            negate = line.startswith("!")
            if negate:
                line = line[1:].strip()
                if not line:
                    raise ValueError("Invalid empty Docker ignore exception")
            line = posixpath.normpath(line).strip("/")
            if line and line != ".":
                rules.append((negate, glob_regex(line)))
    return rules


def ignored(name, rules):
    parts = name.split("/")
    if ".git" in parts:
        return True
    parents = ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]
    excluded = False
    for negate, pattern in rules:
        if any(pattern.fullmatch(parent) for parent in parents):
            excluded = not negate
    return excluded


def create_context(workspace, context_value, dockerfile_value, output, check=lambda: None):
    workspace = Path(workspace).resolve()
    context = (workspace / context_value).resolve()
    dockerfile = workspace / dockerfile_value
    # Keep the selected filename; its symlink target can have a different sidecar.
    dockerfile = dockerfile.parent.resolve() / dockerfile.name
    dockerfile_target = dockerfile.resolve()
    if not inside(context, workspace) or not context.is_dir():
        raise ValueError("Build context must be a local directory inside the checkout")
    if ".git" in context.relative_to(workspace).parts:
        raise ValueError("Build context cannot be inside .git")
    if (not inside(dockerfile, workspace) or not inside(dockerfile_target, workspace)
            or not dockerfile_target.is_file()):
        raise ValueError("Dockerfile must be a file inside the checkout")
    if (".git" in dockerfile.relative_to(workspace).parts
            or ".git" in dockerfile_target.relative_to(workspace).parts):
        raise ValueError("Dockerfile cannot be inside .git")

    specific_ignore = Path(str(dockerfile) + ".dockerignore")
    ignore_file = specific_ignore if specific_ignore.is_file() else context / ".dockerignore"
    ignore_target = ignore_file.resolve()
    if not inside(ignore_target, workspace):
        raise ValueError("Docker ignore file cannot escape the checkout")
    if ".git" in ignore_target.relative_to(workspace).parts:
        raise ValueError("Docker ignore file cannot be inside .git")
    if os.path.lexists(ignore_file) and not ignore_file.is_file():
        raise ValueError("Docker ignore path must be a file")
    if ignore_file.is_symlink() and inside(ignore_file, context):
        symlink_target(ignore_file, context, ignore_file.relative_to(context).as_posix())
    rules = ignore_rules(ignore_file)
    external = not inside(dockerfile, context)
    rewrite_ignore = external or specific_ignore.is_file() or ignore_file.is_symlink()
    # Legacy Docker can retain the empty parent of a force-included Dockerfile in COPY output.
    docker_name = ".aksd-acr.Dockerfile" if external else dockerfile.relative_to(context).as_posix()
    if external:
        for name in (".aksd-acr", docker_name, docker_name + ".dockerignore"):
            if os.path.lexists(context / name):
                raise ValueError("Reserved context path " + name + " already exists")
    forced = {docker_name}
    if inside(ignore_file, context):
        forced.add(ignore_file.relative_to(context).as_posix())
    output = Path(output).resolve()
    if inside(output, context):
        raise ValueError("Context archive output must be outside the build context")

    with tarfile.open(output, "w:gz", dereference=False) as archive:
        def walk(directory, prefix=""):
            for entry in sorted(os.scandir(directory), key=lambda item: item.name):
                check()
                name = prefix + entry.name
                if ".git" in name.split("/"):
                    continue
                if rewrite_ignore and name == ".dockerignore":
                    continue
                excluded = ignored(name, rules) and name not in forced
                if entry.is_symlink():
                    if excluded:
                        continue
                    if not external and name == docker_name:
                        # The selected Dockerfile must survive even when its target is ignored.
                        archive.add(dockerfile_target, arcname=name, recursive=False)
                        continue
                    target = symlink_target(entry.path, context, name)
                    if ignored(target.relative_to(context).as_posix(), rules):
                        continue
                    archive.add(entry.path, arcname=name, recursive=False)
                elif entry.is_dir(follow_symlinks=False):
                    if not excluded:
                        archive.add(entry.path, arcname=name, recursive=False)
                    # Exceptions can re-include descendants of excluded directories.
                    if (not excluded or any(negate for negate, _ in rules)
                            or any(path.startswith(name + "/") for path in forced)):
                        walk(entry.path, name + "/")
                elif entry.is_file(follow_symlinks=False) and not excluded:
                    archive.add(entry.path, arcname=name, recursive=False)
        walk(context)
        if external:
            archive.add(dockerfile_target, arcname=docker_name, recursive=False)
        if rewrite_ignore:
            # Legacy ACR builders reapply the root ignore file, not Dockerfile-specific overrides.
            effective_ignore = ignore_file.read_bytes() if ignore_file.is_file() else b""
            names = [".dockerignore"]
            if external:
                effective_ignore += ("\n" + docker_name + "\n" + docker_name + ".dockerignore\n").encode()
                names.append(docker_name + ".dockerignore")
            for name in names:
                info = tarfile.TarInfo(name)
                info.mode, info.size = 0o644, len(effective_ignore)
                archive.addfile(info, io.BytesIO(effective_ignore))
    return docker_name
`;
