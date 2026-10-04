"""Inspect a public RAR over HTTP ranges without downloading its payload.

Requires rarfile==4.2. Archive names and timestamps are leads, not version proof.
"""
import argparse
from collections import OrderedDict
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import urllib.request

import rarfile


class HTTPRangeReader(io.RawIOBase):
    def __init__(self, url, max_bytes=32 * 1024 * 1024):
        super().__init__()
        self.url = url
        self.position = 0
        self.size = None
        self.validator = None
        self.last_modified = None
        self.bytes_fetched = 0
        self.requests = 0
        self.max_bytes = max_bytes
        self.cache = OrderedDict()
        self.block_size = 4096
        self._fetch(0, 7)

    def _fetch(self, start, end):
        if self.bytes_fetched + end - start + 1 > self.max_bytes:
            raise OSError("Archive inspection exceeded the download budget")
        headers = {"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity", "User-Agent": "Mozilla/5.0"}
        if self.validator:
            headers["If-Range"] = self.validator
        request = urllib.request.Request(self.url, headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
            if response.status != 206 or not match:
                raise OSError("Server did not honor the HTTP range; refusing a full download")
            actual_start, actual_end, size = map(int, match.groups())
            if actual_start != start or actual_end != end or (self.size is not None and size != self.size):
                raise OSError("Unexpected archive byte range or changed archive size")
            validator = response.headers.get("ETag")
            if not validator or validator.startswith("W/"):
                validator = response.headers.get("Last-Modified")
            if not validator or (self.validator and validator != self.validator):
                raise OSError("Missing or changed archive validator")
            if response.headers.get("Content-Encoding", "identity") != "identity":
                raise OSError("Encoded HTTP ranges are unsupported")
            data = response.read(end - start + 2)
            if len(data) != end - start + 1:
                raise OSError("Incomplete or oversized archive byte range")
            self.size = size
            self.validator = validator
            self.last_modified = response.headers.get("Last-Modified")
            self.bytes_fetched += len(data)
            self.requests += 1
            return data

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        self._checkClosed()
        if whence == io.SEEK_SET:
            position = offset
        elif whence == io.SEEK_CUR:
            position = self.position + offset
        elif whence == io.SEEK_END:
            position = self.size + offset
        else:
            raise ValueError("Invalid seek origin")
        if position < 0:
            raise ValueError("Negative seek position")
        self.position = position
        return position

    def read(self, size=-1):
        self._checkClosed()
        remaining = max(0, self.size - self.position)
        size = remaining if size is None or size < 0 else min(size, remaining)
        if size > self.max_bytes:
            raise OSError("Read exceeded the archive inspection budget")
        chunks = []
        while size:
            start = self.position // self.block_size * self.block_size
            if start not in self.cache:
                self.cache[start] = self._fetch(start, min(start + self.block_size, self.size) - 1)
                if len(self.cache) > 256:
                    self.cache.popitem(last=False)
            self.cache.move_to_end(start)
            block = self.cache[start]
            offset = self.position - start
            chunk = block[offset:offset + size]
            chunks.append(chunk)
            self.position += len(chunk)
            size -= len(chunk)
        return b"".join(chunks)


class DirectoryLimitReached(Exception):
    pass


def inspect(url, max_bytes, max_entries=None):
    entries = []
    directory_complete = True
    solid = None
    def found(info):
        nonlocal solid
        if info.type == rarfile.RAR_BLOCK_MAIN:
            solid = bool(info.flags & rarfile.RAR_MAIN_SOLID)
        if info.type != rarfile.RAR_BLOCK_FILE:
            return
        entries.append({
            "name": info.filename,
            "directory": info.is_dir(),
            "bytes": info.file_size,
            "compressedBytes": info.compress_size,
            "compression": info.compress_type,
            "crc32": f"{info.CRC:08x}" if info.CRC is not None else None,
            "mtime": info.mtime.isoformat() if info.mtime else None,
            "headerOffset": info.header_offset,
            "dataOffset": info.data_offset,
            "solid": bool(info.flags & rarfile.RAR_FILE_SOLID),
            "encrypted": info.needs_password(),
        })
        if max_entries is not None and len(entries) >= max_entries:
            raise DirectoryLimitReached()
    with HTTPRangeReader(url, max_bytes) as remote:
        try:
            with rarfile.RarFile(remote, errors="strict", info_callback=found) as archive:
                solid = archive.is_solid()
        except DirectoryLimitReached:
            directory_complete = False
        return {
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "url": url,
            "archiveBytes": remote.size,
            "httpValidator": remote.validator,
            "lastModified": remote.last_modified,
            "parser": f"rarfile=={rarfile.__version__}",
            "solid": solid,
            "directoryComplete": directory_complete,
            "downloadedBytes": remote.bytes_fetched,
            "httpRequests": remote.requests,
            "officialVersionAuthenticated": False,
            "entries": entries,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-bytes", type=int, default=32 * 1024 * 1024)
    parser.add_argument("--max-entries", type=int)
    args = parser.parse_args()
    if args.max_bytes < 8 or (args.max_entries is not None and args.max_entries < 1):
        parser.error("Budgets must be positive (at least 8 bytes)")
    report = inspect(args.url, args.max_bytes, args.max_entries)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    scope = "complete directory" if report['directoryComplete'] else "partial directory"
    print(f"Listed {len(report['entries'])} entries ({scope}) in {report['archiveBytes']} bytes; fetched {report['downloadedBytes']} bytes. See {args.output}.")


if __name__ == "__main__":
    main()
