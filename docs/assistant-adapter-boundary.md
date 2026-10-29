# Assistant adapter boundary

The assistant's providers (Claude Code, Codex, Antigravity, Hermes, an
OpenAI-compatible endpoint, Oh My Pi) are not interchangeable backends
behind one trait. They are arms of the `Brain` enum, and the boundary is
the set of six operations every arm must honor. The enum dispatch in
`brain.rs` is the boundary; a provider that cannot honor an operation
says so by doing nothing for it, never by faking it.

This describes the current source architecture. The target for the assistant
inside Isle is Hermes and Oh My Pi (OMP); the other adapters listed here are
existing code outside this target. Agents outside Isle connect to the separate
MCP server through their own client settings.

## The six operations

### start

`Brain::start(provider, model, resume, workspace, instructions)` connects
the provider and keeps it up for the next turns until dropped.

- CLI providers (Claude, Codex, Antigravity) spawn their process through
  `child::spawn`: its own process group, lowered priority, killed when its
  `Group` drops.
- Oh My Pi spawns `omp --mode rpc-ui --approval-mode always-ask` with its
  native tools, extensions, skills, and rules enabled, then opens its session
  (`open_session`). A session-only overlay changes explicit `bash: allow` to
  `prompt` and preserves `deny` rules. Native tool approvals use Isle's agent
  alert; other interactive extension dialogs are cancelled.
- Hermes and OpenAI-compatible endpoints build an API client instead of
  a process, and load their per-provider conversation history from the
  private data directory.

### warm

`Brain::warm()` prepares for the first turn without asking anything.

- Codex opens its conversation now, so the first turn need not wait.
- Every other arm is a no-op. A no-op warm is valid: warm must never
  ask, stream, or change what the next turn says.

### prompt

`Brain::ask(prompt, activity, draft)` runs one turn and returns an
`Answer` (what to say, the actions Isle runs, whether it listens again).

- `activity` hears progress steps ("Searching the web for …").
- `draft` hears the running text as it is written, so the island shows
  the answer forming. Antigravity is the exception: it reports activity
  only and sends no draft.
- The answer is always Isle's action JSON (see `answer.rs`): every
  provider returns it, and Isle runs or asks approval for those Isle actions.
  This describes the current answer/action path; Hermes and OMP can also keep
  their own native tools. The external MCP server is a separate interface for
  outside agents. Hermes connects with full access: it keeps its own tools,
  answers as Isle's agent, and Isle runs the desktop actions it asks for.

### stream

Streaming is how `draft` is fed, not a separate mode:

- Claude, Codex, and Antigravity stream their CLIs' JSON event lines.
- Oh My Pi streams RPC `message_update` text deltas.
- Hermes and OpenAI-compatible endpoints stream server-sent events:
  each `choices[0].delta.content` is appended and forwarded.
- Oh My Pi and the API arms send an empty draft when done; Claude and
  Codex simply stop at the final text. The island treats both as "the
  draft is finished" once the answer item lands.

### stop

Stopping is two drops, in order, and it is the same for every provider:

1. The turn's ask future is dropped (`until_cancelled` on Cancel).
   This alone stops no process: every CLI and RPC arm holds a
   persistent session process in its struct, not a per-turn one.
2. The brain itself is dropped (`session.brain = None`).
   Dropping a `Group` kills its whole process group, so a CLI or OMP
   process stops for real. Dropping the API ask future sets the cancel
   flag its SSE reader checks between lines, so the remote request
   stops and its connection closes.

A stopped turn always starts fresh next time: the comment in the code
says it plainly ("Stopped mid-turn, the AI would answer into the next
one: a fresh one is started next time"). A failed turn also drops the
brain; a conversation that broke for no known reason is not resumed,
while offline, signed-out, or out-of-quota failures keep it.

Known limit: a server that stalls mid-SSE-stream still blocks one
reader thread until it sends more or the connection dies. There is no
per-read timeout, because a total body budget would also cut off
legitimately long answers.

### continuation

- Claude, Codex, and Antigravity resume by conversation id
  (`Brain::conversation`, `Brain::forget`).
- Oh My Pi resumes by session directory under Isle's private data
  directory (`omp-<pid>-<n>`), guarded to stay inside it.
- Hermes and OpenAI-compatible endpoints report no conversation id:
  their provider-side state is the history file, loaded when the client
  is built and saved after each completed turn. Continuation works
  without an id, by construction.

## What is not the boundary

- The external MCP server is not a provider: today it exposes a selected set
  of Isle tools to external agents and does not answer as the assistant. It is
  separate from the in-app assistant's answer/action path. External agents
  connect to it through their own MCP settings.
- Model discovery is not part of a turn: `ListModels` (Hermes and
  OpenAI-compatible endpoints via `/models`, Oh My Pi via RPC
  `get_available_models`) feeds the settings picker only.
- Current personality settings are one `voice-custom-instructions` value,
  added to supported non-Hermes prompts. The target's Isle-managed
  `SOUL.md`, `USER.md`, and `MEMORY.md` files do not exist yet. Hermes keeps
  its own personality and memory files, and Isle only adds its desktop
  instructions.

## Target product boundary

The in-app assistant target is Hermes and OMP. Both use Isle's in-app
answer/action path for Isle-owned actions; Isle applies its own permission and
approval checks there. OMP keeps its native coding-agent tools and runtime
behavior. The target does not require Hermes or OMP to call MCP.

The external MCP server has a different purpose: expose all Isle data and
actions as tools to agents running outside Isle. The external agent stores the
connection in its own MCP settings. The server's tool surface is not a provider
inside `Brain`, and its MCP setup does not belong in Isle's assistant provider
settings. Underlying Isle service code may be reused, but the two clients and
interfaces stay distinct. See
[assistant-platform-plan.md](assistant-platform-plan.md).
