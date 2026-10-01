# Git hosting profiles

Hosting profiles provide read-only pull/merge request and issue lists through a service API. They are separate from Git's SSH agent, credential helper, fetch and push authentication. Local Git operations work without a hosting profile.

## Configure and bind a remote

Open **Preferenze → Profili hosting**, the **Profili hosting · account e server Git** command in the palette, or **Profili hosting** on the Integrations page. Add a named profile, choose a provider and enter its HTTPS server/organization URL, including any server prefix. Select the authentication mode and save the credential. A blank credential field retains the saved value; saved secrets are never read back into the form. **Accesso pubblico** sends no credential and works only where the server allows anonymous reads.

With a repository open, choose a remote under **Associa al repository**, select a saved profile and use **Salva associazione**. This stores an application binding without changing the Git remote URL. Multiple remotes can use different profiles. Custom domains need an explicit provider choice; a hostname alone does not identify the software running there.

**Test connessione** uses the profile currently open in the editor and the selected remote. Save edits first. It makes a read request to that repository; success does not prove write permission or access to every repository. The Integrations page uses the saved binding and offers remote selection, refresh, lists and external links.

For Azure DevOps Server, set **Versione API Azure** to a version supported by that installation; the default is `7.1`. The issue tab is labelled **Work item** because these results belong to the Azure project.

For GitHub CLI mode, authenticate the desired host separately with `gh auth login --hostname HOST`. Branchline delegates requests to the installed CLI rather than importing its token.

## Provider configuration

The table describes the adapters' intended read scope and provider authentication. Live account/server observations belong in [VALIDATION.md](VALIDATION.md); adapter presence is not universal compatibility proof.

| Provider | Profile URL and authentication | Read scope and limits |
| --- | --- | --- |
| GitHub / Enterprise Server | `https://github.com` or the enterprise server; token or authenticated `gh`. Enterprise REST uses `/api/v3`. | Pull requests and issues. Issue results exclude pull requests. Token scopes and repository permissions still apply. [REST reference](https://docs.github.com/en/enterprise-server%403.18/rest/pulls/pulls). |
| GitLab / self-managed | Instance URL, including an optional prefix; personal access token or OAuth bearer. REST uses `/api/v4`. | Merge requests and issues; nested namespace paths are encoded as one project identifier and displayed numbers use `iid`. [Authentication](https://docs.gitlab.com/api/rest/authentication/) and [merge requests](https://docs.gitlab.com/api/merge_requests/). |
| Bitbucket Cloud | `https://bitbucket.org`; API token with Basic account authentication or Bearer, or an OAuth/access token with Bearer. | Pull requests. Native issue tracker APIs were removed on 20 August 2026; app passwords were retired and API tokens gained Bearer support. Jira is separate. [Current changelog](https://developer.atlassian.com/cloud/bitbucket/changelog/) and [pull requests](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/). |
| Bitbucket Server / Data Center | Instance URL with its context path; HTTP token with the authentication mode supported by the server. Project/repository tokens use Bearer. | Pull requests through `/rest/api/latest`. Native repository issues are not exposed; Jira integration is outside this adapter. [HTTP tokens](https://confluence.atlassian.com/bitbucketserver086/http-access-tokens-1188782454.html) and [REST reference](https://developer.atlassian.com/server/bitbucket/rest/v900/api-group-pull-requests/). |
| Azure DevOps / Server | Organization URL, such as `https://dev.azure.com/organization`, or server collection URL; PAT through Basic with an optional username, or bearer token. | Pull requests and project work items, rather than repository-scoped issues. API versions depend on Server releases. [PAT authentication](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops), [pull requests](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-requests) and [version compatibility](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rest-api-versioning?view=azure-devops). |
| Gitea | Instance URL with any prefix; personal token or OAuth bearer. | Pull requests and issues through `/api/v1`; instance version, token scopes and enabled features matter. [API usage](https://docs.gitea.com/development/api-usage/). |
| Forgejo | Instance URL with any prefix; personal token or OAuth bearer. | Pull requests and issues through `/api/v1`; major versions can change API compatibility and administrators may disable the API. [API usage](https://forgejo.org/docs/latest/user/api/usage/). |

Remote formats differ: ordinary SSH/HTTPS owner/repository paths, nested GitLab groups, Bitbucket `/scm/PROJECT/repository.git` and Azure `/_git/` or `ssh.dev.azure.com:v3/organization/project/repository`. SSH configuration aliases are not resolved; API profiles require a matching canonical host. Host, port for HTTPS, server prefix and Azure organization/collection are checked before sending profile credentials. Parsing a remote does not contact the host or prove access.

## Storage and boundaries

Application metadata and bindings live in `userData/hosting/profiles.json`; credentials are encrypted in `userData/hosting/credentials.json` by Electron `safeStorage`. On macOS the encryption key uses Keychain. The vault rejects unavailable encryption and Linux `basic_text`: there is no plaintext fallback. Profile reads return credential-presence flags only. See [SECURITY.md](../SECURITY.md).

Deleting a profile removes its application credentials and bindings. It does not revoke a token on the service or change the repository, remote URL, SSH configuration or Git credential helper.

Integrations do not create, edit, review, comment on or merge requests. They do not edit issues, query Jira/Trello, or manage organizations. Lists return at most 50 items from at most five pages, rather than a complete account-wide view. Azure's work-item query excludes the literal states `Closed`, `Done` and `Removed`; custom workflow states retain their names. GitHub Enterprise CLI mode supports standard host URLs; use a token profile for custom ports or prefixes. Server versions, custom authentication gateways, token expiration, API availability, permissions and rate limits can prevent a request; the UI reports errors or unsupported capabilities instead of treating them as an empty list.

Use public reports only with synthetic repository names, placeholder endpoints and redacted errors. Avoid pasting credentials or private server paths into screenshots and issue reports.

See the [usage guide](GUIDE.md) for the broader desktop workflow and [internal API](../API.md) for exact payloads and transport limits.
