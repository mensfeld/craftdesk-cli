# CraftDesk CLI

> **Dependency management for AI capabilities** - Install, manage, and version control your Claude Code skills, agents, commands, hooks, and plugins.

The command-line interface for managing your Coding AI capabilities. Similar to npm for JavaScript or bundler for Ruby, CraftDesk CLI provides a complete package management solution for AI-powered development tools.

[![npm version](https://img.shields.io/npm/v/craftdesk.svg)](https://www.npmjs.com/package/craftdesk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is CraftDesk?

CraftDesk is a package manager for AI capabilities used in Claude Code and other AI development environments. It allows you to:

- **Install AI skills, agents, commands, hooks, and plugins** from git repositories
- **Lock versions** for reproducible environments across teams
- **Manage dependencies** with automatic transitive resolution
- **Support monorepos** with subdirectory extraction
- **Auto-convert GitHub URLs** - paste any GitHub URL (tree/blob)
- **Direct file references** - install single files from repositories

Think of it as:
- **npm** for Node.js → **CraftDesk** for AI capabilities
- **Bundler** for Ruby → **CraftDesk** for Claude tools
- **Cargo** for Rust → **CraftDesk** for AI agents

> **Note:** A self-hosted registry server is currently under development and will be available soon, enabling private registries and centralized craft distribution.

---

## Quick Start

### Install CraftDesk

```bash
npm install -g craftdesk
```

Verify installation:
```bash
craftdesk --version
# 0.3.0
```

**Requirements:** Node.js >= 18.0.0, Git, npm or yarn

### 1. Initialize a New Project

```bash
mkdir my-ai-project
cd my-ai-project
craftdesk init
```

This creates a `craftdesk.json` file:
```json
{
  "name": "my-ai-project",
  "version": "1.0.0",
  "type": "skill",
  "dependencies": {}
}
```

### 2. Add Dependencies

```bash
# Add a single skill file from GitHub (auto-converts web URLs)
craftdesk add https://github.com/aviflombaum/rspec-rails-agents/blob/main/rspec-dry-agent.md

# Add from git repository
craftdesk add git+https://github.com/aviflombaum/rspec-rails-agents.git

# Add from monorepo subdirectory
craftdesk add https://github.com/technicalpickles/pickled-claude-plugins/tree/main/plugins/working-in-monorepos/skills/working-in-monorepos

# Add with explicit type
craftdesk add https://github.com/aviflombaum/rspec-rails-agents/blob/main/rspec-dry-agent.md --type agent
```

### 3. Install Everything

```bash
craftdesk install
```

This installs all dependencies to `.claude/` directory and creates `craftdesk.lock`.

### 4. View Installed Crafts

```bash
craftdesk list
```

Output:
```
my-ai-project@1.0.0

Installed crafts:
  • my-skill@main (skill)
  • custom-agent@main (agent)

Total: 2 crafts installed
```

---

## Table of Contents

- [What is CraftDesk?](#what-is-craftdesk)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Command Reference](#command-reference)
- [Dependency Sources](#dependency-sources)
- [Monorepo Support](#monorepo-support)
- [craftdesk.json Reference](#craftdeskjson-reference)
- [craftdesk.lock](#craftdesklock)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Core Concepts

### Crafts

A **craft** is any AI capability:
- **Skill** - Knowledge domain (e.g., ruby-on-rails, postgres-expert)
- **Agent** - Autonomous task executor (e.g., code-reviewer, test-runner)
- **Command** - Slash command (e.g., /deploy, /analyze)
- **Hook** - Event handler (e.g., pre-commit, post-install)
- **Plugin** - Extended functionality or tool integration (e.g., mcp-server, custom-tools)

### Manifest File: craftdesk.json

Declares your project's dependencies:
```json
{
  "name": "my-project",
  "version": "1.0.0",
  "dependencies": {
    "my-skill": {
      "git": "https://github.com/user/skill.git",
      "branch": "main"
    }
  }
}
```

### Lockfile: craftdesk.lock

Records exact versions installed (like package-lock.json or Gemfile.lock):
```json
{
  "version": "1.0.0",
  "lockfileVersion": 1,
  "crafts": {
    "my-skill": {
      "version": "main",
      "resolved": "https://github.com/user/skill.git",
      "integrity": "a1b2c3d4e5f6...",
      "type": "skill",
      "git": "https://github.com/user/skill.git",
      "branch": "main",
      "commit": "a1b2c3d4e5f6789012345678901234567890abcd"
    }
  }
}
```

**Always commit this file to version control!**

### Security: Checksum Verification

CraftDesk automatically verifies the integrity of downloaded packages:

- **Registry packages**: SHA-256 checksums are computed when you first add a craft and stored in `craftdesk.lock`
- **Subsequent installs**: The downloaded file is verified against the stored checksum before extraction
- **MITM protection**: Prevents tampering during download by detecting any modifications
- **Git packages**: Git commit hashes serve as checksums - stored in the lockfile and verified during clone

**What happens on checksum mismatch:**
```
Error: Checksum verification failed for john/rails-api@2.1.0.
Expected: a1b2c3d4e5f6...
This may indicate a corrupted download or a security issue.
Try running 'craftdesk install --no-lockfile' to re-resolve dependencies.
```

The lockfile contains SHA-256 hashes that ensure reproducible and secure installations across all team members.

### Install Directory

By default, crafts install to `.claude/` in your project:
```
.claude/
├── skills/
│   ├── ruby-on-rails/
│   └── postgres-expert/
├── agents/
│   └── code-reviewer/
├── commands/
│   └── deploy/
├── hooks/
│   └── pre-commit/
└── plugins/
    └── mcp-server/
```

---

## Command Reference

### `craftdesk init [options]`

Initialize a new craftdesk.json file.

**Options:**
- `-y, --yes` - Skip prompts and use defaults
- `-n, --name <name>` - Project name (default: directory name)
- `-v, --version <version>` - Project version (default: "1.0.0")
- `-t, --type <type>` - Project type: skill, agent, command, hook, or plugin (default: "skill")
- `-d, --description <desc>` - Project description
- `-a, --author <author>` - Author name
- `-l, --license <license>` - License (default: "MIT")

**Examples:**
```bash
# Interactive initialization
craftdesk init

# Quick init with defaults
craftdesk init -y

# Specify options
craftdesk init --name my-skill --type skill --author "Your Name"
```

---

### `craftdesk install [options]`

Install all dependencies from craftdesk.json.

**Options:**
- `--no-lockfile` - Ignore craftdesk.lock and re-resolve dependencies
- `--production` - Skip devDependencies

**Examples:**
```bash
# Install all dependencies
craftdesk install

# Or use the alias
craftdesk i

# Production install (skip dev dependencies)
craftdesk install --production

# Force re-resolve (ignore lockfile)
craftdesk install --no-lockfile
```

**What it does:**
1. Reads craftdesk.json
2. Uses craftdesk.lock if present (ensures reproducibility)
3. Resolves dependencies (registry + git sources)
4. Installs to .claude/ directory
5. Updates/creates craftdesk.lock

---

### `craftdesk add <craft> [options]`

Add a new dependency and install it immediately.

**Options:**
- `-D, --save-dev` - Save as devDependency
- `-O, --save-optional` - Save as optionalDependency
- `-E, --save-exact` - Save exact version (no ^ or ~)
- `-t, --type <type>` - Specify craft type (skill, agent, command, hook, plugin)

**Examples:**

```bash
# GitHub web URLs (auto-converted)
craftdesk add https://github.com/user/repo/blob/main/skill.md
craftdesk add https://github.com/user/repo/tree/main/skills/auth

# With explicit type
craftdesk add https://github.com/user/repo/blob/main/agent.md --type agent

# Git dependencies (manual format)
craftdesk add git+https://github.com/user/repo.git
craftdesk add git+https://github.com/user/repo.git#develop
craftdesk add git+https://github.com/user/repo.git#v2.0.0

# Direct file reference
craftdesk add git+https://github.com/user/repo.git#main#file:skill.md

# Subdirectory (monorepo)
craftdesk add git+https://github.com/company/monorepo.git#main#path:skills/auth
```

---

### `craftdesk remove <craft>`

Remove a dependency from craftdesk.json and the filesystem.

**Examples:**
```bash
craftdesk remove my-skill
craftdesk remove my-agent
```

---

### `craftdesk list [options]`

List installed crafts.

**Options:**
- `--tree` - Show dependency tree
- `--depth <n>` - Limit tree depth
- `--json` - Output as JSON

**Examples:**
```bash
# Simple list
craftdesk list

# Show dependency tree
craftdesk list --tree

# Limit tree depth
craftdesk list --tree --depth 2

# JSON output (for scripts)
craftdesk list --json
```

**Example output:**
```
my-project@1.0.0

Installed crafts:
  • my-skill@main (skill)
  • code-reviewer@v2.0.1 (agent)
  • postgres-expert@main (skill)

Total: 3 crafts installed
```

---

### Global Options

Available for all commands:

- `-v, --version` - Output the version number
- `-d, --debug` - Enable debug output
- `-h, --help` - Display help

**Examples:**
```bash
craftdesk --version
craftdesk --help
craftdesk init --help
```

---

## Dependency Sources

CraftDesk supports both registry and git dependencies.

### 1. Registry Dependencies (CraftDesk Web API)

Install crafts from the CraftDesk registry using `author/name` format:

```bash
# Search for crafts
craftdesk search kafka

# Get information about a craft
craftdesk info john/rails-api

# Add from registry
craftdesk add john/rails-api
craftdesk add john/rails-api@^2.1.0

# Add with specific version
craftdesk add jane/postgres-expert@1.2.0
```

**Registry format in craftdesk.json:**

```json
{
  "dependencies": {
    "john/rails-api": "^2.1.0",
    "jane/kafka-processing": "~1.5.2",
    "team/postgres-admin": "latest"
  },
  "registries": {
    "default": {
      "url": "http://localhost:3000"
    }
  }
}
```

**Important:** You must configure your registry URL in `craftdesk.json` to use registry-based crafts. Git-based dependencies (GitHub URLs) work without any registry configuration.

**Private Registry Authentication:**

For private registries, set authentication tokens via environment variables:

```bash
# For a registry named "company-private" in craftdesk.json
export CRAFTDESK_AUTH_COMPANY_PRIVATE=your_token_here

# For default registry
export CRAFTDESK_AUTH_DEFAULT=your_token_here
```

Example `craftdesk.json` with private registry:

```json
{
  "registries": {
    "default": {
      "url": "https://your-registry.com"
    },
    "company-private": {
      "url": "https://private.company.com",
      "scope": "@company"
    }
  }
}
```

### 2. GitHub URLs (Easiest for Git)

Simply paste any GitHub URL - it auto-converts to the correct format:

```bash
# Directory in monorepo
craftdesk add https://github.com/user/repo/tree/main/skills/auth

# Single file
craftdesk add https://github.com/user/repo/blob/main/agent.md

# Entire repository
craftdesk add https://github.com/user/repo
```

### 3. Git Dependencies

From git repositories:

```json
{
  "dependencies": {
    "custom-agent": {
      "git": "https://github.com/user/agent-repo.git",
      "branch": "develop"
    },
    "stable-skill": {
      "git": "https://github.com/org/skills.git",
      "tag": "v2.1.0"
    },
    "specific-commit": {
      "git": "https://github.com/user/repo.git",
      "commit": "a1b2c3d4"
    }
  }
}
```

**Git options:**
- `git` - Repository URL (required)
- `branch` - Branch name (default: main/master)
- `tag` - Git tag
- `commit` - Specific commit hash
- `path` - Subdirectory within repo (for monorepos)
- `file` - Direct file path (for single-file crafts)

---

## Monorepo Support

Install multiple crafts from the same git repository using subdirectory paths:

```json
{
  "dependencies": {
    "auth-handler": {
      "git": "https://github.com/company/ai-crafts-monorepo.git",
      "tag": "v3.2.0",
      "path": "skills/auth"
    },
    "data-processor": {
      "git": "https://github.com/company/ai-crafts-monorepo.git",
      "tag": "v3.2.0",
      "path": "agents/processor"
    },
    "report-generator": {
      "git": "https://github.com/company/ai-crafts-monorepo.git",
      "tag": "v3.2.0",
      "path": "skills/reporting"
    }
  }
}
```

**Benefits:**
- Single git repository for multiple crafts
- Version them together with git tags
- Each craft installs independently
- Efficient cloning (repo cached during resolution)

**Monorepo structure example:**
```
ai-crafts-monorepo/
├── skills/
│   ├── auth/
│   │   ├── craftdesk.json
│   │   └── SKILL.md
│   └── reporting/
│       ├── craftdesk.json
│       └── SKILL.md
├── agents/
│   └── processor/
│       ├── craftdesk.json
│       └── AGENT.md
└── commands/
    └── deploy/
        ├── craftdesk.json
        └── COMMAND.md
```

---

## craftdesk.json Reference

Complete specification of the craftdesk.json format:

```json
{
  // Required fields
  "name": "my-project",
  "version": "1.0.0",

  // Optional metadata
  "type": "skill",
  "description": "My awesome AI project",
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "homepage": "https://example.com",
  "repository": {
    "type": "git",
    "url": "https://github.com/user/repo.git"
  },
  "keywords": ["ai", "claude", "automation"],

  // Dependencies
  "dependencies": {
    "my-skill": {
      "git": "https://github.com/user/repo.git",
      "branch": "main"
    },
    "auth-handler": {
      "git": "https://github.com/company/monorepo.git",
      "tag": "v3.2.0",
      "path": "skills/auth"
    },
    "my-agent": {
      "git": "https://github.com/user/agents.git",
      "branch": "main",
      "file": "agent.md"
    }
  },

  "devDependencies": {
    "test-runner": {
      "git": "https://github.com/org/test-tools.git",
      "branch": "main"
    }
  }
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Craft name (lowercase, no spaces) |
| `version` | string | Yes | Semantic version (e.g., "1.0.0") |
| `type` | string | No | Craft type: skill, agent, command, hook, plugin |
| `description` | string | No | Short description |
| `author` | string | No | Author name and email |
| `license` | string | No | License identifier (e.g., "MIT") |
| `dependencies` | object | No | Production dependencies |
| `devDependencies` | object | No | Development dependencies |

---

## craftdesk.lock

The lockfile ensures reproducible installations across different machines and times.

### What's in the Lockfile?

```json
{
  "version": "1.0.0",
  "lockfileVersion": 1,
  "generatedAt": "2025-11-18T10:30:00.000Z",
  "crafts": {
    "my-skill": {
      "version": "main",
      "resolved": "https://github.com/user/skill.git",
      "integrity": "a1b2c3d4e5f6789012345678901234567890abcd",
      "type": "skill",
      "author": "git",
      "git": "https://github.com/user/skill.git",
      "branch": "main",
      "commit": "a1b2c3d4e5f6789012345678901234567890abcd",
      "dependencies": {}
    },
    "custom-agent": {
      "version": "v2.0.0",
      "resolved": "https://github.com/user/agent.git",
      "integrity": "b2c3d4e5f6789012345678901234567890abcdef",
      "type": "agent",
      "git": "https://github.com/user/agent.git",
      "tag": "v2.0.0",
      "commit": "b2c3d4e5f6789012345678901234567890abcdef",
      "dependencies": {}
    }
  }
}
```

### Best Practices

✅ **DO:**
- Commit craftdesk.lock to version control
- Let the CLI manage it (don't edit manually)
- Use it for reproducible builds in CI/CD

❌ **DON'T:**
- Ignore craftdesk.lock in .gitignore
- Edit it manually
- Delete it without `--no-lockfile` flag

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Deploy
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install CraftDesk CLI
        run: npm install -g craftdesk

      - name: Install AI capabilities
        run: craftdesk install --production

      - name: Deploy
        run: ./deploy.sh
```

### GitLab CI

```yaml
deploy:
  image: node:18
  script:
    - npm install -g craftdesk
    - craftdesk install --production
    - ./deploy.sh
  only:
    - main
```

### Docker

```dockerfile
FROM node:18

# Install CraftDesk CLI
RUN npm install -g craftdesk

# Copy project files
WORKDIR /app
COPY craftdesk.json craftdesk.lock ./

# Install AI capabilities
RUN craftdesk install --production

# Copy rest of application
COPY . .

CMD ["node", "app.js"]
```

---

## Troubleshooting

### Common Issues

#### `No craftdesk.json found`

Make sure you're in a directory with a craftdesk.json file, or run `craftdesk init` first.

#### `Failed to resolve dependencies`

- Check internet connection
- Verify git repository URLs are accessible
- For private repos, ensure SSH keys or access tokens are configured
- Try `craftdesk install --no-lockfile` to re-resolve

#### `Git clone failed`

- Verify git is installed: `git --version`
- Check git repository URL is accessible
- For private repos, ensure SSH keys or tokens are configured

#### `Permission denied`

- For global install: `sudo npm install -g craftdesk`
- Or use npx: `npx craftdesk install`

#### `Dependency conflicts`

Currently uses last-write-wins. Future versions will have interactive conflict resolution.

### Debug Mode

Enable verbose logging:

```bash
craftdesk --debug install
```

### Getting Help

```bash
# General help
craftdesk --help

# Command-specific help
craftdesk init --help
craftdesk add --help
craftdesk install --help
```

---

## Development

### Building from Source

```bash
git clone https://github.com/mensfeld/craftdesk.git
cd craftdesk
npm install
npm run build
npm link
```

### Project Structure

```
craftdesk/
├── src/
│   ├── commands/       # CLI commands
│   ├── services/       # Core services
│   ├── types/          # TypeScript types
│   └── utils/          # Utilities
├── dist/               # Compiled JavaScript
├── bin/                # Executable entry point
├── examples/           # Example craftdesk.json files
└── docs/               # Documentation
```

### Running Tests

```bash
npm test
```

### Publishing

```bash
npm version patch
npm publish
```

---

## License

MIT

---

## Links

- **Repository**: [https://github.com/mensfeld/craftdesk](https://github.com/mensfeld/craftdesk)
- **Issues**: [https://github.com/mensfeld/craftdesk/issues](https://github.com/mensfeld/craftdesk/issues)
- **Registry**: Self-hosted registry server available at [CraftDesk Web](../web)

---

## Roadmap

- ✅ Git dependency support
- ✅ GitHub URL auto-conversion
- ✅ Direct file references
- ✅ Monorepo support
- ✅ Lockfile-based version control
- ✅ Self-hosted registry server support
- ✅ Registry search and info commands
- ✅ ZIP archive extraction for registry crafts
- ✅ SHA-256 checksum verification (MITM protection)
- 🚧 Private registry authentication (token-based)
- 🚧 Dependency conflict resolution
- 🚧 Semantic versioning for registry packages

---

Made for the AI development community
