# bedrock-runtime integration test setup

The `BedrockRuntimeSandboxProvider` needs a registered AgentCore Runtime
resource to talk to. This directory contains the minimum container image
(`Dockerfile`, `server.py`) and the AWS CLI commands to register it once,
then point the integration test at the resulting ARN.

## What's in the container

- `python:3.13-slim` — provides `bash`, `coreutils`, `findutils` (everything
  the shell-based filesystem ops need), plus Python.
- `server.py` — a 20-line HTTP server on port 8080 that responds to `/ping`
  and `/invocations`. AgentCore Runtime requires this contract; without it
  `InvokeAgentRuntimeCommand` fails with HTTP 424 / `RuntimeClientError`
  even though the adapter itself never calls the HTTP endpoint.

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity` succeeds)
- Permissions to create ECR repos, IAM roles, and AgentCore Runtimes
- Docker installed locally
- A region that supports AgentCore (e.g. `us-west-2`, `us-east-1`)

## One-time setup

```bash
export AWS_REGION=us-west-2
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REPO_NAME=zeitlich-bedrock-runtime-test
export IMAGE_TAG=v1
export RUNTIME_NAME=zeitlich_bedrock_runtime_test  # name regex: [a-zA-Z][a-zA-Z0-9_]{0,47} — no hyphens

# 1. Create the ECR repo
aws ecr create-repository --repository-name "$REPO_NAME" --region "$AWS_REGION"

# 2. Build & push the container (run from this directory)
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build -t "$REPO_NAME:$IMAGE_TAG" .
docker tag  "$REPO_NAME:$IMAGE_TAG" "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME:$IMAGE_TAG"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME:$IMAGE_TAG"

# 3. Create an IAM execution role for the runtime
#    Trust policy lets AgentCore assume the role; attached policies grant
#    ECR pull + CloudWatch Logs write so the runtime can pull the image and
#    emit logs visible via `aws logs tail`.
cat > /tmp/trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "bedrock-agentcore.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name "${RUNTIME_NAME}-execution-role" \
  --assume-role-policy-document file:///tmp/trust.json

aws iam attach-role-policy \
  --role-name "${RUNTIME_NAME}-execution-role" \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

aws iam attach-role-policy \
  --role-name "${RUNTIME_NAME}-execution-role" \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess

export ROLE_ARN=$(aws iam get-role --role-name "${RUNTIME_NAME}-execution-role" --query Role.Arn --output text)

# 4. Register the AgentCore Runtime
#    Optional: add `--filesystem-configurations '[{"sessionStorage":{"mountPath":"/mnt/workspace"}}]'`
#    to enable persistent FS across stop/resume.
aws bedrock-agentcore-control create-agent-runtime \
  --region "$AWS_REGION" \
  --agent-runtime-name "$RUNTIME_NAME" \
  --agent-runtime-artifact "containerConfiguration={containerUri=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME:$IMAGE_TAG}" \
  --role-arn "$ROLE_ARN" \
  --network-configuration '{"networkMode":"PUBLIC"}'

# 5. Capture the ARN
export BEDROCK_RUNTIME_TEST_ARN=$(aws bedrock-agentcore-control list-agent-runtimes \
  --region "$AWS_REGION" \
  --query "agentRuntimes[?agentRuntimeName=='$RUNTIME_NAME'].agentRuntimeArn | [0]" \
  --output text)
echo "$BEDROCK_RUNTIME_TEST_ARN"
```

## Run the test

From the repo root:

```bash
export AWS_REGION=us-west-2
export BEDROCK_RUNTIME_TEST_ARN=arn:aws:bedrock-agentcore:us-west-2:...:runtime/...

npx vitest run src/adapters/sandbox/bedrock-runtime/test/integration.test.ts
```

If the env var is unset, the suite is skipped automatically — won't break
local CI runs without AWS credentials.

## Troubleshooting

If commands return HTTP 424 / `RuntimeClientError` or the session never
activates, the runtime supervisor's logs will tell you why:

```bash
aws logs tail "/aws/bedrock-agentcore/runtimes/$RUNTIME_NAME" --since 10m
```

Common causes:

- **The image doesn't satisfy the contract.** `/ping` must return 200 on
  port 8080. The shipped `server.py` does this; if you replace it with
  something that doesn't, sessions won't activate.
- **The execution role lacks ECR pull rights.** AgentCore can't fetch the
  image. Check the trust policy and attached managed policies in step 3.
- **The image was pushed to the wrong region.** ECR is regional; the
  container URI in `--agent-runtime-artifact` must be in the same region
  as the runtime resource.

## Update the image

If you change the Dockerfile or `server.py` and want a new container:

```bash
export IMAGE_TAG=v2  # bump the tag to bypass any digest caching
docker build -t "$REPO_NAME:$IMAGE_TAG" .
docker tag  "$REPO_NAME:$IMAGE_TAG" "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME:$IMAGE_TAG"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME:$IMAGE_TAG"

# Re-run step 4 with a new --agent-runtime-name to register a fresh runtime
# pointing at the new image, then update BEDROCK_RUNTIME_TEST_ARN.
```

## Tear down

```bash
aws bedrock-agentcore-control delete-agent-runtime \
  --region "$AWS_REGION" \
  --agent-runtime-id "$(aws bedrock-agentcore-control list-agent-runtimes --region "$AWS_REGION" \
      --query \"agentRuntimes[?agentRuntimeName=='$RUNTIME_NAME'].agentRuntimeId | [0]\" --output text)"

aws iam detach-role-policy --role-name "${RUNTIME_NAME}-execution-role" \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
aws iam detach-role-policy --role-name "${RUNTIME_NAME}-execution-role" \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
aws iam delete-role --role-name "${RUNTIME_NAME}-execution-role"

aws ecr delete-repository --region "$AWS_REGION" --repository-name "$REPO_NAME" --force
```
