# Minimal AgentCore Runtime container for testing the bedrock-runtime adapter.
#
# The adapter only ever calls InvokeAgentRuntimeCommand (shell exec). It
# does not call InvokeAgentRuntime (HTTP payload). However, AgentCore still
# requires the container to satisfy the runtime contract — an HTTP server
# on port 8080 with /ping returning 200 — before it will activate sessions
# and dispatch shell commands. Without it InvokeAgentRuntimeCommand returns
# 424 Failed Dependency / RuntimeClientError.
#
# python:3.13-slim already includes bash, coreutils (cat, stat, mkdir, cp,
# mv, base64, ls, printf, test, readlink, rm) and findutils (find).

FROM python:3.13-slim

# Default mountPath when filesystemConfigurations.sessionStorage is enabled.
RUN mkdir -p /mnt/workspace

COPY server.py /app/server.py

EXPOSE 8080
CMD ["python3", "/app/server.py"]
