# Iteration 10 - Skills And Team Version Management

> Planning note
> This iteration turns local skills and team definitions into versioned assets that can be connected to a GitHub repository.

This iteration adds **version management for Skills and Teams** and replaces the earlier
distributed-orchestration direction with a Git-backed collaboration model.

The goal is to let users treat reusable team knowledge as source-controlled product assets:

- Skills can be authored, reviewed, versioned, and synced.
- Skills can be sourced from multiple GitHub or enterprise Git repositories.
- Team templates can be sourced from multiple GitHub or enterprise Git repositories.
- Team definitions can be exported/imported and connected to repository sources.
- Changes can be reviewed before apply, with rollback and history.

---

## Core Goal

Add a Git-backed lifecycle for:

- local Skills
- team definitions
- team-level runtime/profile settings
- reusable workflows and role presets
- repository source configuration for skills and team templates

The product outcome:

- a user can connect multiple GitHub/enterprise Git repos as sources of truth
- edit Skills/Teams locally
- preview changes
- commit or open a PR
- pull updates safely
- roll back to a previous version
- install the app on multiple machines and collaborate through the shared repository

---

## Non-Goals

- Do not build a public marketplace in this iteration.
- Do not auto-install arbitrary remote code without review.
- Do not make GitHub mandatory for local-only usage.
- Do not build SSH/SFTP-based distributed team orchestration.
- Do not make one Hermit instance schedule or control teammate runtimes on other machines.
- Do not version volatile runtime state such as inboxes, task logs, live process state, or transcripts.
- Do not couple version management to a single agent provider.

---

## Versioned Asset Scope

### Skills

Version:

- `SKILL.md`
- skill metadata
- examples / fixtures
- optional local docs

Do not version:

- generated cache
- execution logs
- secrets
- local-only auth files

### Teams

Version:

- team display name and description
- role/member templates
- workflows
- default provider/model intent
- team-level launch profile
- optional channel binding references by logical name

Do not version by default:

- real Feishu app secrets
- inbox messages
- tasks and comments unless explicitly exported as a snapshot
- runtime launch-state
- process state
- transcript files

---

## Repository Layout Proposal

Default repo layout:

```text
.hermit/
  skills/
    <skill-id>/
      SKILL.md
      skill.json
  teams/
    <team-id>/
      team.json
      members.json
      workflows/
        <member-name>.md
  presets/
    roles.json
    runtime-profiles.json
```

This layout should be treated as an interchange format, not necessarily the app's internal storage layout.

---

## Collaboration Model

Hermit should not own multi-machine distributed scheduling in this direction.

Instead:

- each human/operator installs Hermit on their own machine
- each machine connects to the same GitHub/enterprise Git sources
- Skills and team templates sync through repositories
- code collaboration happens through the user's normal Git/GitHub flow
- enterprise deployments can point to private GitHub Enterprise, GitLab, Gitea, or other Git-compatible remotes later

This keeps Hermit local-first while still enabling multi-machine coordination.

The app may still support remote project paths where already implemented, but new product investment should go into repository-backed assets rather than SSH/SFTP team orchestration.

---

## Phase 0 - Export/Import Contract

Define typed export/import contracts:

- `SkillExport`
- `TeamDefinitionExport`
- `RuntimeProfileExport`
- `HermitWorkspaceManifest`

Add pure conversion helpers:

- local app state -> export tree
- export tree -> validation result
- export tree -> apply plan

Success criteria:

- no filesystem writes during validation
- no secrets included by default
- import produces a reviewable plan before mutating local state

---

## Phase 1 - Local Versioned Workspace

Add a local "versioned workspace" target.

User flow:

1. Choose a folder or Git repo.
2. Export current Skills/Teams to `.hermit/`.
3. See a diff/plan before writing.
4. Apply export.
5. Use existing Git tooling to inspect changes.

Implementation expectations:

- reuse existing project editor/diff primitives where safe
- use main-process filesystem validation
- keep renderer free of direct arbitrary filesystem writes

---

## Phase 2 - Repository Sources

Add repository source configuration.

Supported source types:

- Skills source repo
- Team template source repo
- Combined Hermit asset repo

Capabilities:

- multiple sources
- enable/disable source
- source priority/order
- source scope: user, project, organization
- branch/ref selection
- local checkout path
- sync status
- conflict state

Each source should be identified by stable id, display name, remote URL, branch/ref, and asset type.

---

## Phase 3 - GitHub / Enterprise Git Connection

Add GitHub-backed repository connection first, with room for enterprise Git remotes.

Capabilities:

- connect repo URL / owner / repo
- clone or select local checkout
- detect branch and dirty state
- pull/fetch status
- create branch for changes
- commit generated asset changes
- optionally open PR
- support multiple configured remotes/sources

Prefer `gh` when available for GitHub operations. Fall back to normal git where appropriate.

Important:

- never store GitHub tokens in exported `.hermit/` files
- respect existing dirty working tree
- always show files that will be written/committed
- never assume public GitHub only; keep contracts compatible with enterprise Git remotes

---

## Phase 4 - Skills Source And Version Management UI

Add UI under `Extensions -> Skills`:

- "Connect source"
- "Source list"
- "Export skill"
- "Import skill"
- "Update from source"
- "Show diff"
- "Rollback"

Skill import should support:

- single skill
- folder of skills
- repository manifest

Safety:

- show source repo/path
- show changed files
- require confirmation before overwriting local skill files
- show source priority when multiple sources define the same skill id

---

## Phase 5 - Team Template Source And Version Management UI

Add UI under team settings:

- export team definition
- import team definition
- connect team to template source
- compare team to repository template version
- apply team update
- rollback team definition

When importing a team:

- separate identity changes from runtime changes
- never delete active live members without explicit confirmation
- never overwrite secrets
- show which changes require team restart or member restart
- support creating a new team from a repository template

---

## Phase 6 - PR Workflow

Enable task-driven version updates:

- a team can create/update a Skill
- Hermit exports the change to the connected repository
- Hermit opens a PR
- review result can be reflected back into the team/task

This is the bridge from local orchestration to shareable team/skill assets.

---

## Data Model Notes

Likely new domain modules:

```text
src/features/versioned-assets/
  core/
  main/
  renderer/
```

Core responsibilities:

- schema
- validation
- diff planning
- import/export normalization

Main responsibilities:

- filesystem
- git/GitHub commands
- safe writes

Renderer responsibilities:

- review UI
- diff previews
- repository connection UX

---

## Risks

- Team runtime state is easy to confuse with team definition state.
- Secrets can accidentally leak if export rules are too broad.
- GitHub auth varies across user machines.
- Importing teams while live can create confusing partial state.
- Skills from remote repositories need trust/review boundaries.

Mitigations:

- default to dry-run plans
- explicit secret redaction
- separate definition import from live runtime mutation
- require confirmation for destructive changes
- support local-only workflows without GitHub

---

## Definition Of Done

Iteration is done when:

- Skills and Teams have typed export schemas.
- User can export current Skills/Teams to a local `.hermit/` tree.
- User can import from a `.hermit/` tree with a reviewable plan.
- GitHub repo connection can clone/select repo and show sync status.
- A simple Skill change can be committed or prepared for PR.
- A simple Team definition change can be imported without touching live runtime state.
- Secrets are redacted by default and covered by tests.

