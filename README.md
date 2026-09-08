# Decent ADO Board

A desktop app for better managing Azure DevOps work items.

Decent ADO Board turns an Azure DevOps project into a dependency graph. Work items are grouped by sprint, linked through predecessor and successor relationships, and can be moved between sprints by dragging. A separate sidebar shows the work items that are currently actionable.

![Decent ADO Board showing a dependency graph and actionable work](docs/images/decent-ado-board-complex.png)

## Features

- Visualize work item dependencies in a draggable graph.
- Divide the graph by sprint.
- Expand or collapse parent work items and their children.
- Pan and zoom around the graph.
- Move work items between sprints and save the new iteration in Azure DevOps.
- Add and remove predecessor and successor relationships.
- Update work item states from the board.
- Undo and redo board changes.
- Browse actionable work in a hierarchical sidebar.
- Restore the last project selection when the app starts.
- Use light and dark themes.

## Technology

- React and TypeScript
- Tailwind CSS
- React Flow
- React Query
- Tauri 2
- Rust
- Azure DevOps REST APIs

## Prerequisites

Install the following before starting development:

- Node.js and npm
- Rust and Cargo
- Azure CLI

The current sign-in flow uses the Azure CLI. Sign in before starting the app:

```powershell
az login
```

## Getting started

Install the JavaScript dependencies:

```powershell
npm install
```

Start the Tauri development app:

```powershell
npm run tauri dev
```

### Configure the AI Planner

The AI Planner supports two backends. The app picks one automatically: Azure OpenAI is preferred
for plan quality, and Foundry Local is used as a fallback when no cloud deployment is configured.

#### Option 1: Foundry Local (no Azure subscription required)

Runs a model on your own machine. Nothing is sent to the cloud, and no approvals, quota, or role
assignments are needed.

```powershell
winget install Microsoft.FoundryLocal
foundry server start
foundry model download phi-4-mini
npm run tauri dev
```

Expect the first `foundry server start` to take a long time — it downloads hardware acceleration
components (CUDA, WebGPU, OpenVINO, TensorRT) before the server becomes usable, which took about
25 minutes on a Microsoft laptop. Providers your machine cannot use, such as CUDA without an
NVIDIA GPU, fail individually and are skipped; that is expected and not an error.

Check readiness at any time:

```powershell
foundry server status   # "State Ready" plus a "Web URLs" endpoint means it is usable
foundry server logs -f  # follow download and startup progress
```

Note that `foundry server status` exits successfully even when the server is stopped, so read the
reported state rather than the exit code. The service port is assigned dynamically, so the app
discovers the endpoint from this command rather than assuming a fixed port.

`phi-4-mini` (2.2 GB) is the recommended starting point. Larger models such as `phi-4` (8.8 GB)
produce better plans but are slow without a supported GPU. List the options with
`foundry model list --type chat`. The app automatically loads the selected downloaded model into
memory before using it.

#### Option 2: Azure OpenAI (better plan quality)

Uses Microsoft Entra authentication through the Azure CLI. The signed-in identity needs access to
an Azure OpenAI or Azure AI Foundry model deployment and the `Cognitive Services OpenAI User` role
on the resource.

```powershell
$env:DECENT_ADO_BOARD_AZURE_OPENAI_ENDPOINT = "https://<resource-name>.openai.azure.com"
$env:DECENT_ADO_BOARD_AZURE_OPENAI_DEPLOYMENT = "<deployment-name>"
$env:DECENT_ADO_BOARD_AZURE_OPENAI_API_VERSION = "2024-10-21" # Optional
npm run tauri dev
```

The app obtains a separate Azure OpenAI access token from `az`. No API key is stored in the
frontend or repository.

#### Optional overrides

```powershell
$env:DECENT_ADO_BOARD_AI_PROVIDER = "foundry-local"   # or "azure-openai" to force one backend
$env:DECENT_ADO_BOARD_FOUNDRY_LOCAL_ENDPOINT = "http://127.0.0.1:58372"
$env:DECENT_ADO_BOARD_FOUNDRY_LOCAL_MODEL = "phi-4-mini"
```

If no backend is available, the rest of the board keeps working and the AI Planner explains what
to install or configure.

After signing in, select an Azure DevOps organization, project, and area path. The app then loads the board data for that selection.

## Useful commands

```powershell
npm run dev             # Start the Vite frontend only
npm run tauri dev       # Start the desktop app
npm run build           # Type-check and build the frontend
npm test                # Run the frontend tests
npm run lint            # Run ESLint
npm run format          # Format frontend source files
```

Rust commands can be run from the repository root:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project structure

```text
src/                 React application and frontend logic
src/api/              TypeScript wrappers for Tauri commands
src/components/       Board, graph, login, and project selection components
src/hooks/            React hooks for data loading, dragging, and undo/redo
src/utils/            Layout, routing, dependency, and state helpers
src-tauri/src/        Rust commands, Azure DevOps access, auth, and state
```

The frontend communicates with Azure DevOps through Tauri commands. Rust handles authentication, Azure DevOps requests, and writes that change work item state, iteration paths, and dependency links.

## Status

This project is under active development. The graph view and Azure DevOps integration are working, while the board layout and routing are still being refined.
