# ULDA Bachelor Research Workspace

## Overview

This repository is a public-facing ULDA research and bachelor-project workspace related to the topic:

**Information system of stateless authentication for web services with minimal metadata disclosure. Information and software support for cryptographic subject verification based on ULDA protocols.**

The repository is intended for experimental development, software maintenance coursework, and demonstration of ULDA-based ideas. It should not be interpreted as a production-ready identity platform.

## Relation to the bachelor thesis topic

The main focus of this repository is the ULDA-based approach to cryptographic subject verification and state progression with minimal metadata disclosure.

- `packages/ulda-sign` contains the core signing and verification logic most closely related to the bachelor topic.
- `packages/ulda-front` provides a frontend-oriented integration layer for working with ULDA-backed encrypted records.
- The applications under `applications/` are supporting demos, experiments, and test servers built around those packages.

Although the repository includes a password keeper example, this project is **not** positioned as a generic password manager repository. The password keeper is only a demonstration application used to showcase ULDA integration in a browser-oriented workflow.

## Repository structure

- `packages/ulda-sign`  
  Core ULDA signing functionality and tests. This is the part most directly connected to the research topic.

- `packages/ulda-front`  
  Frontend integration layer for working with ULDA-protected data and transport adapters.

- `applications/example-password-keeper`  
  Demo application that shows one possible user-facing integration of the ULDA approach.

- `applications/ulda-crud`  
  Supporting CRUD-style demo server backed by MySQL for experiments with ULDA state verification.

- `applications/max_speed_test_server`  
  Supporting in-memory test server for performance and stress experiments.

## How to start exploring the repository

There is no single root application entry point. The repository is organized as a workspace of related packages and demo applications.

Suggested starting points:

1. Review `packages/ulda-sign` to inspect the core ULDA-related logic.
2. Review `packages/ulda-front` to understand the frontend-facing integration layer.
3. Open one of the demo applications in `applications/` depending on your focus:
   - `example-password-keeper` for an end-user style demo
   - `ulda-crud` for a MySQL-backed demo server
   - `max_speed_test_server` for performance-oriented experiments

Each application directory contains its own `package.json` and local documentation. Where available, use the scripts documented in those local files instead of assuming a root-level bootstrap command.

## Security and privacy note

This repository is intended to avoid storing private or sensitive information in version control. Example environment files may be included as configuration templates, but they are not secrets and should not be treated as deployed credentials.

The code and demos in this repository are experimental. They are useful for research, coursework, and prototype evaluation, but they do not claim production readiness, full hardening, or a complete operational security model.

## Prototype status

This repository contains demo and research prototype code. It is not production-ready software and should be treated as an experimental workspace for ULDA-related development and evaluation.

## License

This repository is distributed under the MIT License. See the root `LICENSE` file for the full text.
