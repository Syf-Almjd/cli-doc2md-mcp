#!/usr/bin/env node

/**
 * Diagnostic CLI Tool: Test Local Document Extractor & Token Saver
 * Usage: node scripts/test-file.js <path-to-document> [options]
 */

import fs from 'fs'
import path from 'path'
import TurndownService from 'turndown'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

// ANSI colors for premium console reporting
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const BLUE = '\x1b[34m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'

// Initialize standard turndown
const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
})

function optimizeMarkdown(markdown, rules) {
  if (!markdown) return ''
  let optimized = markdown

  if (rules.stripImages) {
    optimized = optimized.replace(/!\[([^\]]*)\]\([^\)]+\)/g, (match, alt) => {
      return alt ? `[Image: ${alt}]` : ''
    })
  }

  if (rules.stripLinks) {
    optimized = optimized.replace(/(?<!\!)\[([^\]]+)\]\([^\)]+\)/g, '$1')
  }

  if (rules.compactTables) {
    const lines = optimized.split('\n')
    const processedLines = lines.map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.split('|')
        const cleanedCells = cells.map(cell => cell.trim())
        return cleanedCells.join('|')
      }
      return line
    })
    optimized = processedLines.join('\n')
  }

  if (rules.collapseWhitespace) {
    optimized = optimized.replace(/\n{3,}/g, '\n\n')
    optimized = optimized.split('\n').map(line => line.trimEnd()).join('\n')
  }

  return optimized.trim() + '\n'
}

/**
 * PDF Document extractor
 */
async function parsePdf(buffer, fileName) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true
  })
  const pdf = await loadingTask.promise

  let markdown = `# PDF Document: ${path.basename(fileName, '.pdf')}\n\n`

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()
    const items = textContent.items

    if (items.length === 0) {
      markdown += `## Page ${pageNum}\n\n*(Empty Page)*\n\n`
      continue
    }

    // Group characters by Y height to rebuild natural paragraphs
    const linesMap = {}
    items.forEach((item) => {
      const y = Math.round(item.transform[5] * 10) / 10
      // Match coordinate tolerances within 4px range (accounts for text adjustments)
      const foundY = Object.keys(linesMap).find(k => Math.abs(parseFloat(k) - y) < 4)
      if (foundY !== undefined) {
        const numericY = parseFloat(foundY)
        linesMap[numericY].push(item)
      } else {
        linesMap[y] = [item]
      }
    })

    // Sort lines from top (highest Y) to bottom
    const sortedY = Object.keys(linesMap).map(Number).sort((a, b) => b - a)
    let pageText = ''

    sortedY.forEach((y) => {
      const lineItems = linesMap[y]
      if (lineItems) {
        // Sort text inside lines left-to-right (horizontal X coordinate)
        lineItems.sort((a, b) => a.transform[4] - b.transform[4])

        const lineStr = lineItems.map(item => item.str).join(' ')
        if (lineStr.trim()) {
          pageText += lineStr + '\n'
        }
      }
    })

    markdown += `## Page ${pageNum}\n\n${pageText.trim()}\n\n`
  }

  return markdown.trim() + '\n'
}

