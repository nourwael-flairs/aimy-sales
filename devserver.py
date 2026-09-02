#!/usr/bin/env python3
"""Static server for local work that never serves a stale index.html.

WHY THIS EXISTS. The cache strategy is `?v=` on the assets, and it has a
hole in it: the version number lives INSIDE index.html, so a browser holding
an old copy of index.html asks for the old asset and never learns a new one
exists. Measured — the stamp was bumped to 400 and a brand-new tab went on
loading `sales.css?v=399`, because the tab was replaying a cached document.

Bumping harder does not fix that, and neither does a `<meta http-equiv>`:
browsers stopped honouring meta cache directives years ago, so a page that
carries one is a page that looks like it has solved this and has not.

The fix has to be a response header, which means it has to be the server.
`python -m http.server` sends no cache headers at all, so the browser falls
back to heuristic freshness and keeps the document for as long as it likes.

    HTML          never stored — always re-fetched, so a new stamp is seen
    stamped asset stored for a year — the stamp is what changes, not the URL
    everything else  revalidated

ONE-TIME CURE FOR URLS ALREADY VISITED. `no-store` stops a document being
stored; it cannot reach back and evict an entry stored before it existed. So
every URL opened under the old server stays poisoned, and the cache key is the
full URL — `/?as=karim` and `/?as=marit` are separate entries, each holding its
own stale copy. Symptom: the navigation reports `transferSize: 0` and the page
loads the old stamp while `fetch('/index.html')` from that same page returns the
new one. Reloading does not help. Fetch each one once, from a page on this
origin, to force the network and let the `no-store` reply drop the entry:

    for (const u of ['/', ...ids.map(i => `/?as=${i}`)])
      await fetch(u, { cache: 'reload' });

Run:  python devserver.py [port]

Do NOT fall back to `python -m http.server` — it sends no cache headers, and
the problem grows back one visited URL at a time.
"""

import functools
import http.server
import os
import sys

STAMPED = ('?v=', '&v=')


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split('?')[0].lower()
        if path.endswith(('.html', '/')) or path == '':
            # The document carries the stamps, so it can never be the stale one.
            self.send_header('Cache-Control', 'no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        elif any(s in self.path for s in STAMPED):
            # A stamped URL is immutable by construction: change the file and
            # the stamp changes with it, which makes it a different URL.
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request is useful; the default writes to stderr and the
        # preview pane reads that as failure output.
        #
        # FLUSH, OR THE LOG LIES. stdout to a pipe is block-buffered, so the
        # preview pane says "No logs yet" for a server that has been answering
        # requests all along — which reads as "the browser never asked", the
        # exact thing you open the log to rule out. Measured: it cost a wrong
        # diagnosis once already.
        sys.stdout.write('%s - %s\n' % (self.address_string(), fmt % args))
        sys.stdout.flush()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8098
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(Handler, directory=os.getcwd())
    with http.server.ThreadingHTTPServer(('', port), handler) as httpd:
        print('serving %s on http://localhost:%d (html never cached)' % (os.getcwd(), port))
        httpd.serve_forever()


if __name__ == '__main__':
    main()
