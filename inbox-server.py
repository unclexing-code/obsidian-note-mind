"""Run behind an HTTPS reverse proxy. Configuration is read from environment variables."""
import base64
import hashlib
import hmac
import json
import os
import re
import sqlite3
import struct
import time
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

DB_PATH = os.environ.get("INBOX_DB", "inbox.sqlite3")
API_TOKEN = os.environ.get("INBOX_API_TOKEN", "")
WX_TOKEN = os.environ.get("WECHAT_TOKEN", "")
APP_ID = os.environ.get("WECHAT_APP_ID", "")
AES_KEY = os.environ.get("WECHAT_AES_KEY", "")
ALLOWED_SENDERS = set(filter(None, os.environ.get("WECHAT_ALLOWED_SENDERS", "").split(",")))


def connection():
    db = sqlite3.connect(DB_PATH)
    db.execute("CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, payload TEXT NOT NULL)")
    return db


def parse_message(text):
    match = re.fullmatch(r"\s*标题\s*[:：]\s*([^\n]+)\n\s*内容\s*[:：]([\s\S]*)", text)
    if not match or not match[1].strip():
        raise ValueError("格式：标题：节点标题\n内容：具体内容（可换行）")
    return match[1].strip(), match[2].lstrip()


def signature(*parts):
    return hashlib.sha1("".join(sorted(parts)).encode()).hexdigest()


def decrypt_message(encrypted):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    key = base64.b64decode(AES_KEY + "=")
    raw = base64.b64decode(encrypted, validate=True)
    decryptor = Cipher(algorithms.AES(key), modes.CBC(key[:16])).decryptor()
    data = decryptor.update(raw) + decryptor.finalize()
    padding = data[-1]
    if not 1 <= padding <= 32 or data[-padding:] != bytes([padding]) * padding:
        raise ValueError("Invalid padding")
    data = data[:-padding]
    size = struct.unpack("!I", data[16:20])[0]
    if data[20 + size:].decode() != APP_ID:
        raise ValueError("Invalid app id")
    return data[20:20 + size]


