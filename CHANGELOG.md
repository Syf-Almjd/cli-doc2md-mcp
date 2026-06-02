# Changelog

All notable changes to the Claude Token Saver MCP project will be documented in this file.

---

## [1.0.0] - 2026-06-02

### Added
- **Core MCP Server**: Implemented stdio JSON-RPC Model Context Protocol (MCP) server structure utilizing standard input/output messaging streams.
- **Universal Multi-format Ingestion**: Built server-side document routers to parse:
  - 📄 Word Documents (`.docx`) using `mammoth` parsing grids.
  - 📊 Excel Worksheets & Sheets (`.xlsx`, `.xls`, `.csv`) mapping tabular cells with `xlsx`.
  - 📉 PowerPoint Slide decks (`.pptx`) recursively extracting text nodes from XML files with `jszip`.
  - 📚 EPUB E-books (`.epub`) sequencing pages chapter-by-chapter.
  - 📦 ZIP Archives (`.zip`) traversing structures recursively to parse text-based code blocks while skipping compiled binaries.
- **Token-Squeezer Suite**: Programmed post-processing optimization pipelines:
  - `stripImages` to remove image markup and minimize size.
  - `stripLinks` to strip URL footprints from scrap outputs while preserving anchor text.
  - `collapseWhitespace` to minimize blank heights.
  - `compactTables` to collapse spacing and padding in Excel outputs.
- **CLI Diagnostic Tool**: Created `scripts/test-file.js` allowing developers to locally benchmark document parses, checking exact character/token metrics, rules, and extraction previews directly in terminal consoles.
- **Ready-to-use Templates**: Created standard `claude_desktop_config.json` templates for macOS and Windows.
- **Documentation**: Packaged detailed setup instruction maps and diagnostic checklists.
