#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import TurndownService from 'turndown'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

// Initialize Turndown
const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
})
turndown.addRule('emptyParagraphs', {
  filter: (node) => node.nodeName === 'P' && !node.textContent?.trim(),
  replacement: () => ''
})

/**
 * Token-Squeezer post-processing rules matching the web studio
 */
function optimizeMarkdown(markdown, rules) {
  if (!markdown) return ''
  let optimized = markdown

  // 1. Strip Images
  if (rules.stripImages) {
    optimized = optimized.replace(/!\[([^\]]*)\]\([^\)]+\)/g, (match, alt) => {
      return alt ? `[Image: ${alt}]` : ''
    })
  }

  // 2. Strip Hyperlink URLs
  if (rules.stripLinks) {
    optimized = optimized.replace(/(?<!\!)\[([^\]]+)\]\([^\)]+\)/g, '$1')
  }

  // 3. Compact Tables
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

  // 4. Collapse Whitespace
  if (rules.collapseWhitespace) {
    optimized = optimized.replace(/\n{3,}/g, '\n\n')
    optimized = optimized.split('\n').map(line => line.trimEnd()).join('\n')
  }

  return optimized.trim() + '\n'
}

/**
 * PPTX PowerPoint slide extractor
 */
async function parsePptx(buffer, fileName) {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files).filter(
    name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
  )

  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10)
    const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10)
    return numA - numB
  })

  let markdown = `# Presentation: ${path.basename(fileName, '.pptx')}\n\n`

  for (let i = 0; i < slideFiles.length; i++) {
    const slideFile = slideFiles[i]
    const zipFile = zip.file(slideFile)
    if (!zipFile) continue
    const xmlText = await zipFile.async('text')

    // Simple PPTX slide XML parser fallback using regex since DOMParser is a browser-only API
    const slideContent = []
    const matches = xmlText.matchAll(/<a:t>([^<]*)<\/a:t>/g)
    for (const match of matches) {
      if (match[1]?.trim()) {
        slideContent.push(match[1].trim())
      }
    }

    markdown += `## Slide ${i + 1}\n\n`
    if (slideContent.length > 0) {
      const title = slideContent[0]
      const body = slideContent.slice(1)
      markdown += `### ${title}\n\n`
      body.forEach((line) => {
        markdown += `- ${line}\n`
      })
    } else {
      markdown += '*(Empty Slide)*\n'
    }
    markdown += '\n---\n\n'
  }

  return markdown.trim().replace(/\n---\n*$/, '') + '\n'
}

/**
 * EPUB E-book extractor
 */
async function parseEpub(buffer, fileName) {
  const zip = await JSZip.loadAsync(buffer)
  const htmlFiles = Object.keys(zip.files).filter(
    name => name.endsWith('.xhtml') || name.endsWith('.html') || name.endsWith('.htm')
  )
  htmlFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

  let markdown = `# Book: ${path.basename(fileName, '.epub')}\n\n`

  for (const htmlFile of htmlFiles) {
    const zipFile = zip.file(htmlFile)
    if (!zipFile) continue
    const htmlContent = await zipFile.async('text')
    const sectionMd = turndown.turndown(htmlContent)

    if (sectionMd.trim()) {
      const sectionName = path.basename(htmlFile, path.extname(htmlFile))
      markdown += `## Chapter: ${sectionName}\n\n${sectionMd.trim()}\n\n---\n\n`
    }
  }

  return markdown.trim().replace(/\n---\n*$/, '') + '\n'
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

/**
 * ZIP Archive extractor (recursive converter)
 */

async function parseZip(buffer, fileName, rules) {
  const zip = await JSZip.loadAsync(buffer)
  let markdown = `# ZIP Package: ${path.basename(fileName)}\n\n`
  markdown += `Recursive file conversions:\n\n---\n\n`

  const fileEntries = Object.keys(zip.files).filter(
    name => !zip.files[name].dir
  )

  for (const entryPath of fileEntries) {
    const zipEntry = zip.file(entryPath)
    if (!zipEntry) continue
    const ext = path.extname(entryPath).toLowerCase()

    markdown += `## File Entry: \`${entryPath}\`\n\n`

    try {
      if (['.txt', '.js', '.ts', '.jsx', '.tsx', '.vue', '.json', '.css', '.py', '.go', '.rs', '.sh', '.yml', '.yaml', '.md'].includes(ext)) {
        const text = await zipEntry.async('text')
        markdown += `# ${path.basename(entryPath)}\n\n\`\`\`${ext.replace('.', '')}\n${text}\n\`\`\`\n`
      } else if (['.html', '.htm'].includes(ext)) {
        const text = await zipEntry.async('text')
        markdown += turndown.turndown(text)
      } else if (ext === '.docx') {
        const entryBuffer = await zipEntry.async('nodebuffer')
        const result = await mammoth.convertToHtml({ buffer: entryBuffer })
        markdown += turndown.turndown(result.value)
      } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
        const entryBuffer = await zipEntry.async('nodebuffer')
        const workbook = XLSX.read(entryBuffer, { type: 'buffer' })
        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName]
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
          if (rows.length === 0) return
          markdown += `### Worksheet: ${sheetName}\n\n`
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
      } else if (ext === '.pptx') {
        const entryBuffer = await zipEntry.async('nodebuffer')
        markdown += await parsePptx(entryBuffer, entryPath)
      } else if (ext === '.epub') {
        const entryBuffer = await zipEntry.async('nodebuffer')
        markdown += await parseEpub(entryBuffer, entryPath)
      } else if (ext === '.pdf') {
        const entryBuffer = await zipEntry.async('nodebuffer')
        markdown += await parsePdf(entryBuffer, entryPath)
      } else {
        markdown += `*(Binary file skipped)*\n`
      }
    } catch (err) {
      markdown += `> [!WARNING]\n> Failed to parse zip member \`${entryPath}\`: ${err.message}\n`
    }

    markdown += '\n\n---\n\n'
  }

  return markdown.trim().replace(/\n---\n*$/, '') + '\n'
}

