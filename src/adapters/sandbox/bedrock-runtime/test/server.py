"""
Minimum AgentCore Runtime contract server.

Satisfies the `/ping` health check and the `/invocations` POST endpoint so
AgentCore activates the session. The bedrock-runtime adapter never calls
`/invocations` (it uses InvokeAgentRuntimeCommand, the shell-exec path),
so the body here is just a placeholder.
"""

from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"healthy"}')

    def do_POST(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *_):
        # Quiet stdout so CloudWatch logs only show real signal.
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
