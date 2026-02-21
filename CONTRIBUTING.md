# Contributing to QuantumClaw

Thanks for wanting to help. Here's how.

## Quick Start

```bash
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw
npm install
npx qclaw onboard
```

## How to Contribute

### Reporting Bugs
Open an issue. Include:
- What you expected to happen
- What actually happened
- Your platform (Linux, macOS, Windows WSL, Termux, etc.)
- Node.js version (`node -v`)
- Steps to reproduce

### Suggesting Features
Open an issue with the `enhancement` label. Explain the problem you're solving, not just the feature you want.

### Submitting Code
1. Fork the repo
2. Create a branch (`git checkout -b feature/my-thing`)
3. Make your changes
4. Test them (`npx qclaw diagnose`)
5. Commit with a clear message
6. Push and open a PR

### Writing Skills
Skills are markdown files. If you've built a useful integration, share it:
1. Create a skill folder in `workspace/shared/skills/your-skill/`
2. Add a `SKILL.md` with: description, auth requirements, endpoints, implementation
3. Test it with your agent
4. Submit a PR

### Improving Documentation
Typos, unclear instructions, missing examples: all welcome. The docs live in `docs/` and `README.md`.

## Code Style

- ESM modules (import/export, not require)
- Minimal dependencies (every npm package is a liability)
- British English in docs and comments (colour, organisation, favour)
- No em dashes. Commas, semicolons, or full stops instead.
- Comments explain WHY, not WHAT

## Architecture Decisions

If you want to change something fundamental (new dependency, new protocol, restructuring), open a discussion first. We'd rather talk about it before you spend a week on a PR that doesn't fit.

## Security

If you find a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Community Standards

- Be direct but kind
- Assume good intent
- No gatekeeping. Everyone started somewhere.
- AI-assisted PRs are welcome. We don't care how you wrote the code, we care if it works.

## Get Help

- **Discord:** [discord.gg/37x3wRha](https://discord.gg/37x3wRha) — fastest way to get help
- **Discussions:** [GitHub Discussions](https://github.com/QuantumClaw/QClaw/discussions) — longer-form questions and ideas
- **Issues:** [Bug reports](https://github.com/QuantumClaw/QClaw/issues/new?template=bug_report.yml) and [feature requests](https://github.com/QuantumClaw/QClaw/issues/new?template=feature_request.yml)

## Licence

By contributing, you agree that your contributions will be licensed under the MIT Licence.