async function runTest() {
  const args = process.argv.slice(2)
  const filePathArg = args[0]

  if (!filePathArg) {
    console.log(`
${BOLD}${CYAN}MarkDownify — Local Token Saver Diagnostic CLI${RESET}
==================================================
Allows you to dry-run any document parsing locally to view token metrics.

${BOLD}Usage:${RESET}
  node scripts/test-file.js <path-to-file> [--keep-images] [--keep-links] [--no-collapse] [--no-compact]

${BOLD}Options:${RESET}
  --keep-images   Disable Image stripping
  --keep-links    Disable URL link stripping
  --no-collapse   Disable Whitespace collapsing
  --no-compact    Disable Table column compression

${BOLD}Example:${RESET}
  node scripts/test-file.js sample-data.xlsx
`)
    process.exit(0)
  }

  const absolutePath = path.resolve(filePathArg)
  if (!fs.existsSync(absolutePath)) {
    console.error(`\n${BOLD}${RED}[Error]${RESET} File does not exist at path: ${absolutePath}\n`)
    process.exit(1)
  }

  const ext = path.extname(absolutePath).toLowerCase()
  const fileName = path.basename(absolutePath)
  const stats = fs.statSync(absolutePath)
  const sizeKb = (stats.size / 1024).toFixed(1)

  // Parse custom parameters from flags
  const rules = {
    stripImages: !args.includes('--keep-images'),
    stripLinks: !args.includes('--keep-links'),
    collapseWhitespace: !args.includes('--no-collapse'),
    compactTables: !args.includes('--no-compact')
  }

  console.log(`\n${BOLD}${BLUE}[Parser]${RESET} Ingesting ${CYAN}${fileName}${RESET} (${sizeKb} KB)...`)

  try {
    let rawMarkdown = ''

    // Route to targeted parses
    if (['.txt', '.js', '.ts', '.jsx', '.tsx', '.vue', '.json', '.css', '.py', '.go', '.rs', '.sh', '.yml', '.yaml', '.md', '.log'].includes(ext)) {
      const text = fs.readFileSync(absolutePath, 'utf8')
      rawMarkdown = `# File: ${fileName}\n\n\`\`\`${ext.replace('.', '')}\n${text}\n\`\`\`\n`
    } else if (['.html', '.htm'].includes(ext)) {
      const htmlText = fs.readFileSync(absolutePath, 'utf8')
      rawMarkdown = turndown.turndown(htmlText)
    } else if (ext === '.docx') {
      const buffer = fs.readFileSync(absolutePath)
      const result = await mammoth.convertToHtml({ buffer })
      rawMarkdown = `# Word Document: ${fileName}\n\n` + turndown.turndown(result.value)
    } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      const buffer = fs.readFileSync(absolutePath)
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      let markdown = `# Sheet Data: ${fileName}\n\n`
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
        if (rows.length === 0) return
        markdown += `## Sheet: ${sheetName}\n\n`
        const colCount = Math.max(...rows.map(r => r.length), 0)
        const headers = Array.from({ length: colCount }).map((_, idx) => String(rows[0]?.[idx] || `Col ${idx + 1}`))
        markdown += '| ' + headers.join(' | ') + ' |\n'
        markdown += '| ' + Array.from({ length: colCount }).map(() => '---').join(' | ') + ' |\n'
        rows.slice(1).forEach((row) => {
          const cells = Array.from({ length: colCount }).map((_, idx) => String(row[idx] === undefined ? '' : row[idx]))
          markdown += '| ' + cells.join(' | ') + ' |\n'
        })
        markdown += '\n'
      })
      rawMarkdown = markdown
    } else if (ext === '.zip') {
      const buffer = fs.readFileSync(absolutePath)
      const zip = await JSZip.loadAsync(buffer)
      let markdown = `# ZIP Package: ${fileName}\n\n`
      const fileEntries = Object.keys(zip.files).filter(name => !zip.files[name].dir)
      for (const entry of fileEntries) {
        const zipEntry = zip.file(entry)
        if (!zipEntry) continue
        const entryExt = path.extname(entry).toLowerCase()
        markdown += `## File: \`${entry}\`\n\n`
        if (['.txt', '.js', '.ts', '.py', '.json', '.md'].includes(entryExt)) {
          const text = await zipEntry.async('text')
          markdown += `\`\`\`${entryExt.replace('.', '')}\n${text}\n\`\`\`\n\n`
        } else if (entryExt === '.pdf') {
          const entryBuffer = await zipEntry.async('nodebuffer')
          markdown += await parsePdf(entryBuffer, entry)
        } else {
          markdown += `*(Binary format details skipped)*\n\n`
        }
      }
      rawMarkdown = markdown
    } else if (ext === '.pdf') {
      const buffer = fs.readFileSync(absolutePath)
      rawMarkdown = await parsePdf(buffer, absolutePath)
    } else {
      rawMarkdown = `# Binary File: ${fileName}\nSize: ${sizeKb} KB\nFormat: ${ext}`
    }

    const originalTokens = Math.max(1, Math.round(rawMarkdown.length / 4 * 1.5))
    const optimizedMarkdown = optimizeMarkdown(rawMarkdown, rules)
    const optimizedTokens = Math.max(1, Math.round(optimizedMarkdown.length / 4))
    const savingsPercent = Math.max(0, Math.round(((originalTokens - optimizedTokens) / originalTokens) * 100))

    console.log(`${BOLD}${GREEN}[Success]${RESET} Conversion completed successfully!`)
    console.log(`--------------------------------------------------`)
    console.log(`${BOLD}Extraction Metrics:${RESET}`)
    console.log(`  - Raw Markdown Char Count:  ${YELLOW}${rawMarkdown.length.toLocaleString()}${RESET} chars`)
    console.log(`  - Optimized Char Count:     ${GREEN}${optimizedMarkdown.length.toLocaleString()}${RESET} chars`)
    console.log(`  - Estimated Source Tokens:  ${YELLOW}${originalTokens.toLocaleString()}${RESET} tokens`)
    console.log(`  - Squeezed Tokens to LLM:   ${GREEN}${optimizedTokens.toLocaleString()}${RESET} tokens`)
    console.log(`  - Token Net Savings:        ${BOLD}${GREEN}-${savingsPercent}% Tokens${RESET}`)
    console.log(`--------------------------------------------------`)

    // Write sample preview
    console.log(`${BOLD}Optimized Markdown Preview (First 20 lines):${RESET}`)
    const previewLines = optimizedMarkdown.split('\n').slice(0, 20).join('\n')
    console.log(`\n${previewLines}\n`)
    if (optimizedMarkdown.split('\n').length > 20) {
      console.log(`... *(truncated, showing 20 of ${optimizedMarkdown.split('\n').length} lines)*\n`)
    }
  } catch (err) {
    console.error(`\n${BOLD}${RED}[Error]${RESET} Conversion failed: ${err.message}\n`)
    process.exit(1)
  }
}

runTest()
