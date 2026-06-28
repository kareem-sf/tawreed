# Tawreed Architecture

Tawreed follows a clean, modular architecture with clear separation of concerns. This document provides an overview of the key components and their interactions.

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        Tawreed Application                      │
├─────────────────┬─────────────────┬─────────────────┬─────────────┤
│     GUI Layer    │   Core Layer    │   Storage Layer │  AI Layer   │
│  (PySide6/Qt)    │   (Pure Python) │   (SQLite)      │ (LLM APIs)  │
└─────────┬────────┴─────────┬────────┴─────────┬────────┴─────────┘
          │                  │                  │                │
          ▼                  ▼                  ▼                ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  MainWindow     │ │  Excel       │ │  Database   │ │  AI Client  │
│  SplashScreen   │ │  Parser      │ │  (SQLite)   │ │  (Streaming)│
│  Pages          │ │  Writer      │ └─────────────┘ └─────────────┘
│  Widgets        │ │  Validator   │
│  Themes         │ └─────────────┘
└─────────────────┘
```

## Layered Architecture

### 1. GUI Layer (gui/)

The presentation layer built with PySide6 (Qt for Python).

**Key Components:**
- `main_window.py` - Main application shell with navigation
- `splash.py` - Splash screen with progress
- `pages/` - Individual pages (Workspace, History, Settings, About)
- `widgets/` - Reusable UI components (Card, Section, etc.)
- `themes/` - QSS theme files for styling

**Responsibilities:**
- User interaction and interface rendering
- Event handling and state management
- Internationalization (i18n) support
- Theme management (dark/light modes)

### 2. Core Layer (core/)

The business logic layer with no Qt dependencies.

**Key Components:**
- `ai.py` - Multi-provider LLM client with streaming support
- `excel.py` - Excel parsing and writing using openpyxl
- `db.py` - Database operations using SQLite
- `model_catalog.py` - Provider and model catalog
- `reset.py` - Settings reset functionality
- `logging_setup.py` - Logging configuration

**Responsibilities:**
- BOQ Excel file parsing and validation
- Work-package categorization via LLM APIs
- Professional Excel output generation
- Database operations and state management
- Error handling and validation

### 3. Storage Layer

Persistent data storage using SQLite and OS keyring.

**Key Components:**
- SQLite database at `~/.tawreed/db/tawreed.db`
- OS keyring for API key storage (via `keyring` package)
- Configuration files in `~/.tawreed/`

**Data Stored:**
- Processing history
- User settings (non-secret)
- Window state and preferences
- Generated work-package files
- Log files (rotating)

### 4. AI Layer

Language model integration for work-package categorization.

**Key Components:**
- Multi-provider support (OpenAI, Anthropic, Google Gemini)
- Streaming response handling
- Structured JSON output validation
- Error handling and retry logic

**Providers Supported:**
- OpenAI (GPT-4, GPT-3.5-turbo)
- Anthropic Claude (Claude 3 family)
- Google Gemini (via OpenAI-compatible endpoint)
- Any OpenAI-compatible custom endpoint

## Data Flow

### BOQ Processing Flow

```
┌─────────┐       ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  User   │──────▶│  Workspace   │──────▶│  Excel       │──────▶│  AI         │
│  Action │       │  Page        │       │  Parser      │       │  Client     │
└─────────┘       └─────────────┘       └─────────────┘       └─────────────┘
       ▲                  ▲                  ▲                  ▲
       │                  │                  │                  │
┌─────────┐       ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  Output │◀──────│  Excel       │◀──────│  AI         │◀──────│  LLM        │
│  Excel   │       │  Writer      │       │  Response    │       │  Provider   │
└─────────┘       └─────────────┘       └─────────────┘       └─────────────┘
```

1. **User Action**: User drops BOQ Excel file on Workspace page
2. **Excel Parsing**: `core/excel.py` parses the Excel file
3. **AI Categorization**: `core/ai.py` sends items to LLM for categorization
4. **Excel Writing**: `core/excel.py` creates professional output workbook
5. **Output Delivery**: User receives formatted work-package Excel file

### Settings Flow

```
┌─────────┐       ┌─────────────┐       ┌─────────────┐
│  User   │──────▶│  Settings    │──────▶│  Config      │
│  Action │       │  Page        │       │  Manager    │
└─────────┘       └─────────────┘       └─────────────┘
       ▲                  ▲                  ▲
       │                  │                  │
