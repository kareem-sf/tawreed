# Tawreed User Guide

Tawreed turns a bill of quantities (BOQ) into a set of clear, procurement-ready work packages. Drop in your BOQ file and Tawreed organizes every line item into grouped work packages you can review, adjust, and approve — then it creates the final workbook files for you.

## What files can I use?

Tawreed accepts:

- Excel workbooks (`.xlsx`, `.xls`)
- CSV and ODS spreadsheets
- PDF documents — including scanned PDFs (Tawreed reads the text off the page automatically)

Both English and Arabic BOQs are supported.

## Step by step

### 1. Add your BOQ

On the opening screen, drag your file onto the window or use **Browse file** to choose it from your computer. Tawreed reads the document on your machine and never changes your original file.

### 2. Choose whether to improve suggestions (optional)

If you've connected an online service (see below), Tawreed will ask: **Improve package suggestions?** It shows you exactly which extracted fields — item descriptions, codes, units, and quantities — would be shared, and only sends them after you say yes for that file. You can always choose **Continue offline** instead, and Tawreed will keep working using its own built-in classification rules.

If you haven't connected any service, Tawreed works entirely offline by default — this step is simply skipped.

### 3. Let it work

While Tawreed processes your file, you'll see plain progress messages — reading the document, classifying items, building work packages. You can cancel at any time; your original file is never touched.

### 4. Review the work packages

Once processing finishes, you land on the review screen. Every work package shows:

- how many items it contains
- its share of the full BOQ
- its total value

A small number of items may be flagged as **needs review** — these are cases Tawreed wasn't fully confident about. Open a package to check its items, and move any item to a different work package if needed. Your corrections are remembered for this project, so Tawreed gets it right automatically next time.

### 5. Approve and generate

When the grouping looks right, click **Approve & generate**. Tawreed builds:

- one master workbook with everything organized by work package
- a separate file for each individual work package, ready to send out for procurement

### 6. Open the result

When generation finishes, use **Open workbook** to open the master file, or **Open packages folder** to see the individual package files. Both are ready to use immediately — nothing further to configure.

## What is a "work package"?

A work package is a group of related BOQ line items — for example, all the concrete works, or all the electrical fit-out items — bundled together as one coherent scope of work. Grouping items into work packages is what makes a BOQ usable for procurement: instead of sending contractors a flat list of thousands of rows, you send each contractor exactly the scope that's relevant to them.

## Connecting an online service (optional)

Tawreed works fully and offline out of the box, using its own built-in classification rules — no account or setup required.

If you want Tawreed to do a better job on ambiguous or unusual item descriptions, you can optionally connect one of these from **Settings → Connection**:

- **ChatGPT account** — sign in with your existing ChatGPT subscription, no separate key needed
- **Anthropic key**, **Gemini key**, or **Grok key** — if you already have an account with one of these AI providers
- **Other service** — an advanced option for connecting any compatible service your organization uses

Whichever you choose, connecting a service never turns it on automatically. In **Settings → For each BOQ**, you decide how it behaves:

- **Ask me every time** (recommended) — Tawreed asks before sending anything, for every file
- **Improve automatically when connected** — skip the prompt and always use the connected service
- **Always work offline** — never use a connected service, even if one is set up

Only the item descriptions, codes, units, and quantities needed to classify that file are ever sent — never the original file itself, and never anything from your other projects. If you'd rather keep everything strictly on this computer, just don't connect a service, or set processing to **Always work offline**.

## Where are my files saved?

Everything Tawreed creates and remembers lives in a single local data folder on your computer (shown to you the first time you use the app). This includes:

- generated master and package workbooks
- your run history
- any connection settings and keys (stored securely by your operating system, not in plain text)

Nothing in this folder is uploaded anywhere. It's yours.

### Finding a past run

Open **History** from the sidebar to see every BOQ you've processed — the date, the file name, how many items became how many work packages, and whether an online service was used. From there you can reopen any past workbook.

## If something doesn't work

Go to **Settings → About**. If Tawreed runs into a problem, you'll find two buttons there:

- **Open logs folder** — opens the folder with Tawreed's activity log, useful if you need to share details with support
- **Report a problem** — opens a place to describe what went wrong

## Languages

Tawreed's interface is available in English and Arabic. Switch anytime from **Settings → Language**.
