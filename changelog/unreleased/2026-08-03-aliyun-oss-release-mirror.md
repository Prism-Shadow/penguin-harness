# Tooling: mirror GitHub Releases to Alibaba Cloud OSS

The Release workflow now downloads its own published GitHub Release assets, verifies every canonical bundle and checksum, and mirrors those exact bytes to versioned `releases/<tag>/` keys in Alibaba Cloud OSS. Publishing uses short-lived GitHub OIDC credentials from the protected `oss-production` environment; no long-lived Alibaba Cloud access key is stored in the repository. Versioned objects are treated as immutable and retries only accept an existing object when its SHA256 is identical.

After every versioned object has been downloaded back and verified, the current GitHub latest Release may update the root `latest.json` pointer. Older manual retries still mirror their version but cannot move that pointer backwards. A separate manually dispatched staging workflow exchanges credentials through the `oss-staging` environment, round-trips a private `staging/<run-id>/` probe, and confirms that the staging role is denied permission to write under `releases/`.

The workflow installs a checksum-pinned ossutil 2 binary and pins Alibaba Cloud's credential action to an exact commit. GitHub Environment variables provide the OIDC provider ARN, role ARN, bucket, region, endpoint, public base URL, and accelerated base URL, keeping account-specific deployment configuration out of tracked files.