// --------------------- MCP SERVER LAYOUT Setup ---------------------
const server = new Server(
  {
    name: 'cli-doc2md-mcp',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

/**
 * List available tools to Claude
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'parse_local_file',
        description: 'Read and convert any local file (PDF manifest, Word doc, Excel sheet, PPTX slides, EPUB, ZIP, plain text, code) into token-optimized Markdown. Strips heavy URL footings, formatting spaces, and image metadata to shrink Claude prompt context sizes by up to 70%.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'The absolute local file path of the document to load and optimize.'
            },
            stripImages: {
              type: 'boolean',
              description: 'Omit markdown images and alt tags to optimize token usage. Defaults to true.',
              default: true
            },
            stripLinks: {
              type: 'boolean',
              description: 'Keep anchor text but strip long hyperlink URLs to preserve context while removing massive character counts. Defaults to true.',
              default: true
            },
            collapseWhitespace: {
              type: 'boolean',
              description: 'Compress consecutive newlines or trailing blanks to minimize whitespace tokens. Defaults to true.',
              default: true
            },
            compactTables: {
              type: 'boolean',
              description: 'Compress cell spacing inside parsed markdown tables. Defaults to true.',
              default: true
            }
          },
          required: ['filePath']
        }
      }
    ]
  }
})

/**
 * Handle execution requests triggered by Claude
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'parse_local_file') {
    throw new Error('Requested tool does not exist.')
  }

  const {
    filePath,
    stripImages = true,
    stripLinks = true,
    collapseWhitespace = true,
    compactTables = true
  } = request.params.arguments

  const absolutePath = path.resolve(filePath)
  if (!fs.existsSync(absolutePath)) {
    return {
      content: [
        {
          type: 'text',
          text: `[Error] File not found at the specified path: ${absolutePath}`
        }
      ],
      isError: true
    }
  }

  const ext = path.extname(absolutePath).toLowerCase()
  const fileName = path.basename(absolutePath)

  try {
    let rawMarkdown = ''

    // 1. Core Format Router
    if (['.txt', '.js', '.ts', '.jsx', '.tsx', '.vue', '.json', '.css', '.py', '.go', '.rs', '.sh', '.yml', '.yaml', '.md', '.log'].includes(ext)) {
      const text = fs.readFileSync(absolutePath, 'utf8')
      const lang = ext.replace('.', '')
      rawMarkdown = `# File: ${fileName}\n\n\`\`\`${lang}\n${text}\n\`\`\`\n`
    } else if (['.html', '.htm'].includes(ext)) {
      const htmlText = fs.readFileSync(absolutePath, 'utf8')
      rawMarkdown = `# HTML Webpage: ${fileName}\n\n` + turndown.turndown(htmlText)
    } else if (ext === '.docx') {
      const buffer = fs.readFileSync(absolutePath)
      const result = await mammoth.convertToHtml({ buffer })
      rawMarkdown = `# Document: ${path.basename(fileName, '.docx')}\n\n` + turndown.turndown(result.value)
    } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      const buffer = fs.readFileSync(absolutePath)
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      let markdown = `# Sheet Data: ${path.basename(fileName)}\n\n`
      
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
          const cells = Array.from({ length: colCount }).map((_, idx) => {
            const cell = row[idx]
            return cell === undefined || cell === null ? '' : String(cell).replace(/\|/g, '\\|')
          })
          markdown += '| ' + cells.join(' | ') + ' |\n'
        })
        markdown += '\n'
      })
      rawMarkdown = markdown
    } else if (ext === '.pptx') {
      const buffer = fs.readFileSync(absolutePath)
      rawMarkdown = await parsePptx(buffer, absolutePath)
    } else if (ext === '.epub') {
      const buffer = fs.readFileSync(absolutePath)
      rawMarkdown = await parseEpub(buffer, absolutePath)
    } else if (ext === '.zip') {
      const buffer = fs.readFileSync(absolutePath)
      rawMarkdown = await parseZip(buffer, absolutePath, { stripImages, stripLinks, collapseWhitespace, compactTables })
    } else if (ext === '.pdf') {
      const buffer = fs.readFileSync(absolutePath)
      rawMarkdown = await parsePdf(buffer, absolutePath)
    } else {
      const stats = fs.statSync(absolutePath)
      rawMarkdown = `# File: ${fileName}\n\n`
      rawMarkdown += `| Attribute | Value |\n`
      rawMarkdown += `| --- | --- |\n`
      rawMarkdown += `| **Format** | Binary / Unknown (${ext}) |\n`
      rawMarkdown += `| **File Path** | \`${absolutePath}\` |\n`
      rawMarkdown += `| **File Size** | ${(stats.size / 1024).toFixed(1)} KB |\n`
    }

    // 2. Token Saver Squeezer Pipeline
    const optimized = optimizeMarkdown(rawMarkdown, {
      stripImages,
      stripLinks,
      collapseWhitespace,
      compactTables
    })

    return {
      content: [
        {
          type: 'text',
          text: optimized
        }
      ]
    }
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `[Error] Failed to convert local document: ${err.message}`
        }
      ],
      isError: true
    }
  }
})

// --------------------- Server Initialization ---------------------
async function run() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[CLI Doc2MD MCP] Connected on stdio transport.')
}

run().catch((err) => {
  console.error('[CLI Doc2MD MCP] Startup error:', err)
  process.exit(1)
})
