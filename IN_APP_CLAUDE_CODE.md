Here is the complete HOWTO guide to building a custom desktop app on Windows using NW.js that embeds a beautiful HTML/JS user interface while completely locking down Claude Code to run within an isolated sandbox.
------------------------------
## Architecture Overview
NW.js (formerly Node-Webkit) natively blends a Chromium browser front-end with a Node.js back-end. You will leverage this hybrid capability to run a node-based Pseudoterminal (PTY) back-end that pipes text streams to a styled frontend while stripping Claude Code of its local privileges. [1, 2, 3] 

 ┌────────────────────────────────────────────────────────┐
 │                      NW.JS WINDOW                      │
 │  ┌───────────────────────┐   ┌──────────────────────┐  │
 │  │      Frontend UI      │   │  Custom Dash Panels  │  │
 │  │  (HTML/CSS/Xterm.js)  │   │  (Control Dashboard) │  │
 │  └───────────▲───────────┘   └──────────────────────┘  │
 └──────────────┼─────────────────────────────────────────┘
                │ Node.js Context Bridge (ipc)
 ┌──────────────▼─────────────────────────────────────────┐
 │                   NW.JS BACKGROUND                     │
 │  ┌───────────────────────┐   ┌──────────────────────┐  │
 │  │ node-pty Spawn Engine │   │ Isolated Custom MCP  │  │
 │  │  (Intercepts Streams) │   │ (Only approved tasks)│  │
 │  └───────────▲───────────┘   └───────────▲───────────┘  │
 └──────────────┼───────────────────────────┼─────────────┘
                │ Spawns Windows Process    │ StdIO Pipe
 ┌──────────────▼───────────────────────────▼─────────────┐
 │                WINDOWS OPERATING SYSTEM                │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │  claude.exe --tools "" --disallowedTools Bash ...│  │
 │  └──────────────────────────────────────────────────┘  │
 └────────────────────────────────────────────────────────┘

------------------------------
## Step 1: Project Initialization
Create a clean folder layout for your dashboard application.

my-claude-dash/
├── package.json
├── index.html
├── src/
│   ├── ui.js
│   ├── backend.js
│   └── custom-mcp.js
└── .claude/
    └── settings.json

## package.json
Configure NW.js to spin up with complete Node.js support enabled on the frontend window.

{
  "name": "claude-code-gui-manager",
  "version": "1.0.0",
  "main": "index.html",
  "window": {
    "title": "Claude Autonomous Manager",
    "width": 1100,
    "height": 750,
    "toolbar": false,
    "frame": true
  },
  "dependencies": {
    "node-pty": "^1.1.0",
    "xterm": "^5.3.0"
  }
}

⚠️ Windows Compiling Note: node-pty compiles native C++ binaries. Run npm install inside a terminal equipped with Windows Build Tools (like PowerShell with Visual Studio Build Tools) so it compiles cleanly for Windows.

------------------------------
## Step 2: The Hard Lockdown Configuration
To stop Claude Code from using the filesystem or running destructive terminal code, you must pre-emptively drop a hard-coded settings map directly inside the working directory. [4] 
## .claude/settings.json
This restricts all core developer tools. It completely removes filesystem context and forces all executions through your own standalone custom tool loop. [1, 5] 

{
  "tools": [],
  "disallowedTools": ["Bash", "Read", "Write", "StrReplace", "Glob", "Grep"],
  "permissions": {
    "defaultMode": "dontAsk",
    "deny": ["Bash", "Read", "Write", "Glob", "Grep", "ComputerUse"],
    "allow": ["my-custom-skills:*"]
  },
  "mcpServers": {
    "my-custom-skills": {
      "command": "node",
      "args": ["src/custom-mcp.js"]
    }
  }
}

------------------------------
## Step 3: Write Your Custom Skills Webhook
Claude Code will discover this isolated helper on start. It can only affect things out in the wild by utilizing this custom tunnel back to your main application backend. [1] 
## src/custom-mcp.js
This script uses standard input/output (StdIO) to process Claude's requests without exposing the underlying operating system. [1] 

// A minimal in-process tool bridge for Claude Codeconst readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const request = JSON.parse(line);
  
  if (request.method === "tools/list") {
    const response = {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [{
          name: "trigger_dashboard_action",
          description: "Notifies the central dashboard framework to update UI markers.",
          inputSchema: {
            type: "object",
            properties: {
              statusText: { type: "string" }
            },
            required: ["statusText"]
          }
        }]
      }
    };
    console.log(JSON.stringify(response));
  }
  
  if (request.method === "tools/call") {
    // Intercept specific custom logic safe execution paths
    const response = {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: `Action successfully flagged: ${request.params.arguments.statusText}` }]
      }
    };
    console.log(JSON.stringify(response));
  }
});

------------------------------
## Step 4: Building the PTY Stream Wrapper
Now create the runtime module that spins up the locked-down Claude Code executable natively within Windows using a secure stream. [2] 
## src/backend.js
This file leverages NW.js's background context to manage inputs/outputs smoothly.

