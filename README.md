# CLI Doc2MD MCP Server
### Local Document Parsing Skill for Claude Desktop & CLI

This is a self-contained **Model Context Protocol (MCP)** server designed to empower **Claude Desktop**, **Claude CLI**, and any MCP-compliant AI client with the native ability to read local documents and convert them into **highly squeezed, token-optimized Markdown**.

By converting files (Word, Excel, PowerPoint, EPUB books, ZIP archives, plain text, and layout HTML) using MarkDownify's Token-Saver algorithm, it reduces prompt ingestion overhead by **up to 70%**! Claude gets clean, structured semantic data while stripping margin padding, fonts, tag lists, and giant URLs.

---

## 🛠️ Supported File Formats & Extractors

The server leverages browserless, high-performance Node.js extraction libraries to parse files entirely locally:

| File Extension | Target Extractor Pipeline | Markdown Representation Layout |
| :--- | :--- | :--- |
| 📄 **Word (`.docx`)** | `Mammoth.js` -> `Turndown` | Full headers, bold/italic structures, lists, and tables. |
| 📊 **Excel (`.xlsx`, `.xls`, `.csv`)** | `SheetJS (XLSX)` | Consolidated tables with dynamic columns and pipe separators. |
| 📉 **PowerPoint (`.pptx`)** | `JSZip` -> XML paragraph parser | Sequential slides structured as `## Slide X` with headings and list bullets. |
| 📚 **EPUB (`.epub`)** | `JSZip` -> XHTML parser | Merges eBook chapters chronologically in reading order. |
| 📦 **ZIP (`.zip`)** | `JSZip` -> Recursive router | Iterates over archives, parses code/text files, skips binary blobs, and merges into one file. |
| 📜 **Plain Text / Code** | Native `fs` buffer reader | Retains original spacing and formats in language-fenced blocks. |
| 📰 **Scraped HTML** | Native `fs` -> `Turndown` | Extracts page layouts into clean headers and semantic blocks. |

---

## 🚀 Step-by-Step Installation & Setup

### 1. Build and install dependencies locally
Open your terminal and navigate to this folder, then run the installer:
```bash
cd cli-doc2md-mcp
npm install
```

---

### 2. Register the Server in Claude Desktop
To add this token-saving skill to your **Claude Desktop** application, you need to register it in your `claude_desktop_config.json` configuration file.

#### File Locations:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- 
Open or create this file and paste the configuration block below, replacing `<absolute-path-to-repo>` with the absolute path to your `markitdown` clone:

```json
{
  "mcpServers": {
    "cli-doc2md-mcp": {
      "command": "node",
      "args": [
        "<absolute-path-to-repo>/cli-doc2md-mcp/index.js"
      ]
    }
  }
}
```

*Example macOS config:*
```json
{
  "mcpServers": {
    "cli-doc2md-mcp": {
      "command": "node",
      "args": [
        "/Users/username/saif/markitdown/cli-doc2md-mcp/index.js"
      ]
    }
  }
}
```

*Example Windows config:*
```json
{
  "mcpServers": {
    "cli-doc2md-mcp": {
      "command": "node",
      "args": [
        "C:\\Users\\username\\Documents\\markitdown\\cli-doc2md-mcp\\index.js"
      ]
    }
  }
}
```

#### 🔄 Apply Changes:
Save the file and **completely restart Claude Desktop** (Quit from menu bar and relaunch). You should now see a plug icon in the input panel, indicating that the `cli-doc2md-mcp` skill is active and linked!

---

### 3. Connect to Claude CLI & Terminal MCP Clients
If you are using the terminal-based **Claude CLI** or wish to interactively debug your skill in the terminal, you can connect this server directly:

#### Option A: Run with the MCP Inspector
The Model Context Protocol Inspector is the official debugging CLI that provides a console interface to interact with and verify your local server:
```bash
# Run from inside the cli-doc2md-mcp directory
npx -y @modelcontextprotocol/inspector node index.js
```
This starts the stdio server, spawns the inspector web panel, and lets you dry-run the `parse_local_file` tool call with custom parameters to see structural token saving in action!

