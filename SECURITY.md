# Security

Agent Run Inspector reads local agent run logs, which can hold customer data and secrets. Reports about anything that could expose them are welcome.

## Reporting a vulnerability

Please report privately: on GitHub, open the **Security** tab of this repository and choose **Report a vulnerability**. Do not open a public issue.

Include what you found, how to reproduce it and which version (`ari --version`). You should get a reply within a week.

## Supported versions

Only the latest release gets fixes.

## In scope

- The local server: binding to 127.0.0.1, the token and cookie, Host and Origin checks.
- Reading logs: anything that reads files outside the known log folders, or writes or deletes a log.
- Data leaving the machine: any request other than the update check described in the README.
- The Mac app and the service files (`~/.config/agent-run-inspector/`, the LaunchAgent).

The README's [Security](README.md#security) section describes what the tool is meant to do.
