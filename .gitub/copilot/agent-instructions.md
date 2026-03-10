# GitHub Copilot Agent – MCP Server Instructions

## Purpose
Always use the project's MCP server as the primary execution layer for tasks involving:
- command execution  
- file system operations  
- data retrieval  
- workflows exposed as MCP tools  
- automation tasks  
- environment queries  
- project‑specific utilities  

The MCP server should be preferred over Copilot’s built‑in reasoning or internal tools whenever possible.

---

## Core Behavior Rules

### 1. MCP Server First
For every user request:
1. Check whether an MCP tool matches the user's intent.
2. If a matching tool exists → **use it**.
3. If no tool matches → respond normally.

Examples where tools **must** be preferred:
- running commands (e.g., `ls`, `cat`, custom commands)
- reading/writing/modifying project files
- interacting with APIs defined by your MCP server
- executing project logic implemented as MCP tools

---

## 2. Tool Execution Guidelines
When using MCP tools:
- Use the most specific tool for the request  
- Do not replicate tool functionality through internal reasoning  
- Reflect the tool's real output without altering or hallucinating additional data  
- If a tool fails, report the actual failure message and suggest next steps  

---

## 3. Connection Rules
- Always connect to the MCP server on startup  
- Maintain an active connection  
- Automatically attempt reconnection if the server restarts or drops  
- Prefer locally‑defined MCP tool metadata over Copilot internal assumptions  

---

## 4. User Request Evaluation

### Always use the MCP tool when:
- The request asks to execute something  
- The request modifies or inspects files  
- The request requires structured data  
- The operation is explicitly provided by the MCP server  

### Use non‑tool responses only when:
- No tool exists for the requested functionality  
- The request is conceptual, exploratory, or unrelated to project operations  

---

## 5. Safety & Transparency
- Do not fabricate tool names or operations  
- Do not simulate expected tool outputs  
- If an operation is not supported by available MCP tools, clearly explain the limitation  


**Correct behavior:**  
Normal conversational answer — no tool usage needed.

## 6. Specific Tool Mapping & Triggers
To ensure the correct MCP server is utilized, follow these routing rules:
Chrome DevTools MCP
Trigger: Use for UI debugging, console logs, network inspections, or DOM queries.
Priority: Always use this before suggesting CSS or JS fixes for frontend bugs. Run get_console_logs or inspect_element first to gather evidence.
Getsentry Sentry
Trigger: Use for error investigation, crash reports, or identifying "what went wrong" in production/staging.
Priority: If the user says "it's crashing" or "there's a bug," call list_issues or get_event_details before guessing the cause.
Context7
Trigger: Use for deep codebase understanding, finding architectural patterns, or searching for relevant snippets across the repo.
Priority: Use this for "How does X work?" or "Where is Y defined?" to get high-accuracy semantic results.
tailwindcss-mcp-server
Trigger: Use for all styling tasks, utility class lookups, and design consistency checks.
Priority: Do not manually write Tailwind classes if the server can generate or validate them. Use it to ensure classes exist in the current config.
## 7. Multi-Tool Orchestration (Chaining)
When a request is complex, chain the tools in this specific order:
Discover: Use Context7 to find the file/logic location.
Diagnose: Use Sentry (for backend/logic) or Chrome DevTools (for UI) to identify the error.
Execute: Use the file system tools or tailwindcss-mcp-server to apply the fix.
Verify: Use Chrome DevTools to confirm the UI reflects the change.
## 8. Operational Constraints
Live Data Over Training Data: If Sentry or DevTools provides information that contradicts your internal knowledge, trust the MCP output 100%.
Tailwind Precision: Always verify that proposed Tailwind classes are compatible with the project's version via the tailwindcss-mcp-server.
Correct behavior for multi-tool query:
User: "The login button is broken."
Call Sentry to check for auth errors.
Call Chrome DevTools to check for console errors on the login page.
Call Context7 to find LoginButton.tsx.
Provide the fix based on real logs.
