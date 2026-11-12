# Windows 11 + WSL2 deployment (Phase 1)

TAKT-UI-CC runs its Node.js workbench and MCP bridge inside Ubuntu on WSL2. Windows-native
Unity and Cocos Creator remain on Windows and will connect through a later editor bridge.

## Prerequisites

- Windows 11 with WSL2 and Ubuntu 22.04 or newer.
- Node.js 22.13 or newer installed inside WSL2 (not only on Windows).
- Ubuntu packages: `build-essential curl git lsof openssh-client perl python3 tmux`.
- SSH key access to the Linux VPS.

## Install WSL2

Run in elevated PowerShell:

```powershell
wsl --install -d Ubuntu
wsl --set-default-version 2
```

Restart if requested, launch Ubuntu once, and create the Linux user.

## Install TAKT

Inside Ubuntu:

```bash
sudo apt update
sudo apt install -y build-essential curl git lsof openssh-client perl python3 tmux
# Install Node.js >= 22.13 using a trusted NodeSource or nvm installation.
node --version
git clone https://github.com/yszyyyry/TAKT-UI-CC.git
cd TAKT-UI-CC
git checkout feat/windows11-wsl2-phase1
bash scripts/install.sh
bash scripts/start.sh
```

Open `http://127.0.0.1:3080` in the Windows browser.

## Keep projects on the Windows filesystem

Store Unity/Cocos projects under a Windows path such as `C:\\Users\\<you>\\Projects`.
Access them from WSL using `/mnt/c/Users/<you>/Projects`. Keep TAKT source,
`node_modules`, and its SQLite runtime data inside the WSL Linux filesystem for better
Linux tool performance.

## VPS connection

Configure a dedicated SSH alias in WSL `~/.ssh/config` and verify:

```bash
ssh -o BatchMode=yes your-vps 'command -v tmux && command -v python3'
```

Bind the VPS through the TAKT Nodes UI. Do not expose the workbench or MCP ports publicly.
Use a private overlay network for remote access; the authenticated mobile access layer is a
later phase and is not included in Phase 1.

## Diagnostics

```bash
npm run doctor
bash scripts/smoke-test.sh
```

Phase 1 is a compatibility baseline, not a production security release. Keep the workbench
local-only until the dedicated authentication and authorization phase is complete.