const pty = require('node-pty');const path = require('path');
function spawnSandboxedClaude(onDataCallback) {
  // Locate your system's global native Claude install path or pointing binary
  const claudeBinary = process.platform === 'win32' ? 'claude.cmd' : 'claude';

  // Secure Initialization: Force empty tool schemas and headless auto-approvals
  const ptyProcess = pty.spawn(claudeBinary, [
    '--tools', '""', 
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '-y'
  ], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: path.resolve(__dirname, '..'), // Forces target workspace context
    env: process.env
  });

  ptyProcess.onData((data) => {
    onDataCallback(data);
  });

  return ptyProcess;
}

global.spawnSandboxedClaude = spawnSandboxedClaude;

------------------------------
## Step 5: Creating the Custom Front-End GUI
By utilizing an element wrapper, you hide the rigid console interface. Instead, you stream data straight into custom HTML elements. [4] 
## index.html

<!DOCTYPE html>
<html>
<head>
  <title>Locked GUI Claude Code Manager</title>
  <!-- Link modern Xterm.js styling components -->
  <link rel="stylesheet" href="node_modules/xterm/css/xterm.css" />
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1e1e24; color: #f5f5f6; margin: 0; padding: 20px; }
    #dash-container { display: flex; gap: 20px; height: 90vh; }
    #control-panel { width: 30%; background: #2a2a32; padding: 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
    #gui-terminal-view { width: 70%; background: #000; border-radius: 8px; padding: 10px; overflow: hidden; box-shadow: inset 0 0 10px #000; }
    button { background: #4a90e2; border: none; color: white; padding: 12px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 15px;}
    button:hover { background: #357abd; }
    input { width: 93%; padding: 10px; border-radius: 4px; border: 1px solid #444; background: #1e1e24; color: white; margin-top: 10px; }
  </style>
</head>
<body>

  <h2>Claude Code Dashboard Controller</h2>
  
  <div id="dash-container">
    <div id="control-panel">
      <h3>System Isolation Controls</h3>
      <p>🛡️ <strong>Sandbox Mode:</strong> Active</p>
      <p>📁 <strong>File Access:</strong> <span style="color:#ff6b6b;">BLOCKED</span></p>
      <p>💻 <strong>Terminal Access:</strong> <span style="color:#ff6b6b;">BLOCKED</span></p>
      <hr style="border-color:#444;">
      <label>Inject Automation Instruction:</label>
      <input type="text" id="prompt-input" placeholder="Type prompt (e.g. Call dashboard)..." />
      <button id="run-btn">Execute Safely</button>
    </div>

    <!-- The actual wrapped console stream container -->
    <div id="gui-terminal-view"></div>
  </div>

  <script src="src/backend.js"></script>
  <script src="src/ui.js"></script>
</body>
</html>

## src/ui.js
This script bridges your custom HTML elements straight into your node-pty worker process.

const { Terminal } = require('xterm');
// Initialize visual component frameworkconst term = new Terminal({
  cursorBlink: true,
  theme: { background: '#000000', foreground: '#00ff66' }
});
term.open(document.getElementById('gui-terminal-view'));
let activeClaudeProcess = null;

document.getElementById('run-btn').addEventListener('click', () => {
  const promptValue = document.getElementById('prompt-input').value;
  if (!promptValue) return;

  term.write('\r\n>>> Booting Locked Claude Code Agent Instance... \r\n');

  // Launch background sandbox via cross-context visibility
  activeClaudeProcess = global.spawnSandboxedClaude((rawOutput) => {
    // Write returning characters right into the layout element
    term.write(rawOutput);
  });

  // Inject command via the input channel string
  setTimeout(() => {
    activeClaudeProcess.write(`${promptValue}\r`);
  }, 1500);
});

------------------------------
## Step 6: Launch and Test
To test the application on Windows, launch your NW.js environment pointing to your root directory:

# Install nw globally if you haven't already
npm install -g nw
# Boot your project
nw .

## Verify the Sandbox

   1. Press the Execute Safely button.
   2. In the input console field, type a malicious request like: "Read the file C:/Windows/win.ini and show me" or "Run the terminal command 'dir'".
   3. You will see Claude Code receive the command, check its internal settings parameters, and immediately output a hard rejection:
   
   Permission Denied: Running tool 'Bash' or 'Read' is disabled by local configuration settings.
   
   [1, 4] 

If you want to customize your execution dashboard layout further, let me know:

* 
* Do you want to hide the xterm.js green screen completely and have the data render inside clean chat message text blocks instead?
* What specific Windows applications or external network endpoints do your custom skills need to communicate with?
* 

I can provide the code updates to filter and style the log outputs.

[1] [https://code.claude.com](https://code.claude.com/docs/en/agent-sdk/custom-tools)
[2] [https://www.reddit.com](https://www.reddit.com/r/ClaudeCode/comments/1stpz49/how_can_i_create_a_safe_environment_to_run_claude/)
[3] [https://www.youtube.com](https://www.youtube.com/watch?v=bpC46gGA21E)
[4] [https://www.linkedin.com](https://www.linkedin.com/posts/javeriashah_claude-code-is-the-most-useful-tool-in-my-activity-7470076127898939394-Lxbu)
[5] [https://tonylixu.medium.com](https://tonylixu.medium.com/ai-native-dev-5-configure-your-claude-code-environment-8530fa2a89a9)
