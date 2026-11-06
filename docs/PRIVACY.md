# Privacy

Cascade processes customer content, so the policy is short and specific.

**What is stored.** Decision records, their test results, run snapshots and the
page↔issue link are stored in **Forge SQL** inside your installation. Nothing is
stored outside the Atlassian platform.

**What is read.** Jira and Confluence objects are read **as the acting user**, so
the app can see only what that user can see. Teamwork Graph reads are also
performed as the user, so graph permissions apply.

**What leaves the platform.** Nothing. Cascade makes no outbound network calls
other than to Atlassian APIs on your site.

**Who can see it.** The same people who can see the underlying Jira and Confluence
content. The panel and the agent inherit the caller's permissions.

**Retention.** Run records live in Forge SQL for the life of the installation and
are removed when the app is uninstalled.

**Contact.** Open an issue at https://github.com/TCPCore/cascadefore.
