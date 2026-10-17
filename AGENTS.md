<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Interaction & Execution Rules

- **Question Handling Rule**: Whenever the user asks a question (i.e., sends a message ending with `?`), do NOT proceed with writing code, executing modifying commands, or making file edits. At most, perform only read-only operations to gather necessary context before answering. Always answer the question directly without any write/edit actions.

## Protected Release Signing Files & Certificates

> [!CAUTION]
> **CRITICAL: NEVER DELETE, OVERWRITE, OR REGENERATE RELEASE KEYSTORES OR CERTIFICATES.**
> The following files contain the official production signing keys and certificates for Google Play Store releases (SHA-1: `04:D0:A9:1A:E6:20:26:3F:10:8F:AF:CD:C1:05:63:F6:B3:3A:A9:08`).
> Any automated tool, script, or AI assistant MUST NEVER delete, clean, overwrite, or replace:
> - `android/certificates/**`
> - `android/certificates/tera-release-key.jks`
> - `android/certificates/tera-release-upload-cert.pem`
> - `android/certificates/tera-release-upload-cert.der`
> - `android/certificates/tera-release-keystore.b64`
> - `android/tera-release-key.jks`
> - `android/scripts/release-keystore.b64`
> 
> Losing or replacing these keys will break all future Google Play Store updates for `app.terawallet.android`.

