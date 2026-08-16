---
id: format/deliverables
kind: cross-cutting
version: 1
description: Producing a document, spreadsheet, deck, page or script — what this runtime can write, and what it must build first.
triggers: [document, report, deck, slides, presentation, spreadsheet, docx, xlsx, pptx, word, excel, powerpoint, pdf, html, page, csv, export, download, attach, file]
tools: []
stages: [plan, act]
outcomes: [outcome/answer, outcome/change, outcome/research]
review: none
---

# Making the thing they asked for

"Write me a report", "put it in a spreadsheet", "make a deck" — the work is not finished
when the content is good. It is finished when there is a file they can open, or when you
have said clearly that there is not one and why.

## What can be written directly, and what cannot

`write_file` takes a **string**. That single fact decides everything below.

**Writable now**, because they are text: HTML, Markdown, CSV and TSV, JSON, YAML, SVG,
plain text, `.ics` calendar files, and source in any language — JavaScript, TypeScript,
Python, SQL, shell.

**Not writable directly**, because they are binary: `.docx`, `.xlsx`, `.pptx`, `.pdf`,
`.png`, `.jpg`, `.zip`. There is no encoding of a binary file that survives being passed
as a string, and the sandbox cannot help — it runs with `--permission` and no filesystem
access at all, so it can compute the content but cannot save it.

Do not attempt a workaround. Base64 into `write_file` produces a text file full of base64.

## Choose the format before you write a word

Ask what they will do with it, not what they named.

- **Read it, print it, send it to someone** → **HTML**, one self-contained file. Styles
  inline, no external fonts or scripts. It opens in every browser, prints to PDF from the
  browser's own dialog, and Word and Pages both import it. This is the right answer far more
  often than it is given.
- **Sort it, filter it, put it in a pivot table** → **CSV**. Excel, Numbers and Sheets all
  open it natively. A CSV that opens is worth more than an `.xlsx` that does not exist.
- **Present it** → an HTML deck: one `<section>` per slide, page breaks between them.
- **Run it** → source, with the extension that matches the language.
- **A genuine Office file, because it goes into someone else's template or workflow** →
  build a tool. That is the next section, and it works.

State the choice and the reason in one line: "HTML rather than .docx, so it opens
everywhere and prints to PDF — say the word if you need a real Word file." Then they can
disagree cheaply, before you have written anything.

## When it really must be .docx, .xlsx or .pptx

Call `build_tool`. Do not report that you cannot make one — you are holding the tool that
makes tools, and this format is genuinely producible.

All three are a **ZIP archive of XML files**. Node's `node:zlib` gives you `deflateRawSync`;
the ZIP container around it is about fifty lines of buffer writing — local header, data,
central directory, end record — and a CRC32 you write yourself. No package is needed, which
matters, because a generated tool has no `node_modules` and an `import` of `docx` or
`exceljs` will not resolve.

Declare `mutating: true`. That is what earns the process `--allow-fs-write`, and a tool
that declares `false` will fail at the moment it tries to save.

The smallest valid `.docx` is three parts:

- `[Content_Types].xml` — declares the `rels` and `xml` defaults and overrides
  `/word/document.xml` as the wordprocessingml main document
- `_rels/.rels` — one relationship pointing at `word/document.xml`
- `word/document.xml` — `<w:document><w:body>`, a `<w:p>` per paragraph, closing `<w:sectPr/>`

`.xlsx` is the same shape with `xl/workbook.xml`, `xl/worksheets/sheet1.xml` and its
relationships; `.pptx` with `ppt/presentation.xml` and one part per slide. Escape `&`, `<`
and `>` in every value you interpolate — one raw ampersand in a customer name makes the
whole file unopenable, and the error a person sees is "the file is corrupt", which tells
them nothing.

Verify before you deliver: read the file back and check it is the size you expect. A
zero-byte file that was written is still a failure.

## Saying what happened

- A file exists only if a `write_file` or a tool call **succeeded**. Not if you planned it,
  not if you produced the content.
- Never write "attached", "ready for download" or "saved" unless one of those returned a
  path. Say the path.
- If nothing was written, say so plainly and put the content in the answer: "Nothing was
  saved to disk; the report is below." That is a complete answer and it is one sentence.
- Writing needs the `assisted` profile and a human approval. On `read-only` the write will
  be refused, so say that up front rather than composing a document you cannot save.
