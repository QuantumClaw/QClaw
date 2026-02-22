# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Email security@allin1.app with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Security Architecture

QuantumClaw takes security seriously at every layer:

- **Secrets**: AES-256-GCM encryption at rest, machine-specific derived keys
- **Trust Kernel**: Immutable VALUES.md rules the agent cannot override
- **Audit Trail**: Every agent action logged with timestamps and cost tracking
- **AGEX Protocol**: Autonomous credential lifecycle with automatic rotation, scoped delegation, and emergency revocation in under 60 seconds
- **Exec Approvals**: Destructive operations require human sign-off
- **Channel Allowlists**: Only authorised users can interact with your agent

## Known Limitations

- The self-signed development AID (`ia_signature: 'self-signed-dev-not-for-production'`) is for local development only. Production deployments should use a certified AGEX Identity Authority.
- The local dashboard binds to `localhost` by default. Do not expose it to the internet without authentication.
- The completion cache stores prompt hashes, not plaintext prompts, but cache entries could theoretically reveal usage patterns.

## Acknowledgements

We appreciate responsible security researchers. Contributors who report valid vulnerabilities will be credited (with permission) in our changelog.