#### Option B: Bind to other CLI / Shell integrations
Since the skill communicates over standard input/output (`stdio`), you can pipe file parsing commands or spin up CLI chat loops using client shells:
```bash
npx -y mcp-cli --server "node /Users/saif/saif/markitdown/cli-doc2md-mcp/index.js"
```

---

## 💡 How to Trigger the Skill in Chat

When interacting with Claude, speak naturally about local files. Claude will identify the target file and trigger the parser automatically:

*   *"Claude, please parse the spreadsheet /Users/saif/sales.xlsx and tell me which month performed best."*
*   *"Check the project log file at ./logs/app.log and tell me why the server crashed."*
*   *"Extract the files in the codebase ZIP folder at /Users/saif/project.zip and review the backend architecture."*

---

## 🎛️ Tool Configurations & Advanced Parameters

The tool exposed to Claude is `parse_local_file`. Behind the scenes, Claude has access to these parameters, which you can explicitly ask it to tweak in your prompts:

-   `filePath` (string, **required**): Absolute path to the file on disk.
-   `stripImages` (boolean, default `true`): Replaces image tags `![alt](url)` with inline tags `[Image: alt]`.
-   `stripLinks` (boolean, default `true`): Strips URL paths from markdown links while preserving the anchor texts (e.g. `[markitdown](https://github.com/...)` becomes just `markitdown`), saving immense token volume on scraped documents.
-   `collapseWhitespace` (boolean, default `true`): Compresses multiple consecutive line breaks down to a maximum of two newlines.
-   `compactTables` (boolean, default `true`): Collapses spacing and cell padding inside generated markdown tables to keep them tight.

### Example Prompt requesting custom tuning:
> *"Claude, parse the file /Users/saif/terms.html using parse_local_file. Make sure to set stripLinks to false because I need to preserve the URL reference links in your answer."*

---

## 🩹 Claude MCP Troubleshooting Manual

If Claude does not show the plug icon or fails to read files, follow this step-by-step diagnostic list:

### 1. Locate the Claude Desktop Logs
Claude logs all JSON-RPC transactions and startup errors. If the server fails to load, the logs tell you exactly why:
- **macOS logs path**: `~/Library/Logs/Claude/mcp.log` and `~/Library/Logs/Claude/mcp-server-cli-doc2md-mcp.log`
- **Windows logs path**: `%APPDATA%\Claude\Logs\mcp.log`

### 2. Error: "command not found: node" or Server failing to spawn
This occurs when Claude Desktop cannot locate `node` on its system path during startup.
- **Solution**: Replace `"node"` in the `"command"` field of `claude_desktop_config.json` with the absolute path to your node binary.
  - On macOS, open terminal and run `which node` to get the path (usually `/usr/local/bin/node` or `/opt/homebrew/bin/node`).
  - Update your configuration:
    ```json
    "cli-doc2md-mcp": {
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/Users/username/saif/markitdown/cli-doc2md-mcp/index.js"
      ]
    }
    ```

### 3. Error: "Cannot find module '@modelcontextprotocol/sdk'..."
The server was started before dependencies were installed locally.
- **Solution**: Run `npm install` inside the `cli-doc2md-mcp/` directory.

### 4. How to perform a dry-run local diagnostic
You can test the MCP server in your terminal. It communicates over stdio, so you can execute the script directly:
```bash
node cli-doc2md-mcp/index.js
```
The server will start and wait for standard input. It will print a log on stderr:
`[CLI Doc2MD MCP] Connected on stdio transport.`
To exit the stdio loop, press `Ctrl + C`.

---

## 🛡️ Security & Privacy Specification

- **100% Local Sandboxing**: The server executes on your local machine under the permissions of your current user account.
- **No External Outbound Transmission**: File parsing, Turndown markdown processing, and regex compression are fully processed locally. There are no outbound web calls or external API triggers.
- **Access Scope**: Claude can only read files that the current user account has read access to. It respects all standard system permissions.

---

*Part of the MarkDownify suite. Developed with ❤️ for prompt engineering productivity.*
