# GRM CRM

A multi-tenant SaaS CRM and document-generation platform built with Python,
Django, and PostgreSQL.

This is the project foundation only. Business domains (companies,
authentication, clients, documents, templates, audit logging) will be added
later as Django apps under `apps/`.

## Project structure

```text
.
├── manage.py          # Django management entry point
├── config/            # Project configuration (Django project package)
│   ├── settings.py
│   ├── urls.py
│   ├── asgi.py
│   └── wsgi.py
├── apps/              # Future business applications live here
├── requirements/
│   └── base.txt
├── .env               # Local environment variables (gitignored)
├── .env.example       # Template for environment variables
└── README.md
```

## Setup

1. Create and activate a virtual environment:

   ```bash
   python -m venv .venv
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements/base.txt
   ```

3. Configure environment:

   ```bash
   cp .env.example .env   # then edit values as needed
   ```

4. Run checks:

   ```bash
   python manage.py check
   ```

## Requirements

- Python 3.13+
- PostgreSQL (create the database referenced by `DB_NAME` in `.env`)