# Security

openCook holds people's recipes, photos and API tokens that AI assistants use,
so security reports are very welcome.

## Reporting a vulnerability

Please report it privately through GitHub:
[**Report a vulnerability**](https://github.com/stretch0/openCook/security/advisories/new)
(Security → Advisories → Report a vulnerability). Don't open a public issue.

Include what you found, how to reproduce it, and what someone could do with
it. You'll get a reply within a week. Once it's fixed, the advisory is
published with credit to you, unless you'd rather not be named.

## Supported versions

Fixes go into the latest release and `main`. openCook is pre-1.0, so there are
no older release lines to backport to: upgrade to the latest release (see
[Upgrading](README.md#upgrading)).

## Checking a release

Release images and source archives come with signed build provenance:

```bash
gh attestation verify oci://ghcr.io/stretch0/opencook:0.1 -R stretch0/openCook
gh attestation verify opencook-0.1.0.tar.gz -R stretch0/openCook
```

## Running your own server

Whoever runs an openCook server can read what's stored on it: accounts,
recipes, notes and photos. API tokens are stored only as hashes. Keep `.env`
(it holds `BETTER_AUTH_SECRET`) and your backups somewhere safe.
