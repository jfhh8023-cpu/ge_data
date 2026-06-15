#!/usr/bin/env python3
"""Idempotently inject DevTracker locations into HTTP and HTTPS Nginx server files."""

import argparse
import re
import shutil
import time
from pathlib import Path


START = '# BEGIN_DEVTRACKER'
END = '# END_DEVTRACKER'


def load_snippet(path):
    text = Path(path).read_text(encoding='utf-8')
    if START not in text or END not in text:
        raise SystemExit(f'snippet must contain {START} and {END}: {path}')
    start = text.index(START)
    end = text.index(END) + len(END)
    return text[start:end].strip() + '\n'


def remove_existing_block(text):
    marked = re.compile(
        r'\n?[ \t]*# BEGIN_DEVTRACKER[\s\S]*?[ \t]*# END_DEVTRACKER\n?',
        re.MULTILINE
    )
    text = marked.sub('\n', text)

    legacy = re.compile(
        r'\n?[ \t]*# =+ DevTracker =+[\s\S]*?(?=\n[ \t]*# =+|\n[ \t]*location / \{|\n\})',
        re.MULTILINE
    )
    return legacy.sub('\n', text)


def insert_after_client_size(text, snippet):
    match = re.search(r'^[ \t]*client_max_body_size\s+[^;]+;\s*$', text, re.MULTILINE)
    if match:
        return text[:match.end()] + '\n\n' + snippet + text[match.end():]

    match = re.search(r'^[ \t]*location\s+', text, re.MULTILINE)
    if match:
        return text[:match.start()] + snippet + '\n' + text[match.start():]

    last_brace = text.rfind('}')
    if last_brace == -1:
        raise SystemExit('server config has no closing brace')
    return text[:last_brace] + '\n' + snippet + text[last_brace:]


def ensure_file(config_path, snippet):
    path = Path(config_path)
    if not path.exists():
        print(f'[skip] {config_path} not found')
        return False

    original = path.read_text(encoding='utf-8')
    cleaned = remove_existing_block(original)
    updated = insert_after_client_size(cleaned, snippet)
    updated = re.sub(r'\n{3,}', '\n\n', updated).rstrip() + '\n'

    if updated == original:
        print(f'[ok] {config_path} already up to date')
        return False

    backup = path.with_name(f'{path.name}.bak.before-devtracker-https-{time.strftime("%Y%m%d%H%M%S")}')
    shutil.copy2(path, backup)
    path.write_text(updated, encoding='utf-8')
    print(f'[updated] {config_path}; backup={backup}')
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--snippet', required=True)
    parser.add_argument('--http-conf', default='/etc/nginx/conf.d/unified.conf')
    parser.add_argument('--https-conf', default='/etc/nginx/conf.d/sandilizi-ssl.conf')
    args = parser.parse_args()

    snippet = load_snippet(args.snippet)
    changed = False
    changed |= ensure_file(args.http_conf, snippet)
    changed |= ensure_file(args.https_conf, snippet)
    print(f'[done] changed={int(changed)}')


if __name__ == '__main__':
    main()
