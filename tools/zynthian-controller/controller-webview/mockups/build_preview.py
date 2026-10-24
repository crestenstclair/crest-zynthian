#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Package the existing frontend and isolated sequencer mockup as one offline HTML."""
from pathlib import Path
import argparse
import json
import re


def preview_html(repo, start=None):
    root=Path(repo)/'controller-webview'
    text=(root.parent/'controller-node/web/index.html').read_text()
    text=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', text)
    text=re.sub(r'<script[^>]*></script>', '', text)
    css=(root.parent/'controller-node/web/style.css').read_text()+'\n'+(root/'mockups/preview.css').read_text()
    text=text.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
    script='window.mockupStart='+json.dumps(start or {})+';\n'+(root.parent/'controller-node/web/app.js').read_text()+'\n'+(root/'mockups/preview.js').read_text()
    text=text.replace('<title>Zynthian Controller</title>','<title>Zynthian — Sequencer mockups</title>')
    return text.replace('</body>','<script>'+script+'</script></body>')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    args.output.write_text(preview_html(args.repo))
    print(args.output)