┌─────────┐       ┌─────────────┐       ┌─────────────┐
│  UI      │◀──────│  Settings    │◀──────│  Keyring    │
│  Update  │       │  Page        │       │  (OS Secure │
└─────────┘       └─────────────┘       │  Storage)   │
                                          └─────────────┘
```

1. **User Action**: User changes settings (provider, model, API key)
2. **Settings Page**: Validates and processes changes
3. **Config Manager**: Updates `~/.tawreed/config.json`
4. **Keyring**: Securely stores API keys in OS credential store
5. **UI Update**: Settings page reflects changes and shows confirmation

## Key Design Principles

### 1. Separation of Concerns

- **GUI Layer**: Only handles presentation and user interaction
- **Core Layer**: Contains all business logic, no Qt dependencies
- **Storage Layer**: Handles persistent data, isolated from business logic
- **AI Layer**: Abstracted provider integration

### 2. Local-First Philosophy

- All data stored locally at `~/.tawreed/`
- No cloud sync or telemetry by default
- API keys stored in OS secure credential store
- Single-user desktop application focus

### 3. Privacy-Conscious AI Usage

- User controls when AI is called
- No data sent to AI without explicit user action
- Clear error messages for API failures
- No telemetry or usage tracking

### 4. Professional Excel Output

- Calibri 11 formatting throughout
- Currency-aware amount formulas
- Frozen header rows
- Professional color scheme
- Consistent column widths
- Landscape orientation with repeating headers

### 5. Internationalization

- Full Arabic and English support
- Automatic RTL/LTR layout switching
- Comprehensive translation system
- All UI strings routed through i18n

## Technical Stack

### Core Technologies

- **Python 3.10+**: Primary language
- **PySide6**: Qt for Python (LGPL licensed)
- **qasync**: Async support for PySide6
- **openpyxl**: Excel parsing and writing
- **httpx**: HTTP client for AI API calls
- **keyring**: OS credential store integration
- **SQLite**: Local database storage

### Development Tools

- **pytest**: Testing framework
- **ruff**: Code formatting and linting
- **PyInstaller**: Single-file executable packaging
- **GitHub Actions**: CI/CD pipelines

### Testing Approach

- **Unit Tests**: Fast, isolated tests for core functions
- **Integration Tests**: Test component interactions
- **End-to-End Tests**: Full workflow testing
- **Mocking**: All AI calls are mocked in tests
- **Regression Tests**: Prevent reintroducing fixed bugs

## File Structure

```
tawreed/
├── main.py                  # Entry point
├── tawreed.spec             # PyInstaller spec
├── pyproject.toml           # Build config
├── core/                    # Backend logic
│   ├── ai.py                # AI client
│   ├── excel.py             # Excel operations
│   ├── db.py                # Database
│   ├── logging_setup.py     # Logging config
│   ├── model_catalog.py     # Model catalog
│   └── reset.py             # Reset functionality
├── gui/                     # Qt/PySide6 UI
│   ├── main_window.py       # Main window
│   ├── splash.py            # Splash screen
│   ├── single_app.py        # Single instance
│   ├── pages/               # UI pages
│   ├── widgets/             # Reusable widgets
│   └── themes/              # QSS themes
├── tawreed_app/             # Console entry
├── tests/                   # Test suite
└── docs/                     # Documentation
```

## Performance Considerations

### Memory Optimization

- **Large Excel Files**: Uses openpyxl's `read_only` mode for files >10MB
- **Streaming AI**: Processes responses incrementally as they arrive
- **Efficient Data Structures**: Uses generators where appropriate
- **Virtual Workbook**: For very large files, uses `save_virtual_workbook`

### Error Handling

- **Comprehensive Validation**: Input validation at all layers
- **User-Friendly Errors**: Clear, actionable error messages
- **Graceful Degradation**: Falls back gracefully when features unavailable
- **Crash Recovery**: Rotating logs and crash handlers

## Future Architecture Evolution

### Potential Enhancements

- **Plugin System**: Allow extensions without modifying core
- **Local LLM Support**: Offline processing with Ollama/LM Studio
- **Batch Processing**: Queue system for multiple files
- **Advanced Excel Features**: Custom templates and formatting

### Maintainability Focus

- Keep architecture simple and understandable
- Avoid over-engineering for current scale
- Prefer mature libraries over custom implementations
- Maintain clear separation of concerns
- Keep binary size reasonable for PyInstaller builds

## Conclusion

Tawreed's architecture is designed for reliability, maintainability, and user-friendliness. The clean separation of concerns allows for easy testing, debugging, and future enhancements while keeping the application focused on its core mission: converting BOQ Excel files into professional procurement work-packages using AI assistance.
