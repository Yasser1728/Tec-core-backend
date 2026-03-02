# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in TEC Core Backend, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email: security@tec-ecosystem.com
3. Include a detailed description of the vulnerability
4. Allow up to 48 hours for an initial response

## Security Measures

- All endpoints require JWT authentication
- Rate limiting is enforced at the API Gateway level
- Database queries use parameterized statements (Prisma ORM)
- Secrets are managed via environment variables, never committed to code
- Dependencies are monitored via Dependabot
- Code is scanned via GitHub CodeQL

## Disclosure Policy

We follow responsible disclosure. Once a fix is deployed, we will publicly acknowledge the reporter (unless anonymity is requested).