def validate_item(item):
    return (isinstance(item, dict) and isinstance(item.get("id"), str)
            and isinstance(item.get("title"), str) and bool(item["title"].strip())
            and isinstance(item.get("note"), str) and isinstance(item.get("updatedAt"), (int, float))
            and item.get("status") in ("pending", "imported", "deleted"))


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, content_type="text/plain; charset=utf-8"):
        raw = body.encode() if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size <= 0 or size > 2_000_000:
            raise ValueError("Invalid payload size")
        return self.rfile.read(size)

    def do_GET(self):
        query = parse_qs(urlsplit(self.path).query)
        if urlsplit(self.path).path != "/wechat":
            self.respond(404, "Not found")
            return
        try:
            timestamp, nonce = query["timestamp"][0], query["nonce"][0]
            if not WX_TOKEN or not hmac.compare_digest(signature(WX_TOKEN, timestamp, nonce), query["signature"][0]):
                self.respond(403, "Invalid signature")
                return
            self.respond(200, query["echostr"][0])
        except (KeyError, ValueError):
            self.respond(400, "Invalid verification request")

    def do_POST(self):
        try:
            if urlsplit(self.path).path == "/api/inbox/sync":
                self.sync()
            elif urlsplit(self.path).path == "/wechat":
                self.wechat()
            else:
                self.respond(404, "Not found")
        except (ValueError, KeyError, ET.ParseError, UnicodeError):
            self.respond(400, "Invalid request")
        except Exception:
            self.respond(500, "Server error; retry later")

    def sync(self):
        if not API_TOKEN or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + API_TOKEN):
            self.respond(401, "Unauthorized")
            return
        payload = json.loads(self.read_body())
        items = payload.get("items")
        if not isinstance(items, list) or not all(validate_item(item) for item in items):
            raise ValueError("Invalid items")
        with connection() as db:
            for item in items:
                db.execute("INSERT INTO items VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated, payload=excluded.payload WHERE excluded.updated > items.updated",
                           (item["id"], item["updatedAt"], json.dumps(item, ensure_ascii=False)))
            result = [json.loads(row[0]) for row in db.execute("SELECT payload FROM items ORDER BY updated DESC")]
        self.respond(200, json.dumps({"items": result}, ensure_ascii=False), "application/json; charset=utf-8")

    def wechat(self):
        query = parse_qs(urlsplit(self.path).query)
        timestamp, nonce = query["timestamp"][0], query["nonce"][0]
        raw = self.read_body()
        if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
            raise ValueError("XML entities disabled")
        outer = ET.fromstring(raw)
        encrypted = outer.findtext("Encrypt")
        if encrypted:
            expected = signature(WX_TOKEN, timestamp, nonce, encrypted)
            provided = query.get("msg_signature", [""])[0]
        else:
            expected = signature(WX_TOKEN, timestamp, nonce)
            provided = query.get("signature", [""])[0]
        if not WX_TOKEN or not hmac.compare_digest(expected, provided):
            self.respond(403, "Invalid signature")
            return
        message = ET.fromstring(decrypt_message(encrypted)) if encrypted else outer
        sender = message.findtext("FromUserName", "")
        if sender not in ALLOWED_SENDERS:
            self.respond(403, "Sender not allowed")
            return
        if message.findtext("MsgType") != "text":
            self.respond(200, "success")
            return
        try:
            title, note = parse_message(message.findtext("Content", ""))
        except ValueError as error:
            self.reply(message, str(error), encrypted)
            return
        msg_id = message.findtext("MsgId")
        if not msg_id:
            raise ValueError("Missing MsgId")
        now = int(time.time() * 1000)
        item = {"id": "wechat:" + msg_id, "title": title, "note": note, "createdAt": now, "updatedAt": now, "status": "pending", "source": "wechat"}
        with connection() as db:
            db.execute("INSERT OR IGNORE INTO items VALUES (?, ?, ?)", (item["id"], now, json.dumps(item, ensure_ascii=False)))
        self.reply(message, "已收集：" + title, encrypted)

    def reply(self, message, text, encrypted):
        root = ET.Element("xml")
        for tag, value in (("ToUserName", message.findtext("FromUserName", "")), ("FromUserName", message.findtext("ToUserName", "")),
                           ("CreateTime", str(int(time.time()))), ("MsgType", "text"), ("Content", text)):
            ET.SubElement(root, tag).text = value
        raw = ET.tostring(root, encoding="utf-8")
        if encrypted:
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            key = base64.b64decode(AES_KEY + "=")
            data = os.urandom(16) + struct.pack("!I", len(raw)) + raw + APP_ID.encode()
            padding = 32 - len(data) % 32
            data += bytes([padding]) * padding
            cipher = Cipher(algorithms.AES(key), modes.CBC(key[:16])).encryptor()
            encoded = base64.b64encode(cipher.update(data) + cipher.finalize()).decode()
            timestamp, nonce = str(int(time.time())), os.urandom(8).hex()
            wrapper = ET.Element("xml")
            for tag, value in (("Encrypt", encoded), ("MsgSignature", signature(WX_TOKEN, timestamp, nonce, encoded)), ("TimeStamp", timestamp), ("Nonce", nonce)):
                ET.SubElement(wrapper, tag).text = value
            raw = ET.tostring(wrapper, encoding="utf-8")
        self.respond(200, raw, "application/xml; charset=utf-8")


if __name__ == "__main__":
    if not API_TOKEN or not WX_TOKEN or not ALLOWED_SENDERS:
        raise SystemExit("Set INBOX_API_TOKEN, WECHAT_TOKEN, WECHAT_ALLOWED_SENDERS (comma-separated OpenIDs); optionally WECHAT_APP_ID and WECHAT_AES_KEY")
    HTTPServer((os.environ.get("INBOX_HOST", "127.0.0.1"), int(os.environ.get("INBOX_PORT", "8765"))), Handler).serve_forever()
